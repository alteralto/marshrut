'use strict';

const { paragraph, wordForm } = require('./word-form');

const filename = 'Заявление о переходе на бесплатное обучение.docx';
const maxLength = 260;
const groups = [
  { title: 'Кому и от кого', fields: [
    { row: 'rector', label: 'ФИО ректора МФТИ' },
    { row: 'student', label: 'ФИО обучающегося полностью' },
    { row: 'year', label: 'Курс', maxLength: 16 },
    { row: 'school', label: 'Физтех-школа' },
    { row: 'group', label: 'Учебная группа', maxLength: 60 },
    { row: 'phone', label: 'Контактный телефон', type: 'tel', maxLength: 60 },
  ] },
  { title: 'Основание перехода', fields: [
    { row: 'reason', label: 'Причина и условие перехода', type: 'textarea', maxLength: 2000,
      hint: 'Укажите основание из пункта 2.3 регламента, которое относится к вам.' },
    { row: 'date', label: 'Дата составления', type: 'date' },
  ] },
  { title: 'Приложенные документы', fields: [
    { row: 'attachment1', label: 'Документ 1' },
    { row: 'attachment2', label: 'Документ 2' },
    { row: 'attachment3', label: 'Документ 3' },
  ] },
];
const fields = new Map(groups.flatMap(group => group.fields.map(field => [field.row, field])));

function applicationValues(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Передайте поля заявления.');
  const values = new Map();
  for (const [key, value] of Object.entries(input)) {
    const field = fields.get(key);
    if (!field) throw new Error('В заявлении есть неизвестное поле.');
    const limit = field.maxLength || maxLength;
    if (typeof value !== 'string' || value.length > limit || !value.isWellFormed()
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
      throw new Error('Проверьте поле «' + field.label + '». Допустимо до ' + limit + ' символов.');
    }
    const text = value.trim();
    if (!text) continue;
    if (key === 'date') {
      const date = new Date(text + 'T00:00:00Z');
      if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
        throw new Error('Укажите корректную дату составления.');
      }
    }
    values.set(key, text);
  }
  if (!values.size) throw new Error('Заполните хотя бы одно поле заявления.');
  return values;
}

function fillApplication(values) {
  const get = (key, blank = '________________________') => values.get(key) || blank;
  const date = values.get('date')?.split('-').reverse().join('.') || '________________';
  return wordForm([
    paragraph('Приложение 1\nк Порядку перехода обучающихся МФТИ\nс платного обучения на бесплатное', { align: 'right', after: 360 }),
    paragraph('Ректору МФТИ ' + get('rector'), { after: 65 }),
    paragraph('от обучающегося ' + get('year', '____') + ' курса', { after: 65 }),
    paragraph('физтех-школы ' + get('school') + ', группы ' + get('group', '________'), { after: 65 }),
    paragraph(get('student', '____________________________________') + ' (Ф.И.О. полностью)', { after: 65 }),
    paragraph('Контактный телефон: ' + get('phone')),
    paragraph('ЗАЯВЛЕНИЕ', { align: 'center', bold: true, before: 360, after: 220, keep: true }),
    paragraph('Прошу перевести меня с платного обучения на бесплатное в связи с:', { keep: true, after: 80 }),
    paragraph(get('reason', '______________________________________________________'), { split: true, after: 90 }),
    ...(!values.has('reason') ? [paragraph('(указать причину и условие перехода)', { size: 20, after: 160 })] : []),
    paragraph('Приложение:', { before: 180, keep: true }),
    ...groups[2].fields.map(({ row }, index) =>
      paragraph((index + 1) + '. ' + get(row, '______________________________________________________'), { after: 85 })),
    paragraph('Дата составления: ' + date, { before: 360, keep: true }),
    paragraph('Подпись обучающегося: __________________________'),
  ].join(''));
}

module.exports = { filename, groups, maxLength, applicationValues, fillApplication };
