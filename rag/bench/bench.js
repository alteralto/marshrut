#!/usr/bin/env node
'use strict';
// Speed check of the core without any model: index load, question latency,
// behaviour on a corpus 10 and 50 times bigger, HTTP throughput.
//
//   node bench/bench.js [--index data/real-index.json] [--dense-index data/real-index-bge.json]
//                       [--scales 1,10,50] [--rounds 5] [--rag <dir with src/>] [--json]
//
// Each scale runs in its own process so that memory numbers do not mix.
// The dense rows use made-up query vectors (a blend of two clause vectors):
// they measure the search itself, the call to the embedding model is extra.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

const A = args(process.argv.slice(2));
const RAG = path.resolve(A.rag || path.join(__dirname, '..'));
const INDEX = path.resolve(A.index || path.join(__dirname, '..', 'data', 'real-index.json'));
const DENSE_INDEX = path.resolve(A['dense-index'] || path.join(__dirname, '..', 'data', 'real-index-bge.json'));
const ROUNDS = Number(A.rounds || 5);

const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const now = () => process.hrtime.bigint();

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

function stats(times) {
  const s = times.slice().sort((a, b) => a - b);
  const p = (x) => s[Math.min(s.length - 1, Math.floor(s.length * x))];
  return { p50: p(0.5), p95: p(0.95), max: s[s.length - 1] };
}

function questions() {
  const out = [];
  for (const f of ['real-dev.json', 'real-test.json']) {
    const p = path.join(__dirname, '..', 'fixtures', f);
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const q of (j.questions || j)) if (q.question) out.push(q.question);
  }
  if (!out.length) out.push('как оформить командировку', 'в какой срок сдать авансовый отчёт', 'закупка у единственного поставщика');
  return out;
}

// Pseudo-words appended to the copies: every copy gets its own mix, so the
// document frequencies of the big corpus are not just the original ones x N.
const SYL = ['ба', 'ве', 'го', 'ду', 'жи', 'за', 'ки', 'ло', 'му', 'не', 'пи', 'ро', 'су', 'та', 'фе', 'хо', 'ци', 'ча', 'шу', 'щи'];
function pseudoWord(n) {
  return SYL[n % 20] + SYL[Math.floor(n / 20) % 20] + SYL[Math.floor(n / 400) % 20] + 'р';
}

// index x times, with distinct document ids; copy 0 is the original.
function replicate(index, times) {
  if (times === 1) return index;
  const rnd = mulberry32(20261110);
  const docs = [];
  const chunks = [];
  const keptVec = [];
  const byDoc = new Map(index.docs.map((d) => [d.id, []]));
  index.chunks.forEach((c, i) => byDoc.get(c.docId).push(i));
  for (let k = 0; k < times; k++) {
    for (const d of index.docs) {
      const id = k ? `${d.id}~${k}` : d.id;
      let n = 0;
      for (const i of byDoc.get(d.id)) {
        const c = index.chunks[i];
        // a copy loses about a tenth of its clauses and gains three pseudo-words per clause
        if (k && rnd() < 0.1 && n > 0) continue;
        const extra = k ? ` ${pseudoWord(Math.floor(rnd() * 8000))} ${pseudoWord(Math.floor(rnd() * 8000))} ${pseudoWord(Math.floor(rnd() * 400))}` : '';
        chunks.push({ ...c, id: `${id}#${c.clauseId}`, docId: id, text: c.text + extra });
        keptVec.push(i);
        n++;
      }
      docs.push({ ...d, id, title: k ? `${d.title} (вариант ${k})` : d.title, chunkCount: n });
    }
  }
  const out = { ...index, docs, chunks, embeddings: null };
  if (index.embeddings && index.embeddings.data) {
    const dim = index.embeddings.dim;
    const buf = Buffer.from(index.embeddings.data, 'base64');
    const flat = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const big = new Float32Array(chunks.length * dim);
    keptVec.forEach((src, j) => big.set(flat.subarray(src * dim, (src + 1) * dim), j * dim));
    out.embeddings = { model: index.embeddings.model, dim, data: Buffer.from(big.buffer).toString('base64') };
  }
  return out;
}

function queryVectors(index, n) {
  const dim = index.embeddings.dim;
  const buf = Buffer.from(index.embeddings.data, 'base64');
  const flat = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const total = flat.length / dim;
  const rnd = mulberry32(7);
  const out = [];
  for (let q = 0; q < n; q++) {
    const a = Math.floor(rnd() * total);
    const b = Math.floor(rnd() * total);
    const v = new Float32Array(dim);
    let s = 0;
    for (let i = 0; i < dim; i++) { v[i] = 0.7 * flat[a * dim + i] + 0.3 * flat[b * dim + i]; s += v[i] * v[i]; }
    s = Math.sqrt(s) || 1;
    for (let i = 0; i < dim; i++) v[i] /= s;
    out.push(v);
  }
  return out;
}

async function measureAsk(rag, store, qs, vecs) {
  const base = { store, mode: 'extractive', embedBaseUrl: '' };
  const run = (k) => rag.ask(qs[k], vecs ? { ...base, queryVector: vecs[k], embedModel: store.embedModel } : base);
  for (let k = 0; k < qs.length; k++) await run(k); // warm-up
  const times = [];
  for (let r = 0; r < ROUNDS; r++) {
    for (let k = 0; k < qs.length; k++) {
      const t0 = now();
      await run(k);
      times.push(ms(t0));
    }
  }
  return stats(times);
}

async function httpThroughput(store, qs) {
  const { createServer } = require(path.join(RAG, 'server.js'));
  const server = createServer({ store, askOpts: { mode: 'extractive', embedBaseUrl: '' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
  const total = 2000;
  const concurrency = 16;
  let sent = 0;
  let failed = 0;
  const times = [];
  const one = () => new Promise((resolve) => {
    const body = JSON.stringify({ question: qs[sent % qs.length] });
    sent++;
    const t0 = now();
    const req = http.request({ host: '127.0.0.1', port, path: '/ask', method: 'POST', agent, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      res.resume();
      res.on('end', () => { if (res.statusCode !== 200) failed++; times.push(ms(t0)); resolve(); });
    });
    req.on('error', () => { failed++; resolve(); });
    req.end(body);
  });
  for (let k = 0; k < 64; k++) await one(); // warm-up
  sent = 0; times.length = 0; failed = 0;
  const t0 = now();
  await Promise.all(Array.from({ length: concurrency }, async () => { while (sent < total) await one(); }));
  const wall = ms(t0);
  agent.destroy();
  await new Promise((r) => server.close(r));
  return { requests: times.length, failed, concurrency, rps: times.length / (wall / 1000), ...stats(times) };
}

async function child(scale) {
  const rag = require(path.join(RAG, 'src'));
  const { prepare } = require(path.join(RAG, 'src', 'store'));
  const qs = questions();
  const res = { scale };

  let t0 = now();
  const raw = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const parseMs = ms(t0);
  const index = replicate(raw, scale);
  t0 = now();
  let store = prepare(index);
  res.prepareMs = ms(t0);
  if (scale === 1) res.loadMs = parseMs + res.prepareMs;
  res.docs = index.docs.length;
  res.chunks = index.chunks.length;
  res.lexical = await measureAsk(rag, store, qs, null);
  if (global.gc) global.gc();
  res.rssMb = process.memoryUsage().rss / 1e6;
  res.heapMb = process.memoryUsage().heapUsed / 1e6;
  if (scale === 1) res.http = await httpThroughput(store, qs);

  if (scale <= 10 && fs.existsSync(DENSE_INDEX)) {
    store = null;
    const rawD = JSON.parse(fs.readFileSync(DENSE_INDEX, 'utf8'));
    const vecs = queryVectors(rawD, qs.length);
    const indexD = replicate(rawD, scale);
    t0 = now();
    const storeD = prepare(indexD);
    res.densePrepareMs = ms(t0);
    res.dense = await measureAsk(rag, storeD, qs, vecs);
    // did the vectors take part? (a core without the queryVector option ignores them)
    const probe = await rag.ask(qs[0], { store: storeD, mode: 'extractive', embedBaseUrl: '', queryVector: vecs[0], embedModel: storeD.embedModel });
    res.denseUsed = !!(probe.diagnostics && probe.diagnostics.retrieval && probe.diagnostics.retrieval.dense);
  }
  process.stdout.write(`\n@@RESULT@@${JSON.stringify(res)}\n`);
}

function f(x, d = 1) {
  return x == null ? '—' : x.toFixed(d);
}

function main() {
  const scales = String(A.scales || '1,10,50').split(',').map(Number).filter(Boolean);
  const results = [];
  for (const s of scales) {
    const r = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=12288', __filename, '--child', String(s),
      '--rag', RAG, '--index', INDEX, '--dense-index', DENSE_INDEX, '--rounds', String(ROUNDS)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const m = /@@RESULT@@(.*)/.exec(r.stdout || '');
    if (!m) {
      console.error(`scale x${s} failed: ${(r.stderr || '').split('\n').slice(-6).join('\n')}`);
      results.push({ scale: s, failed: true });
      continue;
    }
    results.push(JSON.parse(m[1]));
  }
  if (A.json) { console.log(JSON.stringify(results, null, 2)); return; }

  const rows = [['корпус', 'документов', 'пунктов', 'подготовка индекса, мс', 'ответ p50, мс', 'p95, мс', 'макс., мс', 'память RSS, МБ']];
  for (const r of results) {
    if (r.failed) { rows.push([`×${r.scale}`, 'не выполнилось', '', '', '', '', '', '']); continue; }
    rows.push([`×${r.scale}`, String(r.docs), String(r.chunks), f(r.prepareMs, 0), f(r.lexical.p50, 2), f(r.lexical.p95, 2), f(r.lexical.max, 1), f(r.rssMb, 0)]);
    if (r.dense) rows.push([`×${r.scale} + векторы${r.denseUsed ? '' : ' (не использованы)'}`, String(r.docs), String(r.chunks), f(r.densePrepareMs, 0), f(r.dense.p50, 2), f(r.dense.p95, 2), f(r.dense.max, 1), '']);
  }
  console.log(rows.map((r) => `| ${r.join(' | ')} |`).join('\n'));
  const one = results.find((r) => r.scale === 1 && !r.failed);
  if (one) {
    console.log(`\nЗагрузка индекса с диска (чтение JSON + подготовка): ${f(one.loadMs, 0)} мс`);
    if (one.http) console.log(`HTTP POST /ask, ${one.http.concurrency} одновременных, ${one.http.requests} запросов: ${f(one.http.rps, 0)} запросов/с, p50 ${f(one.http.p50, 1)} мс, p95 ${f(one.http.p95, 1)} мс, ошибок ${one.http.failed}`);
  }
}

if (A.child) child(Number(A.child)).catch((e) => { console.error(e); process.exit(1); });
else main();
