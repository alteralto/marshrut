'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const rag = require('../src');
const { chat, llmConfig } = require('../src/openai');
const { redactPeople } = require('../src/redact');
const { fixMixedScript } = require('../src/verify');
const { fixtureStore, OFFLINE } = require('./helpers');

// A fake GigaChat: /oauth gives tokens, /chat/completions wants the latest one.
function mockGigachat(reply) {
  const seen = { tokens: 0, chats: [], prompts: [] };
  let current = null;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (req.url === '/oauth') {
        assert.equal(req.headers.authorization, 'Basic secret-key');
        assert.ok(req.headers.rquid);
        current = `token-${++seen.tokens}`;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: current, expires_at: Date.now() + 30 * 60000 }));
        return;
      }
      seen.chats.push(req.headers.authorization);
      if (req.headers.authorization !== `Bearer ${current}`) { res.writeHead(401).end('{}'); return; }
      const body = JSON.parse(data);
      seen.prompts.push(body.messages.map((m) => m.content).join('\n'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply ? reply(body) : 'ok' } }] }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    process.env.GIGACHAT_BASE_URL = `${base}/v1`;
    process.env.GIGACHAT_AUTH_URL = `${base}/oauth`;
    resolve({ seen, expire: () => { current = 'expired'; }, close: () => { server.close(); delete process.env.GIGACHAT_BASE_URL; delete process.env.GIGACHAT_AUTH_URL; } });
  }));
}

test('GigaChat: one token for many requests, a new one after 401', async () => {
  const m = await mockGigachat();
  try {
    const cfg = llmConfig({ llmBaseUrl: '', gigachatCredentials: 'secret-key' });
    assert.equal(cfg.external, true);
    await chat([{ role: 'user', content: 'a' }], cfg);
    await chat([{ role: 'user', content: 'b' }], cfg);
    assert.equal(m.seen.tokens, 1);
    m.expire();
    const { content } = await chat([{ role: 'user', content: 'c' }], cfg);
    assert.equal(content, 'ok');
    assert.equal(m.seen.tokens, 2);
  } finally {
    m.close();
  }
});

test('names, phones and e-mails are cut, positions stay', () => {
  const text = 'Контроль возложить на проректора по экономике Е.В. Крылову. Согласовано: Морозова Оксана Борисовна, Семенов А.И.; тел. +7 (495) 408-45-54, kmo@mipt.ru';
  const out = redactPeople(text);
  assert.doesNotMatch(out, /Крылов|Морозова|Оксана|Семенов|408|kmo@/);
  assert.match(out, /проректора по экономике \[ФИО\]/);
  assert.equal(redactPeople('Утвердить Регламент согласования смет доходов и расходов МФТИ'), 'Утвердить Регламент согласования смет доходов и расходов МФТИ');
});

test('a word with Latin letters is put back from the cited text', () => {
  assert.deepEqual(fixMixedScript('Курирующий проректор/дirector утверждает', 'Курирующий проректор/ директор по направлению утверждает сметы'),
    { text: 'Курирующий проректор/директор утверждает', bad: false });
  assert.equal(fixMixedScript('Сдайте отчёт в бuхгалтерию', 'Отчёт сдаётся в кассу').bad, true);
});

test('a closed document never goes to an external model', async () => {
  const store = await fixtureStore();
  const m = await mockGigachat(() => '{"document":"D1","steps":[],"not_found":true}');
  try {
    const opts = { ...OFFLINE, gigachatCredentials: 'secret-key', store };
    const closed = await rag.ask('потерял пропуск, что делать', { ...opts, mayLeave: () => false });
    assert.equal(m.seen.chats.length, 0);
    assert.equal(closed.mode, 'extractive');
    assert.ok(closed.steps.length > 0);
    await rag.ask('потерял пропуск, что делать', { ...opts, mayLeave: () => true });
    assert.equal(m.seen.prompts.length, 1);
    assert.doesNotMatch(m.seen.prompts[0], /secret-key/);
  } finally {
    m.close();
  }
});

test('a short answer with no steps keeps the answer: clauses become the steps', async () => {
  const store = await fixtureStore();
  const m = await mockGigachat((body) => {
    const id = (body.messages[1].content.match(/^\[(D1:[^\]]+)\]/m) || [])[1];
    return JSON.stringify({ document: 'D1', summary: { text: 'Сообщите об утрате пропуска.', cites: [id] }, steps: [], not_found: true });
  });
  try {
    const a = await rag.ask('потерял пропуск, что делать', { ...OFFLINE, gigachatCredentials: 'secret-key', store });
    assert.equal(a.not_found, false);
    assert.equal(a.mode, 'llm+extractive');
    assert.ok(a.steps.length > 0);
  } finally {
    m.close();
  }
});

test('any model outside the private network counts as external', () => {
  assert.equal(llmConfig({ llmBaseUrl: 'https://foundation-models.api.cloud.ru/v1' }).external, true);
  assert.equal(llmConfig({ llmBaseUrl: 'http://ollama:11434/v1' }).external, false);
  assert.equal(llmConfig({ llmBaseUrl: 'http://192.168.1.5:11434' }).external, false);
});

test('GigaChat: questions wait in one queue, a 429 is retried, the same prompt is answered from memory', async () => {
  let active = 0, peak = 0, calls = 0, busy = 2;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (req.url === '/oauth') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: 't', expires_at: Date.now() + 30 * 60000 }));
        return;
      }
      calls++;
      if (busy > 0) { busy--; res.writeHead(429).end('{"status":429,"message":"Too Many Requests"}'); return; }
      active++; peak = Math.max(peak, active);
      setTimeout(() => {
        active--;
        const q = JSON.parse(data).messages.map((m) => m.content).join(' ');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'reply to ' + q } }] }));
      }, 30);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.GIGACHAT_BASE_URL = `${base}/v1`;
  process.env.GIGACHAT_AUTH_URL = `${base}/oauth`;
  try {
    const cfg = { ...llmConfig({ llmBaseUrl: '', gigachatCredentials: 'k' }), retryPauses: [20, 20, 20] };
    const out = await Promise.all(['a', 'b', 'c', 'd'].map((q) => chat([{ role: 'user', content: q }], cfg)));
    assert.deepEqual(out.map((o) => o.content), ['reply to a', 'reply to b', 'reply to c', 'reply to d']);
    assert.equal(peak, 1, 'one request at a time for a personal key');
    assert.equal(calls, 6, 'two 429 answers were retried');
    const again = await chat([{ role: 'user', content: 'b' }], cfg);
    assert.equal(again.content, 'reply to b');
    assert.equal(again.cached, true);
    assert.equal(calls, 6, 'the repeated question did not go to the model');
  } finally {
    server.close();
    delete process.env.GIGACHAT_BASE_URL;
    delete process.env.GIGACHAT_AUTH_URL;
  }
});

test('under a short answer with no steps the clause it cites comes first, at most three in all', async () => {
  const store = await fixtureStore();
  let citedClause = null;
  const m = await mockGigachat((body) => {
    // cite the LAST clause handed to the model, so it is not first by itself
    const ids = [...body.messages[1].content.matchAll(/^\[(D1:[^\]]+)\]/gm)].map((x) => x[1]);
    citedClause = ids[ids.length - 1].split(':')[1];
    return JSON.stringify({ document: 'D1', summary: { text: 'Порядок указан в пункте.', cites: [ids[ids.length - 1]] }, steps: [], not_found: false });
  });
  try {
    const a = await rag.ask('потерял пропуск, что делать', { ...OFFLINE, gigachatCredentials: 'secret-key', store });
    assert.equal(a.mode, 'llm+extractive');
    assert.ok(a.steps.length <= 3);
    assert.equal(a.steps[0].cites[0].clause.toLowerCase(), citedClause.toLowerCase());
  } finally {
    m.close();
  }
});
