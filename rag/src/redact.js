'use strict';
// Personal data is cut out before a text leaves for an external model: the
// documents themselves are open, but the names, phones and e-mails in their
// approval sheets are not ours to send. Positions stay: "проректор по
// финансам" is the rule, not the person.

const UP = '[А-ЯЁ]';
const LOW = '[а-яё]';
const SURNAME = `${UP}${LOW}+(?:-${UP}${LOW}+)?`;
const INITIALS = `${UP}\\.\\s?(?:${UP}\\.)?`;
const PATRONYMIC = `${UP}${LOW}+(?:ович|евич|ьич|ична|инична|овна|евна)(?:а|у|ем|ом|ой|е|ы)?`;
const NAME = `${UP}${LOW}+`;
const B = '(?<![А-Яа-яЁё])';
const E = '(?![А-Яа-яЁё])';

const PATTERNS = [
  // Иванов Иван Иванович, Иван Иванович Иванов, Ивана Ивановича
  new RegExp(`${B}(?:${SURNAME}\\s+)?${NAME}\\s+${PATRONYMIC}(?:\\s+${SURNAME})?${E}`, 'g'),
  // И.И. Иванов, И. Иванов
  new RegExp(`${B}${INITIALS}\\s?${SURNAME}${E}`, 'g'),
  // Иванов И.И.
  new RegExp(`${B}${SURNAME}\\s+${INITIALS}`, 'g'),
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /(?:\+7|(?<!\d)8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/g,
];

function redactPeople(text) {
  let out = String(text || '');
  for (const re of PATTERNS) out = out.replace(re, (m) => (m.includes('@') ? '[e-mail]' : /\d/.test(m) ? '[телефон]' : '[ФИО]'));
  return out;
}

module.exports = { redactPeople };
