'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRegulation, plausible } = require('../src/parser');

const ids = (r) => r.nodes.map((n) => n.id);
const node = (r, id) => r.nodes.find((n) => n.id === id);

test('nested numbered clauses, subpoints and an appendix', () => {
  const r = parseRegulation(`ПОЛОЖЕНИЕ
о порядке чего-то

1. Общие положения
1.1. Первое правило.
1.2. Второе правило
продолжается на следующей строке.
2. Порядок действий
2.1. Работник подаёт заявление:
а) в деканат;
б) в бухгалтерию.
2.2. Решение принимается:
1) ректором;
2) проректором.
2.3. Уровень три:
2.3.1. первый шаг;
2.3.2. второй шаг.

Приложение 1
Форма заявления
1. ФИО.
2. Дата.`);
  assert.equal(r.title, 'Положение о порядке чего-то');
  assert.deepEqual(ids(r), ['1', '1.1', '1.2', '2', '2.1', '2.1(а)', '2.1(б)', '2.2', '2.2(1)', '2.2(2)', '2.3', '2.3.1', '2.3.2', 'прил.1', 'прил.1/1', 'прил.1/2']);
  assert.equal(node(r, '1').heading, true, 'short numbered line with children is a heading');
  assert.equal(node(r, '2.1').heading, false);
  assert.match(node(r, '1.2').text, /продолжается на следующей строке/);
  assert.equal(node(r, '2.1(б)').parent, '2.1');
  assert.equal(node(r, '2.1(б)').label, 'п. 2.1, пп. б)');
  assert.equal(node(r, '2.3.2').parent, '2.3');
  assert.equal(node(r, 'прил.1').kind, 'appendix');
  assert.equal(node(r, 'прил.1/2').label, 'Приложение 1, п. 2');
});

test('Roman sections with continuous numbering keep plain ids', () => {
  const r = parseRegulation(`ИНСТРУКЦИЯ
о пропусках

I. Общие положения
1. Первый пункт.
2. Второй пункт.
II. Порядок
3. Третий пункт.
4. Четвёртый пункт.`);
  assert.deepEqual(ids(r), ['1', '2', '3', '4']);
  assert.deepEqual(node(r, '3').path, ['II. Порядок']);
});

test('numbering that restarts in every section gets a section prefix', () => {
  const r = parseRegulation(`Порядок оплаты

Раздел 1. Общие положения
1. Первый.
2. Второй.
Раздел 2. Заявка
1. Подготовить заявку.
2. Приложить счёт.`);
  assert.deepEqual(ids(r), ['1.1', '1.2', '2.1', '2.2']);
  assert.equal(node(r, '2.1').label, 'разд. 2, п. 1');
});

test('markdown headings and a wrapped "5 рабочих дней" line are not clauses', () => {
  const r = parseRegulation(`# Положение о поддержке

## 1. Общие положения

1.1. Поддержка оказывается в течение
5 рабочих дней после подачи.

## 2. Порядок

2.1. Подать заявление.`);
  assert.equal(r.title, 'Положение о поддержке');
  assert.deepEqual(ids(r), ['1', '1.1', '2', '2.1']);
  assert.match(node(r, '1.1').text, /5 рабочих дней/);
});

test('plausible() accepts children and small gaps, rejects jumps', () => {
  assert.ok(plausible([2, 4], [2, 3]));
  assert.ok(plausible([2, 3, 1], [2, 3]));
  assert.ok(plausible([3], [2, 3]));
  assert.ok(!plausible([9], [2, 3]));
  assert.ok(!plausible([2, 1], [2, 3]));
});

// ---- real-document layouts (excerpts modelled on public МФТИ / вуз documents, 07.11.2026)

test('order cover with an e-signature stamp: the approved regulation keeps plain clause ids', () => {
  const r = parseRegulation(`Документ подписан простой электронной подписью
Информация о владельце:
ФИО: Иванов Иван ИвановичМинистерство науки и высшего образования Российской Федерации
Должность: Ректор
ДУнаитакаплоьднпыийсапнриояг:р2а5м.м0н9ы.2й02к5лфю1еч3д::4е3р:4а5льное государственное
c6d909c49c1d2034fa3a0156c4eaa51e7232a3a2
высшего образования
ПРИКАЗ
от 01.09.2025
№ 3909-1
Об утверждении Положения об отпусках
ПРИКАЗЫВАЮ:
1. Утвердить Положение об отпусках обучающимся.
2. Контроль за исполнением приказа оставляю за собой.
Ректор
Приложение к приказу № 3909-1 от 01.09.2025
ПОЛОЖЕНИЕ об отпусках
обучающимся
1. Общие положения
1.1. Отпуск предоставляется по заявлению обучающегося.
2. Порядок
2.1. Обучающийся подаёт заявление в деканат.`);
  assert.equal(r.title, 'Положение об отпусках обучающимся');
  assert.deepEqual(ids(r).filter((id) => !id.startsWith('приказ/')), ['абз.1', '1', '1.1', '2', '2.1']);
  assert.ok(ids(r).includes('приказ/1') && ids(r).includes('приказ/2'), 'order items are kept under приказ/');
  assert.equal(node(r, 'приказ/1').label, 'приказ, п. 1');
  const all = r.nodes.map((n) => n.text).join('\n');
  assert.doesNotMatch(all, /Документ подписан|c6d909|ФИО:|р0а7м|р2а5м/);
});

test('PDF furniture: hanging numbers, page numbers and running headers', () => {
  const header = 'Министерство науки и высшего образования РФ Университет\nП - Положение о договорной работе\nФорма А\nСтраница 1 из 9';
  const pages = [
    `ПОЛОЖЕНИЕ о договорной работе\n\n1. ОБЩИЕ ПОЛОЖЕНИЯ\n\n1.1.\n\nНастоящее Положение регулирует порядок\n\nзаключения договоров.\n\n2`,
    `1.2.\n\nДоговор согласуется с юридическим отделом.\n\n3`,
    `2. СОГЛАСОВАНИЕ\n\n2.1. Инициатор готовит проект договора.\n\n4`,
    `2.2. Проект визирует главный бухгалтер.\n\n5`,
  ];
  const r = parseRegulation(pages.map((p, k) => `${header.replace('1 из', `${k + 1} из`)}\n${p}`).join('\n'));
  assert.deepEqual(ids(r), ['1', '1.1', '1.2', '2', '2.1', '2.2']);
  assert.equal(node(r, '1.1').text, 'Настоящее Положение регулирует порядок\nзаключения договоров.');
  assert.equal(node(r, '1.2').text, 'Договор согласуется с юридическим отделом.');
  assert.doesNotMatch(r.nodes.map((n) => n.text).join('\n'), /Страница|Форма А|Министерство/);
});

test('clauses run together on one line are split, references are not', () => {
  const r = parseRegulation(`Положение об отчислении
1. Общие положения
1.1 Положение разработано в соответствии с законом. 1.2 Положение устанавливает порядок отчисления (см. п. 2.1 Положения).
2. Основания
2.1 Отчисление по инициативе обучающегося: 2.1.1 По собственному желанию. 2.1.2 В связи с переводом.
2.2 Основания указаны в ст. 2.3 Регламента.`);
  assert.deepEqual(ids(r), ['1', '1.1', '1.2', '2', '2.1', '2.1.1', '2.1.2', '2.2']);
  assert.match(node(r, '1.2').text, /см\. п\. 2\.1 Положения/);
  assert.match(node(r, '2.2').text, /ст\. 2\.3 Регламента/);
});

test('table of contents is dropped; Глава > Раздел with restarting numbering gets nested ids', () => {
  const r = parseRegulation(`Положение о закупке
СОДЕРЖАНИЕ
Глава I. Общие положения\t5
Глава II. Подготовка закупок\t7
Раздел 1. Планирование закупок\t7
Раздел 2. Комиссия……………………9

Глава I. Общие положения
Раздел 1. Сфера применения
1. Положение регулирует закупки.
2. Термины используются в значении закона.
Глава II. Подготовка закупок
Раздел 1. Планирование закупок
1. План закупки утверждается на год.
Раздел 2. Комиссия по осуществлению
закупок
1. Заказчик создаёт комиссию.
2. Число членов комиссии не менее пяти.
Глава III. Договор
1. Договор заключается после закупки.`);
  assert.deepEqual(ids(r), ['I.1.1', 'I.1.2', 'II.1.1', 'II.2.1', 'II.2.2', 'III.1']);
  assert.equal(node(r, 'II.2.2').label, 'гл. II, разд. 2, п. 2');
  assert.deepEqual(node(r, 'II.2.1').path, ['Глава II. Подготовка закупок', 'Раздел 2. Комиссия по осуществлению закупок']);
  assert.equal(node(r, 'III.1').label, 'гл. III, п. 1');
});

test('numbered appendix headings are structure, not running headers', () => {
  const body = ['Порядок отчисления', '1. Общие положения', '1.1. Отчисление оформляется приказом.'];
  for (let k = 1; k <= 5; k++) body.push(`Приложение ${k} к Порядку отчисления`, `Образец заявления ${k}`, 'Ректору МФТИ', 'ЗАЯВЛЕНИЕ', 'Прошу отчислить меня.');
  const r = parseRegulation(body.join('\n'));
  assert.deepEqual(r.nodes.filter((n) => n.kind === 'appendix').map((n) => n.id), ['прил.1', 'прил.2', 'прил.3', 'прил.4', 'прил.5']);
});

test('a numbered heading followed by its first child on the same line is split', () => {
  const r = parseRegulation(`Положение о договорной работе
1. Порядок
1.1. Общее правило.
1.2. Структура договора 1.2.1. В структуру договора включаются разделы. 1.2.2. Преамбула содержит номер договора.`);
  assert.deepEqual(ids(r), ['1', '1.1', '1.2', '1.2.1', '1.2.2']);
  assert.equal(node(r, '1.2').heading, true);
});
