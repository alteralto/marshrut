'use strict';
// Snowball Russian stemmer, ported by hand from the reference algorithm
// (https://snowballstem.org/algorithms/russian/stemmer.html).
// No dependencies: the algorithm is ~100 lines and a package would add
// supply-chain surface for no gain.

const VOWELS = new Set('аеиоуыэюя');

const PERFECTIVE_GERUND_1 = ['вшись', 'вши', 'в']; // after а/я
const PERFECTIVE_GERUND_2 = ['ившись', 'ывшись', 'ивши', 'ывши', 'ив', 'ыв'];
const ADJECTIVE = ['ими', 'ыми', 'его', 'ого', 'ему', 'ому', 'ее', 'ие', 'ые', 'ое', 'ей', 'ий',
  'ый', 'ой', 'ем', 'им', 'ым', 'ом', 'их', 'ых', 'ую', 'юю', 'ая', 'яя', 'ою', 'ею'];
const PARTICIPLE_1 = ['ем', 'нн', 'вш', 'ющ', 'щ']; // after а/я
const PARTICIPLE_2 = ['ивш', 'ывш', 'ующ'];
const REFLEXIVE = ['ся', 'сь'];
const VERB_1 = ['ете', 'йте', 'ешь', 'нно', 'ла', 'на', 'ли', 'ем', 'ло', 'но', 'ет', 'ют', 'ны',
  'ть', 'й', 'л', 'н']; // after а/я
const VERB_2 = ['ейте', 'уйте', 'ила', 'ыла', 'ена', 'ите', 'или', 'ыли', 'ило', 'ыло', 'ено',
  'ует', 'уют', 'ены', 'ить', 'ыть', 'ишь', 'ей', 'уй', 'ил', 'ыл', 'им', 'ым', 'ен', 'ят', 'ит',
  'ыт', 'ую', 'ю'];
const NOUN = ['иями', 'ями', 'ами', 'ией', 'иям', 'ием', 'иях', 'ев', 'ов', 'ие', 'ье', 'еи', 'ии',
  'ей', 'ой', 'ий', 'ям', 'ем', 'ам', 'ом', 'ах', 'ях', 'ию', 'ью', 'ия', 'ья', 'а', 'е', 'и', 'й',
  'о', 'у', 'ы', 'ь', 'ю', 'я'];
const SUPERLATIVE = ['ейше', 'ейш'];
const DERIVATIONAL = ['ость', 'ост'];

function regions(w) {
  let pV = w.length;
  let p2 = w.length;
  let i = 0;
  while (i < w.length && !VOWELS.has(w[i])) i++;
  if (i < w.length) {
    pV = i + 1;
    i = pV;
    while (i < w.length && VOWELS.has(w[i])) i++; // gopast non-v (R1 start)
    i++;
    while (i < w.length && !VOWELS.has(w[i])) i++;
    if (i < w.length) {
      i++;
      while (i < w.length && VOWELS.has(w[i])) i++;
      if (i < w.length) p2 = i + 1;
    }
  }
  return { pV, p2 };
}

// Longest suffix from the merged groups that lies inside [limit, end).
// Returns {suffix, group} or null. group 1 requires a preceding а/я inside the region.
function longest(w, limit, g1, g2) {
  let best = null;
  for (const s of g1) {
    if (w.length - s.length >= limit && w.endsWith(s) && (!best || s.length > best.s.length)) best = { s, g: 1 };
  }
  if (g2) {
    for (const s of g2) {
      if (w.length - s.length >= limit && w.endsWith(s) && (!best || s.length > best.s.length)) best = { s, g: 2 };
    }
  }
  return best;
}

// Snowball "among" + condition: take the longest match, then check its condition.
function removeGrouped(w, limit, g1, g2) {
  const m = longest(w, limit, g1, g2);
  if (!m) return null;
  const cut = w.length - m.s.length;
  if (m.g === 1) {
    const prev = w[cut - 1];
    if (cut - 1 < limit || (prev !== 'а' && prev !== 'я')) return null;
  }
  return w.slice(0, cut);
}

function stem(word) {
  let w = String(word).toLowerCase().replace(/ё/g, 'е');
  if (!/^[а-я]+$/.test(w)) return w;
  const { pV, p2 } = regions(w);
  if (pV >= w.length) return w;

  // Step 1
  let r = removeGrouped(w, pV, PERFECTIVE_GERUND_1, PERFECTIVE_GERUND_2);
  if (r !== null) {
    w = r;
  } else {
    const refl = longest(w, pV, REFLEXIVE);
    if (refl) w = w.slice(0, w.length - refl.s.length);
    const adj = longest(w, pV, ADJECTIVE);
    if (adj) {
      w = w.slice(0, w.length - adj.s.length);
      const p = removeGrouped(w, pV, PARTICIPLE_1, PARTICIPLE_2);
      if (p !== null) w = p;
    } else {
      r = removeGrouped(w, pV, VERB_1, VERB_2);
      if (r !== null) {
        w = r;
      } else {
        const n = longest(w, pV, NOUN);
        if (n) w = w.slice(0, w.length - n.s.length);
      }
    }
  }

  // Step 2
  if (w.endsWith('и') && w.length - 1 >= pV) w = w.slice(0, -1);

  // Step 3
  const d = longest(w, p2, DERIVATIONAL);
  if (d) w = w.slice(0, w.length - d.s.length);

  // Step 4
  const sup = longest(w, pV, SUPERLATIVE);
  if (sup) {
    w = w.slice(0, w.length - sup.s.length);
    if (w.endsWith('нн') && w.length - 2 >= pV) w = w.slice(0, -1);
  } else if (w.endsWith('нн') && w.length - 2 >= pV) {
    w = w.slice(0, -1);
  } else if (w.endsWith('ь') && w.length - 1 >= pV) {
    w = w.slice(0, -1);
  }
  return w;
}

module.exports = { stem };
