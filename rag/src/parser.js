'use strict';
// Regulation structure parser.
// Input: plain text or markdown of one regulation.
// Output: { title, nodes } where each node is a citable unit:
//   kind 'clause'   — numbered пункт: 1, 1.1, 2.3.4          id "2.3"
//   kind 'sub'      — подпункт а) б) or 1) 2) of a clause    id "2.3(а)"
//   kind 'para'     — unnumbered paragraph (преамбула etc.)   id "абз.3"
//   kind 'appendix' — приложение heading + its free text      id "прил.1"
//   kind 'row'      — one row of a table                       id "табл.2/3"
// Numbering inside an appendix is prefixed: "прил.1/2.3"; inside a step of a
// "Шаг 1 / Шаг 2" instruction: "шаг.1/2". Top-level "1) 2) 3)" items are
// clauses with ids "1)", "2)".
// A numbered node that is short, has children and no final punctuation is a
// heading: it gives context ("path") to its children but is not ranked itself.

const ROMAN = /^(?:(?:раздел|глава)\s+)?([IVXLC]{1,6})\.?\s+(\S.{0,300})$/i;
const NAMED_SECTION = /^(раздел|глава)\s+(\d{1,3})\.?\s*(.{0,300})$/i;
// a heading introduced by the word "Раздел"/"Глава" may be long (up to 300 chars); a bare "II. ..." line may not
const sectionMax = (line) => (/^(раздел|глава)\s/i.test(line) ? 300 : 160);
const NUMBERED = /^(\d{1,3}(?:\.\d{1,3}){0,4})(\.)?(?:\s+|(?=[А-ЯЁA-Z«"(]))(\S.*)$/;
const SUB_LETTER = /^\(?([а-яё])\)\s*(\S.*)$/;
const SUB_NUMBER = /^(\d{1,2})\)\s*(\S.*)$/;
const APPENDIX = /^приложение\s*(?:№\s*)?(\d{1,3}|[А-ЯA-Z](?![а-яa-z]))?\.?(?:\s|$)(.*)$/i;
const MD_HEADING = /^(#{1,6})\s+(.*)$/;
const LABEL_PARA = /^[А-ЯЁ][а-яё]+(?:\s[а-яё]+){0,2}:\s/;
// "Статья 5." / "Статья 5. Отпуска" / "§ 3. Договор": case-sensitive and with a
// dot or the end of the line after the number, so a wrapped line of running
// text ("Статья 28 Федерального закона ...") is not taken for a heading.
const ARTICLE = /^(Статья|СТАТЬЯ|§)\s*(\d{1,3})(?:\.\s*(.{0,300})|\s*)$/;
const ARTICLE_LOOSE = /^(§)\s*(\d{1,3})\s+([А-ЯЁ].{0,300})$/;
// "Шаг 1.", "Шаг 2: Приложите чеки", "Этап 3 – ..."
const STEP = /^(шаг|этап)\s*(\d{1,2})\s*[.:)\-–—]?\s*(.*)$/i;
const TABLE_SEP = ' | ';
const QA_START = /^вопрос(?:\s*(?:№\s*)?\d{1,3})?\s*[:.]/i;
const TITLE_WORDS = /^(положение|регламент|порядок|правила|инструкция|методические|стандарт|политика|кодекс|устав|коллективный\s+договор)(?![а-яё])/i;

function cleanText(raw) {
  return String(raw || '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[  \t]/g, ' ')
    .replace(/[‐‑]/g, '-')
    // word broken by a hyphen at the end of a line: "работ-\nника"
    .replace(/([а-яё])-\n([а-яё])/g, '$1$2')
    // a heading and the first clause glued into one line by the PDF layout:
    // "Общие положения 1. Настоящий регламент ..."
    .replace(/^(?!Статья|Раздел|Глава|Часть|Приложение|Пункт|Шаг|Этап|Параграф)([А-ЯЁ][а-яё]+ [А-Яа-яё ]{2,50}?) (1\. [А-ЯЁ«])/gm, '$1\n$2');
}

// ---------------------------------------------------------------- page furniture
// Real documents (PDF via pdftotext, Word with a table of contents) carry text
// that belongs to no clause: the e-signature stamp, a table of contents with
// page numbers, running headers/footers and bare page numbers. Left in, it
// lands inside clauses, and its numbers look like clause numbers.

// Table of contents entries: a heading followed by a tab or a dot/ellipsis
// leader and a page number. Detected before tabs are turned into spaces.
const TOC_LEADER = /(?:\.{5,}|…{2,}|_{5,})[\s.…]*\d{1,3}(?:\s|$)/;
const TOC_TAB = /\S\t+\s*\d{1,3}\s*$/;
const TOC_HEADING = /^(?:содержание|оглавление)\s*:?$/i;
function dropTocLines(lines) {
  return lines.filter((l) => {
    const t = l.trim();
    if (TOC_HEADING.test(t) || TOC_LEADER.test(t)) return false;
    if (TOC_TAB.test(l) && t.length <= 300 && !/^\d{1,3}(?:\.\d{1,3})*\.?\t/.test(l)) return false;
    // a chapter/section TOC entry whose page number was cut off
    if (/\t\s*$/.test(l) && /^(глава|раздел)\s/i.test(t)) return false;
    return true;
  });
}

// E-signature stamp on the first page ("Документ подписан простой электронной
// подписью / ФИО / Должность / Уникальный программный ключ"). In OCR'd PDFs it
// is often interleaved letter by letter with the real header lines.
const STAMP_START = /^документ подписан (?:простой |усиленной |квалифицированной )*электронной подписью/i;
const STAMP_LINE = /^(?:информация о владельце|фио:|должность:|дата подписания|уникальный программный ключ|сертификат:|владелец:)/i;
const STAMP_GARBAGE = /[0-9a-f]{16,}|(?:[а-яёa-z][0-9:.]){4,}/i;
function dropStamp(lines) {
  const out = [];
  let window = 0;
  for (const l of lines) {
    const t = l.trim();
    if (STAMP_START.test(t)) {
      // one-line stamp, possibly followed by real text after the key
      const tail = /уникальный программный ключ:?\s*[0-9a-f]{20,}\s*(.*)$/i.exec(t);
      if (tail && tail[1]) out.push(tail[1]);
      window = 12;
      continue;
    }
    if (window > 0 && t) {
      window--;
      if (STAMP_LINE.test(t) || STAMP_GARBAGE.test(t)) continue;
    }
    out.push(l);
  }
  return out;
}

const PAGE_NUMBER = /^(?:[-–—]\s*)?\d{1,3}(?:\s*[-–—])?$|^(?:стр\.|страница)\s*\d{1,3}(?:\s*из\s*\d{1,3})?$/i;

// Running headers and footers: the same short line repeated on many pages and
// spread over the whole document. Forms repeated in an appendix stay: they are
// clustered at the end.
function furnitureKey(l) {
  return l.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ').toLowerCase();
}
function dropRepeated(lines) {
  const seen = new Map();
  lines.forEach((l, i) => {
    const k = furnitureKey(l);
    if (k.length < 3 || k.length > 150 || k.includes('|') || /^#(?:\.#)*\.?\s+\S/.test(k) || /_{3,}/.test(k)) return;
    if (APPENDIX.test(l.trim())) return; // "Приложение 2", "Приложение 3", ... are structure
    if (!/[а-яёa-z]{2}/.test(k)) return; // bare numbers are handled elsewhere
    const e = seen.get(k) || { n: 0, first: i, last: i };
    e.n++;
    e.last = i;
    seen.set(k, e);
  });
  const drop = new Set();
  for (const [k, e] of seen) if (e.n >= 4 && e.last - e.first >= 0.3 * lines.length) drop.add(k);
  return drop.size ? lines.filter((l) => !drop.has(furnitureKey(l))) : lines;
}

// "1.1." alone on a line and its text on the next non-empty line (PDF layout
// with a hanging number): glue them back together.
const LONE_NUMBER = /^(?:\d{1,3}(?:\.\d{1,3}){0,4}\.|\d{1,3}(?:\.\d{1,3}){1,4})$/;
function mergeLoneNumbers(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    // "Шаг" and "1:" on separate lines (markup split by inline tags)
    if (/^(шаг|этап)$/i.test(t)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && /^\d{1,2}\s*[.:)]?$/.test(lines[j].trim())) {
        out.push(`${t} ${lines[j].trim()}`);
        i = j;
        continue;
      }
    }
    if (LONE_NUMBER.test(t)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const nx = j < lines.length ? lines[j].trim() : '';
      if (nx && !NUMBERED.test(nx) && !LONE_NUMBER.test(nx)) {
        out.push(`${t} ${nx}`);
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out;
}

// Several clauses run together on one line ("... актами МФТИ. 1.2 Положение
// устанавливает ..."), common in PDFs. The line is split before an inline
// multi-level number that follows the end of a sentence (or an upper-case
// heading), precedes a capital letter, is not a reference ("п. 2.4", "ст. 1.2")
// and is a believable next number after the last clause seen.
const INLINE_NUM = /(?:[.;:!?»")]|[А-ЯЁ]{2})\s+(\d{1,3}(?:\.\d{1,3}){1,4})\.?\s*(?=[А-ЯЁ«"])/g;
const REF_BEFORE = /(?:^|[\s(])(?:п|пп|ст|ч|подп|разд|гл|прил|рис|табл|см|абз|№)\.?\s*$/i;
function splitInlineClauses(lines) {
  const out = [];
  let last = [];
  for (const line of lines) {
    let rest = line;
    for (let guard = 0; guard < 100; guard++) {
      const t = rest.trim();
      const head = NUMBERED.exec(t);
      if (head) {
        const nums = head[1].split('.').map(Number);
        if (nums.length >= 2 || plausible(nums, last)) last = nums;
      }
      let cut = -1;
      INLINE_NUM.lastIndex = 0;
      for (let m = INLINE_NUM.exec(t); m; m = INLINE_NUM.exec(t)) {
        const pos = m.index + m[0].lastIndexOf(m[1]);
        if (head && pos <= head[1].length) continue;
        if (REF_BEFORE.test(t.slice(Math.max(0, pos - 12), pos))) continue;
        const nums = m[1].split('.').map(Number);
        if (nums.includes(0) || !plausible(nums, last)) continue;
        cut = pos;
        break;
      }
      // "5.6 Заключение и регистрация договора 5.6.1. Процесс ...": a heading
      // followed by its own first child needs no punctuation in between
      if (head) {
        const bodyAt = t.length - head[3].length;
        const re = new RegExp(`\\s(${head[1].replace(/\./g, '\\.')}\\.1)\\.?\\s*(?=[А-ЯЁ«"])`);
        const m = re.exec(t.slice(bodyAt));
        if (m && (cut < 0 || bodyAt + m.index + 1 < cut)) cut = bodyAt + m.index + 1;
      }
      if (cut <= 0) { out.push(rest); break; }
      out.push(t.slice(0, cut).trimEnd());
      rest = t.slice(cut);
    }
  }
  return out;
}

function preprocess(raw) {
  const text = String(raw || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let lines = dropTocLines(text.split('\n'));
  // Symbol-font bullets from Word/PDF land in the private use area
  lines = cleanText(lines.join('\n').replace(/[]/g, '•')).split('\n');
  lines = dropStamp(lines).filter((l) => !PAGE_NUMBER.test(l.trim()));
  lines = mergeLoneNumbers(lines);
  lines = dropRepeated(lines);
  return splitInlineClauses(lines);
}

// ---------------------------------------------------------------- order cover
// Local acts are often published together with the order that approves them:
// "ПРИКАЗ ... ПРИКАЗЫВАЮ: 1. Утвердить ... 2. ... Приложение к приказу № ...
// ПОЛОЖЕНИЕ о ...". The order's items would take the clause numbers 1, 2, 3
// and push the whole regulation into an appendix. Returns the line index where
// the approved document starts, or -1.
const ORDER_HEAD = /^(?:приказ|приказываю|постановляю|распоряжение)(?![а-яё])/i;
const COVER_APPENDIX = /^приложение(?:\s*(?:№\s*)?\d{1,3})?\s*(?:к\s+приказу|$)/i;
function findOrderCover(lines) {
  let orderAt = -1;
  let numbered = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (orderAt < 0) {
      if (ORDER_HEAD.test(t) && t.length <= 40) orderAt = i;
      else if (i > 80) return -1;
      continue;
    }
    if (NUMBERED.test(t)) numbered++;
    if (!numbered || !COVER_APPENDIX.test(t)) continue;
    // a bare "Приложение" must be followed by "к приказу ..."
    const next = lines.slice(i + 1, i + 4).find((l) => l.trim());
    if (!/к\s+приказу/i.test(t) && !(next && /^к\s+приказу/i.test(next.trim()))) continue;
    // and the approved document's title follows within a few lines
    let seen = 0;
    for (let j = i + 1; j < lines.length && seen < 12; j++) {
      const s = lines[j].trim();
      if (!s) continue;
      seen++;
      if (TITLE_WORDS.test(s)) return i;
      if (NUMBERED.test(s)) break;
    }
  }
  return -1;
}

function isUpperLine(s) {
  const letters = s.replace(/[^А-ЯЁа-яёA-Za-z]/g, '');
  return letters.length >= 4 && letters === letters.toUpperCase();
}

// Is `cand` a believable next number after `path` (the last accepted number)?
// Allows: child start (2.3 -> 2.3.1), sibling/ancestor increments with small gaps
// (2.3 -> 2.4, 2.3 -> 3, 2.3 -> 3.1 when "3." was omitted).
function plausible(cand, path) {
  if (!path.length) return cand.every((x) => x >= 1 && x <= 3);
  for (let k = 0; k <= Math.min(cand.length - 1, path.length); k++) {
    const restSmall = cand.slice(k + 1).every((x) => x >= 1 && x <= 2);
    if (k === path.length) return cand[k] >= 1 && cand[k] <= 2 && restSmall;
    if (cand[k] > path[k] && cand[k] <= path[k] + 3 && restSmall) return true;
    if (cand[k] !== path[k]) return false;
  }
  return false;
}

// Title lines: a line starting with "Положение/Регламент/..." (plus up to 3
// continuation lines) among the lines before the first clause; otherwise the
// first non-empty line. Returned indices are skipped by the body parser.
function detectTitle(lines, haveTitle) {
  const skip = new Set();
  let firstNumbered = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const m = NUMBERED.exec(t);
    // "7 декабря" in a signature block is not the first clause
    const clauseLike = m && (m[2] || m[1].includes('.') || /^[А-ЯЁA-Z«"(]/.test(m[3]));
    if (clauseLike || ROMAN.test(t)) { firstNumbered = i; break; }
  }
  // up to 40 non-empty lines (PDF text often has a blank line after every line)
  let limit = firstNumbered;
  for (let i = 0, seen = 0; i < firstNumbered; i++) if (lines[i].trim() && ++seen > 40) { limit = i; break; }
  for (let i = 0; i < limit; i++) {
    const line = lines[i].trim();
    const md = MD_HEADING.exec(line);
    if (md && md[1].length === 1) { skip.add(i); return { title: md[2].trim(), skip }; }
    if (TITLE_WORDS.test(line) && line.length <= 300) {
      const parts = [line];
      skip.add(i);
      for (let j = i + 1; j < limit && parts.length < 4; j++) {
        const nx = lines[j].trim();
        if (!nx || NUMBERED.test(nx) || nx.length > 250) break;
        if (/^(утвержд|принят|введен|редакц)/i.test(nx)) break;
        if (structuralLine(nx)) break;
        parts.push(nx);
        skip.add(j);
      }
      // "ПОЛОЖЕНИЕ о ..." -> "Положение о ..."
      const fixed = parts.map((p, k) => (isUpperLine(p)
        ? (k === 0 ? p.charAt(0) + p.slice(1).toLowerCase() : p.toLowerCase())
        : p));
      // "ПОЛОЖЕНИЕ о порядке ..." on one line -> "Положение о порядке ..."
      const joined = fixed.join(' ').replace(/^([А-ЯЁ])([А-ЯЁ]{3,})(?=\s)/, (m0, a, b) => a + b.toLowerCase());
      return { title: joined, skip };
    }
  }
  if (haveTitle) return { title: '', skip };
  for (let i = 0; i < limit; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const md = MD_HEADING.exec(line);
    // the first line is already content (a step, a list item, a table row,
    // a very long paragraph): the document has no title of its own
    if (!md && (structuralLine(line) || line.length > 300)) return { title: '', skip };
    skip.add(i);
    return { title: md ? md[2].trim() : line, skip };
  }
  return { title: '', skip };
}

// Lines that start a structural unit and therefore cannot continue a title.
function structuralLine(t) {
  return SUB_NUMBER.test(t) || SUB_LETTER.test(t) || STEP.test(t) || ARTICLE.test(t) || ARTICLE_LOOSE.test(t)
    || QA_START.test(t) || /^[•·\-–—*]\s/.test(t) || t.includes(TABLE_SEP) || /^(раздел|глава)\s/i.test(t);
}

function articleHead(line) {
  const m = ARTICLE.exec(line) || ARTICLE_LOOSE.exec(line);
  if (!m) return null;
  const word = m[1] === '§' ? '§' : 'статья';
  return { word, key: m[2], rest: (m[3] || '').trim() };
}

// "Положение" alone on the title line: the full name usually stands in the
// first clause, "Порядок перехода ... (далее – настоящий Порядок) разработан".
const TITLE_IN_TEXT = /((?:положени[ея]|поряд(?:ок|ка)|регламент[а]?|правила?|инструкци[яи])\s[^()\n]{8,220}?)\s*\(далее/i;
function titleFromBody(title, nodes) {
  if (title.split(/\s+/).length > 2 || !TITLE_WORDS.test(title)) return title;
  for (const n of nodes.filter((x) => x.kind === 'clause' && !x.heading).slice(0, 4)) {
    const m = TITLE_IN_TEXT.exec(n.text);
    if (m && m[1].toLowerCase().startsWith(title.toLowerCase().slice(0, 5))) {
      const t = m[1].replace(/\s+/g, ' ').trim();
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
  }
  return title;
}

// Does numbering restart at "1." inside two or more Roman/"Раздел" sections?
// Then every section gets its own prefix, including the first one, so ids are
// consistent: "Раздел 2 / 1." -> "2.1", "Раздел 1 / 1." -> "1.1".
function sectionsRestart(lines) {
  let restarts = 0;
  let afterSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const rom = ROMAN.exec(line);
    const isSection = (line.length <= sectionMax(line) && ((rom && /^[IVXLC]+$/.test(rom[1])) || NAMED_SECTION.test(line)))
      || !!articleHead(line);
    if (isSection) { afterSection = true; continue; }
    const m = NUMBERED.exec(line);
    if (m && afterSection) {
      if (m[1] === '1') restarts++;
      afterSection = false;
    }
  }
  return restarts >= 2;
}

// Order cover first (see findOrderCover): its items get ids "приказ/1", the
// approved document keeps plain clause numbers.
function parseRegulation(raw, opts = {}) {
  const lines = preprocess(raw);
  const cut = opts.noCover ? -1 : findOrderCover(lines);
  if (cut < 0) return parseBody(lines, opts);
  const main = parseBody(lines.slice(cut), opts);
  const cover = parseBody(lines.slice(0, cut), { title: 'Приказ' });
  const pre = (id) => `приказ/${id}`;
  const coverNodes = cover.nodes.map((n) => ({
    ...n,
    id: pre(n.id),
    parent: n.parent ? pre(n.parent) : null,
    children: n.children.map(pre),
    label: `приказ, ${n.label}`,
    path: ['Приказ об утверждении', ...n.path],
  }));
  const nodes = [...coverNodes, ...main.nodes];
  nodes.forEach((n, i) => { n.order = i; });
  return { title: main.title, nodes };
}

const SECTION_ABBR = { глава: 'гл.', раздел: 'разд.', roman: 'разд.', статья: 'ст.', '§': '§' };

function parseBody(lines, opts = {}) {
  const restartMode = sectionsRestart(lines);
  const nodes = [];
  const byId = new Map();
  let title = opts.title ? String(opts.title).trim() : '';

  let path = []; // numbers of the last accepted clause
  let numStack = []; // nodes for each level of `path`
  let current = null; // node receiving continuation text
  let lastNumbered = null; // clause that owns subpoints
  let scopePrefix = ''; // '' or 'прил.1/'
  let appendixNode = null;
  let sectionTitle = null; // Roman / md / "Раздел" heading text
  let sectionPrefix = ''; // used only when numbering restarts inside sections
  let sectionJustOpened = false;
  let sectionKey = null;
  let sections = []; // open section headings, outer first: Глава II > Раздел 1
  let sectionLabel = ''; // "гл. II, разд. 1" for clause labels in restart mode
  let paraCount = 0;
  let blank = false;
  const { title: detected, skip: titleSkip } = detectTitle(lines, !!opts.title);
  if (!title) title = detected;
  let seenNumbered = false;
  let order = 0;
  let lastPara = null; // paragraph that may own a list ("...:" then а) б))
  let parenSeq = 0; // last number of a top-level "1) 2) 3)" list
  let parenNode = null;
  let stepNode = null; // open "Шаг N" container
  let tableCount = 0;

  function uniqueId(id) {
    if (!byId.has(id)) return id;
    let k = 2;
    while (byId.has(`${id}~${k}`)) k++;
    return `${id}~${k}`;
  }

  function add(node) {
    node.id = uniqueId(node.id);
    node.order = order++;
    node.children = [];
    nodes.push(node);
    byId.set(node.id, node);
    if (node.parent && byId.has(node.parent)) byId.get(node.parent).children.push(node.id);
    current = node;
    return node;
  }

  function currentPathTitles(parentNode) {
    const titles = [];
    if (appendixNode) titles.push(appendixNode.text.split('\n')[0].slice(0, 120));
    if (sections.length) for (const s of sections) titles.push(s.label);
    else if (sectionTitle) titles.push(sectionTitle);
    let p = parentNode;
    const chain = [];
    while (p) {
      chain.unshift(p);
      p = p.parent ? byId.get(p.parent) : null;
    }
    for (const c of chain) {
      if (c.kind === 'clause') titles.push(`${c.number} ${c.text.split('\n')[0].slice(0, 120)}`);
    }
    return titles;
  }

  function addPara(text) {
    paraCount++;
    add({
      id: `${scopePrefix}абз.${paraCount}`,
      kind: 'para',
      label: `${appendixNode ? appendixNode.label + ', ' : ''}абзац ${paraCount}`,
      number: null,
      parent: appendixNode ? appendixNode.id : null,
      path: currentPathTitles(null),
      text,
    });
    lastNumbered = null;
    lastPara = current;
    parenNode = null;
  }

  function addClause(nums, text, asHeading) {
    const number = nums.join('.');
    // parent = deepest existing ancestor
    let parent = null;
    for (let k = nums.length - 1; k >= 1; k--) {
      const pid = `${scopePrefix}${sectionPrefix}${nums.slice(0, k).join('.')}`;
      if (byId.has(pid)) { parent = byId.get(pid); break; }
    }
    const node = add({
      id: `${scopePrefix}${sectionPrefix}${number}`,
      kind: 'clause',
      label: `${appendixNode ? appendixNode.label + ', ' : ''}${sectionPrefix ? `${sectionLabel}, п. ${number}` : `п. ${number}`}`,
      number: `${sectionPrefix}${number}`,
      parent: parent ? parent.id : (appendixNode ? appendixNode.id : null),
      path: currentPathTitles(parent),
      text,
      forcedHeading: !!asHeading,
    });
    path = nums;
    numStack = numStack.slice(0, nums.length - 1);
    numStack[nums.length - 1] = node;
    lastNumbered = node;
    lastPara = null;
    parenNode = null;
    seenNumbered = true;
    sectionJustOpened = false;
  }

  function containerLabel() {
    return appendixNode ? `${appendixNode.label}, ` : '';
  }

  // "Шаг 2: ..." — a clause of its own and a scope for what is numbered inside it.
  function openStep(word, n, text) {
    const w = word.toLowerCase();
    // leave the previous step, keep an enclosing appendix
    if (stepNode) { appendixNode = stepNode.outer; scopePrefix = stepNode.outerScope; }
    const outer = appendixNode;
    const outerScope = scopePrefix;
    const node = add({
      id: `${outerScope}${w}.${n}`,
      kind: 'clause',
      label: `${outer ? outer.label + ', ' : ''}${w} ${n}`,
      number: `${w} ${n}`,
      parent: outer ? outer.id : null,
      path: currentPathTitles(null),
      text,
    });
    node.outer = outer;
    node.outerScope = outerScope;
    node.stepNo = n;
    stepNode = node;
    appendixNode = node;
    scopePrefix = `${outerScope}${w}.${n}/`;
    path = [];
    numStack = [];
    paraCount = 0;
    lastNumbered = node;
    lastPara = null;
    parenNode = null;
    parenSeq = 0;
    seenNumbered = true;
  }

  // Top-level "1) ... 2) ..." list with no clause above it.
  function addParenItem(n, text) {
    const node = add({
      id: `${scopePrefix}${n})`,
      kind: 'clause',
      label: `${containerLabel()}п. ${n})`,
      number: `${n})`,
      parent: appendixNode ? appendixNode.id : null,
      path: currentPathTitles(null),
      text,
    });
    parenSeq = n;
    parenNode = node;
    lastNumbered = node;
    lastPara = null;
    seenNumbered = true;
  }

  // Table rows ("a | b | c" lines from docx/html tables): every row is citable.
  function addTable(rows, owner) {
    tableCount++;
    const cells = rows.map((r) => r.split(TABLE_SEP).map((c) => c.trim()));
    const width = Math.max(...cells.map((c) => c.length));
    const first = cells[0];
    const hasHeader = cells.length >= 2 && first.length === width && first.every((c) => c && c.length <= 80 && !/^\d+([.,]\d+)?$/.test(c))
      && cells.slice(1).some((c) => c.some((x) => /\d/.test(x)) || c.join(' ').length > first.join(' ').length);
    const header = hasHeader ? first : null;
    const body = hasHeader ? cells.slice(1) : cells;
    const basePath = owner && owner.kind === 'clause'
      ? [...owner.path, `${owner.number} ${owner.text.split('\n')[0].slice(0, 120)}`]
      : currentPathTitles(null);
    const tablePath = header ? [...basePath, header.join(' | ').slice(0, 160)] : basePath;
    body.forEach((c, k) => {
      if (!c.some(Boolean)) return;
      const text = header
        ? c.map((v, j) => (v ? (header[j] && header[j] !== v ? `${header[j]}: ${v}` : v) : '')).filter(Boolean).join('; ')
        : c.filter(Boolean).join(' | ');
      add({
        id: `${scopePrefix}табл.${tableCount}/${k + 1}`,
        kind: 'row',
        label: `${containerLabel()}таблица ${tableCount}, строка ${k + 1}`,
        number: null,
        parent: owner ? owner.id : (appendixNode ? appendixNode.id : null),
        path: tablePath,
        text,
      });
    });
    current = null;
    lastNumbered = null;
    lastPara = null;
    parenNode = null;
  }

  function tryNumbered(line, asHeading) {
    const m = NUMBERED.exec(line);
    if (!m) return false;
    const nums = m[1].split('.').map(Number);
    const hasDot = !!m[2];
    const text = m[3].trim().replace(/^\|\s*/, '');
    if (!text) return false;
    if (nums.some((x) => x === 0)) return false;
    // "5 рабочих дней ..." at the start of a wrapped line is not a clause
    if (nums.length === 1 && !hasDot && !/^[А-ЯЁA-Z«"(]/.test(text)) return false;
    if (nums.length === 1 && nums[0] > 300) return false;
    if (plausible(nums, path)) {
      addClause(nums, text, asHeading);
      return true;
    }
    // numbering restarts inside a Roman/"Раздел" section: I. 1. 2. II. 1. 2.
    if (sectionJustOpened && nums.every((x) => x <= 2) && sectionKey) {
      setSectionPrefix();
      path = [];
      addClause(nums, text, asHeading);
      return true;
    }
    return false;
  }

  function setSectionPrefix() {
    const keyed = sections.filter((s) => s.key);
    sectionPrefix = keyed.map((s) => s.key).join('.') + '.';
    sectionLabel = keyed.map((s) => `${SECTION_ABBR[s.word] || 'разд.'} ${s.key}`).join(', ');
  }

  // A heading of a kind that is already open replaces it (and closes what is
  // nested in it); a new kind nests: "Глава II" > "Раздел 1".
  function openSection(label, key, word) {
    if (key && word) {
      const k = sections.findIndex((s) => s.word === word);
      if (k >= 0) sections = sections.slice(0, k);
      sections.push({ word, key, label });
    } else {
      sections = [];
    }
    sectionTitle = label;
    sectionKey = key || null;
    sectionJustOpened = true;
    lastNumbered = null;
    lastPara = null;
    parenNode = null;
    parenSeq = 0;
    if (restartMode && key && !appendixNode) {
      setSectionPrefix();
      path = [];
    }
    current = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { blank = true; continue; }
    const afterBlank = blank;
    blank = false;

    if (titleSkip.has(i)) continue;

    // Markdown heading
    const md = MD_HEADING.exec(line);
    if (md) {
      const inner = md[2].trim().replace(/\*\*/g, '');
      if (seenNumbered && APPENDIX.test(inner)) { openAppendix(inner); continue; }
      if (tryNumbered(inner, true)) continue;
      openSection(inner);
      continue;
    }

    // Appendix (only after the body started: "Приложение к приказу" on top is a header)
    // "... по форме согласно / Приложение № 1." is the wrapped end of a sentence, not a heading
    // So is "Приложение № 2 к Регламенту" right under an unfinished line: a
    // real appendix starts after a finished paragraph or an empty line.
    // An unfinished line is a full-width line of running text without final
    // punctuation, or one that ends with a word that cannot end a sentence.
    const openLine = (s) => Boolean(s) && !/[.;:!?»")]$/.test(s)
      && (s.length >= 60 || /(?:,|\s(?:согласно|в|к|по|на|с|и|или|форме))$/i.test(s));
    const sentenceTail = openLine(i > 0 ? lines[i - 1].trim() : '') || (/\.$/.test(line) && (() => {
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j].trim();
        if (prev) return openLine(prev);
      }
      return false;
    })());
    if (seenNumbered && line.length <= 200 && APPENDIX.test(line) && !/[;,]$/.test(line) && !sentenceTail) {
      openAppendix(line);
      continue;
    }

    // Roman / named section headings
    const rom = ROMAN.exec(line);
    if (rom && line.length <= sectionMax(line) && !/[;,]$/.test(line) && /^[IVXLC]+$/.test(rom[1])) {
      const word = (/^(раздел|глава)/i.exec(line) || [null, 'roman'])[1].toLowerCase();
      openSection(word === 'roman' ? `${rom[1]}. ${rom[2].trim()}` : line, rom[1], word);
      continue;
    }
    const named = NAMED_SECTION.exec(line);
    if (named && line.length <= sectionMax(line) && !/[;,]$/.test(line)) {
      openSection(line, named[2], named[1].toLowerCase());
      continue;
    }

    // "Статья 5. Отпуска" / "§ 3. ..."
    const art = articleHead(line);
    if (art && !/[;,]$/.test(line)) {
      const body = art.rest;
      // a статья whose text follows on the same line is content, not a heading
      const isContent = body.length > 120 || /[.;:]$/.test(body);
      const head = art.word === '§' ? `§ ${art.key}` : `Статья ${art.key}`;
      openSection(isContent || !body ? head : `${head}. ${body}`, art.key, art.word);
      if (isContent) {
        add({
          id: `${scopePrefix}${SECTION_ABBR[art.word]}${art.key}`,
          kind: 'clause',
          label: `${containerLabel()}${SECTION_ABBR[art.word]} ${art.key}`,
          number: `${SECTION_ABBR[art.word]} ${art.key}`,
          parent: appendixNode ? appendixNode.id : null,
          path: currentPathTitles(null),
          text: body,
        });
        lastNumbered = current;
        seenNumbered = true;
      }
      continue;
    }

    const st = STEP.exec(line);
    if (st && Number(st[2]) === (stepNode ? stepNode.stepNo + 1 : 1)
      && (st[3] === '' || /^[А-ЯЁA-Z«"(]/.test(st[3]) || /^\S+\s*\d+\s*[.:)\-–—]/.test(line))) {
      openStep(st[1], Number(st[2]), st[3].trim());
      continue;
    }

    if (tryNumbered(line, false)) continue;

    // table block: consecutive "a | b | c" lines
    if (line.includes(TABLE_SEP)) {
      const rows = [line];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const nx = lines[j].trim();
        if (!nx || !nx.includes(TABLE_SEP)) break;
        rows.push(nx);
      }
      if (rows.length >= 2) {
        let owner = current;
        if (owner && owner.kind === 'sub') owner = byId.get(owner.parent);
        if (owner && (owner.kind === 'row' || owner.kind === 'appendix')) owner = null;
        addTable(rows, owner);
        i = j - 1;
        continue;
      }
    }

    const sl = SUB_LETTER.exec(line) || SUB_NUMBER.exec(line);
    // "1) ... 2) ..." as the document's own numbering, with no clause above
    if (sl && /^\d/.test(sl[1])) {
      const n = Number(sl[1]);
      const nextTop = parenNode && n === parenSeq + 1 && (lastNumbered === parenNode);
      const underColon = lastPara && lastPara === current && /:\s*$/.test(lastPara.text.trim());
      const firstTop = n === 1 && !lastNumbered && !underColon && (!current || afterBlank);
      if (nextTop || firstTop) {
        addParenItem(n, sl[2].trim());
        continue;
      }
    }
    // a list under an unnumbered paragraph that ends with a colon
    if (sl && !lastNumbered && lastPara) {
      const owner = lastPara;
      const first = /^(?:а|1)$/i.test(sl[1]);
      const inList = current && current.kind === 'sub' && current.parent === owner.id;
      const starts = first && current === owner && /:\s*$/.test(owner.text.trim());
      if (inList || starts) {
        const letter = sl[1].toLowerCase();
        add({
          id: `${owner.id}(${letter})`,
          kind: 'sub',
          label: `${owner.label}, пп. ${letter})`,
          number: null,
          parent: owner.id,
          path: owner.path,
          text: sl[2].trim(),
        });
        continue;
      }
    }
    if (sl && lastNumbered) {
      const letter = sl[1].toLowerCase();
      add({
        id: `${lastNumbered.id}(${letter})`,
        kind: 'sub',
        label: `${lastNumbered.label}, пп. ${letter})`,
        number: `${lastNumbered.number}(${letter})`,
        parent: lastNumbered.id,
        path: [...lastNumbered.path, `${lastNumbered.number} ${lastNumbered.text.split('\n')[0].slice(0, 120)}`],
        text: sl[2].trim(),
      });
      continue;
    }

    // A section heading wrapped onto the next line: "Раздел 2. ... конкурса / в электронной форме"
    if (!current && sectionJustOpened && sectionTitle && /^[а-яё(«"]/.test(line) && line.length <= 160) {
      sectionTitle = `${sectionTitle} ${line}`;
      if (sections.length) sections[sections.length - 1].label = sectionTitle;
      continue;
    }

    // "Вопрос: ... Ответ: ..." pairs: every question starts its own paragraph
    if (QA_START.test(line)) { addPara(line); continue; }

    // Continuation or a new paragraph
    if (current) {
      const prev = current.text.trimEnd();
      const continues = !afterBlank || /[:;,\-—]$/.test(prev) || /^[а-яё\-—•·–]/.test(line);
      const startsLabel = LABEL_PARA.test(line);
      if (current.kind === 'appendix' || (continues && !(afterBlank && startsLabel))) {
        current.text += (afterBlank ? '\n' : '\n') + line;
        continue;
      }
      if (afterBlank && (startsLabel || current.kind === 'para')) {
        addPara(line);
        continue;
      }
      current.text += '\n' + line;
      continue;
    }
    addPara(line);
  }

  function openAppendix(line) {
    const m = APPENDIX.exec(line);
    const num = (m && m[1]) ? m[1] : String(nodes.filter((n) => n.kind === 'appendix').length + 1);
    scopePrefix = `прил.${num}/`;
    stepNode = null;
    lastPara = null;
    parenNode = null;
    parenSeq = 0;
    path = [];
    numStack = [];
    sectionTitle = null;
    sectionPrefix = '';
    sections = [];
    paraCount = 0;
    appendixNode = null;
    const node = add({
      id: `прил.${num}`,
      kind: 'appendix',
      label: `Приложение ${num}`,
      number: null,
      parent: null,
      path: [],
      text: line,
    });
    appendixNode = node;
    lastNumbered = null;
  }

  // Headings: numbered nodes with children, short, without final punctuation
  for (const n of nodes) {
    n.heading = false;
    if (n.kind !== 'clause') continue;
    const t = n.text.trim();
    const shortNoPunct = t.length <= 120 && !/[.;:,]$/.test(t) && !t.includes('\n');
    if ((n.children.length && shortNoPunct) || (n.forcedHeading && shortNoPunct) || (shortNoPunct && isUpperLine(t) && t.length <= 100)) {
      n.heading = true;
    }
    delete n.forcedHeading;
  }
  for (const n of nodes) {
    delete n.outer;
    delete n.outerScope;
    delete n.stepNo;
    n.text = n.text.replace(/^\n+/, '');
  }

  if (title) title = titleFromBody(title.replace(/\s+/g, ' ').trim(), nodes);
  if (!title) title = opts.fallbackTitle || 'Без названия';
  return { title: title.replace(/\s+/g, ' ').trim(), nodes };
}

module.exports = { parseRegulation, plausible, cleanText, preprocess, findOrderCover };
