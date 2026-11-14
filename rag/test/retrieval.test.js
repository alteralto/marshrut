'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stem } = require('../src/stemmer');
const { tokens, queryTerms } = require('../src/text');
const { BM25 } = require('../src/bm25');
const { retrieve } = require('../src/retrieve');
const { fixtureStore, OFFLINE } = require('./helpers');

test('stemmer: inflections of one word share a stem (Snowball reference outputs)', () => {
  for (const [words, s] of [
    [['командировка', 'командировки', 'командировку', 'командировкой'], 'командировк'],
    [['пропуск', 'пропуска', 'пропуском'], 'пропуск'],
    [['заявление', 'заявления', 'заявлению'], 'заявлен'],
    [['утрата', 'утраты', 'утрате'], 'утрат'],
  ]) {
    for (const w of words) assert.equal(stem(w), s, w);
  }
  assert.equal(stem('ёлка'), stem('елка'), 'ё is folded to е');
  assert.equal(stem('2.3'), '2.3', 'non-Cyrillic tokens are left alone');
});

test('tokens drop stop words; queryTerms also drop "how do I" words and flag verbs', () => {
  assert.deepEqual(tokens('Работник подаёт заявление в бухгалтерию'), ['работник', 'пода', 'заявлен', 'бухгалтер']);
  const q = queryTerms('подскажите, как мне оформить командировку');
  assert.deepEqual(q.map((x) => x.t), ['оформ', 'командировк']);
  assert.equal(q[0].verb, true);
  assert.equal(q[1].verb, false);
});

test('BM25 ranks the document with the rare query term first', () => {
  const docs = [
    'работник подает заявление в отдел кадров',
    'утрата пропуска сообщить в бюро пропусков',
    'работник получает пропуск в бюро',
  ].map(tokens);
  const bm = new BM25(docs);
  const s = bm.scores(tokens('утрата пропуска'));
  assert.ok(s[1] > s[2] && s[2] > s[0], `scores ${[...s]}`);
  assert.equal(s[0], 0);
  // a weighted query: expansion terms count less
  const w = bm.scores(new Map([['пропуск', 1], ['утрат', 0.1]]));
  assert.ok(w[1] > 0 && w[2] > 0);
});

test('retrieve: picks the regulation, then the clauses of the right section', async () => {
  const store = await fixtureStore();
  const r = await retrieve(store, 'потерял пропуск, что делать', OFFLINE);
  assert.equal(r.notFound, false);
  assert.equal(r.primary.docId, 'propusk');
  const best = r.context.filter((c) => c.inBestSection).map((c) => c.clauseId);
  for (const id of ['10', '11', '12']) assert.ok(best.includes(id), `clause ${id} in ${best}`);
  assert.ok(r.diagnostics.synonyms['потерял'] || Object.keys(r.diagnostics.synonyms).length, 'colloquial "потерял" expanded');
});

test('retrieve: colloquial wording still finds the document', async () => {
  const store = await fixtureStore();
  const cases = [
    ['студент хочет уйти в академ по болезни', 'akadem-otpusk'],
    ['нужно взять пару дней за свой счёт', 'otpusk-rabotnikov'],
    ['вернулся из командировки, что сдавать в бухгалтерию?', 'komandirovki'],
    ['какие документы приложить к заявке на оплату', 'oplata-schetov'],
  ];
  for (const [q, doc] of cases) {
    const r = await retrieve(store, q, OFFLINE);
    assert.equal(r.notFound, false, q);
    assert.equal(r.primary.docId, doc, q);
  }
});

test('retrieve: off-topic questions are "not found" before any LLM call', async () => {
  const store = await fixtureStore();
  for (const q of ['какой рецепт борща', 'какой пароль от wi-fi в общежитии', 'как оформить декретный отпуск', '']) {
    const r = await retrieve(store, q, OFFLINE);
    assert.equal(r.notFound, true, `${q}: ${r.reason}`);
  }
});

test('retrieve: a regulation inside an order appendix is split by its own sections; "в какие часы" finds the clock times', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { buildIndex, prepare } = require('../src/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-appendix-'));
  fs.writeFileSync(path.join(dir, 'support.txt'), [
    'ПРИКАЗ',
    'Об утверждении Регламента работы службы поддержки',
    '1. Утвердить Регламент работы службы поддержки (Приложение).',
    'Приложение',
    'РЕГЛАМЕНТ работы службы поддержки',
    '1 Общие положения',
    '1.1. Настоящий Регламент устанавливает порядок работы службы поддержки.',
    '1.2. Регламент распространяется на сотрудников и обучающихся.',
    '2 Каналы подачи обращений',
    '2.1. Обращения в службу поддержки подаются через систему заявок или по электронной почте.',
    '2.2. Телефон и мессенджеры не являются каналами подачи обращений.',
    '3 Порядок обработки обращений',
    '3.1. При подаче обращения пользователь указывает ФИО, телефон и кабинет.',
    '3.2. Обращение передаётся исполнителю в течение одного рабочего дня.',
    '3.3. После выполнения работ обращение передаётся автору для подтверждения.',
    '4 Режим работы службы поддержки',
    '4.1. Служба поддержки принимает обращения в рабочие дни с 9:00 до 18:00, перерыв с 12:00 до 13:00.',
    '4.2. В выходные дни обращения не принимаются.',
  ].join('\n'));
  try {
    const store = prepare(await buildIndex([dir], { embed: false }));
    const r = await retrieve(store, 'В какие часы работает служба поддержки?', OFFLINE);
    assert.equal(r.notFound, false);
    const at = r.context.findIndex((c) => /9:00 до 18:00/.test(c.text));
    assert.ok(at >= 0 && at < 3, `the clause with the hours is among the first three, got ${at}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
