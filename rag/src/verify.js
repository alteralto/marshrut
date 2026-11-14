'use strict';
// Deterministic grounding check for generated steps. No model involved.
// A step passes only if:
//   1. it cites at least one clause, and every cited clause is in the context
//      that was actually given to the generator;
//   2. its content words are covered by the cited text (stem match, or a shared
//      5+ letter prefix for paraphrased forms), share >= minSupport;
//   3. every number in the step (digits or numeral words) occurs in the cited text;
//   4. it does not flip negation ("допускается" vs "не допускается").

const { tokens, words, stem } = require('./text');

const GENERIC = new Set(tokens(`необходимо нужно следует надо сначала затем далее потом после этого этом
также требуется рекомендуется обратите внимание убедитесь вам вы ваш ваше вашего ваша вашу свой своего свою
своё свое своей сам самостоятельно шаг этап итог итоге случае порядке согласно соответствии`));

const NUMERALS = [
  [/^(один|одна|одно|одного|одной|одному|одним|одном|одну)$/, '1'],
  [/^(два|две|двух|двум|двумя)$/, '2'],
  [/^(три|трех|трем|тремя)$/, '3'],
  [/^(четыре|четырех|четырем|четырьмя)$/, '4'],
  [/^(пять|пяти|пятью)$/, '5'],
  [/^(шесть|шести)$/, '6'],
  [/^(семь|семи)$/, '7'],
  [/^(восемь|восьми)$/, '8'],
  [/^(девять|девяти)$/, '9'],
  [/^(десять|десяти)$/, '10'],
  [/^(четырнадцать|четырнадцати)$/, '14'],
  [/^(пятнадцать|пятнадцати)$/, '15'],
  [/^(двадцать|двадцати)$/, '20'],
  [/^(тридцать|тридцати)$/, '30'],
];

function numbersIn(text) {
  const out = new Set();
  for (const w of words(text)) {
    if (/^\d+$/.test(w)) { out.add(String(Number(w))); continue; }
    for (const [re, d] of NUMERALS) if (re.test(w)) { out.add(d); break; }
  }
  return out;
}

// Stems that appear right after "не"/"ни"/"без" (negated) vs. without it.
function polarity(text) {
  const ws = words(text);
  const neg = new Set();
  const pos = new Set();
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (w.length < 3) continue;
    const s = stem(w);
    const prev = ws[i - 1];
    if (prev === 'не' || prev === 'ни' || prev === 'без' || w.startsWith('запрещ') || w === 'нельзя') neg.add(s);
    else pos.add(s);
  }
  return { neg, pos };
}

function prefixMatch(t, set, n = 5) {
  if (t.length < n) return false;
  const p = t.slice(0, n);
  for (const s of set) if (s.length >= n && s.startsWith(p)) return true;
  return false;
}

function supportScore(stepText, citedText) {
  const stepToks = [...new Set(tokens(stepText))].filter((t) => !GENERIC.has(t) && !/^\d+$/.test(t));
  if (!stepToks.length) return { support: 0, unsupported: [], total: 0 };
  const cited = new Set(tokens(citedText));
  const unsupported = stepToks.filter((t) => !cited.has(t) && !prefixMatch(t, cited));
  return { support: (stepToks.length - unsupported.length) / stepToks.length, unsupported, total: stepToks.length };
}

// Normalizes "п. 2.3", "2.3а", "2.3 пп. а)", "D1:2.3", "Приложение 1" ...
// Returns { slot: 'D1'|null, clause: '2.3(а)' }.
function normalizeCite(raw) {
  let x = String(raw || '').trim().toLowerCase().replace(/ё/g, 'е');
  let slot = null;
  const m = /^\[?(d\d+)\s*[:/\-–—]?\s*/i.exec(x);
  if (m) { slot = m[1].toUpperCase(); x = x.slice(m[0].length); }
  x = x.replace(/[[\]]/g, '').trim();
  x = x.replace(/приложени[еяюи]\s*№?\s*(\d+)/g, 'прил.$1');
  // "прил.1, п. 2" / "прил.1 пункт 2" -> "прил.1/2"
  x = x.replace(/^(прил\.\d+)[,\s]*(?:пункт[а-я]*|п\.?)?\s*(?=\d)/, '$1/');
  x = x.replace(/^(?:пункт[а-я]*\s*|п\.\s*|п\s+)/, '');
  x = x.replace(/[,\s]*(?:подпункт[а-я]*|пп\.?)\s*«?([а-я0-9]{1,2})»?\)?/g, '($1)');
  x = x.replace(/^((?:прил\.\d+\/)?\d+(?:\.\d+)*)\.?\s*\(?([а-я])\)$/, '$1($2)');
  x = x.replace(/^((?:прил\.\d+\/)?\d+(?:\.\d+)*)([а-я])$/, '$1($2)');
  x = x.replace(/\s+/g, '').replace(/\.$/, '');
  x = x.replace(/^абзац/, 'абз.');
  return { slot, clause: x };
}

// context: array of chunks {docId, clauseId, text, subs, label}; slots: docId -> 'D1'
function buildCiteResolver(context, slots) {
  const map = new Map(); // 'D1:2.3' -> {chunk, sub}
  const bare = new Map(); // '2.3' -> [{chunk, sub}]
  for (const c of context) {
    const slot = slots.get(c.docId);
    const entries = [{ id: c.clauseId, chunk: c, sub: null }, ...(c.subs || []).map((s) => ({ id: s.id, chunk: c, sub: s }))];
    for (const e of entries) {
      const key = e.id.toLowerCase();
      map.set(`${slot}:${key}`, e);
      if (!bare.has(key)) bare.set(key, []);
      bare.get(key).push(e);
    }
  }
  return function resolve(raw) {
    const { slot, clause } = normalizeCite(raw);
    if (slot) return map.get(`${slot}:${clause}`) || null;
    const list = bare.get(clause);
    if (!list) return null;
    return list[0]; // context is ordered primary doc first
  };
}

const STEP_FIELDS = ['who', 'deadline', 'form'];

// A model sometimes slips Latin letters into a Russian word ("дirector").
// Such a word is put back from the cited text, or the step fails.
const LAT = { a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'кс', y: 'ы', z: 'з' };
function fixMixedScript(text, source) {
  const words = new Set(String(source).toLowerCase().replace(/ё/g, 'е').match(/[а-я]+/g) || []);
  let bad = false;
  const fixed = String(text).replace(/[A-Za-zА-Яа-яЁё]+/g, (w) => {
    if (!/[A-Za-z]/.test(w) || !/[А-Яа-яЁё]/.test(w)) return w;
    const ru = w.toLowerCase().replace(/[a-z]/g, (ch) => LAT[ch] || ch);
    if (words.has(ru.replace(/ё/g, 'е'))) return /^[A-ZА-ЯЁ]/.test(w) ? ru[0].toUpperCase() + ru.slice(1) : ru;
    bad = true;
    return w;
  });
  return { text: fixed, bad };
}

function verifyStep(step, resolve, opts = {}) {
  const minSupport = opts.minSupport ?? 0.6;
  const reasons = [];
  const cites = Array.isArray(step.cites) ? step.cites : (step.cites ? [step.cites] : []);
  const resolved = [];
  const invalid = [];
  for (const c of cites) {
    const r = resolve(c);
    if (r) resolved.push(r); else invalid.push(String(c));
  }
  if (!cites.length) reasons.push('no_citation');
  if (invalid.length) reasons.push(`cited_clause_not_in_context:${invalid.join(',')}`);

  // When a subpoint is cited, the clause lead-in counts as context too.
  const citedText = resolved.map((r) => (r.sub ? `${r.chunk.text}` : r.chunk.text) + ' ' + (r.chunk.path || []).slice(-1).join(' ')).join('\n');
  const mixed = fixMixedScript(String(step.text || '').trim(), citedText);
  const text = mixed.text;
  if (!text) reasons.push('empty_step');
  if (mixed.bad) reasons.push('mixed_script');

  let support = 0;
  let unsupported = [];
  if (resolved.length && text) {
    ({ support, unsupported } = supportScore(text, citedText));
    if (support < minSupport) reasons.push(`low_support:${support.toFixed(2)}`);
    const stepNums = numbersIn(text);
    const citedNums = numbersIn(citedText);
    // clause numbers quoted in the step text ("по п. 3.1") are not facts
    const citedIds = new Set(resolved.flatMap((r) => r.chunk.clauseId.split(/[^0-9]+/)));
    const badNums = [...stepNums].filter((n) => !citedNums.has(n) && !citedIds.has(n));
    if (badNums.length) reasons.push(`numbers_not_in_source:${badNums.join(',')}`);
    const ps = polarity(text);
    const pc = polarity(citedText);
    const flipped = [];
    for (const s of ps.pos) if (pc.neg.has(s) && !pc.pos.has(s)) flipped.push(s);
    for (const s of ps.neg) if (pc.pos.has(s) && !pc.neg.has(s)) flipped.push(s);
    if (flipped.length) reasons.push(`negation_mismatch:${flipped.join(',')}`);
  }
  // Optional attributes (who / deadline / form) must come from the cited
  // text as well; an unsupported attribute is dropped, the step is kept.
  const fields = {};
  for (const name of STEP_FIELDS) {
    const val = typeof step[name] === 'string' ? step[name].trim() : '';
    if (!val || !resolved.length) continue;
    const fs = supportScore(val, citedText);
    const fieldNums = [...numbersIn(val)].filter((n) => !numbersIn(citedText).has(n));
    if ((fs.total === 0 || fs.support >= minSupport) && !fieldNums.length) fields[name] = val;
    else reasons.push(`field_unsupported:${name}`);
  }
  // A partially invalid cite list is tolerated only if the rest supports the
  // step; attribute problems are never fatal.
  const fatal = reasons.filter((r) => !r.startsWith('field_unsupported')
    && (!r.startsWith('cited_clause_not_in_context') || !resolved.length));
  return {
    ok: fatal.length === 0,
    reasons,
    support: +support.toFixed(3),
    unsupported,
    resolved,
    fields,
    text,
  };
}

module.exports = { verifyStep, supportScore, normalizeCite, buildCiteResolver, numbersIn, polarity, fixMixedScript };
