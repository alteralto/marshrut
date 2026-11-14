'use strict';
// Layouts that the 13 collected regulations do not have, but an unknown
// document may: bracket numbering, steps, articles, tables, Q&A, a site page,
// OCR output.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRegulation } = require('../src/parser');
const { htmlToText, htmlTitle, looksLikeText } = require('../src/extract');
const { layoutToText, fixOcrLine } = require('../src/ocr');

const ids = (r) => r.nodes.map((n) => n.id);

test('"1) 2) 3)" as the document numbering: items are clauses, not part of the title', () => {
  const r = parseRegulation(`Порядок выдачи справок
1) Работник подаёт заявление в отдел кадров.
2) Отдел кадров готовит справку в течение 3 рабочих дней.
3) Справка выдаётся лично работнику:
а) при предъявлении паспорта;
б) по доверенности.`);
  assert.equal(r.title, 'Порядок выдачи справок');
  assert.deepEqual(ids(r), ['1)', '2)', '3)', '3)(а)', '3)(б)']);
  assert.equal(r.nodes[1].label, 'п. 2)');
  assert.equal(r.nodes[4].label, 'п. 3), пп. б)');
});

test('"Шаг N" instruction: every step is a clause, numbering inside a step is scoped to it', () => {
  const r = parseRegulation(`Инструкция по возврату аванса
Шаг 1. Подготовьте авансовый отчёт.
1. Заполните форму АО-1.
2. Приложите чеки.
Шаг 2: Передайте отчёт в бухгалтерию не позднее 3 рабочих дней после возвращения.`);
  assert.equal(r.title, 'Инструкция по возврату аванса');
  assert.deepEqual(ids(r), ['шаг.1', 'шаг.1/1', 'шаг.1/2', 'шаг.2']);
  assert.equal(r.nodes[2].label, 'шаг 1, п. 2');
  assert.match(r.nodes[3].text, /не позднее 3 рабочих дней/);
});

test('"Шаг" and its number on separate lines (site markup) are glued', () => {
  const r = parseRegulation('Оплата счетов\nШаг\n1:\nСоберите пакет документов.\nШаг\n2:\nПередайте пакет в бухгалтерию.');
  assert.deepEqual(ids(r), ['шаг.1', 'шаг.2']);
  assert.equal(r.nodes[0].text, 'Соберите пакет документов.');
});

test('"Статья N" with numbering restarting in every article', () => {
  const r = parseRegulation(`ПОЛОЖЕНИЕ о командировках

Статья 1. Общие положения
1. Положение определяет порядок направления в командировки.
2. Положение обязательно для всех подразделений.

Статья 2. Оформление командировки
1. Работник подаёт служебную записку не позднее чем за 10 рабочих дней.
2. Руководитель согласует записку в течение 2 рабочих дней.`);
  assert.deepEqual(ids(r), ['1.1', '1.2', '2.1', '2.2']);
  assert.equal(r.nodes[2].label, 'ст. 2, п. 1');
  assert.deepEqual(r.nodes[2].path, ['Статья 2. Оформление командировки']);
});

test('a статья whose text stands on the heading line stays citable', () => {
  const r = parseRegulation(`Правила пользования пропуском
Статья 1. Пропуск выдаётся работнику в бюро пропусков при предъявлении паспорта.
Статья 2. При утрате пропуска работник обязан в тот же день сообщить об этом в службу охраны.`);
  assert.equal(r.nodes.length, 2);
  assert.equal(r.nodes[1].label, 'ст. 2');
  assert.match(r.nodes[1].text, /^При утрате пропуска/);
});

test('"Раздел II." and "§ 3." are headings, not the tail of the previous clause', () => {
  const r = parseRegulation(`РЕГЛАМЕНТ закупок
Раздел I. Общие положения
1.1 Регламент определяет порядок закупок.
Раздел II. Порядок подачи заявки
2.1 Заявка согласуется с ФЭУ в течение 5 дней.
§ 3. Заключение договора
3.1 Договор подписывает проректор.`);
  assert.deepEqual(ids(r), ['1.1', '2.1', '3.1']);
  assert.equal(r.nodes[1].text, 'Заявка согласуется с ФЭУ в течение 5 дней.');
  // a new kind of heading nests under the open one: Раздел II > § 3
  assert.equal(r.nodes[2].path.at(-1), '§ 3. Заключение договора');
});

test('table: every row is a citable node that carries the column names', () => {
  const r = parseRegulation(`Сроки оплаты счетов
Вид платежа | Срок | Ответственный
Оплата по договору | 7 рабочих дней | ФЭУ
Аванс поставщику | 10 рабочих дней | Бухгалтерия`);
  assert.deepEqual(ids(r), ['табл.1/1', 'табл.1/2']);
  assert.equal(r.nodes[0].kind, 'row');
  assert.equal(r.nodes[0].label, 'таблица 1, строка 1');
  assert.equal(r.nodes[1].text, 'Вид платежа: Аванс поставщику; Срок: 10 рабочих дней; Ответственный: Бухгалтерия');
});

test('table whose first row is data ("1. | ...") gets no invented header', () => {
  const r = parseRegulation(`Лист согласования
Согласуют:

п/п | Подразделение | Подпись
1. | Отдел закупок |
2. | Финансовый отдел |`);
  const rows = r.nodes.filter((n) => n.kind === 'row');
  assert.equal(rows.length, 2);
  assert.match(rows[1].text, /Финансовый отдел/);
});

test('question-answer memo: one paragraph per question', () => {
  const r = parseRegulation(`Частые вопросы по командировкам
Вопрос: Кто подписывает служебную записку?
Ответ: Руководитель подразделения.
Вопрос: Когда сдавать авансовый отчёт?
Ответ: В течение трёх рабочих дней после возвращения.`);
  assert.equal(r.nodes.length, 2);
  assert.match(r.nodes[1].text, /^Вопрос: Когда[\s\S]*Ответ: В течение трёх/);
});

test('a one-word title is completed from the first clause', () => {
  const r = parseRegulation(`ПОРЯДОК

1. Общие положения
1.1. Порядок перехода обучающихся с платного обучения на бесплатное (далее – настоящий Порядок) разработан в соответствии с законом.`);
  assert.equal(r.title, 'Порядок перехода обучающихся с платного обучения на бесплатное');
});

test('a wrapped line of running text is not taken for a heading', () => {
  const r = parseRegulation(`Положение о стипендиях
1. Стипендия назначается в соответствии со
Статья 36 Федерального закона устанавливает виды стипендий.
2. Размер стипендии определяет учёный совет.`);
  assert.deepEqual(ids(r), ['1', '2']);
  assert.match(r.nodes[0].text, /Статья 36 Федерального закона/);
});

test('site page: the document starts at <h1>, lists get numbers, chrome is dropped', () => {
  const html = `<html><head><title>Оплата счетов — Справочник сотрудника</title></head><body>
<div class="warn">В старых версиях браузеров сайт может отображаться некорректно.</div>
<nav><a href="/">Главная</a><a href="/fin">Финансы</a></nav>
<h1 class="post-title">Оплата счетов контрагентов</h1>
<p>Для оплаты нужны:</p><ol><li>Счёт на оплату</li><li>Товарная накладная</li></ol>
<footer>© Университет</footer></body></html>`;
  assert.equal(htmlTitle(html), 'Оплата счетов контрагентов');
  const text = htmlToText(html);
  assert.doesNotMatch(text, /старых версиях|Главная|©/);
  assert.match(text, /1\. Счёт на оплату\s+2\. Товарная накладная/);
});

test('OCR output: lines are put in reading order, obvious confusions are fixed', () => {
  // "left<TAB>top<TAB>height<TAB>text", the stamp at the right comes out of order
  const raw = ['300\t100\t30\tПРИКАЗ', '1200\t95\t40\tштамп', '300\t200\t30\t1. Утвердить Положение.', '300\t240\t30\tЗ. Контроль возложить на проректора.',
    '300\t280\t30\tот 21 марта 2023 г. М 247', '\f', '300\t100\t30\t1.1. Положение действует с 1 января.', '\f'].join('\n');
  const text = layoutToText(raw);
  const lines = text.split('\n').filter(Boolean);
  assert.equal(lines[0], 'ПРИКАЗ штамп');
  assert.equal(lines[2], '3. Контроль возложить на проректора.');
  assert.equal(lines[3], 'от 21 марта 2023 г. № 247');
  assert.match(text, /\n\n1\.1\. Положение действует/);
  assert.equal(fixOcrLine('Заявление подаётся в отдел.'), 'Заявление подаётся в отдел.');
});

test('looksLikeText: readable text passes, binary junk does not', () => {
  assert.equal(looksLikeText('1. Работник подаёт заявление в отдел кадров не позднее чем за 3 дня.'), true);
  assert.equal(looksLikeText(`%PDF-1.4 \u0000\u0001\u0002 ${'x'.repeat(3000)}`), false);
  assert.equal(looksLikeText(''), false);
});

test('empty and junk input never throws', () => {
  for (const t of ['', '\n\n\n', '|||', '1)', 'Шаг', '§', 'Статья', ' | | | ', '1.1.1.1.1.1.1', '\u0000'.repeat(50)]) {
    assert.doesNotThrow(() => parseRegulation(t, { fallbackTitle: 'x.txt' }));
  }
});

test('xlsx: a sheet listed many times or too many cells is refused, not unpacked into memory', () => {
  const { writeZip } = require('../src/zip');
  const { xlsxSheets } = require('../src/extract');
  const row = '<row r="1">' + '<c r="A1"><v>1</v></c>'.repeat(1000) + '</row>';
  const sheet = '<worksheet><sheetData>' + row.repeat(210) + '</sheetData></worksheet>';
  const listed = Array.from({ length: 20 }, (_, k) => `<sheet name="S${k}" sheetId="${k + 1}" r:id="rId1"/>`).join('');
  const book = (rows) => writeZip({
    'xl/workbook.xml': `<workbook><sheets>${listed}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': rows,
  });
  assert.throws(() => xlsxSheets(book(sheet)), /200000 ячеек/);
  const small = xlsxSheets(book('<worksheet><sheetData>' + row + '</sheetData></worksheet>'));
  assert.equal(small.length, 1);
});
