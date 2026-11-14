'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readZip } = require('../rag/src/extract');
const { memoValues, fillConcertMemo } = require('./concert-memo');

test('concert memo exports user text, access and schedule as editable Word content', () => {
  const values = memoValues({
    event: 'Концерт «Весна & <свет>»',
    'access.0.name': 'Иванов Иван',
    'access.2.name': 'Петрова Анна',
    'schedule.0.label': 'Репетиция',
    'schedule.0.date': '2026-11-20',
    'schedule.0.crew': 'Звукорежиссёр\nОператор света',
  });
  const archive = readZip(fillConcertMemo(values));
  const document = archive.read('word/document.xml').toString('utf8');
  assert.match(document, /Весна &amp; &lt;свет&gt;/u);
  const [access, schedule] = document.match(/<w:tbl>.*?<\/w:tbl>/gu);
  assert.match(access, /Иванов Иван.*Петрова Анна/u);
  assert.equal((access.match(/<w:tr>/gu) || []).length, 3);
  assert.match(schedule, /Репетиция.*20\.11\.2026.*Звукорежиссёр<\/w:t><w:br\/>/u);
  assert.match(document, /Состояние зала после мероприятия: _+/u);
});

test('concert memo allows partial data but rejects invalid dates and extra fields', () => {
  assert.equal(memoValues({ event: 'Концерт' }).get('event'), 'Концерт');
  assert.throws(() => memoValues({}), /Заполните/u);
  assert.throws(() => memoValues({ start: '2026-02-30' }), /корректную дату/u);
  assert.throws(() => memoValues({ start: '2026-11-20', end: '2026-11-19' }), /не раньше/u);
  assert.throws(() => memoValues({ 'schedule.24.label': 'Концерт' }), /лимит/u);
});
