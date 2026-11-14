'use strict';

const { paragraph, wordForm } = require('./word-form');

const filename = 'Заявка на поиск и подбор персонала.docx';
const maxLength = 260;
const field = (row, label, extra = {}) => ({ row, label, ...extra });
const groups = [
  { title: 'Вакансия', fields: [
    field('position', 'Название вакантной должности'),
    field('department', 'Подразделение'),
    field('recruitingFormat', 'Формат работы с вакансией'),
    field('startDate', 'Планируемая дата выхода', {
      type: 'date',
      hint: 'В приложении к регламенту указан ориентир: подбор занимает примерно месяц.',
    }),
    field('headcount', 'Количество требуемых сотрудников на вакансию', { maxLength: 60 }),
    field('manager', 'Кому будет подчиняться сотрудник'),
    field('reports', 'Количество подчинённых', { maxLength: 60 }),
  ] },
  { title: 'Условия работы', fields: [
    field('workplace', 'Где будет находиться рабочее место сотрудника'),
    field('workFormat', 'Формат работы'),
    field('workHours', 'Время работы'),
    field('workdays', 'Рабочие дни'),
    field('netSalary', 'Сумма заработной платы после вычета налогов'),
    field('experience', 'Требуемый опыт работы'),
    field('fixedTerm', 'Срочный трудовой договор', { options: ['Да', 'Нет'] }),
    field('fixedTermDetails', 'Уточнение по срочному договору'),
  ] },
  { title: 'Обязанности и требования', fields: [
    field('duties', 'Должностные обязанности', { type: 'textarea', maxLength: 2400 }),
    field('requirements', 'Требования к кандидату', {
      type: 'textarea', maxLength: 2400,
      hint: 'Образование, опыт, навыки, знание ПО и иностранных языков, деловые и личные качества.',
    }),
  ] },
  { title: 'Собеседование проводит', fields: [
    field('interviewer', 'ФИО'),
    field('interviewerEmail', 'Адрес корпоративной почты', { type: 'email' }),
    field('interviewerPhone', 'Телефон', { type: 'tel', maxLength: 60 }),
  ] },
];
const fields = new Map(groups.flatMap(group => group.fields.map(item => [item.row, item])));

function applicationValues(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Передайте значения полей заявки.');
  const values = new Map();
  for (const [key, value] of Object.entries(input)) {
    const item = fields.get(key);
    if (!item) throw new Error('В заявке есть неизвестное поле.');
    const limit = item.maxLength || maxLength;
    if (typeof value !== 'string' || value.length > limit || !value.isWellFormed()
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
      throw new Error('Проверьте поле «' + item.label + '». Допустимо до ' + limit + ' символов.');
    }
    const text = value.trim();
    if (!text) continue;
    if (item.type === 'date') {
      const date = new Date(text + 'T00:00:00Z');
      if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
        throw new Error('Укажите корректную планируемую дату выхода.');
      }
    }
    if (item.options && !item.options.includes(text)) throw new Error('Выберите значение в поле «' + item.label + '».');
    values.set(key, text);
  }
  if (!values.size) throw new Error('Заполните хотя бы одно поле заявки.');
  return values;
}

function fillStaffingApplication(values) {
  const blank = '____________________________';
  const get = key => values.get(key) || blank;
  const line = (number, key, value = get(key)) =>
    paragraph(number + '. ' + fields.get(key).label + ': ' + value, { after: 65 });
  const date = values.get('startDate');
  const contract = values.get('fixedTerm');
  const contractDetails = values.get('fixedTermDetails');
  const body = [
    paragraph('Приложение\nк Регламенту поиска и подбора персонала\nфедерального государственного автономного\nобразовательного учреждения высшего образования\n«Московский физико-технический институт\n(национальный исследовательский университет)»',
      { indent: 0, size: 22, keep: true }),
    paragraph('ЗАЯВКА\nНА ПОИСК И ПОДБОР ПЕРСОНАЛА', { align: 'center', bold: true, before: 210, after: 220, keep: true }),
    line(1, 'position'),
    line(2, 'department'),
    line(3, 'recruitingFormat'),
    paragraph('4. Планируемая дата выхода (учитывая, что период подбора составляет примерно месяц): '
      + (date ? date.split('-').reverse().join('.') : blank), { after: 65 }),
    line(5, 'headcount'),
    line(6, 'manager'),
    line(7, 'reports'),
    line(8, 'workplace'),
    line(9, 'workFormat'),
    line(10, 'workHours'),
    line(11, 'workdays'),
    line(12, 'netSalary'),
    line(13, 'experience'),
    line(14, 'fixedTerm', [contract, contractDetails].filter(Boolean).join('. ') || blank),
    paragraph('15. Должностные обязанности:', { before: 80, after: 30, keep: true }),
    paragraph(get('duties'), { indent: 340, split: true }),
    paragraph('16. Требования к кандидату (образование, профессиональный опыт, необходимые навыки, в том числе знание ПО и иностранных языков, деловые и личные качества):', { after: 30, keep: true }),
    paragraph(get('requirements'), { indent: 340, split: true }),
    paragraph('17. Собеседование проводит:', { after: 30, keep: true }),
    ...groups[3].fields.map(item => paragraph(item.label + ': ' + get(item.row), { after: 40 })),
  ].join('');
  return wordForm(body);
}

module.exports = { filename, groups, maxLength, applicationValues, fillStaffingApplication };
