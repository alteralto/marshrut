'use strict';
// Okapi BM25 over pre-tokenized documents, stored as an inverted index:
// term -> postings (document ids ascending + term frequencies) in typed
// arrays, CSR layout. A query touches only the postings of its own terms, so
// the cost follows the number of matches, not the size of the corpus.
//
// The arithmetic is kept in the same order as a plain "for every document,
// for every query term" loop, so scores are bit-identical to that reference
// (see test/perf.test.js).

function lowerBound(arr, lo, hi, x) {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function countTokens(toks) {
  const m = new Map();
  for (const t of toks) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

class BM25 {
  // docsTokens: iterable of token arrays (consumed once, not retained).
  constructor(docsTokens, opts = {}) {
    const items = (function* gen() {
      for (const toks of docsTokens) yield { counts: countTokens(toks), len: toks.length };
    }());
    this._build(items, opts);
  }

  // items: iterable of { counts: Map term -> tf, len: number of tokens }.
  static fromCounts(items, opts = {}) {
    const self = Object.create(BM25.prototype);
    self._build(items, opts);
    return self;
  }

  _build(items, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.termId = new Map(); // term -> dense id, in order of first appearance
    const dfArr = [];
    const lens = [];
    const fwdIds = []; // per document: Int32Array of term ids
    const fwdTfs = []; // per document: Int32Array of tf
    let total = 0;
    let postings = 0;
    for (const { counts, len } of items) {
      const ids = new Int32Array(counts.size);
      const tfs = new Int32Array(counts.size);
      let j = 0;
      for (const [t, c] of counts) {
        let id = this.termId.get(t);
        if (id === undefined) {
          id = dfArr.length;
          this.termId.set(t, id);
          dfArr.push(0);
        }
        dfArr[id]++;
        ids[j] = id;
        tfs[j] = c;
        j++;
      }
      fwdIds.push(ids);
      fwdTfs.push(tfs);
      lens.push(len);
      total += len;
      postings += counts.size;
    }
    this.N = lens.length;
    this.len = Float64Array.from(lens);
    this.avgLen = this.N ? total / this.N : 0;
    this.maxIdf = Math.log(1 + (this.N + 0.5) / 0.5);

    const nTerms = dfArr.length;
    this.off = new Int32Array(nTerms + 1);
    for (let t = 0; t < nTerms; t++) this.off[t + 1] = this.off[t] + dfArr[t];
    this.postDoc = new Int32Array(postings);
    this.postTf = new Int32Array(postings);
    const cursor = this.off.slice(0, nTerms);
    for (let i = 0; i < this.N; i++) {
      const ids = fwdIds[i];
      const tfs = fwdTfs[i];
      for (let j = 0; j < ids.length; j++) {
        const p = cursor[ids[j]]++;
        this.postDoc[p] = i;
        this.postTf[p] = tfs[j];
      }
    }
    // term -> document frequency, same key order as termId
    this.df = new Map();
    for (const [t, id] of this.termId) this.df.set(t, dfArr[id]);

    this.norm = new Float64Array(this.N);
    for (let i = 0; i < this.N; i++) this.norm[i] = this.k1 * (1 - this.b + this.b * (this.len[i] / (this.avgLen || 1)));
  }

  idf(term) {
    const df = this.df.get(term) || 0;
    return Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
  }

  has(term) {
    return this.df.has(term);
  }

  // Term frequency of `term` in document i (0 if absent).
  tfOf(term, i) {
    const id = this.termId.get(term);
    if (id === undefined) return 0;
    const hi = this.off[id + 1];
    const p = lowerBound(this.postDoc, this.off[id], hi, i);
    return p < hi && this.postDoc[p] === i ? this.postTf[p] : 0;
  }

  // Sets mark[d] = stamp for every document d that contains `term` and is not
  // stamped yet; returns how many documents were newly stamped. With one
  // stamp per group of terms this counts the union of their postings.
  stamp(term, mark, stamp) {
    const id = this.termId.get(term);
    if (id === undefined) return 0;
    const { postDoc } = this;
    let n = 0;
    for (let p = this.off[id], hi = this.off[id + 1]; p < hi; p++) {
      const d = postDoc[p];
      if (mark[d] !== stamp) { mark[d] = stamp; n++; }
    }
    return n;
  }

  // weighted: Map term -> weight (1 for query words, <1 for expansions)
  scoreDoc(weighted, i) {
    const norm = this.norm[i];
    let s = 0;
    for (const [q, w] of weighted) {
      const f = this.tfOf(q, i);
      if (!f) continue;
      s += w * this.idf(q) * (f * (this.k1 + 1)) / (f + norm);
    }
    return s;
  }

  // queryTerms: array of terms or Map term -> weight.
  // Returns Float64Array of scores for every document.
  scores(queryTerms) {
    const weighted = queryTerms instanceof Map ? queryTerms : new Map([...new Set(queryTerms)].map((t) => [t, 1]));
    const out = new Float64Array(this.N);
    const { postDoc, postTf, off, norm } = this;
    const k1p = this.k1 + 1;
    for (const [q, w] of weighted) {
      const id = this.termId.get(q);
      if (id === undefined) continue;
      const wIdf = w * this.idf(q);
      for (let p = off[id], hi = off[id + 1]; p < hi; p++) {
        const d = postDoc[p];
        const f = postTf[p];
        out[d] += wIdf * (f * k1p) / (f + norm[d]);
      }
    }
    return out;
  }

  // BM25 with statistics local to the documents [start, end): what a separate
  // BM25 built over just those documents would give, without building it.
  range(start, end) {
    return new RangeBM25(this, start, end);
  }
}

class RangeBM25 {
  constructor(parent, start, end) {
    this.parent = parent;
    this.start = start;
    this.end = end;
    this.N = end - start;
    this.k1 = parent.k1;
    this.b = parent.b;
    let total = 0;
    for (let i = start; i < end; i++) total += parent.len[i];
    this.avgLen = this.N ? total / this.N : 0;
    this.norm = new Float64Array(this.N);
    for (let i = 0; i < this.N; i++) this.norm[i] = this.k1 * (1 - this.b + this.b * (parent.len[start + i] / (this.avgLen || 1)));
  }

  // Returns Float64Array aligned with [start, end).
  scores(queryTerms) {
    const weighted = queryTerms instanceof Map ? queryTerms : new Map([...new Set(queryTerms)].map((t) => [t, 1]));
    const out = new Float64Array(this.N);
    const { postDoc, postTf, off, termId } = this.parent;
    const { start, end, norm, N } = this;
    const k1p = this.k1 + 1;
    for (const [q, w] of weighted) {
      const id = termId.get(q);
      if (id === undefined) continue;
      const lo = lowerBound(postDoc, off[id], off[id + 1], start);
      const hi = lowerBound(postDoc, lo, off[id + 1], end);
      const df = hi - lo;
      if (!df) continue;
      const wIdf = w * Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (let p = lo; p < hi; p++) {
        const d = postDoc[p] - start;
        const f = postTf[p];
        out[d] += wIdf * (f * k1p) / (f + norm[d]);
      }
    }
    return out;
  }
}

module.exports = { BM25, RangeBM25, countTokens };
