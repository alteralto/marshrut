'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { tripAnswer } = require('./trip');

function storeWithDeadline(text) {
  const id = 'mipt-business-trip';
  return { docById: new Map([[id, {
    id, title: 'Регламент о командировании', url: '/original/mipt-business-trip',
    nodes: [{ id: '53', page: 13, text }],
  }]]) };
}

const clause = 'Не позднее чем за 7 рабочих дней до командировки, работник представляет Решение о\nкомандировании в группу командирования ОМС.';
const question = 'За сколько дней до командировки нужно подать заявку?';

test('colloquial trip filing question cites clause 53 and the PDF page', () => {
  const answer = tripAnswer(storeWithDeadline(clause), question);
  assert.match(answer.summary, /7 рабочих дней/);
  assert.equal(answer.summary_cite.anchor, 'cl-53');
  assert.equal(answer.steps[0].cites[0].original, '/original/mipt-business-trip#page=13');
});

test('prepared deadline does not cover a different procedure or an updated deadline', () => {
  assert.equal(tripAnswer(storeWithDeadline(clause), 'Когда подать заявку на отмену командировки?'), null);
  assert.equal(tripAnswer(storeWithDeadline(clause), 'За сколько дней до командировки нужно подать заявку на билеты?'), null);
  assert.equal(tripAnswer(storeWithDeadline(clause.replace('7', '5')), question), null);
});
