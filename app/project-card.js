'use strict';

const { readZip } = require('../rag/src/extract');
const { writeZip } = require('../rag/src/zip');

const filename = 'Карточка проекта — заполненная.docx';
const groups = [
  {
    title: 'Договор и проект',
    fields: [
      { row: 1, label: 'Номер договора, контракта или соглашения' },
      { row: 2, label: 'Название договора, контракта или соглашения', type: 'textarea' },
      { row: 3, label: 'Дата заключения', type: 'date' },
      { row: 4, label: 'Дата завершения', type: 'date' },
      { row: 5, label: 'Заказчик или грантодатель' },
      { row: 6, label: 'Идентификация договора', options: ['ГОЗ', 'Не ГОЗ'] },
      { row: 7, label: 'Идентификационный номер' },
      { row: 8, label: 'Программа' },
      { row: 9, label: 'Наименование фонда для гранта' },
      { row: 10, label: 'Вид работ', options: ['НИР', 'ОКР', 'НИР и ОКР'] },
    ],
  },
  {
    title: 'Приоритеты и технология',
    fields: [
      { row: 11, label: 'Приоритетное направление развития науки и техники', type: 'textarea', hint: 'Список 1 к карточке проекта' },
      { row: 12, label: 'Приоритет научно-технологического развития', type: 'textarea', hint: 'Список 2 к карточке проекта' },
      { row: 13, label: 'Критическая технология', type: 'textarea', hint: 'Список 3 к карточке проекта' },
    ],
  },
  {
    title: 'Расходы и налоги',
    fields: [
      { row: 14, label: 'Размер накладных расходов и база исчисления', type: 'textarea' },
      { row: 15, label: 'Начисление резерва отпускных', options: ['Да', 'Нет'] },
      { row: 16, label: 'ФЛС для компенсации отпускных', hint: 'Если резерв отпускных начислить невозможно' },
      { row: 17, label: 'НДС по договору', options: ['Да', 'Нет'] },
    ],
  },
  {
    title: 'Контакты и подразделение',
    fields: [
      { row: 18, label: 'Контакты руководителя подразделения', hint: 'Электронная почта и телефон' },
      { row: 19, label: 'Контакты руководителя проекта', hint: 'Электронная почта и телефон' },
      { row: 20, label: 'Контакты заместителя или ответственного исполнителя', hint: 'Электронная почта и телефон' },
      { row: 21, label: 'Структурное подразделение' },
    ],
  },
];
const fields = new Map(groups.flatMap(group => group.fields).map(field => [String(field.row), field]));
const maxLength = 1000;
const documentPart = 'word/document.xml';

function cardValues(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Передайте значения полей карточки проекта.');
  }
  const values = new Map();
  for (const [row, value] of Object.entries(input)) {
    const field = fields.get(row);
    if (!field) throw new Error('В карточке проекта есть неизвестное поле.');
    if (typeof value !== 'string' || value.length > maxLength
      || !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
      throw new Error('Проверьте поле «' + field.label + '». Допустимо до ' + maxLength + ' символов.');
    }
    const text = value.trim();
    if (!text) continue;
    if (field.options && !field.options.includes(text)) throw new Error('Выберите значение для поля «' + field.label + '».');
    if (field.type === 'date') {
      const date = new Date(text + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
        throw new Error('Укажите корректную дату в поле «' + field.label + '».');
      }
      values.set(row, text.split('-').reverse().join('.'));
    } else values.set(row, text);
  }
  if (!values.size) throw new Error('Заполните хотя бы одно поле карточки.');
  return values;
}

function wordRun(text) {
  const lines = text.split(/\r\n?|\n/u).map(line => {
    const escaped = line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return '<w:t xml:space="preserve">' + escaped + '</w:t>';
  });
  return '<w:r>' + lines.join('<w:br/>') + '</w:r>';
}

function fillDocumentXml(xml, values) {
  // The trusted appendix has one heading table followed by the numbered form table.
  const tables = [...xml.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g)];
  const table = tables[1]?.[0];
  const rows = table?.match(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g);
  if (tables.length !== 2 || rows?.length !== fields.size) throw new Error('Таблица карточки проекта не соответствует шаблону.');
  let rowNumber = 0;
  const filled = table.replace(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g, row => {
    const number = String(++rowNumber);
    const cells = [...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)];
    const label = cells[0]?.[0].match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/)?.[1].trim();
    if (cells.length !== 3 || label !== number) {
      throw new Error('Нумерация полей карточки проекта не соответствует шаблону.');
    }
    if (!values.has(number)) return row;
    const cell = cells[2][0];
    const paragraph = cell.match(/(<w:p(?:\s[^>]*)?>)(<w:pPr>[\s\S]*?<\/w:pPr>)[\s\S]*?<\/w:p>/);
    if (!paragraph) throw new Error('В шаблоне нет поля карточки ' + number + '.');
    const replacement = paragraph[1] + paragraph[2] + wordRun(values.get(number)) + '</w:p>';
    return row.replace(cell, () => cell.replace(paragraph[0], () => replacement));
  });
  return xml.replace(table, () => filled);
}

function fillProjectCard(template, values) {
  const archive = readZip(template);
  const xml = fillDocumentXml(archive.read(documentPart).toString('utf8'), values);
  return writeZip(Object.fromEntries(archive.names.map(name => [
    name, name === documentPart ? xml : archive.read(name),
  ])));
}

module.exports = { cardValues, filename, fillProjectCard, groups, maxLength };
