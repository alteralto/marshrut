'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const rag = require('../src');
const { fixtureStore, OFFLINE } = require('./helpers');

// A fake OpenAI-compatible endpoint. `reply(prompt, body)` returns the
// assistant's message content (or {status, body} to fail the request).
function mockLlm(reply) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const body = JSON.parse(data);
      calls.push(body);
      const prompt = body.messages.map((m) => m.content).join('\n');
      const out = reply(prompt, body);
      if (out && out.status) {
        res.writeHead(out.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.body || { error: 'fail' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: out } }] }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}/v1`, calls, close: () => server.close() });
  }));
}

// clause lines of the prompt: "[D1:10] (раздел: ...) text"
function clausesInPrompt(prompt) {
  return [...prompt.matchAll(/^\[(D\d+:[^\]]+)\](?: \(раздел: [^)]*\))? (.+)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
}

const llm = (url) => ({ ...OFFLINE, llmBaseUrl: url, llmModel: 'mock' });

test('extractive mode: steps are verbatim clauses with citations', async () => {
  const store = await fixtureStore();
  const a = await rag.ask('потерял пропуск, что делать', { ...OFFLINE, store });
  assert.equal(a.not_found, false);
  assert.equal(a.mode, 'extractive');
  assert.equal(a.document.id, 'propusk');
  assert.ok(a.steps.length >= 3);
  for (const s of a.steps) {
    assert.equal(s.verified, true);
    assert.ok(s.cites.length >= 1);
    assert.ok(s.cites[0].quote.length > 0);
  }
  const lost = a.steps.find((s) => s.cites[0].clause === '10');
  assert.ok(lost, 'clause 10 (утрата пропуска) is a step');
  assert.equal(lost.deadline, 'в течение одного рабочего дня');
  assert.equal(lost.who, 'владелец');
});

test('off-topic question: not_found, no steps', async () => {
  const store = await fixtureStore();
  for (const q of ['какой рецепт борща', 'как записаться в спортзал университета']) {
    const a = await rag.ask(q, { ...OFFLINE, store });
    assert.equal(a.not_found, true, q);
    assert.equal(a.message, rag.NOT_FOUND_MESSAGE);
    assert.deepEqual(a.steps, []);
  }
});

test('empty question asks for details', async () => {
  const store = await fixtureStore();
  const a = await rag.ask('  подскажите пожалуйста ', { ...OFFLINE, store });
  assert.equal(a.not_found, true);
  assert.ok(a.clarifying_question);
});

test('ambiguous question gets a clarifying question', async () => {
  const store = await fixtureStore();
  const a = await rag.ask('как оформить отпуск', { ...OFFLINE, store });
  assert.ok(a.clarifying_question, JSON.stringify(a.candidates));
});

test('LLM mode: grounded steps pass, an invented step is rejected', async () => {
  const store = await fixtureStore();
  const m = await mockLlm((prompt) => {
    const cl = clausesInPrompt(prompt);
    const c10 = cl.find((c) => c.id === 'D1:10');
    const c11 = cl.find((c) => c.id === 'D1:11');
    return JSON.stringify({
      document: 'D1',
      steps: [
        { text: 'В течение одного рабочего дня сообщите об утрате пропуска в бюро пропусков.', cites: [c10.id], who: 'владелец', deadline: 'в течение одного рабочего дня' },
        { text: c11.text, cites: [c11.id], form: 'заявление на выдачу дубликата' },
        { text: 'Оплатите штраф 500 рублей в кассе института.', cites: [c11.id] },
      ],
      not_found: false,
      clarifying_question: null,
    });
  });
  try {
    const a = await rag.ask('потерял пропуск, что делать', { ...llm(m.url), store });
    assert.equal(a.mode, 'llm');
    assert.equal(a.steps.length, 2);
    assert.equal(a.steps[0].cites[0].clause, '10');
    assert.equal(a.steps[0].who, 'владелец');
    assert.equal(a.steps[1].form, 'заявление на выдачу дубликата');
    assert.equal(a.rejected_steps.length, 1);
    assert.match(a.rejected_steps[0].text, /штраф/);
    assert.ok(a.rejected_steps[0].issues.some((r) => /low_support|numbers_not_in_source/.test(r)));
    // the request asked for strict JSON
    assert.equal(m.calls[0].response_format.type, 'json_schema');
    assert.equal(m.calls[0].temperature, 0);
  } finally {
    m.close();
  }
});

test('LLM mode: everything invented -> extractive fallback', async () => {
  const store = await fixtureStore();
  const m = await mockLlm(() => '```json\n{"document":"D1","steps":[{"text":"Обратитесь в профком за справкой.","cites":["D1:99"]}],"not_found":false}\n```');
  try {
    const a = await rag.ask('потерял пропуск, что делать', { ...llm(m.url), store });
    assert.equal(a.mode, 'llm+extractive');
    assert.ok(a.steps.length > 0 && a.steps.every((s) => s.fallback && s.verified));
    assert.equal(a.rejected_steps.length, 1);
  } finally {
    m.close();
  }
});

test('LLM mode: model says not_found -> not_found', async () => {
  const store = await fixtureStore();
  const m = await mockLlm(() => '<think>нет такого</think>{"document": null, "steps": [], "not_found": true, "clarifying_question": null}');
  try {
    const a = await rag.ask('потерял пропуск, что делать', { ...llm(m.url), store });
    assert.equal(a.not_found, true);
    assert.equal(a.mode, 'llm');
  } finally {
    m.close();
  }
});

test('LLM mode: server without json_schema support -> retries with json_object', async () => {
  const store = await fixtureStore();
  const m = await mockLlm((prompt, body) => {
    if (body.response_format && body.response_format.type === 'json_schema') return { status: 400, body: { error: 'response_format not supported' } };
    const c = clausesInPrompt(prompt).find((x) => x.id === 'D1:11');
    return JSON.stringify({ document: 'D1', steps: [{ text: c.text, cites: [c.id] }], not_found: false });
  });
  try {
    const a = await rag.ask('потерял пропуск, что делать', { ...llm(m.url), store });
    assert.equal(a.mode, 'llm');
    assert.equal(m.calls.length, 2);
    assert.equal(m.calls[1].response_format.type, 'json_object');
    assert.equal(a.steps[0].cites[0].clause, '11');
  } finally {
    m.close();
  }
});

test('LLM endpoint down -> extractive answer with a warning', async () => {
  const store = await fixtureStore();
  const a = await rag.ask('потерял пропуск, что делать', { ...OFFLINE, llmBaseUrl: 'http://127.0.0.1:9', llmTimeoutMs: 2000, store });
  assert.equal(a.mode, 'extractive');
  assert.ok(a.steps.length > 0);
  assert.ok(a.warnings.some((w) => /LLM failed/.test(w)));
});
