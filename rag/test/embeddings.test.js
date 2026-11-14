'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { buildIndex, prepare } = require('../src/store');
const { retrieve } = require('../src/retrieve');
const { tokens } = require('../src/text');
const { FIXTURES } = require('./helpers');

// Fake /v1/embeddings: hashed bag of stems, 128 dims. Enough to check the
// plumbing (vectors stored, query embedded, dense list fused) end to end.
function hashVec(text) {
  const v = new Array(128).fill(0);
  for (const t of tokens(text)) {
    let h = 0;
    for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 128] += 1;
  }
  return v;
}

function mockEmbeddings() {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      calls++;
      const body = JSON.parse(data);
      const input = Array.isArray(body.input) ? body.input : [body.input];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: body.model, data: input.map((t, index) => ({ index, embedding: hashVec(t) })) }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    calls: () => calls,
    close: () => server.close(),
  })));
}

test('hybrid retrieval: vectors are built at ingest and fused at query time', async () => {
  const m = await mockEmbeddings();
  try {
    const opts = { embedBaseUrl: m.url, embedModel: 'mock-embed', embedApiKey: '' };
    const index = await buildIndex([FIXTURES], opts);
    assert.equal(index.embeddings.model, 'mock-embed');
    assert.equal(index.embeddings.dim, 128);
    const store = prepare(JSON.parse(JSON.stringify(index))); // round-trip like a saved file
    assert.equal(store.vectors.length, index.chunks.length);

    const r = await retrieve(store, 'потерял пропуск, что делать', { ...opts, synonymsFile: null });
    assert.equal(r.diagnostics.dense, true);
    assert.equal(r.primary.docId, 'propusk');
    assert.equal(typeof r.docs[0].dense, 'number');

    // another model at query time: dense part is skipped with a warning
    const r2 = await retrieve(store, 'потерял пропуск', { ...opts, embedModel: 'other' });
    assert.equal(r2.diagnostics.dense, false);
    assert.ok(r2.warnings.some((w) => /model mismatch/.test(w)));

    // no endpoint at query time: BM25 only, still answers
    const r3 = await retrieve(store, 'потерял пропуск', { embedBaseUrl: '' });
    assert.equal(r3.diagnostics.dense, false);
    assert.equal(r3.primary.docId, 'propusk');
  } finally {
    m.close();
  }
});

test('ingest without an embedding endpoint (or with a dead one) still builds a BM25 index', async () => {
  const none = await buildIndex([FIXTURES], { embedBaseUrl: '' });
  assert.equal(none.embeddings, null);
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const dead = await buildIndex([FIXTURES], { embedBaseUrl: 'http://127.0.0.1:9', embedTimeoutMs: 2000 });
    assert.equal(dead.embeddings, null);
  } finally {
    console.warn = origWarn;
  }
});
