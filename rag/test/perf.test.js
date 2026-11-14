'use strict';
// The fast paths must give exactly what the plain ones give:
//   - inverted-index BM25 vs. a "for every document, for every term" loop;
//   - BM25.range() vs. a separate BM25 built over the same slice;
//   - bucketed query expansion vs. a scan of the whole vocabulary.
// "Exactly" means bit for bit: rankings are fused by rank, a last-digit
// difference could reorder a tie.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BM25, countTokens } = require('../src/bm25');
const { expandQuery, buildVocabIndex, neighbours, retrieve } = require('../src/retrieve');
const { prepare } = require('../src/store');
const { queryTerms } = require('../src/text');
const { fixtureStore, OFFLINE } = require('./helpers');

// Reference: the straightforward implementation the index replaced.
class NaiveBM25 {
  constructor(docsTokens, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.N = docsTokens.length;
    this.len = new Float64Array(this.N);
    this.tf = [];
    this.df = new Map();
    let total = 0;
    docsTokens.forEach((toks, i) => {
      const m = new Map();
      for (const t of toks) m.set(t, (m.get(t) || 0) + 1);
      this.tf.push(m);
      this.len[i] = toks.length;
      total += toks.length;
      for (const t of m.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
    });
    this.avgLen = this.N ? total / this.N : 0;
  }

  idf(term) {
    const df = this.df.get(term) || 0;
    return Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
  }

  scoreDoc(weighted, i) {
    const m = this.tf[i];
    const norm = this.k1 * (1 - this.b + this.b * (this.len[i] / (this.avgLen || 1)));
    let s = 0;
    for (const [q, w] of weighted) {
      const f = m.get(q);
      if (!f) continue;
      s += w * this.idf(q) * (f * (this.k1 + 1)) / (f + norm);
    }
    return s;
  }

  scores(weighted) {
    const out = new Float64Array(this.N);
    for (let i = 0; i < this.N; i++) out[i] = this.scoreDoc(weighted, i);
    return out;
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random corpus: skewed term frequencies, some empty and some very long documents.
function randomCorpus(rnd, nDocs, nTerms) {
  const term = () => `t${Math.floor(nTerms * rnd() ** 2.5)}`;
  const docs = [];
  for (let i = 0; i < nDocs; i++) {
    const r = rnd();
    const len = r < 0.05 ? 0 : r > 0.97 ? 300 + Math.floor(rnd() * 300) : 1 + Math.floor(rnd() * 60);
    const toks = [];
    for (let k = 0; k < len; k++) toks.push(term());
    docs.push(toks);
  }
  return docs;
}

function randomQuery(rnd, nTerms) {
  const w = new Map();
  const n = 1 + Math.floor(rnd() * 12);
  for (let k = 0; k < n; k++) {
    const t = rnd() < 0.1 ? `absent${k}` : `t${Math.floor(nTerms * rnd() ** 2)}`;
    w.set(t, [1, 0.8, 0.6, 0.48][Math.floor(rnd() * 4)]);
  }
  return w;
}

function sameBits(actual, expected, what) {
  assert.equal(actual.length, expected.length, `${what}: length`);
  for (let i = 0; i < expected.length; i++) {
    if (!Object.is(actual[i], expected[i])) assert.fail(`${what}: [${i}] ${actual[i]} != ${expected[i]}`);
  }
}

test('inverted-index BM25 equals the naive loop bit for bit', () => {
  const rnd = mulberry32(20261111);
  for (const [nDocs, nTerms] of [[1, 5], [7, 20], [200, 150], [600, 2000]]) {
    const docs = randomCorpus(rnd, nDocs, nTerms);
    const fast = new BM25(docs);
    const ref = new NaiveBM25(docs);
    assert.equal(fast.N, ref.N);
    assert.equal(fast.avgLen, ref.avgLen);
    assert.deepEqual([...fast.df], [...ref.df], 'df map, including key order');
    for (let q = 0; q < 60; q++) {
      const w = randomQuery(rnd, nTerms);
      sameBits(fast.scores(w), ref.scores(w), `scores, ${nDocs} docs, query ${q}`);
      const i = Math.floor(rnd() * nDocs);
      assert.ok(Object.is(fast.scoreDoc(w, i), ref.scoreDoc(w, i)), 'scoreDoc');
      const [t] = w.keys();
      assert.equal(fast.idf(t), ref.idf(t));
      assert.equal(fast.has(t), ref.df.has(t));
      assert.equal(fast.tfOf(t, i), ref.tf[i].get(t) || 0);
    }
    // plain array of terms: every term with weight 1, duplicates ignored
    sameBits(fast.scores(['t0', 't1', 't0', 'nope']), ref.scores(new Map([['t0', 1], ['t1', 1], ['nope', 1]])), 'array query');
  }
});

test('BM25 built from term counts equals BM25 built from tokens', () => {
  const rnd = mulberry32(5);
  const docs = randomCorpus(rnd, 120, 90);
  const a = new BM25(docs);
  const b = BM25.fromCounts(docs.map((toks) => ({ counts: countTokens(toks), len: toks.length })));
  for (let q = 0; q < 30; q++) {
    const w = randomQuery(rnd, 90);
    sameBits(b.scores(w), a.scores(w), 'fromCounts');
  }
});

test('BM25.range equals a separate BM25 over the same documents', () => {
  const rnd = mulberry32(77);
  const docs = randomCorpus(rnd, 400, 300);
  const all = new BM25(docs);
  for (let r = 0; r < 40; r++) {
    const start = Math.floor(rnd() * 400);
    const end = Math.min(400, start + Math.floor(rnd() * 120));
    const local = all.range(start, end);
    const ref = new NaiveBM25(docs.slice(start, end));
    assert.equal(local.N, ref.N);
    for (let q = 0; q < 10; q++) {
      const w = randomQuery(rnd, 300);
      sameBits(local.scores(w), ref.scores(w), `range [${start}, ${end})`);
    }
  }
});

test('stamp counts the union of postings', () => {
  const docs = [['a', 'b'], ['b'], ['c'], [], ['a', 'c', 'c']];
  const bm = new BM25(docs);
  const mark = new Int32Array(docs.length);
  assert.equal(bm.stamp('a', mark, 1) + bm.stamp('c', mark, 1) + bm.stamp('zzz', mark, 1), 3);
  assert.deepEqual([...mark], [1, 0, 1, 0, 1]);
  assert.equal(bm.stamp('b', mark, 2), 2);
});

test('bucketed expansion equals a scan of the whole vocabulary', async () => {
  const store = await fixtureStore();
  const vocab = store.vocab;
  assert.ok(vocab.length > 200, 'fixture vocabulary is loaded');
  const bucketed = buildVocabIndex(vocab);

  // every stem of the vocabulary, the stems of the evaluation questions, and
  // made-up near misses (one letter changed or dropped at the end)
  const terms = new Set(vocab);
  for (const f of ['eval-questions.json', 'eval-holdout.json', 'real-dev.json', 'real-test.json']) {
    const p = path.join(__dirname, '..', 'fixtures', f);
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const q of (j.questions || j)) for (const x of queryTerms(q.question || '')) terms.add(x.t);
  }
  for (const v of vocab) {
    if (v.length < 5) continue;
    terms.add(v.slice(0, -1));
    terms.add(`${v.slice(0, -1)}щ`);
    terms.add(`${v}ова`);
  }
  let withNeighbours = 0;
  for (const t of terms) {
    const naive = expandQuery([t], vocab, 0.6);
    const fast = expandQuery([t], bucketed, 0.6);
    assert.deepEqual([...fast.weighted], [...naive.weighted], `weights of "${t}", including order`);
    assert.deepEqual([...fast.groups.get(t)], [...naive.groups.get(t)], `group of "${t}"`);
    if (naive.weighted.size > 1) withNeighbours++;
  }
  assert.ok(withNeighbours > 100, 'the comparison is not vacuous');
  // several terms at once, second lookup served from the cache
  const many = [...terms].slice(0, 40);
  assert.deepEqual([...expandQuery(many, bucketed, 0.6).weighted], [...expandQuery(many, vocab, 0.6).weighted]);
});

test('neighbours always share a 5-letter prefix', async () => {
  const store = await fixtureStore();
  const vocab = store.vocab.filter((v) => v.length >= 5);
  const rnd = mulberry32(3);
  for (let k = 0; k < 20000; k++) {
    const a = vocab[Math.floor(rnd() * vocab.length)];
    const b = rnd() < 0.5 ? `${a.slice(0, 4 + Math.floor(rnd() * 4))}${vocab[Math.floor(rnd() * vocab.length)].slice(-3)}` : vocab[Math.floor(rnd() * vocab.length)];
    if (neighbours(a, b)) assert.equal(a.slice(0, 5), b.slice(0, 5), `${a} / ${b}`);
  }
});

test('a document whose clauses are scattered across the index is still searched', async () => {
  const store = await fixtureStore();
  const { index } = store;
  // interleave the clauses of all documents, keeping the order inside each one
  const queues = index.docs.map((d) => store.docChunks.get(d.id).map((i) => index.chunks[i]));
  const mixed = [];
  for (let k = 0; queues.some((q) => k < q.length); k++) for (const q of queues) if (k < q.length) mixed.push(q[k]);
  assert.equal(mixed.length, index.chunks.length);
  const scattered = prepare({ ...index, chunks: mixed, embeddings: null });
  assert.ok([...scattered.docRange.values()].some((r) => r === null), 'ranges are not contiguous any more');
  assert.ok(index.docs.every((d) => !store.docChunks.get(d.id).length || store.docRange.get(d.id)), 'a normal index is contiguous');

  const questions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'eval-questions.json'), 'utf8')).questions.slice(0, 25);
  for (const q of questions) {
    const a = await retrieve(store, q.question, OFFLINE);
    const b = await retrieve(scattered, q.question, OFFLINE);
    assert.equal(b.notFound, a.notFound, q.question);
    assert.equal(b.primary && b.primary.docId, a.primary && a.primary.docId, q.question);
    assert.deepEqual(b.context.map((c) => c.id).sort(), a.context.map((c) => c.id).sort(), q.question);
  }
});
