'use strict';
// Document passport: the kind of act, its number and date, the regulation it
// approves, and the acts it changes or cancels. Everything is read from the
// text and the file name. linkVersions() then compares the passports of all
// documents in the base and marks which edition is in force.

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DATE_RE = new RegExp(`(?<![\\d.])(?:(\\d{1,2})\\.(\\d{1,2})\\.((?:19|20)\\d{2})|[«"]?(\\d{1,2})[»"]?\\s+(${MONTHS.join('|')})\\s+((?:19|20)\\d{2}))`, 'gi');
const NUM_RE = /(?:№|(?<![A-Za-zА-Яа-яЁё])N)\s*(\d{1,5}(?:\s?-{1,2}\s?\d{1,2})?)(?![\d.]\d)/g;
const KIND_LINE = /^\s*(п\s?р\s?и\s?к\s?а\s?з|р\s?а\s?с\s?п\s?о\s?р\s?я\s?ж\s?е\s?н\s?и\s?е)\s*$/i;
const LEGAL_FORM = /\s*федеральн\S+\s+государственн\S+\s+(?:автономн\S+|бюджетн\S+)\s+образовательн\S+\s+учреждени\S+\s+высшего\s+(?:профессионального\s+)?образования\s*/gi;
const PREAMBLE = /^(в целях|с целью|в соответствии|в связи|на основании|во исполнение|для |приказываю|обязываю|\d+\.)/i;
const ACT_WORD = '(?:Регламент|Положение|Порядок|Инструкци[яю]|Правила|Методик[ау]|Стандарт)';
const GOOD_TITLE = new RegExp(`^${ACT_WORD}(?:\\s|$)`, 'i');
const BAD_TITLE = /^(министерство|федеральное государственное|зарегистрировано|лист «|приложени[ея](\s|$)|утвержд|приказ$|распоряжение$|без названия)/i;
const APPROVES = new RegExp(`утвердить.{0,140}?(${ACT_WORD}\\s.{5,260}?)(?=\\s*\\(|\\s+согласно|\\s+в\\s+соответствии|\\.(?:\\s|$)|;|$)`, 'i');
const EFFECTIVE = /(?:ввести в действие|вступает в силу|вступают в силу|действует|утвердить)[^;]{0,60}?\sс\s+([«"]?\d{1,2}[»"]?[.\s][^;]{2,20}?(?:19|20)\d{2})/i;
const REVOKE = /утративш\S*\s+силу|отменить\s/i;
const AMEND = /внести\s+(?:следующие\s+)?изменени|изложить\s+в\s+(?:следующей|новой)\s+редакции|в\s+новой\s+редакции/i;
const PARTIAL = /(?:пункт\S*|абзац\S*|подпункт\S*|раздел\S*|приложени\S+)\s+(?:№\s*)?(?:\d|первы|второ|трет)/i;

const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function ruDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function dates(s) {
  const out = [];
  for (const m of String(s).matchAll(DATE_RE)) {
    const d = Number(m[1] || m[4]);
    const mo = m[2] ? Number(m[2]) : MONTHS.indexOf(m[5].toLowerCase()) + 1;
    const y = Number(m[3] || m[6]);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    out.push({ iso: `${y}-${pad(mo)}-${pad(d)}`, index: m.index, end: m.index + m[0].length });
  }
  return out;
}

function numbers(s) {
  const out = [];
  for (const m of String(s).matchAll(NUM_RE)) {
    out.push({ number: m[1].replace(/\s/g, '').replace(/-+/g, '-'), index: m.index, end: m.index + m[0].length });
  }
  return out;
}

// "№ 76-1 от 12.02.2015", "от 25.06.2020 г. № 1385-1", "от 25.11.2021 | № 3065-1"
function actRefs(s) {
  const ds = dates(s);
  return numbers(s).map((n) => {
    let best = null;
    for (const d of ds) {
      const gap = d.index >= n.end ? d.index - n.end : n.index - d.end;
      if (gap >= 0 && gap <= 25 && (!best || gap < best.gap)) best = { gap, iso: d.iso };
    }
    return { number: n.number, date: best ? best.iso : null, index: n.index, end: n.end };
  });
}

// The order header: "ПРИКАЗ", then the date and number, then "О ...".
function readHeader(text) {
  const lines = text.slice(0, 4000).split('\n');
  const k = lines.findIndex((l, i) => i < 40 && KIND_LINE.test(l));
  if (k < 0) return null;
  const kind = /^\s*п/i.test(lines[k]) ? 'приказ' : 'распоряжение';
  let number = null;
  let date = null;
  let i = k + 1;
  let stray = 0;
  for (; i < lines.length && stray < 3; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (/^(о|об|обо)\s/i.test(l) && !/^от\s/i.test(l)) break;
    stray++;
    const refs = actRefs(l);
    const ds = dates(l);
    if (refs.length || ds.length || /^от\s/i.test(l)) {
      number = refs.length ? refs[0].number : null;
      date = (refs.length && refs[0].date) || (ds.length ? ds[0].iso : null);
      i++;
      break;
    }
  }
  const subj = [];
  stray = 0;
  for (; i < lines.length && subj.length < 6; i++) {
    const l = lines[i].trim();
    if (!l) { if (subj.length) break; continue; }
    if (!subj.length) {
      if (/^(о|об|обо)\s/i.test(l)) subj.push(l);
      else if (PREAMBLE.test(l) || ++stray > 3) break;
      continue;
    }
    if (PREAMBLE.test(l)) break;
    subj.push(l);
  }
  const subject = oneLine(subj.join(' ')).replace(/[.,;]$/, '');
  return { kind, number, date, subject: subject ? cap(subject) : null, end: i };
}

function fromFileName(file) {
  const base = String(file || '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  const kind = /^приказ/i.test(base) ? 'приказ' : /^распоряжение/i.test(base) ? 'распоряжение' : null;
  const refs = actRefs(base);
  let number = refs.length ? refs[0].number : null;
  const date = refs.length ? refs[0].date : null;
  if (!number) {
    const m = /^(\d{1,5}-\d{1,2})(?=\s)/.exec(base);
    if (m) number = m[1];
  }
  return { kind, number, date, base: oneLine(base).replace(/^Копия\s+/i, '') };
}

// The part of the text that is the order itself, before what it approves.
function coverOf(text) {
  const head = text.slice(0, 12000);
  const start = head.search(/ПРИКАЗЫВАЮ|ОБЯЗЫВАЮ|\n\s*1\.\s/);
  const m = /\n\s*(?:Приложение|УТВЕРЖД[ЕЁ]Н|Лист согласования|СОГЛАСОВАНО)/.exec(head.slice(Math.max(0, start)));
  return m ? head.slice(0, Math.max(0, start) + m.index) : head.slice(0, 6000);
}

const NOMINATIVE = [[/^Инструкцию/i, 'Инструкция'], [/^Методику/i, 'Методика']];

function relations(cover, own) {
  const refs = [];
  const seen = new Set();
  const items = cover.split(/\n\s*(?=\d{1,2}\.\s)/);
  items.forEach((raw, k) => {
    const item = oneLine(raw);
    const found = actRefs(item).filter((r) => r.date && r.number !== own);
    if (!found.length) return;
    let rel = 'mentions';
    if (k > 0 && REVOKE.test(item)) rel = PARTIAL.test(item.slice(0, found[0].index)) ? 'amends' : 'revokes';
    else if (k > 0 && AMEND.test(item)) rel = 'amends';
    for (const r of found) {
      const key = `${rel}:${r.number}:${r.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = /^[^«]{0,12}«([^»]{5,200})»/.exec(item.slice(r.end));
      refs.push({ rel, number: r.number, date: r.date, title: t ? t[1] : null });
    }
  });
  return refs;
}

/**
 * text, file name, the title the parser found -> passport.
 * { kind, number, date, subject, regulation, effective, year, refs, title }
 */
function docMeta(text, file, parsedTitle) {
  const t = String(text || '');
  const fn = fromFileName(file);
  const head = readHeader(t);
  const cover = head ? coverOf(t) : '';
  const flat = oneLine(cover);

  let number = fn.number || (head && head.number) || null;
  let date = fn.date || (head && head.date) || null;
  let kind = (head && head.kind) || fn.kind || null;
  // registration stamp on a scan: "Зарегистрировано в ЭДО МФТИ от 01.09.2025 № 3897-1"
  if (!number) {
    const stamp = t.slice(0, 1500).split('\n').find((l) => /зарегистрирован/i.test(l));
    const r = stamp ? actRefs(stamp)[0] : null;
    if (r) { number = r.number; date = date || r.date; kind = kind || 'приказ'; }
  }

  let regulation = null;
  const parsed = oneLine(String(parsedTitle || '').replace(LEGAL_FORM, ' ')).replace(/([»")])\d{1,2}$/, '$1');
  if (parsed && GOOD_TITLE.test(parsed) && parsed.split(' ').length > 1) regulation = parsed;
  if (!regulation && flat) {
    const m = APPROVES.exec(flat);
    if (m) {
      regulation = oneLine(m[1]).replace(/^(прилагаем\S+|нов\S+\s+редакци\S+)\s+/i, '');
      for (const [re, to] of NOMINATIVE) regulation = regulation.replace(re, to);
      regulation = cap(oneLine(regulation.replace(LEGAL_FORM, ' ')));
    }
  }

  let effective = null;
  const em = flat ? EFFECTIVE.exec(flat) : null;
  if (em) { const d = dates(em[1]); if (d.length) effective = d[0].iso; }

  const refs = cover ? relations(cover, number) : [];
  const anyDate = date || effective || (cover ? dates(cover).map((d) => d.iso).sort().pop() : null) || null;
  const year = anyDate ? Number(anyDate.slice(0, 4)) : null;

  const subject = head ? head.subject : null;
  const act = number ? `${kind || 'приказ'} № ${number}${date ? ` от ${ruDate(date)}` : ''}` : null;
  let title;
  if (regulation) title = act ? `${regulation} (${act})` : regulation;
  else if (act && subject) title = `${cap(act)} «${subject}»`;
  else if (head && subject) title = `${cap(kind)} «${subject}»`;
  else if (parsed && !BAD_TITLE.test(parsed) && parsed !== file) title = act ? `${parsed} (${act})` : parsed;
  else if (act) title = `${cap(act)}${fn.base && !fn.kind ? ` — ${fn.base}` : ''}`;
  else title = fn.base || parsed || 'Без названия';

  return { kind, number, date, subject, regulation, effective, year, refs, title };
}

// ---------------------------------------------------------------- versions

function sortDate(m) {
  return m.effective || m.date || (m.year ? `${m.year}-01-01` : null);
}

function titleWords(name) {
  const w = String(name || '').toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]+/g) || [];
  return w.length >= 4 ? w : null;
}

// The same regulation approved again: the names coincide word for word.
// A couple of wrong letters are forgiven (a scan), but not a missing or an
// extra word and not a different number: "на сумму до 100" and "на сумму
// свыше 100" are two regulations, not two editions.
function sameAct(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (/\d/.test(a[i] + b[i]) || a[i].length !== b[i].length || a[i].length < 5) return false;
    let d = 0;
    for (let k = 0; k < a[i].length; k++) if (a[i][k] !== b[i][k]) d++;
    if (d > 2 || ++diff > 2) return false;
  }
  return true;
}

/**
 * docs: [{ id, meta }] — adds to every meta:
 *   status: 'действует' | 'изменён' | 'утратил силу' | 'предыдущая редакция'
 *   changedBy: [{ doc, rel }], supersededBy: id | null, editions: [ids, newest first] | null
 */
function linkVersions(docs) {
  const byNumber = new Map();
  for (const d of docs) {
    Object.assign(d.meta, { status: 'действует', changedBy: [], supersededBy: null, editions: null });
    if (d.meta.number) {
      if (!byNumber.has(d.meta.number)) byNumber.set(d.meta.number, []);
      byNumber.get(d.meta.number).push(d);
    }
  }
  // an act in the base cancels or changes another act in the base
  for (const d of docs) {
    for (const r of d.meta.refs || []) {
      if (r.rel === 'mentions') continue;
      for (const t of byNumber.get(r.number) || []) {
        if (t === d || (r.date && t.meta.date && r.date !== t.meta.date)) continue;
        t.meta.changedBy.push({ doc: d.id, rel: r.rel });
        if (r.rel === 'revokes') { t.meta.status = 'утратил силу'; t.meta.supersededBy = d.id; } else if (t.meta.status === 'действует') t.meta.status = 'изменён';
      }
    }
  }
  // editions of one regulation: the same name approved by different orders
  const groups = [];
  for (const d of docs) {
    const words = titleWords(d.meta.regulation);
    if (!words) continue;
    const g = groups.find((x) => sameAct(x.words, words));
    if (g) g.list.push(d);
    else groups.push({ words, list: [d] });
  }
  for (const g of groups) {
    if (g.list.length < 2) continue;
    g.list.sort((a, b) => String(sortDate(b.meta) || '').localeCompare(String(sortDate(a.meta) || '')));
    const cur = g.list[0];
    const ids = g.list.map((d) => d.id);
    for (const d of g.list) {
      d.meta.editions = ids;
      const older = d !== cur && sortDate(d.meta) && sortDate(cur.meta) && sortDate(d.meta) < sortDate(cur.meta);
      if (older && d.meta.status !== 'утратил силу') { d.meta.status = 'предыдущая редакция'; d.meta.supersededBy = cur.id; }
    }
  }
  return docs;
}

const OUTDATED = new Set(['утратил силу', 'предыдущая редакция']);

module.exports = { docMeta, linkVersions, actRefs, dates, ruDate, sortDate, OUTDATED };
