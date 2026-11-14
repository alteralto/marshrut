'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { fixtureStore, OFFLINE } = require('./helpers');

async function withServer(fn) {
  const store = await fixtureStore();
  const server = createServer({ store, indexPath: '(memory)', askOpts: OFFLINE });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const post = (base, body) => fetch(`${base}/ask`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('POST /ask returns the answer shape the UI relies on', async () => {
  await withServer(async (base) => {
    const res = await post(base, { question: 'как получить аванс перед командировкой' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const a = await res.json();
    assert.equal(a.not_found, false);
    assert.equal(a.document.id, 'komandirovki');
    assert.equal(a.document.source, '/doc/komandirovki');
    assert.ok(Array.isArray(a.steps) && a.steps.length > 0);
    for (const s of a.steps) {
      assert.equal(typeof s.n, 'number');
      assert.equal(typeof s.text, 'string');
      assert.equal(typeof s.verified, 'boolean');
      assert.ok(s.cites.length > 0);
      for (const c of s.cites) {
        for (const k of ['doc', 'docTitle', 'clause', 'label', 'quote', 'anchor']) assert.ok(c[k], `cite.${k}`);
      }
    }
    assert.ok('clarifying_question' in a);
    assert.ok(Array.isArray(a.rejected_steps));
    assert.ok(Array.isArray(a.candidates));
  });
});

test('POST /ask: not found, bad input', async () => {
  await withServer(async (base) => {
    const nf = await (await post(base, { question: 'какой рецепт борща' })).json();
    assert.equal(nf.not_found, true);
    assert.deepEqual(nf.steps, []);
    assert.equal((await post(base, {})).status, 400);
    assert.equal((await post(base, '{oops')).status, 400);
  });
});

test('GET /doc/:id gives clauses with anchors that /ask cites point to', async () => {
  await withServer(async (base) => {
    const a = await (await post(base, { question: 'потерял пропуск, что делать' })).json();
    const cite = a.steps[0].cites[0];
    const doc = await (await fetch(`${base}${a.document.source}`)).json();
    assert.equal(doc.id, 'propusk');
    const node = doc.nodes.find((n) => n.anchor === cite.anchor);
    assert.ok(node, `anchor ${cite.anchor}`);
    assert.equal(node.text, cite.quote);
    const html = await (await fetch(`${base}/doc/propusk?format=html&hl=${encodeURIComponent(cite.clause)}`)).text();
    assert.match(html, new RegExp(`id="${cite.anchor}" class="clause hl"`));
    assert.equal((await fetch(`${base}/doc/nope`)).status, 404);
  });
});

test('GET /health, GET /docs, CORS preflight', async () => {
  await withServer(async (base) => {
    const h = await (await fetch(`${base}/health`)).json();
    assert.equal(h.ok, true);
    assert.equal(h.docs, 8);
    assert.equal(h.llm.configured, false);
    const docs = await (await fetch(`${base}/docs`)).json();
    assert.equal(docs.length, 8);
    const pre = await fetch(`${base}/ask`, { method: 'OPTIONS', headers: { origin: 'http://ui.local', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  });
});
