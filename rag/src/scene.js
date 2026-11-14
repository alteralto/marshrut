'use strict';
// Clause of a regulation -> scene for the animated step picture.
//
//   parseScene(text, hints?) -> { scene, who, whoRole, to, toRole, doc, form,
//                                 deadline, allDeadlines, confidence, needsArbiter, signals }
//
// scene:  approve | fill | handover | money | report | info
// who/to: a label taken from the clause (a nominative phrase as written, or
//         the dictionary name of a matched word plus its genitive tail);
//         whoRole/toRole: employee | manager | dept, picks the figure to draw
// deadline: { days, unit, rel, anchor, n, kind, text }
//
// Everything is dictionaries and regular expressions: no model, no
// dependencies, about 0.05 ms per clause. The clause text is the only source
// of truth: a label that the text does not support is never returned, and
// checkScene() removes such labels from any scene object (for example one
// filled by an LLM). arbitrate() optionally asks a small OpenAI-compatible
// model about the scene type when the dictionary is unsure.

const SCENES = ['approve', 'fill', 'handover', 'money', 'report', 'info'];
const ROLES = ['employee', 'manager', 'dept'];

// ---------------------------------------------------------------- regex helpers
// JavaScript \b and \w know only Latin letters, so word boundaries are spelled
// out. In pattern sources: \< = word start, \> = word end, \w = a word character.
// Patterns run on lower-cased text with ё replaced by е (same length as the
// original, so match positions are valid in both).

const W = '[а-яa-z0-9]';
function rx(src, flags = 'g') {
  return new RegExp(
    src.replace(/\\</g, `(?<!${W})`).replace(/\\>/g, `(?!${W})`).replace(/\\w/g, W),
    flags,
  );
}

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[   ]/g, ' ');
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Sentences and list items: [{ start, end }]. A full stop splits only after a
// word of two or more characters, so "п. 3.3", "ф. 0504505", "г. Москва" stay whole.
function sentences(orig) {
  const out = [];
  const re = /(?<=[а-яёa-z0-9»")\]]{2}[.!?])\s+(?=[А-ЯЁA-Z«"(•-])|;\s+|\n+/g;
  let start = 0;
  let m;
  while ((m = re.exec(orig))) {
    if (m.index > start) out.push({ start, end: m.index });
    start = m.index + m[0].length;
  }
  if (start < orig.length) out.push({ start, end: orig.length });
  return out;
}

// ---------------------------------------------------------------- deadlines

const NUM_WORDS = {
  одного: 1, одной: 1, один: 1, одна: 1, одну: 1, одни: 1, одних: 1,
  двух: 2, два: 2, две: 2, трех: 3, три: 3, четырех: 4, четыре: 4, пяти: 5, пять: 5,
  шести: 6, шесть: 6, семи: 7, семь: 7, восьми: 8, восемь: 8, девяти: 9, девять: 9,
  десяти: 10, десять: 10, одиннадцати: 11, одиннадцать: 11, двенадцати: 12, двенадцать: 12,
  тринадцати: 13, четырнадцати: 14, четырнадцать: 14, пятнадцати: 15, пятнадцать: 15,
  шестнадцати: 16, семнадцати: 17, восемнадцати: 18, девятнадцати: 19,
  двадцати: 20, двадцать: 20, тридцати: 30, тридцать: 30, сорока: 40, сорок: 40,
  пятидесяти: 50, пятьдесят: 50, шестидесяти: 60, шестьдесят: 60, девяноста: 90, девяносто: 90, ста: 100, сто: 100,
};
const NUM_PREFIX = {
  '': 1, одно: 1, двух: 2, трех: 3, четырех: 4, пяти: 5, шести: 6, семи: 7, восьми: 8, девяти: 9, десяти: 10,
  четырнадцати: 14, пятнадцати: 15, двадцати: 20, тридцати: 30,
};
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const NUMW = Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join('|');
// 3 | 3 (три) | трех | двадцати одного
const NUM = `(?:(\\d{1,3})(?:\\s*\\([а-я ]{2,30}\\))?|((?:${NUMW})(?:\\s+(?:${NUMW}))?))`;
const UNIT = '(?:(рабоч\\w+|календарн\\w+|банковск\\w+|учебн\\w+)\\s+)?(дней|дня|день|дни|дн\\.|суток|сутки|часов|часа|час|недель|недели|неделю|неделя|месяцев|месяца|месяц|лет|года|год)\\>';
const QTY = `${NUM}\\s+${UNIT}`; // 4 groups: digits, words, unit adjective, unit
const FROM = '(после|со дня|с даты|с момента|с дня|от даты|от дня|с даты)';
const ANCH = '([^,.;:()]{3,80})';

function numOf(digits, wordsStr) {
  if (digits) return Number(digits);
  if (!wordsStr) return null;
  let n = 0;
  for (const w of wordsStr.trim().split(/\s+/)) {
    if (!(w in NUM_WORDS)) return null;
    n += NUM_WORDS[w];
  }
  return n || null;
}

function quantity(n, adj, unitWord) {
  const u = unitWord || '';
  let unit = null;
  let days = null;
  if (/^(дн|день)/.test(u)) {
    days = n;
    unit = /^рабоч|^банковск|^учебн/.test(adj || '') ? 'workday' : /^календарн/.test(adj || '') ? 'calendar' : null;
  } else if (/^сут/.test(u)) { days = n; unit = 'calendar'; }
  else if (/^недел/.test(u)) { days = n * 7; unit = 'calendar'; }
  else if (/^час/.test(u)) unit = 'hour';
  else if (/^месяц/.test(u)) unit = 'month';
  else unit = 'year';
  return { n, days, unit };
}

const DEADLINE_PATTERNS = [
  // не позднее чем за 5 рабочих дней до начала командировки
  { rel: 'before', re: rx(`\\<(?:(?:не позднее|не позже|не менее|не ранее),?\\s+(?:чем\\s+)?)?за\\s+${QTY}\\s+до\\s+${ANCH}`), q: 1, a: 5 },
  // не позднее 3 рабочих дней до выезда
  { rel: 'before', re: rx(`\\<(?:не позднее|не позже)\\s+${QTY}\\s+до\\s+${ANCH}`), q: 1, a: 5 },
  // в течение 3 (трёх) рабочих дней [со дня получения заявления]
  { rel: 'within', re: rx(`\\<в течение\\s+${QTY}(?:\\s+${FROM}\\s+${ANCH})?`), q: 1, f: 5, a: 6 },
  // в течение часа / месяца после ...
  { rel: 'within', re: rx(`\\<в течение\\s+(часа|суток|недели|месяца|года)\\>(?:\\s+${FROM}\\s+${ANCH})?`), bare: 1, f: 2, a: 3 },
  // не позднее 5 дней после выплаты; в срок не более 10 рабочих дней со дня получения
  { rel: 'within', re: rx(`\\<(?:не позднее|не позже|в срок,? не более|в срок,? не позднее|не более чем через|не позднее чем через|в срок,? не превышающий|срок\\w*,? не превышающ\\w+)(?:\\s+чем)?\\s+${QTY}(?:\\s+${FROM}\\s+${ANCH})?`), q: 1, f: 5, a: 6 },
  // срок рассмотрения не должен превышать двух рабочих дней
  { rel: 'within', re: rx(`\\<срок\\w*[^.;]{0,80}?не (?:должен|может|должны|могут) превышать\\s+${QTY}`), q: 1 },
  // в трёхдневный срок, в 10-дневный срок, в месячный срок
  { rel: 'within', re: rx(`\\<в\\s+(?:(\\d{1,3})-?(?:х|ти|и)?-?|([а-я]*?))(дневн|недельн|месячн)\\w+\\s+срок\\>(?:\\s+${FROM}\\s+${ANCH})?`), adjective: 1, f: 4, a: 5 },
  // 3 (три) рабочих дня после возвращения
  { rel: 'after', re: rx(`\\<${QTY}\\s+${FROM}\\s+${ANCH}`), q: 1, f: 5, a: 6 },
  // в срок до 10 числа, не позднее 25 числа месяца
  { rel: null, date: 'dom', re: rx('\\<(?:в срок\\s+)?(?:не позднее|не позже|до)\\s+(\\d{1,2})(?:-го)?\\s+числа\\>') },
  // до 1 декабря
  { rel: null, date: 'month', re: rx(`\\<(?:в срок\\s+)?(?:не позднее|не позже|до)\\s+(\\d{1,2})\\s+(${MONTHS.join('|')})\\>`) },
];

// A period of validity or storage is not a deadline for an action.
const VALIDITY_BEFORE = rx('(?:действу\\w+|действител\\w+|действия|хран\\w+|сохраня\\w+|продолжительност\\w+|предоставляется|длится)\\s+(?:\\w+\\s+){0,2}$', '');

function parseDeadlines(text) {
  const orig = String(text == null ? '' : text);
  const low = norm(orig);
  const found = [];
  for (const p of DEADLINE_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(low))) {
      const start = m.index;
      const end = start + m[0].length;
      if (found.some((d) => start < d.end && end > d.start)) continue;
      if (VALIDITY_BEFORE.test(low.slice(Math.max(0, start - 60), start))) continue;
      let d;
      if (p.date === 'dom') {
        d = { days: null, unit: null, rel: null, anchor: null, n: null, kind: 'date', dayOfMonth: Number(m[1]) };
      } else if (p.date === 'month') {
        d = { days: null, unit: null, rel: null, anchor: null, n: null, kind: 'date', day: Number(m[1]), month: MONTHS.indexOf(m[2]) + 1 };
      } else {
        let q;
        if (p.bare) q = quantity(1, null, m[1]);
        else if (p.adjective) {
          const n = m[1] ? Number(m[1]) : NUM_PREFIX[m[2] || ''];
          if (!n) continue;
          q = quantity(n, null, m[3] === 'дневн' ? 'дней' : m[3] === 'недельн' ? 'недель' : 'месяц');
        } else {
          const n = numOf(m[p.q], m[p.q + 1]);
          if (!n) continue;
          q = quantity(n, m[p.q + 2], m[p.q + 3]);
        }
        const from = p.f ? m[p.f] : null;
        let anchor = null;
        if (p.a && m[p.a]) {
          const aStart = start + m[0].lastIndexOf(m[p.a]);
          anchor = orig.slice(aStart, aStart + m[p.a].length).trim();
        }
        const rel = p.rel === 'within' && from ? 'after' : p.rel;
        d = { days: q.days, unit: q.unit, rel, anchor, n: q.n, kind: 'period' };
      }
      d.text = orig.slice(start, end).trim();
      d.start = start;
      d.end = end;
      found.push(d);
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- actions

// [scene, pattern, flags]. Finite and infinitive forms only: full participles
// ("согласованный", "утверждённой") describe a document, not a step.
// flags: check = a checking verb that gives way to a later action in the same
//        sentence; tail = the predicate is the last word of the match (for the
//        negation test); weak = used only when nothing else matched.
const SUBMIT = '(?:представля(?:ет|ют|ется|ются)|предоставля(?:ет|ют|ется|ются)|представить|предоставить|сда(?:ет|ют|ется|ются)|сдать|прилага(?:ет|ют|ется|ются)|принима(?:ется|ются)|предоставленн\\w+|представленн\\w+)';
const DONE = '(?:производится|осуществляется|производятся|осуществляются|проводится)';
const ACTION_PATTERNS = [
  ['report', `\\<авансов\\w+ отчет\\w*[^.;]{0,200}?\\<${SUBMIT}\\>`],
  ['report', `\\<${SUBMIT}\\>[^.;]{0,120}?\\<авансов\\w+ отчет`],
  ['report', '\\<возвраща(?:ет|ют|ется|ются)\\>[^.;]{0,80}?\\<(?:остат\\w+|неизрасходованн\\w+|неиспользованн\\w+)'],
  ['report', '\\<(?:остат\\w+|неизрасходованн\\w+|неиспользованн\\w+)[^.;]{0,80}?\\<возвраща(?:ет|ют|ется|ются)\\>'],
  ['report', '\\<представля(?:ет|ют)\\>[^.;]{0,80}?\\<копи[юи]\\>'],
  ['report', '\\<(?:отчитыва(?:ет|ют)ся|отчитаться)\\>'],
  ['report', '\\<(?:представля|сда)(?:ет|ют|ется|ются)\\>\\s+(?:\\w+\\s+){0,3}?отчет'],

  ['money', '\\<(?:перечисля(?:ет|ют|ется|ются|ть)|перечислить)\\>'],
  ['money', '\\<(?:выплачива(?:ет|ют|ется|ются|ть)|выплатить)\\>'],
  ['money', '\\<(?:оплачива(?:ет|ют|ется|ются|ть)|оплатить)\\>'],
  ['money', '\\<(?:возмеща(?:ет|ют|ется|ются|ть)|возместить)\\>'],
  ['money', `\\<(?:оплата|возмещение|выплата|перечисление|выдача денежных средств|выдача аванса)\\>[^.;]{0,140}?\\<${DONE}\\>`, 'tail'],
  ['money', '\\<(?:проводит|производит|осуществляет)\\s+(?:оплату|выплату|перечисление|возмещение)\\>'],
  ['money', '\\<выда(?:ет|ют|ется|ются)\\>[^.;]{0,40}?\\<(?:аванс|денежн)'],

  ['approve', '\\<оформля(?:ется|ются)\\s+приказ(?:ом|ами)\\>'],
  ['approve', '\\<(?:согласу(?:ет|ют|ется|ются)|согласовыва(?:ет|ют|ется|ются|ть)|согласовать)\\>'],
  ['approve', '\\<(?:визиру(?:ет|ют|ется|ются)|завизировать|визировать)\\>'],
  ['approve', '\\<виз[аы]\\s+проставля(?:ет|ют|ется|ются)\\>'],
  ['approve', '\\<(?:подписыва(?:ет|ют|ется|ются|ть)|подписать)\\>'],
  ['approve', '\\<(?:утвержда(?:ет|ют|ется|ются|ть)|утвердить)\\>'],
  ['approve', `\\<(?:утверждение|согласование|визирование|подписание)\\>[^.;]{0,140}?\\<${DONE}\\>`, 'tail'],
  ['approve', '\\<(?:принима(?:ет|ют)|принять)\\s+решени'],
  ['approve', '\\<решени\\w+[^.;]{0,140}?\\<принима(?:ет|ют|ется|ются)\\>', 'tail'],
  ['approve', '\\<(?:определяется|устанавливается|определяются|устанавливаются)\\s+(?:\\w+\\s+){0,2}?(?:руководител|ректор|проректор|декан|директор|комисси)'],
  ['approve', '\\<срок\\w*\\s+(?:рассмотрения|согласования|подписания|визирования|утверждения)\\>'],
  ['approve', '\\<(?:отклон(?:ить|яет|яют))\\>'],
  ['approve', '\\<(?:рассматрива(?:ет|ют|ется|ются)|рассмотреть)\\>', 'check'],
  ['approve', '\\<(?:проверя(?:ет|ют|ется|ются)|проверить)\\>', 'check'],

  ['handover', '\\<готов(?:ит|ят)\\s+(?:проект\\w*\\s+)?приказ'],
  ['handover', '\\<приказ\\w*[^.;]{0,100}?\\<готов(?:ит|ят)\\>', 'tail'],
  ['handover', '\\<(?:переда(?:ет|ют|ется|ются|ть|вать))\\>'],
  ['handover', '\\<(?:направля(?:ет|ют|ется|ются|ть)|направить)\\>'],
  ['handover', '\\<(?:регистриру(?:ет|ют|ется|ются)|зарегистрировать)\\>'],
  ['handover', '\\<(?:сообща(?:ет|ют)|информиру(?:ет|ют)|уведомля(?:ет|ют)|извеща(?:ет|ют))\\>'],
  ['handover', '\\<(?:изготавлива(?:ет|ют|ется|ются)|вруча(?:ет|ют|ется|ются))\\>'],
  ['handover', '\\<возвраща(?:ет|ют|ется|ются)\\>[^.;]{0,60}?\\<(?:инициатор|исполнител|заявител|на доработку)'],
  ['handover', '\\<размеща(?:ет|ют)\\>[^.;]{0,80}?\\<(?:в единой информационной системе|на сайте|на портале|в еис)\\>'],

  ['fill', '\\<обраща(?:ет|ют)ся\\>[^.;]{0,200}?\\<с\\s+(?:\\w+\\s+){0,2}?(?:заявлением|заявкой|служебной запиской|ходатайством)'],
  ['fill', '\\<представля(?:ет|ют)\\>[^.;]{0,80}?\\<(?:заявлени|заявк|служебн\\w+ записк|ходатайств)'],
  ['fill', '\\<(?:пода(?:ет|ют|ется|ются|вать)|подать)\\>'],
  ['fill', '\\<инициир(?:ует|уют|овать|уется|уются)\\>'],
  ['fill', '\\<(?:оформля(?:ет|ют|ется|ются|ть)|оформить)\\>'],
  ['fill', '\\<(?:заполня(?:ет|ют|ется|ются|ть)|заполнить)\\>'],
  ['fill', '\\<составля(?:ется|ются)\\>'],
  ['fill', '\\<(?:составля(?:ет|ют)|составить|формиру(?:ет|ют)|сформировать)\\>\\s+(?:\\w+\\s+){0,2}?(?:заявк|заявлени|акт|отчет|протокол|смет|служебн|проект|пакет|комплект)'],
  ['fill', '\\<готов(?:ит|ят)\\s+проект'],
  ['fill', '\\<(?:прилага(?:ет|ют|ется|ются)|приклад(?:ывает|ывают|ывается|ываются)|приложить)\\>'],

  // "представляет в отдел кадров сведения": after the specific report/fill patterns
  ['handover', '\\<представля(?:ет|ют)\\s+в\\>'],

  ['fill', '\\<поданн\\w+\\s+в\\>', 'weak'],
].map(([scene, src, flag]) => ({ scene, re: rx(src), flag: flag || null }));

// A payment verb in a rule about amount, source or eligibility is a norm, not a step.
const NORM_CUE = rx('\\<(?:в размере|размер\\w*|не более|не менее|не свыше|по фактическим|за счет|следующие|следующих|за каждый|за календарн\\w+|только при|не чаще|виды|процент\\w*)\\>', '');
// "X является Y", "X признаётся Y": a definition, whatever verbs follow.
const DEFINES = rx('\\<(?:является|являются|признается|признаются|понимается|понимаются)\\>', '');
const DASH_DEFINITION = /^[^.;:,(]{2,90}\s[–—-]\s/;
const CONDITION = rx('\\<если\\>', 'g');

function findHits(low, sents) {
  const raw = [];
  for (const p of ACTION_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(low))) {
      const start = m.index;
      const end = start + m[0].length;
      const lastWord = /[а-яa-z0-9-]+$/.exec(m[0]);
      const verbPos = p.flag === 'tail' && lastWord ? start + lastWord.index : start;
      raw.push({ scene: p.scene, start, end, verbPos, flag: p.flag, verb: m[0] });
      if (m[0].length === 0) p.re.lastIndex++;
    }
  }
  // one hit per position: the first pattern in the list is the most specific
  const byPos = new Map();
  for (const h of raw) if (!byPos.has(h.start)) byPos.set(h.start, h);
  const hits = [...byPos.values()].sort((a, b) => a.start - b.start);
  for (const h of hits) h.sent = sents.findIndex((s) => h.start >= s.start && h.start < s.end);
  return hits;
}

function conditionSpans(low, sents) {
  const spans = [];
  CONDITION.lastIndex = 0;
  let m;
  while ((m = CONDITION.exec(low))) {
    const s = sents.find((x) => m.index >= x.start && m.index < x.end);
    const limit = s ? s.end : low.length;
    const comma = low.indexOf(',', m.index);
    spans.push({ start: m.index, end: comma >= 0 && comma < limit ? comma : limit });
  }
  return spans;
}

// ---------------------------------------------------------------- actors

// Case by ending, per declension. `amb` endings cannot be told from genitive
// and are not taken as a subject.
const DECL = {
  m: { nom: ['', 'и', 'ы'], ins: ['ом', 'ами'], dat: ['у', 'ам'], gen: ['а', 'ов', 'е', 'ах'] },
  soft: { nom: ['ь', 'и'], ins: ['ем', 'ями'], dat: ['ю', 'ям'], gen: ['я', 'ей', 'е', 'ях'] },
  ec: { nom: ['ец', 'ьцы'], ins: ['ьцем', 'ьцами'], dat: ['ьцу', 'ьцам'], gen: ['ьца', 'ьцев'] },
  ia: { nom: ['я'], ins: ['ей', 'ями'], dat: [], acc: ['ю'], gen: ['и', 'й', 'ям', 'ях'] },
  a: { nom: ['а'], ins: ['ой', 'ами'], dat: ['е'], acc: ['у'], gen: ['ы', 'ам', 'ах'] },
  ie: { nom: ['е'], ins: ['ем', 'ями'], dat: ['ю'], gen: ['я', 'и', 'й', 'ям', 'ях'] },
  lico: { nom: ['о'], ins: ['ом', 'ами'], dat: ['у', 'ам'], gen: ['а'] },
  part: { nom: ['ийся', 'аяся', 'иеся'], ins: ['имся', 'имися'], dat: ['емуся'], gen: ['егося', 'ихся', 'ейся', 'уюся'] },
  adj: { nom: ['ий', 'ая', 'ие'], ins: ['им', 'ими'], dat: ['ему'], gen: ['его', 'их', 'ей', 'ую'] },
};

// [role, dictionary name, stem, declension, takes a genitive tail]
const ACTORS = [
  ['employee', 'Внутренний заказчик', 'внутренн\\w+\\s+заказчик', 'm', false],
  ['employee', 'Работник', 'работник', 'm', false],
  ['employee', 'Сотрудник', 'сотрудник', 'm', true],
  ['employee', 'Обучающийся', 'обучающ', 'part', false],
  ['employee', 'Студент', 'студент', 'm', false],
  ['employee', 'Аспирант', 'аспирант', 'm', false],
  ['employee', 'Инициатор', 'инициатор', 'm', true],
  ['employee', 'Исполнитель', 'исполнител', 'soft', true],
  ['employee', 'Заявитель', 'заявител', 'soft', false],
  ['employee', 'Подотчётное лицо', 'подотчетн\\w+\\s+лиц', 'lico', false],
  ['employee', 'Участник', 'участник', 'm', true],
  ['employee', 'Победитель', 'победител', 'soft', true],
  ['employee', 'Посетитель', 'посетител', 'soft', false],
  ['employee', 'Владелец', 'владел', 'ec', false],
  ['manager', 'Руководитель', 'руководител', 'soft', true],
  ['manager', 'Проректор', 'проректор', 'm', true],
  ['manager', 'Ректор', 'ректор', 'm', false],
  ['manager', 'Декан', 'декан', 'm', true],
  ['manager', 'Директор', 'директор', 'm', true],
  ['manager', 'Начальник', 'начальник', 'm', true],
  ['manager', 'Заведующий', 'заведующ', 'adj', true],
  ['manager', 'Председатель', 'председател', 'soft', true],
  ['manager', 'Комиссия', 'комисси', 'ia', false],
  ['manager', 'Учёный совет', 'учен\\w+\\s+совет', 'm', false],
  ['manager', 'Уполномоченное лицо', 'уполномоченн\\w+\\s+(?:\\w+\\s+)?лиц', 'lico', false],
  ['manager', 'Визирующие лица', 'визирующ\\w+\\s+лиц', 'lico', false],
  ['manager', 'Согласующий', 'согласующ', 'adj', false],
  ['dept', 'Бухгалтерия', 'бухгалтери', 'ia', false],
  ['dept', 'Отдел', 'отдел', 'm', true],
  ['dept', 'Управление', 'управлени', 'ie', true],
  ['dept', 'Деканат', 'деканат', 'm', false],
  ['dept', 'Служба', 'служб', 'a', true],
  ['dept', 'Дирекция', 'дирекци', 'ia', true],
  ['dept', 'Администрация', 'администраци', 'ia', false],
  ['dept', 'Профком', 'профком', 'm', false],
  ['dept', 'Оператор', 'оператор', 'm', true],
  ['dept', 'Заказчик', 'заказчик', 'm', false],
  ['dept', 'Канцелярия', 'канцеляри', 'ia', false],
  ['dept', 'Центр', 'центр', 'm', true],
  ['dept', 'Департамент', 'департамент', 'm', true],
  ['dept', 'Подразделение', 'подразделени', 'ie', false],
].map(([role, name, stem, decl, tail]) => {
  const ends = [...new Set(Object.values(DECL[decl]).flat())].sort((a, b) => b.length - a.length);
  return { role, name, decl, tail, re: rx(`\\<(${stem})(${ends.join('|')})\\>`) };
});

const PREP_TARGET = new Set(['в', 'во', 'на', 'к', 'ко']);
const PREP_WITH = new Set(['с', 'со']);
const PREP_OTHER = new Set(['от', 'из', 'у', 'для', 'без', 'до', 'после', 'при', 'о', 'об', 'по', 'за', 'через', 'между', 'перед', 'над', 'под', 'про', 'среди', 'кроме', 'вместо', 'согласно']);
const ADJ_END = /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ом|ем|ую|юю|ых|их|ыми|ими)$/;
const NOM_ADJ_END = /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие)$/;
const GEN_END = /(?:ого|его|ой|ей|ых|их|ов|ев|ий|а|я|и|ы)$/;
const VERB_END = /(?:ся|ет|ит|ют|ят|ут|ать|ить|еть|ять)$/;
const TAIL_STOP = new Set(['и', 'или', 'либо', 'а', 'не', 'если', 'лично', 'также', 'которые', 'которая', 'который', 'которое']);
// Abbreviations that are not a department.
const NOT_DEPT = new Set(['РФ', 'МФТИ', 'НИУ', 'ВШЭ', 'СЭД', 'ЕИС', 'ФИО', 'НДС', 'МСП', 'ФЗ', 'МЧС', 'ИНН', 'КПП', 'ООО', 'ИП', 'РИД', 'НИР', 'НИОКР', 'ЛНА', 'ТК', 'ГК', 'НК', 'МРОТ', 'КБК', 'КОСГУ', 'ЭП', 'ЭЦП', 'НМЦД', 'НМЦК', 'ОКПД', 'ЕП', 'ТЗ', 'ПО', 'США', 'СНГ', 'ЦБ', 'МГПУ', 'УЛГУ', 'ЭДО', 'ЛК', 'ИТ', 'ЕГРЮЛ', 'СМИ', 'ВО', 'ДПО', 'НПР', 'ППС', 'ФГОС', 'ОВЗ', 'ГИА', 'ВКР']);

const WORD_BEFORE = /([а-яa-z0-9-]+)[\s«"(]*$/;

// Words right before `pos`, last first, at most `n`, not crossing punctuation.
function wordsBefore(low, pos, n) {
  const out = [];
  let end = pos;
  for (let k = 0; k < n; k++) {
    const m = WORD_BEFORE.exec(low.slice(Math.max(0, end - 40), end));
    if (!m) break;
    out.push(m[1]);
    end = end - m[0].length;
  }
  return out;
}

// Genitive tail after a head: "отдел кадров", "руководитель структурного
// подразделения", "проректор по учебной работе".
function tailAfter(low, orig, pos) {
  let end = pos;
  let taken = 0;
  const re = /^ ([а-яa-z-]+)/;
  for (;;) {
    const m = re.exec(low.slice(end, end + 40));
    if (!m) break;
    const w = m[1];
    if (w === 'по' && taken < 3) {
      const m2 = /^ по ([а-я-]+(?:ой|ей|ому|ему|ым|им)) ([а-я-]+)/.exec(low.slice(end, end + 70));
      if (m2) end += m2[0].length;
      break;
    }
    if (taken >= 3 || TAIL_STOP.has(w) || PREP_TARGET.has(w) || PREP_WITH.has(w) || PREP_OTHER.has(w)) break;
    if (!GEN_END.test(w) || VERB_END.test(w)) break;
    end += m[0].length;
    taken++;
  }
  return orig.slice(pos, end);
}

function findActors(orig, low) {
  const out = [];
  for (const a of ACTORS) {
    a.re.lastIndex = 0;
    let m;
    while ((m = a.re.exec(low))) {
      const start = m.index;
      const end = start + m[0].length;
      const ending = m[2];
      const d = DECL[a.decl];
      let kase = d.nom.includes(ending) ? 'nom' : d.ins.includes(ending) ? 'ins' : d.dat.includes(ending) ? 'dat' : (d.acc || []).includes(ending) ? 'acc' : 'gen';
      // "уполномоченного лица" vs "визирующие лица"
      if (a.decl === 'lico' && ending === 'а') kase = /(?:ие|ые)\s/.test(m[1]) ? 'nom' : 'gen';
      if (a.decl === 'lico' && ending === 'о' && /(?:ого|его)\s/.test(m[1])) kase = 'gen';
      // plural "-и/-ы" of a masculine noun is nominative only without a preposition; "отдела" etc. stay genitive
      const back = wordsBefore(low, start, 4);
      let prep = null;
      let adjStart = start;
      let cursor = start;
      for (const w of back) {
        if (PREP_TARGET.has(w) || PREP_WITH.has(w) || PREP_OTHER.has(w)) { prep = w; break; }
        if (!ADJ_END.test(w) || VERB_END.test(w)) break;
        const at = low.lastIndexOf(w, cursor - 1);
        if (kase === 'nom' && NOM_ADJ_END.test(w)) adjStart = at;
        cursor = at;
      }
      // "в адрес руководителя", "на имя ректора", "на подпись ректору"
      const lead = low.slice(Math.max(0, start - 60), start);
      const addressed = /(?:в адрес|на имя|на подпись|на согласование|на утверждение|на рассмотрение)\s+(?:[а-я-]+\s+){0,2}$/.test(lead);
      let role = 'mention';
      if (addressed) role = 'target';
      else if (prep && PREP_TARGET.has(prep)) role = kase === 'gen' && a.decl !== 'ie' && a.decl !== 'm' ? 'mention' : (kase === 'nom' || kase === 'acc' || kase === 'dat') ? 'target' : 'mention';
      else if (prep && PREP_WITH.has(prep)) role = kase === 'ins' ? 'with' : 'mention';
      else if (prep) role = 'mention';
      else if (kase === 'nom') role = 'subject';
      else if (kase === 'ins') role = 'agent';
      else if (kase === 'dat') role = 'target';
      else if (kase === 'acc') role = 'target';
      const tail = a.tail ? tailAfter(low, orig, end).slice(0) : '';
      let label;
      if (kase === 'nom' || (role === 'target' && (a.decl === 'm' || a.decl === 'ie') && d.nom.includes(ending) && ending !== 'и' && ending !== 'ы')) {
        label = cap(orig.slice(role === 'subject' ? adjStart : start, end) + tail);
      } else label = a.name + tail;
      out.push({ role: a.role, name: a.name, start, end, kase, use: role, label: label.replace(/\s+/g, ' ').trim() });
    }
  }
  // abbreviations of departments: УБУиО, УВД, ФЭУ
  const abbr = /(?<![А-ЯЁа-яёA-Za-z0-9-])[А-ЯЁ]{2,6}(?:и[А-ЯЁ]{1,3})?(?![А-ЯЁа-яёA-Za-z0-9])/g;
  let m;
  while ((m = abbr.exec(orig))) {
    if (NOT_DEPT.has(m[0])) continue;
    const start = m.index;
    const [w1] = wordsBefore(low, start, 1);
    const lead = orig.slice(Math.max(0, start - 3), start);
    let use = 'mention';
    if (w1 && PREP_TARGET.has(w1)) use = 'target';
    else if (w1 && /(?:ется|ются)$/.test(w1)) use = 'agent';
    else if (w1 && /(?:ует|ает|яет|ит|ют|ят)$/.test(w1) && !PREP_OTHER.has(w1)) use = 'target';
    else if (start === 0 || /[.;,]\s*$/.test(lead) || w1 === 'и' || w1 === 'или') use = 'subject';
    out.push({ role: 'dept', name: m[0], start, end: start + m[0].length, kase: null, use, label: m[0] });
  }
  // a longer match at the same place wins ("внутренний заказчик" over "заказчик")
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  return out.filter((x, i) => !out.some((y, j) => j !== i && y.start <= x.start && y.end >= x.end && (y.end - y.start) > (x.end - x.start)));
}

// ---------------------------------------------------------------- documents

const DOCS = [
  ['Служебная записка', 'служебн\\w+\\s+записк\\w+'],
  ['Пояснительная записка', 'пояснительн\\w+\\s+записк\\w+'],
  ['Авансовый отчёт', 'авансов\\w+\\s+отчет\\w*'],
  ['Заявка-обоснование', 'заявк\\w+-обосновани\\w+'],
  ['Заявка', 'заявк\\w+'],
  ['Заявление', 'заявлени\\w+'],
  ['Проект приказа', 'проект\\w*\\s+приказ\\w+'],
  ['Проект договора', 'проект\\w*\\s+договор\\w+'],
  ['Проект соглашения', 'проект\\w*\\s+соглашени\\w+'],
  ['Приказ', 'приказ\\w*'],
  ['Дополнительное соглашение', 'дополнительн\\w+\\s+соглашени\\w+'],
  ['Протокол разногласий', 'протокол\\w*\\s+разногласий'],
  ['Протокол', 'протокол\\w*'],
  ['Лист визирования', 'лист\\w*\\s+визирования'],
  ['Договор', 'договор\\w*'],
  ['Уведомление', 'уведомлени\\w+'],
  ['Извещение', 'извещени\\w+'],
  ['Окончательное предложение', 'окончательн\\w+\\s+предложени\\w+'],
  ['Удостоверение', 'удостоверени\\w+'],
  ['Справка', 'справк\\w+'],
  ['Смета', 'смет(?:а|ы|у|ой|е)'],
  ['Счёт на оплату', 'счет\\w*\\s+на\\s+оплату'],
  ['Отчёт', 'отчет(?:а|у|ом|е|ы|ов)?'],
  ['Пропуск', 'пропуск(?:а|у|ом|е|и|ов)?'],
  ['Аванс', 'аванс(?:а|у|ом|е)?'],
  ['Стипендия', 'стипенди[яиюей]+'],
  ['Материальная помощь', 'материальн\\w+\\s+(?:помощ\\w+|поддержк\\w+)'],
  ['Пособие', 'пособи[еяюй]\\w*'],
  ['Суточные', 'суточн(?:ые|ых)'],
].map(([name, stem]) => ({ name, re: rx(`\\<${stem}\\>`) }));

function findDocs(low) {
  const out = [];
  for (const d of DOCS) {
    d.re.lastIndex = 0;
    let m;
    while ((m = d.re.exec(low))) {
      const start = m.index;
      const end = start + m[0].length;
      if (out.some((x) => start < x.end && end > x.start)) continue;
      out.push({ name: d.name, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// по форме К-1; ф. 0504505; (0510521); Приложение 1
function findForm(orig) {
  let m = /(?:по форме|форм[аеуы])\s+(?:№\s*)?([А-ЯA-Z]{1,4}-?\d+[а-я]?)/.exec(orig);
  if (m) return m[1];
  m = /ф\.\s*(\d{5,8})/.exec(orig) || /\((\d{7})\)/.exec(orig);
  if (m) return `ф. ${m[1]}`;
  m = /Приложени\S*\s+(?:№\s*)?(\d{1,2})(?![\d.])/i.exec(orig);
  if (m) return `Приложение ${m[1]}`;
  return null;
}

// ---------------------------------------------------------------- support check

// A label is supported when every word of it (three letters or more) occurs
// in the text up to its ending.
function supported(label, text) {
  if (!label) return false;
  const low = norm(text);
  const wordsOf = norm(label).match(/[а-яa-z0-9]+(?:-[а-яa-z0-9]+)*/g) || [];
  if (!wordsOf.length) return false;
  for (const w of wordsOf) {
    if (w.length < 3 && !/\d/.test(w)) continue;
    const stem = /\d/.test(w) ? w : w.slice(0, Math.min(6, Math.max(3, w.length - 2)));
    if (!low.includes(stem)) return false;
  }
  return true;
}

function numberInText(n, text) {
  if (n == null) return false;
  const low = norm(text);
  if (rx(`\\<${n}\\>`, '').test(low)) return true;
  return Object.entries(NUM_WORDS).some(([w, v]) => v === n && rx(`\\<${w}\\>`, '').test(low))
    || Object.entries(NUM_PREFIX).some(([w, v]) => w && v === n && low.includes(`${w}дневн`))
    || (n === 1 && rx('\\<в течение (?:часа|суток|недели|месяца|года)\\>|\\<в (?:месячный|недельный) срок', '').test(low));
}

/**
 * Remove from a scene object every label the clause text does not support.
 * Returns a copy; `dropped` lists the removed fields.
 */
function checkScene(scene, text) {
  const out = { ...(scene || {}) };
  const dropped = [];
  for (const f of ['who', 'to', 'doc', 'form']) {
    if (out[f] != null && !supported(String(out[f]), text)) { out[f] = null; dropped.push(f); }
  }
  if (out.who == null && out.whoRole != null && dropped.includes('who')) out.whoRole = null;
  if (out.to == null && out.toRole != null && dropped.includes('to')) out.toRole = null;
  if (!SCENES.includes(out.scene)) { out.scene = 'info'; dropped.push('scene'); }
  const d = out.deadline;
  if (d) {
    const n = d.kind === 'date' ? (d.dayOfMonth ?? d.day) : (d.n ?? d.days);
    const weeks = d.days != null && d.n != null && d.days === d.n * 7;
    const ok = numberInText(n, text) || (weeks && numberInText(d.n, text));
    const anchorOk = d.anchor == null || norm(text).includes(norm(d.anchor));
    if (!ok) { out.deadline = null; dropped.push('deadline'); }
    else if (!anchorOk) { out.deadline = { ...d, anchor: null }; dropped.push('deadline.anchor'); }
  }
  out.dropped = dropped;
  return out;
}

// ---------------------------------------------------------------- parseScene

const GUESS_ROLE = { approve: 'manager', handover: 'dept', money: 'dept', fill: 'employee', report: 'employee', info: null };
// Looks like an instruction even though no verb of the dictionary matched.
const ACTIONABLE = rx('\\<(?:обязан\\w*|должен|должна|должны|необходимо|следует|обеспечивает|организует|осуществляет|проводит|готовит|выдает|получает)\\>', '');

function publicDeadline(d) {
  if (!d) return null;
  const { start, end, ...rest } = d; // eslint-disable-line no-unused-vars
  return rest;
}

function roleOfLabel(label) {
  const low = norm(label);
  for (const a of ACTORS) {
    a.re.lastIndex = 0;
    if (a.re.test(low)) return a.role;
  }
  return null;
}

/**
 * @param {string} text  clause text
 * @param {{who?: string, deadline?: string, form?: string}} [hints]  fields of the
 *   answer step written by the LLM; used only where the clause text supports them
 */
function parseScene(text, hints = {}) {
  const orig = String(text == null ? '' : text);
  const low = norm(orig);
  const sents = sentences(orig);
  const deadlines = parseDeadlines(orig);
  const signals = { hits: [], norm: false, definition: false, negated: 0, conditional: 0, whoGuess: null };

  let hits = findHits(low, sents);
  const cond = conditionSpans(low, sents);
  const definition = DASH_DEFINITION.test(orig) && !hits.some((h) => h.start < orig.search(/\s[–—-]\s/));
  const kept = [];
  for (const h of hits) {
    const s = sents[h.sent] || { start: 0, end: low.length };
    if (/(?:^|[^а-яa-z0-9])не\s+$/.test(low.slice(Math.max(0, h.verbPos - 4), h.verbPos))) { signals.negated++; continue; }
    if (cond.some((c) => h.verbPos >= c.start && h.verbPos < c.end)) { signals.conditional++; continue; }
    const before = low.slice(s.start, h.start);
    if (DEFINES.test(before)) { signals.definition = true; continue; }
    if (h.scene === 'money' && NORM_CUE.test(low.slice(s.start, s.end))) { signals.norm = true; continue; }
    kept.push(h);
  }
  hits = kept;
  if (definition) { signals.definition = true; hits = []; }

  let strong = hits.filter((h) => h.flag !== 'weak');
  const weak = hits.filter((h) => h.flag === 'weak');
  let chosen = null;
  if (strong.length) {
    chosen = strong[0];
    // "проверяет комплектность и передаёт в учебное управление": the later action is the step
    if (chosen.flag === 'check') {
      const later = strong.find((h) => h.sent === chosen.sent && h.flag !== 'check' && h.scene !== 'approve');
      if (later) chosen = later;
    }
    // a report phrase beats the generic verb it contains ("представляет в бухгалтерию авансовый отчёт")
    if (chosen.scene !== 'report' && chosen.scene !== 'money') {
      const rep = strong.find((h) => h.scene === 'report' && h.sent === chosen.sent);
      if (rep) chosen = rep;
    }
  } else if (weak.length) chosen = weak[0];

  const scene = chosen ? chosen.scene : 'info';
  const distinct = [...new Set(strong.map((h) => h.scene))];
  signals.hits = hits.map((h) => ({ scene: h.scene, verb: orig.slice(h.start, Math.min(h.end, h.start + 60)), pos: h.start, weak: h.flag === 'weak' || undefined }));

  // deadline that governs the action: same sentence as the verb, else the first one
  let deadline = null;
  if (deadlines.length) {
    const s = chosen ? sents[chosen.sent] : null;
    deadline = (s && deadlines.find((d) => d.start >= s.start && d.start < s.end)) || deadlines[0];
  }

  let who = null;
  let whoRole = null;
  let to = null;
  let toRole = null;
  let doc = null;
  if (chosen) {
    const s = sents[chosen.sent] || { start: 0, end: low.length };
    const inSent = findActors(orig, low).filter((a) => a.start >= s.start && a.start < s.end
      && !cond.some((c) => a.start >= c.start && a.start < c.end));
    let actor = inSent.find((a) => a.use === 'subject') || inSent.find((a) => a.use === 'agent');
    if (!actor) {
      // "оформляется приказом проректора", "по решению комиссии"
      const m = rx('\\<(?:приказом|распоряжением|решением|по решению)\\s+$', '');
      actor = inSent.find((a) => a.kase === 'gen' && m.test(low.slice(Math.max(0, a.start - 20), a.start)));
    }
    if (actor) { who = actor.label; whoRole = actor.role; }
    const target = inSent.find((a) => (a.use === 'target' || a.use === 'with') && a !== actor && a.start > chosen.start && (!actor || a.label !== actor.label))
      || inSent.find((a) => (a.use === 'target' || a.use === 'with') && a !== actor && (!actor || a.label !== actor.label));
    if (target) { to = target.label; toRole = target.role; }
    const docs = findDocs(low).filter((d) => d.start >= s.start && d.start < s.end);
    if (docs.length) {
      doc = docs.reduce((best, d) => (Math.abs(d.start - chosen.verbPos) < Math.abs(best.start - chosen.verbPos) ? d : best)).name;
    }
  }
  let form = chosen ? findForm(orig) : null;

  // hints from the LLM step: taken only when the clause itself supports them
  if (chosen && hints && typeof hints === 'object') {
    if (!who && hints.who && supported(hints.who, orig)) { who = String(hints.who).trim(); whoRole = roleOfLabel(who); }
    if (!form && hints.form && supported(hints.form, orig)) form = String(hints.form).trim();
    if (!doc && hints.form) {
      const d = findDocs(norm(hints.form))[0];
      if (d && supported(d.name, orig)) doc = d.name;
    }
  }
  if (!deadline && hints && hints.deadline) {
    const hd = parseDeadlines(String(hints.deadline))[0];
    if (hd && numberInText(hd.kind === 'date' ? (hd.dayOfMonth ?? hd.day) : hd.n, orig)) deadline = { ...hd, anchor: null, fromHint: true };
  }

  signals.whoGuess = whoRole || GUESS_ROLE[scene];
  const competing = distinct.length >= 2;
  const actionable = !chosen && !signals.definition && !signals.norm && orig.length > 40 && ACTIONABLE.test(low)
    && findActors(orig, low).some((a) => a.use === 'subject');
  const needsArbiter = competing || actionable;
  let confidence;
  if (!chosen) confidence = actionable ? 0.5 : signals.definition || signals.norm ? 0.85 : 0.75;
  else if (chosen.flag === 'weak') confidence = 0.5;
  else if (competing) confidence = 0.55;
  else confidence = who ? 0.9 : 0.75;

  return {
    scene,
    who,
    whoRole,
    to,
    toRole,
    doc,
    form,
    deadline: publicDeadline(deadline),
    allDeadlines: deadlines.map(publicDeadline),
    confidence,
    needsArbiter,
    signals,
  };
}

// ---------------------------------------------------------------- arbiter (optional model)

const SCENE_HELP = {
  approve: 'кто-то согласует, визирует, подписывает, утверждает, проверяет или принимает решение',
  fill: 'человек заполняет, оформляет или подаёт заявление, заявку, служебную записку, проект документа или прикладывает к нему документы',
  handover: 'документ передают, направляют, регистрируют, сообщают в подразделение или там готовят по нему приказ или пропуск',
  money: 'деньги перечисляют, выплачивают, оплачивают или возмещают',
  report: 'после события человек сдаёт отчёт, подтверждающие документы или возвращает остаток денег',
  info: 'общая норма, определение, условие или ограничение без конкретного действия',
};
const WHO_HELP = {
  employee: 'сам сотрудник: работник, обучающийся, инициатор, исполнитель, посетитель или владелец',
  manager: 'тот, кто принимает решение: руководитель, проректор, ректор, декан или комиссия',
  dept: 'служба или отдел: бухгалтерия, отдел кадров, деканат, финансово-экономическое управление, юридический отдел, бюро пропусков',
};
const ARBITER_SYSTEM = 'Ты разбираешь пункт регламента в JSON. Поля:\n'
  + `scene — тип действия: ${Object.entries(SCENE_HELP).map(([k, v]) => `${k} = ${v}`).join('; ')}.\n`
  + `who — кто действует: ${Object.entries(WHO_HELP).map(([k, v]) => `${k} = ${v}`).join('; ')}; none = не указано.\n`
  + 'Отвечай только JSON.';
const ARBITER_SCHEMA = {
  type: 'object',
  properties: {
    scene: { type: 'string', enum: SCENES },
    who: { type: 'string', enum: [...ROLES, 'none'] },
  },
  required: ['scene', 'who'],
  additionalProperties: false,
};
// From the demo regulation of the mockups, not from any evaluated set.
const ARBITER_FEWSHOT = [
  ['Работник оформляет служебную записку по форме К-1 не позднее чем за 5 рабочих дней до даты выезда.', { scene: 'fill', who: 'employee' }],
  ['Решение о направлении в командировку принимает руководитель структурного подразделения.', { scene: 'approve', who: 'manager' }],
  ['На основании согласованной служебной записки отдел кадров готовит приказ о командировке.', { scene: 'handover', who: 'dept' }],
  ['Аванс перечисляется на карту работника не позднее 3 рабочих дней до выезда.', { scene: 'money', who: 'dept' }],
  ['Авансовый отчёт сдаётся в течение 3 рабочих дней после возвращения.', { scene: 'report', who: 'employee' }],
  ['Суточные при командировке по России составляют 700 рублей за каждый день.', { scene: 'info', who: 'none' }],
];

function arbiterMessages(text, model) {
  const suffix = /qwen3/i.test(model || '') ? '\n/no_think' : '';
  const msgs = [{ role: 'system', content: ARBITER_SYSTEM }];
  for (const [t, a] of ARBITER_FEWSHOT) {
    msgs.push({ role: 'user', content: t + suffix }, { role: 'assistant', content: JSON.stringify(a) });
  }
  msgs.push({ role: 'user', content: String(text).slice(0, 1500) + suffix });
  return msgs;
}

/**
 * Ask a small model about the scene type. The model decides only `scene` and,
 * when the text names no actor, a role guess; labels and deadlines stay from
 * the rules. On any failure the parsed scene is returned unchanged.
 * @param {{baseUrl: string, model: string, apiKey?: string, timeoutMs?: number}} llmCfg  as openai.llmConfig()
 */
async function arbitrate(text, parsed, llmCfg) {
  if (!llmCfg || !llmCfg.baseUrl) return parsed;
  const headers = { 'content-type': 'application/json' };
  if (llmCfg.apiKey) headers.authorization = `Bearer ${llmCfg.apiKey}`;
  const body = {
    model: llmCfg.model,
    temperature: 0,
    max_tokens: 200,
    reasoning_effort: 'none', // reasoning models otherwise return empty content
    messages: arbiterMessages(text, llmCfg.model),
    response_format: { type: 'json_schema', json_schema: { name: 'step', strict: true, schema: ARBITER_SCHEMA } },
  };
  try {
    const res = await fetch(`${String(llmCfg.baseUrl).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(llmCfg.timeoutMs || 30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    let content = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '');
    const ans = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
    if (!SCENES.includes(ans.scene)) throw new Error('scene out of vocabulary');
    const out = { ...parsed, scene: ans.scene, arbiter: { scene: ans.scene, who: ROLES.includes(ans.who) ? ans.who : null }, signals: { ...parsed.signals } };
    if (ans.scene === 'info') { out.who = null; out.whoRole = null; out.to = null; out.toRole = null; out.doc = null; }
    out.signals.whoGuess = out.whoRole || out.arbiter.who || GUESS_ROLE[ans.scene];
    out.confidence = ans.scene === parsed.scene ? Math.max(parsed.confidence, 0.8) : 0.6;
    return out;
  } catch (e) {
    return { ...parsed, arbiterError: e.message };
  }
}

module.exports = {
  parseScene, checkScene, parseDeadlines, arbitrate, supported,
  SCENES, ROLES, GUESS_ROLE,
};
