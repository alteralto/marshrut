'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyStep, buildCiteResolver, normalizeCite } = require('../src/verify');

const context = [
  {
    docId: 'kom', clauseId: '2.2', label: 'п. 2.2', path: ['2 Оформление командировки'],
    text: 'Служебная записка подаётся в отдел кадров не позднее чем за пять рабочих дней до начала командировки.', subs: [],
  },
  {
    docId: 'kom', clauseId: '3.1', label: 'п. 3.1', path: ['3 Возмещение расходов'],
    text: 'Работнику возмещаются:\nа) расходы по проезду;\nб) суточные.',
    subs: [{ id: '3.1(а)', label: 'п. 3.1, пп. а)', text: 'расходы по проезду;' }, { id: '3.1(б)', label: 'п. 3.1, пп. б)', text: 'суточные.' }],
  },
  {
    docId: 'kom', clauseId: '3.4', label: 'п. 3.4', path: ['3 Возмещение расходов'],
    text: 'При отсутствии документов, подтверждающих расходы по найму жилого помещения, возмещение не производится.', subs: [],
  },
];
const resolve = buildCiteResolver(context, new Map([['kom', 'D1']]));

test('a step that paraphrases its clause passes', () => {
  const v = verifyStep({ text: 'Подайте служебную записку в отдел кадров не позднее чем за пять рабочих дней до начала командировки.', cites: ['D1:2.2'] }, resolve);
  assert.equal(v.ok, true, v.reasons.join());
  assert.ok(v.support >= 0.9);
});

test('an invented step citing a real clause is rejected', () => {
  const v = verifyStep({ text: 'Получите в профкоме справку о составе семьи и согласуйте её с ректором.', cites: ['D1:2.2'] }, resolve);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.startsWith('low_support')), v.reasons.join());
});

test('a changed number is rejected even when the words match', () => {
  const v = verifyStep({ text: 'Служебная записка подаётся в отдел кадров не позднее чем за 10 рабочих дней до начала командировки.', cites: ['D1:2.2'] }, resolve);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.startsWith('numbers_not_in_source:10')), v.reasons.join());
  // numeral words count too: "три" is not "пять"
  const w = verifyStep({ text: 'Служебная записка подаётся в отдел кадров за три рабочих дня до начала командировки.', cites: ['D1:2.2'] }, resolve);
  assert.equal(w.ok, false);
});

test('citing a clause that was not in the context is rejected', () => {
  const v = verifyStep({ text: 'Служебная записка подаётся в отдел кадров.', cites: ['D1:9.9'] }, resolve);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.startsWith('cited_clause_not_in_context')));
  const none = verifyStep({ text: 'Служебная записка подаётся в отдел кадров.', cites: [] }, resolve);
  assert.equal(none.ok, false);
  assert.ok(none.reasons.includes('no_citation'));
});

test('flipped negation is rejected', () => {
  const v = verifyStep({ text: 'При отсутствии документов о найме жилого помещения возмещение производится.', cites: ['D1:3.4'] }, resolve);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.startsWith('negation_mismatch')), v.reasons.join());
});

test('subpoint citations in different spellings resolve', () => {
  for (const c of ['D1:3.1(б)', 'D1:3.1б', '[D1:3.1 пп. б)]', 'п. 3.1(б)']) {
    assert.ok(resolve(c), c);
    assert.equal(resolve(c).sub.id, '3.1(б)', c);
  }
  assert.deepEqual(normalizeCite('Приложение 1, п. 2'), { slot: null, clause: 'прил.1/2' });
  assert.deepEqual(normalizeCite('D1:прил.1/2'), { slot: 'D1', clause: 'прил.1/2' });
  assert.deepEqual(normalizeCite('пункт 4.1'), { slot: null, clause: '4.1' });
});

test('an unsupported attribute is dropped, the step is kept', () => {
  const v = verifyStep({
    text: 'Служебная записка подаётся в отдел кадров не позднее чем за пять рабочих дней до начала командировки.',
    cites: ['D1:2.2'],
    who: 'отдел кадров',
    deadline: 'за 14 дней',
    form: 'служебная записка',
  }, resolve);
  assert.equal(v.ok, true);
  assert.deepEqual(v.fields, { who: 'отдел кадров', form: 'служебная записка' });
  assert.ok(v.reasons.includes('field_unsupported:deadline'));
});
