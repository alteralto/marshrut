'use strict';

const { paragraph, wordForm } = require('./word-form');

const filename = 'Служебная записка об организации мероприятия в концертном зале.docx';
const field = (row, label, extra = {}) => ({ row, label, ...extra });
const name = field('name', 'ФИО', { maxLength: 160 });
const phone = field('phone', 'Мобильный телефон', { type: 'tel', maxLength: 48 });
const groups = [
  { title: 'Мероприятие', fields: [
    field('event', 'Название мероприятия', { type: 'textarea', maxLength: 400 }),
    field('start', 'Дата начала', { type: 'date' }),
    field('end', 'Дата окончания', { type: 'date' }),
    field('time', 'Время использования зала', { hint: 'Например, с 17:00 до 22:00' }),
    field('department', 'Подразделение-организатор'),
    field('funding', 'Источник финансирования', { type: 'textarea', hint: 'Укажите подразделение МФТИ и ФЛС либо стороннюю организацию.' }),
  ] },
  { title: 'Организатор и безопасность', fields: [
    field('organizer', 'ФИО организатора'),
    field('organizerPhone', 'Мобильный телефон организатора', { type: 'tel', maxLength: 48 }),
    field('safety', 'ФИО ответственного за безопасность', { hint: 'Порядок, охрана труда, пожарная безопасность, медицинское сопровождение и сохранность имущества.' }),
    field('safetyPhone', 'Мобильный телефон ответственного за безопасность', { type: 'tel', maxLength: 48 }),
  ] },
  { title: 'Ответственные лица', repeat: 'contacts', itemLabel: 'Ответственный', addLabel: 'Добавить ответственного', initial: 2, limit: 24, fields: [name, phone] },
  { title: 'Список для доступа в зал', repeat: 'access', itemLabel: 'Участник', addLabel: 'Добавить участника', initial: 1, limit: 40, fields: [
    name, field('position', 'Группа или должность'),
  ] },
  { title: 'Расписание репетиций и мероприятия', repeat: 'schedule', itemLabel: 'Запись', addLabel: 'Добавить запись в расписание', initial: 1, limit: 24, fields: [
    field('label', 'Наименование', { hint: 'Например, репетиция или название мероприятия.' }),
    field('date', 'Дата', { type: 'date' }),
    field('time', 'Время и количество часов', { maxLength: 100 }),
    field('equipment', 'Оборудование', { hint: 'Свет, звук, проектор и другое.' }),
    field('crew', 'Привлекаемые специалисты', { type: 'textarea', maxLength: 400 }),
    field('shift', 'Смена', { maxLength: 80 }),
  ] },
  { title: 'Подготовка и сдача зала', fields: [
    field('move', 'Что, куда и когда нужно переместить', { type: 'textarea' }),
    field('condition', 'Состояние зала после мероприятия', { type: 'textarea', hint: 'Заполняется после мероприятия. Для подачи записки оставьте поле пустым.' }),
  ] },
];
const maxLength = 260;
const fields = new Map();
for (const group of groups) for (const f of group.fields) {
  if (!group.repeat) fields.set(f.row, f);
  else for (let i = 0; i < group.limit; i++) fields.set(group.repeat + '.' + i + '.' + f.row, f);
}

function memoValues(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Передайте значения полей записки.');
  const values = new Map();
  for (const [key, value] of Object.entries(input)) {
    const f = fields.get(key);
    if (!f) throw new Error('В записке есть неизвестное поле или превышен лимит строк.');
    if (typeof value !== 'string' || value.length > (f.maxLength || maxLength)
      || !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
      throw new Error('Проверьте поле «' + f.label + '». Допустимо до ' + (f.maxLength || maxLength) + ' символов.');
    }
    const text = value.trim();
    if (!text) continue;
    if (f.type === 'date') {
      const date = new Date(text + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
        throw new Error('Укажите корректную дату в поле «' + f.label + '».');
      }
    }
    values.set(key, text);
  }
  if (!values.size) throw new Error('Заполните хотя бы одно поле записки.');
  if (values.has('start') && values.has('end') && values.get('end') < values.get('start')) {
    throw new Error('Дата окончания должна быть не раньше даты начала.');
  }
  return values;
}

function table(headers, rows, widths, size) {
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(edge =>
    '<w:' + edge + ' w:val="single" w:sz="5" w:color="555555"/>').join('');
  const makeRow = (row, heading) => '<w:tr><w:trPr><w:cantSplit/>' + (heading ? '<w:tblHeader/>' : '') + '</w:trPr>' +
    row.map((text, i) => '<w:tc><w:tcPr><w:tcW w:w="' + widths[i] + '" w:type="dxa"/></w:tcPr>' +
      paragraph(text, { after: 60, before: 60, bold: heading, keep: heading, size }) + '</w:tc>').join('') + '</w:tr>';
  return '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>' + borders +
    '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
    widths.map(w => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>' +
    makeRow(headers, true) + rows.map(row => makeRow(row, false)).join('') + '</w:tbl>';
}

function fillConcertMemo(values) {
  const blank = '______________________';
  const get = (key, fallback = blank) => values.get(key) || fallback;
  const date = (key, fallback = blank) => values.has(key) ? get(key).split('-').reverse().join('.') : fallback;
  function rows(id) {
    const group = groups.find(g => g.repeat === id);
    return Array.from({ length: group.limit }, (_, i) => group.fields.map(f => {
      const key = id + '.' + i + '.' + f.row;
      return f.type === 'date' ? date(key, '') : get(key, '');
    })).filter(row => row.some(Boolean));
  }
  const contacts = rows('contacts');
  while (contacts.length < 2) contacts.push(['', '']);
  const access = rows('access');
  const schedule = rows('schedule');
  const start = date('start');
  const end = date('end');
  const signature = 'Организатор    ____________________ / ____________________';
  const sectionTitle = text => paragraph(text, { before: 200, keep: true });
  const body = [
    paragraph('Приложение № 1\nк Регламенту КЗ', { align: 'right', after: 360 }),
    paragraph('Начальнику культурно-массового отдела МФТИ\nМорозова О.Б.', { align: 'right', after: 240 }),
    paragraph('Служебная записка\nоб организации мероприятия', { style: 'Title', align: 'center', after: 240, keep: true }),
    paragraph('Прошу предоставить Концертный зал МФТИ с ' + start + ' по ' + end +
      ', время: ' + get('time') + ', для проведения: ' + get('event') + '.', { indent: 480 }),
    paragraph('Подразделение-организатор: ' + get('department')),
    paragraph('Организатор мероприятия: ' + get('organizer') + ', сот. тел.: ' + get('organizerPhone')),
    sectionTitle('Ответственные лица:'),
    ...contacts.map(([person, tel]) => paragraph('— ' + (person || blank) + ', сот. тел.: ' + (tel || blank))),
    paragraph('Ответственный за обеспечение общественного порядка, соблюдение требований охраны труда, пожарной безопасности, медицинского сопровождения, сохранности имущества: ' + get('safety') + ', сот. тел.: ' + get('safetyPhone')),
    paragraph('Источник финансирования мероприятия (подразделение МФТИ (ФЛС) / сторонние организации): ' + get('funding')),
    sectionTitle('Прошу разрешить доступ в Концертный зал следующим лицам:'),
    table(['ФИО', 'Группа / должность'], access.length ? access : [['', '']], [4800, 4560]),
    sectionTitle('Расписание репетиций и мероприятий:'),
    table(['Наименование', 'Время (кол-во часов)', 'Дата', 'Оборудование (свет, звук, проектор)', 'Привлекаемые специалисты', 'Смена'],
      schedule.length ? schedule.map(([label, d, time, equipment, crew, shift]) => [label, time, d, equipment, crew, shift]) : [['', '', '', '', '', '']],
      [1800, 1480, 1330, 1860, 1970, 920], 21),
    paragraph('Для подготовки мероприятия необходимо переместить (что, куда, когда): ' + get('move').replace(/[.]$/u, '') +
      '. Своевременный возврат имущества на места хранения гарантирую.', { indent: 480, before: 200 }),
    paragraph('Перемещение мебели и оборудования производится силами Организатора.', { indent: 480 }),
    paragraph('Общественный порядок, чистоту и соблюдение правил противопожарной безопасности гарантирую. С регламентом эксплуатации Концертного зала МФТИ ознакомлен и согласен. Инструктаж по ПБ получил.', { indent: 480 }),
    paragraph('Обязуюсь контролировать состав и численность посетителей мероприятия, не допускать переполнение зала (присутствие в зале лиц, для которых не хватило кресла).', { indent: 480 }),
    paragraph('Обязуюсь не допускать внос в Концертный зал МФТИ и употребление участниками и посетителями мероприятия еды, внос любых предметов и веществ, способных причинить вред имуществу и отделке Концертного зала.', { indent: 480 }),
    paragraph('В случае порчи имущества / отделки Концертного зала обязуюсь оплатить восстановление / замену испорченного.', { indent: 480, keep: true }),
    paragraph(signature, { before: 180, after: 240 }),
    paragraph('Состояние зала после мероприятия: ' + get('condition', '________________________________________'), { keep: true }),
    paragraph(signature, { before: 100 }),
  ].join('');
  return wordForm(body);
}

module.exports = { filename, groups, maxLength, memoValues, fillConcertMemo };
