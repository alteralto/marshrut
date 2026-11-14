'use strict';
// Two-stage hybrid retrieval: pick the regulation, then the clauses inside it.
//
// Stage 1 (documents): several rankings fused with Reciprocal Rank Fusion —
//   a) BM25 over the whole document (title x3 + headings + body),
//   b) BM25 of its best clauses (top1 + top2/2 + top3/4),
//   c) query-term coverage (share of the question's content words the doc has),
//   d) dense: best clause cosine (only if the index has vectors and an
//      embedding endpoint is configured).
// Stage 2 (clauses): BM25 with statistics local to the chosen document (so the
// words of its title, present in every clause, stop dominating), plus dense,
// fused with RRF, then grouped by section: a procedure is usually one section.
//
// "Not found" is decided before any LLM call from query-term coverage: an
// off-topic question shares (almost) no content words with any regulation.

const { OUTDATED } = require('./meta');
// RAG_OPTS='{"minAbout":0.3}': thresholds for experiments without touching the code
let ENV_OPTS = {};
try { ENV_OPTS = process.env.RAG_OPTS ? JSON.parse(process.env.RAG_OPTS) : {}; } catch { ENV_OPTS = {}; }
const VERB_PREFIX = /^(?:пере|рас|раз|при|про|от|вы|за|по|на|с|у|о)(?=[а-яё]{6})/;
const FORM_CUE = /бланк|форм[аыуе](?![а-яё])|шаблон|образ[ец]ц|таблиц|ячейк|лист[аеу]?(?![а-яё])/i;
const HISTORY = /утратил|прежн|стар(?:ая|ой|ую|ом|ого|ым|ые|ых)(?![а-яё])|предыдущ|раньше|ранее\s+действ|истори|как\s+было|до\s+изменени/i;
const { queryTerms, tokens } = require('./text');
const { BM25 } = require('./bm25');
const { embed, embedConfig } = require('./openai');
const { getSynonyms, synonymExpansions } = require('./synonyms');

const DEFAULTS = {
  rrfK: 60,
  minCoverage: 0.55, // weighted share of query content terms present in the chosen doc
  minChunkCoverage: 0.34, // ... and in its best three clauses
  contextSize: 10, // clauses handed to the LLM
  secondDocRatio: 0.85, // include 2nd regulation if its blended score is this close
  commonDocShare: 0.3, // a term in more than this share of docs is "common"
  expansionWeight: 0.6, // weight of morphological-neighbour stems
  synonymWeight: 0.8, // weight of colloquial -> regulation synonyms
  verbWeight: 0.6, // BM25 weight of verb-like query words
  blend: [0.1, 0.3, 0.3, 0.3], // document score: BM25 of the document, of its best clauses, coverage, "about"
  minAbout: 0.35,
  ambiguityRatio: 0.9, // two documents this close: ask which one is meant // share of the specific query words the chosen document is about
  formPrior: 0.7, // a blank form or a table gives way to a regulation
  verbAbout: 0.5, // weight of a verb in "about" when a document title has it; 0 = verbs do not count
  bodyAbout: 0.5, // in ranking a heading or frequent use counts this much of a title
  entryClauses: 2, // "how do I" questions: this many clauses where an application is filed are shown too
  leadRatio: 0.8, // a clause this close to the best one is shown whatever its section
  aboutPer: 1000, // "about" by frequency: one use per this many words of the document, at least three
};

// Sections that rarely hold the steps of a procedure.
const GENERAL_SECTION = /(общие положения|термины|определения|заключительные положения|область применения|нормативные ссылки|сокращения)/i;
// Sections that usually hold the steps.
const PROCEDURAL_SECTION = /(порядок|оформлени|подач|обращени|подготовк|согласовани|направлени|получени|выдач|процедур|действи)/i;
// Questions about one fact (amount, term, place) rather than a procedure.
// The clause where a procedure starts: somebody files an application.
const ENTRY_DOC = '(?:заявк|заявлени|служебн[а-яё]+ записк|обращени)';
const ENTRY_ACT = '(?:пода[её]т|подают|подан|подач|направля|составля|заполня|представля)';
const ENTRY_CUE = new RegExp(`${ENTRY_DOC}[^.;]{0,80}${ENTRY_ACT}|${ENTRY_ACT}[^.;]{0,80}${ENTRY_DOC}`, 'i');
// Questions about what a term means: the answer is in "Термины и определения".
const DEFINITION_QUESTION = /(^|[^а-яё])(кто так(?:ой|ая|ие)|что так(?:ое|ой)|что значит|что означает|что понимается|что считается|определение)([^а-яё]|$)/i;
const FACT_QUESTION = /(^|[^а-яё])(сколько|когда|какой срок|какая сумма|какой размер|в какой срок|можно ли|где|куда|кто)([^а-яё]|$)/i;
// "в какие часы", "во сколько": the answer is a time of day, so clauses that
// state one ("с 9:00 до 18:00") go up.
const APPENDIX = /^(приложение|прил\.)(\s*(n|№)?\s*[0-9а-я]{0,3})?\.?$/i;
const TIME_QUESTION = /(^|[^а-яё])(в какие часы|во сколько|в какое время|часы работы|время работы|график работы|режим работы|часы при[её]ма)([^а-яё]|$)/i;
const CLOCK = /(^|[^0-9])([01]?[0-9]|2[0-3])[:.][0-5][0-9]([^0-9]|$)/;

function rankOf(values, keys) {
  // values: Map key -> number; returns Map key -> rank (1-based, ties share rank), only for value > 0
  const arr = keys.filter((k) => values.get(k) > 0).sort((a, b) => values.get(b) - values.get(a));
  const ranks = new Map();
  let prev = null;
  let r = 0;
  arr.forEach((k, i) => {
    const v = values.get(k);
    if (v !== prev) r = i + 1;
    prev = v;
    ranks.set(k, r);
  });
  return ranks;
}

function rrf(rankMaps, keys, k) {
  const out = new Map();
  for (const key of keys) {
    let s = 0;
    for (const rm of rankMaps) {
      const r = rm.get(key);
      if (r) s += 1 / (k + r);
    }
    out.set(key, s);
  }
  return out;
}

// Snowball keeps verb and noun stems apart ("согласова" / "согласован",
// "оформ" / "оформлен"). Two stems are neighbours if one is a prefix of the
// other (shorter >= 5 letters) or they share all but the last letter of the
// shorter one (>= 6 letters).
function neighbours(a, b) {
  if (a === b) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 5 || l.length - s.length > 5) return false;
  if (l.startsWith(s)) return true;
  if (s.length < 7) return false;
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return i >= s.length - 1;
}

// Neighbours always share their first 5 letters: either the shorter stem
// (>= 5 letters) is a prefix of the longer one, or they agree on all but the
// last letter of a stem of >= 7 letters. So the vocabulary is bucketed by a
// 5-letter prefix and a term is compared only with its own bucket. Buckets
// keep the vocabulary order, which makes the result the same as a full scan.
const PREFIX = 5;
const NO_NEIGHBOURS = [];

function buildVocabIndex(vocab) {
  const buckets = new Map();
  for (const v of vocab) {
    if (v.length < PREFIX) continue;
    const key = v.slice(0, PREFIX);
    const b = buckets.get(key);
    if (b) b.push(v);
    else buckets.set(key, [v]);
  }
  return { buckets, cache: new Map() };
}

function neighboursOf(t, vocab) {
  if (Array.isArray(vocab)) return vocab.filter((v) => neighbours(t, v));
  let hit = vocab.cache.get(t);
  if (hit === undefined) {
    const bucket = vocab.buckets.get(t.slice(0, PREFIX));
    hit = bucket ? bucket.filter((v) => neighbours(t, v)) : NO_NEIGHBOURS;
    if (vocab.cache.size > 50000) vocab.cache.clear();
    vocab.cache.set(t, hit);
  }
  return hit;
}

function inVocab(v, vocab) {
  if (Array.isArray(vocab)) return vocab.includes(v);
  const bucket = vocab.buckets.get(v.slice(0, PREFIX));
  return !!bucket && bucket.includes(v);
}

// vocab: array of stems (full scan) or the result of buildVocabIndex().
function expandQuery(qTerms, vocab, weight) {
  const weighted = new Map(qTerms.map((t) => [t, 1]));
  const groups = new Map(qTerms.map((t) => [t, new Set([t])]));
  for (const t of qTerms) {
    if (t.length < 5 || /^\d+$/.test(t)) continue;
    let near = neighboursOf(t, vocab);
    // "скорректировать" where the regulations say "корректировка": a word
    // the corpus lacks is tried again without its verbal prefix. A second
    // guess must match closer: stems of about the same length only, so that
    // "корректное составление" is not taken for a correction.
    if (!near.length && t.length >= 8) {
      const m = VERB_PREFIX.exec(t);
      if (m) {
        const bare = t.slice(m[0].length);
        near = neighboursOf(bare, vocab).filter((v) => Math.abs(v.length - bare.length) <= 2);
      }
    }
    // aspect pairs keep only four letters in common and are looked up
    // directly: "указа(ть)" -> "указыва(ет)", "рассмотре(ть)" -> "рассматрива(ет)"
    const pair = /[аеи]$/.test(t) ? [`${t.slice(0, -1)}ыва`, `${t.slice(0, -1)}ива`].filter((v) => inVocab(v, vocab)) : NO_NEIGHBOURS;
    for (const v of [...near, ...pair]) {
      groups.get(t).add(v);
      if (!weighted.has(v)) weighted.set(v, weight);
    }
  }
  return { weighted, groups };
}

function vocabIndex(store) {
  if (!store.vocabIndex) store.vocabIndex = buildVocabIndex(store.vocab);
  return store.vocabIndex;
}

async function queryVector(store, question, opts) {
  if (!store.vectors) return { vec: null };
  // the caller already has the vector (batch runs, benchmarks)
  if (opts.queryVector) return { vec: opts.queryVector };
  const cfg = embedConfig(opts);
  if (!cfg) return { vec: null };
  if (store.embedModel && cfg.model !== store.embedModel) {
    return { vec: null, warning: `embedding model mismatch: index=${store.embedModel}, env=${cfg.model}` };
  }
  try {
    const [v] = await embed([question], cfg);
    return { vec: v };
  } catch (e) {
    return { vec: null, warning: `embedding endpoint unavailable: ${e.message}` };
  }
}

// BM25 over the clauses of one document, with document-local statistics.
// Normally a view over the global clause postings; a separate small index
// only if the document's clauses are scattered across the index.
function localBm25(store, docId) {
  let b = store.localBm25.get(docId);
  if (!b) {
    const idxs = store.docChunks.get(docId);
    const range = store.docRange.get(docId);
    const bm25 = range ? store.chunkBm25.range(range[0], range[1]) : new BM25(idxs.map((i) => store.chunkTokensOf(i)));
    b = { idxs, bm25 };
    store.localBm25.set(docId, b);
  }
  return b;
}

// Cosine of the question with every clause (vectors are L2-normalized).
function denseScores(store, vec) {
  const flat = store.vecFlat;
  const dim = store.vecDim;
  const n = store.index.chunks.length;
  const m = Math.min(dim, vec.length);
  const out = new Float64Array(n);
  for (let c = 0, base = 0; c < n; c++, base += dim) {
    let s = 0;
    for (let i = 0; i < m; i++) s += flat[base + i] * vec[i];
    out[c] = s;
  }
  return out;
}

async function retrieve(store, question, opts = {}) {
  const o = { ...DEFAULTS, ...ENV_OPTS, ...opts };
  const { index, chunkBm25, docBm25, docChunks } = store;
  const warnings = [];
  const qDetailed = queryTerms(question);
  const qTerms = qDetailed.map((x) => x.t);
  const verbTerm = new Set(qDetailed.filter((x) => x.verb).map((x) => x.t));
  const docIds = index.docs.map((d) => d.id);

  if (!qTerms.length) {
    return { notFound: true, reason: 'empty_query', qTerms, docs: [], context: [], warnings };
  }

  const vocab = vocabIndex(store);
  const { weighted, groups } = expandQuery(qTerms, vocab, o.expansionWeight);
  // How specific a word is gets judged by its own forms, before synonyms
  // ("отпускные" is specific even though its expansion "оплата" is everywhere).
  const ownGroups = new Map([...groups].map(([t, g]) => [t, new Set(g)]));
  // Verbs rank less than nouns in BM25 too: "оформить", "подписать" occur in
  // every regulation, the noun says which one.
  for (const t of verbTerm) for (const g of groups.get(t)) weighted.set(g, weighted.get(g) * o.verbWeight);
  // Synonyms: their stems (and the stems' morphological neighbours) count as
  // matches of the original term both in BM25 and in coverage.
  const syn = synonymExpansions(question, qTerms, getSynonyms(o));
  const synonymsUsed = {};
  for (const [t, exp] of syn) {
    const extra = expandQuery([...exp], vocab, 1).weighted;
    synonymsUsed[t] = [...exp];
    for (const [e, w] of extra) {
      const ew = w * o.synonymWeight;
      if ((weighted.get(e) || 0) < ew) weighted.set(e, ew);
      if (groups.has(t)) groups.get(t).add(e);
    }
  }

  const qv = await queryVector(store, question, o);
  if (qv.warning) warnings.push(qv.warning);
  const vec = qv.vec;

  // --- Stage 1: documents
  const chunkScores = chunkBm25.scores(weighted);
  const docScoresArr = docBm25.scores(weighted);
  const dense = vec ? denseScores(store, vec) : null;

  const nDocs = index.docs.length;
  // Share of documents that use a query word in any of its own forms:
  // the union of the postings, counted with a stamp array.
  const seen = new Int32Array(nDocs);
  let stamp = 0;
  const termDocShare = new Map();
  for (const t of qTerms) {
    stamp++;
    let n = 0;
    for (const g of ownGroups.get(t)) n += docBm25.stamp(g, seen, stamp);
    termDocShare.set(t, n / (nDocs || 1));
  }
  const isCommon = (t) => nDocs >= 4 && termDocShare.get(t) > o.commonDocShare;
  // Coverage weights. Common words and verbs count half: "заявление",
  // "работник", "оформить" say little about which regulation is meant.
  // Words no regulation uses at all:
  //   verb ("пустить", "посеял")      -> 0, colloquial, carries no topic;
  //   number ("7000")                  -> 0, a detail of the case;
  //   adjective ("декретный")          -> 1, names a kind of thing the corpus lacks;
  //   other ("Казань", "конференция")  -> 0.5, often a detail, sometimes the topic.
  // (a word that stands only in a title or a file name is known too)
  const knownTerm = new Map(qTerms.map((t) => [t, [...groups.get(t)].some((g) => chunkBm25.has(g) || docBm25.has(g))]));
  const known = (t) => knownTerm.get(t);
  const weightOf = new Map(qDetailed.map((x) => {
    let w;
    if (x.num) w = 0;
    else if (!known(x.t)) w = x.verb ? 0 : (x.adj ? 1 : 0.5);
    else w = isCommon(x.t) || x.verb ? 0.5 : 1;
    return [x.t, w];
  }));
  const weight = (t) => weightOf.get(t);
  // "декретный отпуск", "больничный лист": the noun matches, but it is
  // qualified by an adjective the corpus never uses, so the regulation is
  // probably about another kind of "отпуск". Such a noun counts half.
  const qualified = new Set(qDetailed.filter((x) => x.adj && !known(x.t) && x.next).map((x) => x.next));
  const totalW = qTerms.reduce((s, t) => s + weight(t), 0) || 1;
  // Coverage = weighted share of the query words that pass `has`.
  const coverageOf = (has) => qTerms
    .filter(has)
    .reduce((s, t) => s + weight(t) * (qualified.has(t) ? 0.5 : 1), 0) / totalW;
  // Which documents contain each query word (any form, synonyms included),
  // and the coverage of every document, summed in query-word order.
  const docHas = new Map();
  const docCoverage = new Float64Array(nDocs);
  for (const t of qTerms) {
    const has = new Uint8Array(nDocs);
    for (const g of groups.get(t)) docBm25.stamp(g, has, 1);
    docHas.set(t, has);
    const w = weight(t) * (qualified.has(t) ? 0.5 : 1);
    for (let di = 0; di < nDocs; di++) if (has[di]) docCoverage[di] += w;
  }

  // "About": is the document about what is asked, or does it merely mention
  // it? A specific query word counts when it stands in the title, the file
  // name or a heading of the document, or is used in it often enough: three
  // times in a regulation of usual size, more in a long one (a budget order
  // of 5000 words names "стипендии" and "аспирантура" among its lines without
  // being about either).
  // A verb names the topic only when some document is titled with it
  // ("скорректировать" -> «инструкция по корректировке смет», "перевестись"
  // -> «Порядок перевода»): it counts half, and only through the title.
  const spec = new Map();
  const titleOnly = new Set();
  let specTotal = 0;
  for (const x of qDetailed) {
    if (x.num || spec.has(x.t)) continue;
    let sp = known(x.t) ? 1 - termDocShare.get(x.t) : 0.5;
    if (sp < 0.25) continue; // a word most documents use says nothing about the topic
    if (verbTerm.has(x.t)) {
      const g = [...groups.get(x.t)];
      if (!o.verbAbout || !known(x.t) || !store.titleVocab.some((tv) => g.some((e) => tv.has(e)))) continue;
      sp *= o.verbAbout;
      titleOnly.add(x.t);
    }
    spec.set(x.t, sp);
    specTotal += sp;
  }
  const formCue = FORM_CUE.test(question);
  const about = new Map();
  // The same for ranking, where a title says more than a heading or a count:
  // of two regulations that both speak of "техническая поддержка" the one
  // named after it is meant. The thresholds below keep the plain value.
  const aboutRank = new Map();
  index.docs.forEach((d, di) => {
    if (!specTotal) { about.set(d.id, 0); aboutRank.set(d.id, 0); return; }
    const av = store.aboutVocab[di];
    const tv = store.titleVocab[di];
    const need = Math.max(3, o.aboutPer ? docBm25.len[di] / o.aboutPer : 0);
    let sum = 0;
    let inTitle = 0;
    for (const [t, sp] of spec) {
      let sat = 0;
      let tf = 0;
      if ([...groups.get(t)].some((g) => tv.has(g))) { sum += sp; inTitle += sp; continue; }
      if (titleOnly.has(t)) continue;
      for (const g of groups.get(t)) {
        if (av.has(g)) { sat = 1; break; }
        tf += docBm25.tfOf(g, di);
      }
      if (!sat) {
        const full = store.abbr.get(t);
        if (full && [...full].every((e) => av.has(e))) sat = 1;
        else if (tf >= need) sat = 1;
        else if (tf >= 2 && tf >= need * 2 / 3) sat = 0.5;
      }
      sum += sp * sat;
    }
    const nodes = (d.report && d.report.nodes) || null;
    const form = nodes && !nodes.clause && nodes.row > 0;
    const prior = form && !formCue ? o.formPrior : 1;
    about.set(d.id, (sum / specTotal) * prior);
    aboutRank.set(d.id, ((inTitle + o.bodyAbout * (sum - inTitle)) / specTotal) * prior);
  });

  const bm25Doc = new Map();
  const bm25Agg = new Map();
  const coverage = new Map();
  const denseDoc = new Map();
  index.docs.forEach((d, di) => {
    bm25Doc.set(d.id, docScoresArr[di]);
    // three best clause scores of the document
    const idxs = docChunks.get(d.id);
    let c0 = -Infinity;
    let c1 = -Infinity;
    let c2 = -Infinity;
    let best = 0;
    for (let k = 0; k < idxs.length; k++) {
      const v = chunkScores[idxs[k]];
      if (v > c0) { c2 = c1; c1 = c0; c0 = v; } else if (v > c1) { c2 = c1; c1 = v; } else if (v > c2) c2 = v;
      if (dense) best = Math.max(best, dense[idxs[k]]);
    }
    const n = idxs.length;
    bm25Agg.set(d.id, (n > 0 ? c0 || 0 : 0) + 0.5 * (n > 1 ? c1 || 0 : 0) + 0.25 * (n > 2 ? c2 || 0 : 0));
    coverage.set(d.id, docCoverage[di] / totalW);
    if (dense) denseDoc.set(d.id, best);
  });

  // Documents are few and the margins say more than the ranks, so the
  // signals are blended as values: BM25 and dense scaled to their best
  // document, coverage and "about" as they are (both already 0..1).
  const maxOf = (m) => { let x = 0; for (const v of m.values()) if (v > x) x = v; return x || 1; };
  const parts = [[bm25Doc, o.blend[0], maxOf(bm25Doc)], [bm25Agg, o.blend[1], maxOf(bm25Agg)], [coverage, o.blend[2], 1]];
  if (specTotal) parts.push([aboutRank, o.blend[3], 1]);
  if (dense) parts.push([denseDoc, 0.3, maxOf(denseDoc)]);
  const wSum = parts.reduce((x, part) => x + part[1], 0);
  const fused = new Map(docIds.map((id) => [id, parts.reduce((x, part) => x + part[1] * (part[0].get(id) / part[2]), 0) / wSum]));
  const rankedDocs = docIds
    .filter((id) => bm25Doc.get(id) > 0 || (dense && denseDoc.get(id) > 0))
    .sort((a, b) => fused.get(b) - fused.get(a))
    .map((id) => ({
      docId: id,
      title: store.docById.get(id).title,
      score: +fused.get(id).toFixed(5),
      bm25: +bm25Doc.get(id).toFixed(3),
      clauseBm25: +bm25Agg.get(id).toFixed(3),
      coverage: +coverage.get(id).toFixed(3),
      about: +about.get(id).toFixed(3),
      dense: dense ? +denseDoc.get(id).toFixed(3) : null,
    }));

  // An edition that is no longer in force gives way to the one that replaced
  // it, unless the question is about the past or names the old act.
  const outdated = [];
  if (!opts.includeOutdated && !HISTORY.test(question)) {
    for (let i = 0; i < rankedDocs.length; i++) {
      const old = rankedDocs[i];
      const m = store.docById.get(old.docId).meta;
      if (!m || !m.supersededBy || !OUTDATED.has(m.status)) continue;
      if (m.number && question.includes(m.number)) continue;
      const j = rankedDocs.findIndex((d) => d.docId === m.supersededBy);
      if (j < 0) continue;
      if (j > i) {
        const [cur] = rankedDocs.splice(j, 1);
        cur.score = Math.max(cur.score, old.score);
        rankedDocs.splice(i, 1, cur);
      } else rankedDocs.splice(i, 1);
      outdated.push({ docId: old.docId, supersededBy: m.supersededBy });
      i--;
    }
  }

  if (!rankedDocs.length) {
    return { notFound: true, reason: 'no_match', qTerms, docs: [], context: [], warnings };
  }

  // --- Stage 2: clauses inside a document (doc-local BM25 + dense)
  function rankClauses(docId) {
    const { idxs, bm25 } = localBm25(store, docId);
    const local = bm25.scores(weighted);
    const bm = new Map(idxs.map((i, k) => [i, local[k]]));
    if (TIME_QUESTION.test(question || '')) {
      for (const i of idxs) if (bm.get(i) > 0 && CLOCK.test(store.index.chunks[i].text)) bm.set(i, bm.get(i) * 1.6);
    }
    const lists2 = [rankOf(bm, idxs)];
    if (dense) lists2.push(rankOf(new Map(idxs.map((i) => [i, dense[i]])), idxs));
    const f = rrf(lists2, idxs, o.rrfK);
    return idxs
      .filter((i) => f.get(i) > 0)
      .sort((a, b) => f.get(b) - f.get(a))
      .map((i) => ({ i, fused: f.get(i), bm25: bm.get(i), dense: dense ? dense[i] : null }));
  }

  const primary = rankedDocs[0];
  const primaryIdx = store.docIdx.get(primary.docId);
  const clauses = rankClauses(primary.docId);
  const top3 = clauses.slice(0, 3).map((c) => c.i);
  const chunkCov = coverageOf((t) => [...groups.get(t)].some((g) => top3.some((i) => chunkBm25.tfOf(g, i) > 0)));
  // Anchor: at least one non-verb query word that is specific to this
  // regulation: in its title, or matched through a word few documents use.
  const shareOf = (g) => (docBm25.df.get(g) || 0) / (nDocs || 1);
  const titleV = store.titleVocab[primaryIdx];
  // A verb counts too when the title has it ("перевестись" -> «Порядок перевода»).
  const anchorMatched = qTerms.some((t) => weight(t) > 0 && [...groups.get(t)].some((g) => titleV.has(g)
      || (!verbTerm.has(t) && docBm25.tfOf(g, primaryIdx) > 0 && (nDocs < 4 || shareOf(g) <= o.commonDocShare)))
      // an abbreviation whose expansion is in the title ("ФЛС" -> «финансового лицевого счета»)
      || (weight(t) > 0 && store.abbr.get(t) && [...store.abbr.get(t)].every((e) => titleV.has(e))))
    || qTerms.filter((t) => !isCommon(t) && docHas.get(t)[primaryIdx]).length >= 2;

  const detail = new Map(qDetailed.map((x) => [x.t, x]));
  // verb forms the stemmer does not mark (завести, собираюсь) and comparatives (младше, старше)
  // and past tense (пришло), and «верно / правильно» of a yes-no question
  const NOT_SUBJECT = /(?:[сз]ти|чь|[юуая]сь|[её]шься|[иы]шь|ше|ее|л[аои]?|^верно|^правильно)$/;
  const unknownSubject = qTerms.filter((t) => !known(t) && !detail.get(t).verb && !detail.get(t).adj && !detail.get(t).num && !NOT_SUBJECT.test(detail.get(t).w || '')
    && (t.length >= 4 || /[a-z]/.test(t)));
  const diagnostics = {
    unknownSubject,
    coverage: primary.coverage,
    chunkCoverage: +chunkCov.toFixed(3),
    anchorMatched,
    qTerms,
    verbs: [...verbTerm],
    common: qTerms.filter(isCommon),
    weights: Object.fromEntries(qTerms.map((t) => [t, weight(t)])),
    qualified: [...qualified],
    expansions: [...weighted.keys()].filter((t) => !qTerms.includes(t)),
    synonyms: synonymsUsed,
    unknownTerms: qTerms.filter((t) => !known(t)),
    dense: !!dense,
  };

  let notFound = false;
  let reason = null;
  // The document is clearly about the topic and well ahead of the others:
  // a word of the question it lacks ("заявка" where it says "записка") is forgiven.
  const runnerUp = rankedDocs[1];
  const clearLead = specTotal > 0 && primary.about >= 0.55 && (!runnerUp || primary.score >= 1.1 * runnerUp.score);
  if (primary.coverage < o.minCoverage * (clearLead ? 0.7 : 1)) { notFound = true; reason = 'low_coverage'; }
  else if (chunkCov < o.minChunkCoverage) { notFound = true; reason = 'low_clause_coverage'; }
  else if (specTotal && primary.about < o.minAbout) { notFound = true; reason = 'not_about'; }
  else if (!anchorMatched) { notFound = true; reason = 'only_common_terms'; }
  // Precision first: a subject word of the question that no loaded regulation
  // uses at all («ГИБДД», «ОСАГО», «сантехник») means the topic is not covered;
  // answering from the nearest document would be a guess.
  // (in a base of a handful of short documents a missing word says little)
  else if (unknownSubject.length && nDocs >= 10) { notFound = true; reason = 'unknown_term'; }

  // Context for the generator: best section block + top clauses, primary doc first.
  const ctx = selectContext(store, primary.docId, clauses, o.contextSize, qTerms, groups, question, o.leadRatio, o.entryClauses);
  const docsInContext = [primary.docId];
  const second = rankedDocs[1];
  if (second && second.score >= primary.score * o.secondDocRatio && second.coverage >= o.minCoverage) {
    const c2 = rankClauses(second.docId).filter((c) => c.bm25 > 0).slice(0, 4);
    c2.sort((a, b) => index.chunks[a.i].order - index.chunks[b.i].order);
    for (const c of c2) ctx.push({ i: c.i, score: c.fused, bm25: c.bm25, dense: c.dense, block: false });
    if (c2.length) docsInContext.push(second.docId);
  }

  const context = ctx.map((c) => ({
    ...index.chunks[c.i],
    score: +c.score.toFixed(5),
    bm25: +c.bm25.toFixed(3),
    dense: c.dense == null ? null : +c.dense.toFixed(3),
    inBestSection: !!c.block,
    sectionRank: c.section == null ? null : c.section,
    lead: !!c.lead,
  }));

  // Close call between two regulations -> suggest a clarifying question
  let ambiguity = null;
  if (second && second.score >= primary.score * o.ambiguityRatio && second.coverage >= primary.coverage - 0.05
    && second.bm25 >= 0.75 * primary.bm25) {
    ambiguity = [primary.title, second.title];
  }

  return { notFound, reason, qTerms, groups, docs: rankedDocs, primary, context, docsInContext, ambiguity, outdated, diagnostics, warnings };
}

// Group clauses of one document by section (top-level heading) and pick the
// section most likely to hold the answer: best clause score + a bit of the
// rest, boosted when the section heading itself matches the question, damped
// for "Общие положения"-like sections. For "how do I" questions whose words
// mostly hit general provisions, a procedural section ("Порядок ...",
// "Оформление ...") is added: procedure steps rarely repeat the question.
// Chosen sections are returned whole (rank 0, 1, ...), then the remaining
// top-scoring clauses, up to `size`.
function selectContext(store, docId, ranked, size, qTerms, groups, question, leadRatio = 0.8, entries = 2) {
  const { index } = store;
  if (!ranked.length) return [];
  // An order often carries the whole regulation as its appendix: then the
  // sections are one level down ("Приложение" > "5 Режим работы ...").
  const sectionOf = (i) => {
    const p = index.chunks[i].path;
    return (APPENDIX.test(p[0] || '') && p[1] ? p[0] + ' / ' + p[1] : p[0]) || '';
  };
  const definition = DEFINITION_QUESTION.test(question || '');
  const fact = FACT_QUESTION.test(question || '');
  const allIdx = store.docChunks.get(docId);
  const sections = [...new Set(allIdx.map(sectionOf))];
  const bySection = new Map(sections.map((s) => [s, []]));
  for (const c of ranked) bySection.get(sectionOf(c.i)).push(c);
  // Unnumbered paragraphs (the header of an order, its title, "В целях ...")
  // repeat the name of the document and match any question about it; a
  // section is judged by its clauses.
  const isPara = (i) => index.chunks[i].kind === 'para';
  const scored = sections.map((s) => {
    const inSection = bySection.get(s);
    const numbered = inSection.filter((c) => !isPara(c.i));
    const cs = numbered.length ? numbered : inSection;
    const sc0 = cs.map((c) => c.bm25).sort((x, y) => y - x);
    let sc = (sc0[0] || 0) + 0.5 * (sc0[1] || 0) + 0.25 * (sc0[2] || 0);
    const head = new Set(tokens(s));
    const headHits = qTerms.filter((t) => [...groups.get(t)].some((g) => head.has(g))).length;
    sc *= 1 + headHits / qTerms.length;
    // "кто такой ...", "что такое ...": the answer is a definition
    const general = !definition && GENERAL_SECTION.test(s);
    if (general) sc *= 0.5;
    return { s, sc, general, headShare: headHits / qTerms.length, procedural: !general && PROCEDURAL_SECTION.test(s) };
  }).sort((x, y) => y.sc - x.sc);

  const pool = scored.filter((x) => !x.general && x.sc > 0);
  const ordered = pool.length ? pool : scored;
  const best = [ordered[0]];
  if (ordered[1] && ordered[1].sc > 0 && ordered[1].sc >= 0.75 * ordered[0].sc) best.push(ordered[1]);
  // Twin sections: a general case and a special one in the same words, so
  // their best clauses score the same and the longer section wins on mass
  // alone. The general case stands first in a regulation and leads. Twins
  // are told by almost the same heading, or the runner-up by its total.
  const top = (x) => Math.max(0, ...bySection.get(x.s).map((c) => c.bm25));
  const top0 = top(best[0]);
  const headWords = (x) => new Set(tokens(x.s).filter((t) => !/^[0-9]+$/.test(t))); // without the section number
  const head0 = headWords(best[0]);
  const alike = (x) => {
    const h = headWords(x);
    const shared = [...h].filter((t) => head0.has(t)).length;
    return shared >= 3 && shared >= 0.4 * Math.min(h.size, head0.size);
  };
  const twin = ordered.find((x) => x !== best[0] && x.sc > 0 && sections.indexOf(x.s) < sections.indexOf(best[0].s)
    && Math.abs(top(x) - top0) <= 0.05 * Math.max(top(x), top0) && (best.includes(x) || alike(x)));
  if (twin) best.splice(0, best.length, twin, ...best.filter((x) => x !== twin).slice(0, 1));
  // Only when the question's words point at general provisions (scope, "за
  // счёт средств института") rather than at a specific section.
  const topGeneral = GENERAL_SECTION.test(sectionOf(ranked[0].i));
  if (!fact && !definition && !best.some((x) => x.procedural) && (topGeneral || best[0].sc === 0)) {
    const proc = scored.find((x) => x.procedural && !best.includes(x));
    if (proc) best.push(proc);
  }
  const rankOfSection = new Map(best.map((x, k) => [x.s, k]));

  // whole chosen sections, including zero-score clauses
  const scoreOf = new Map(ranked.map((c) => [c.i, c]));
  const entry = (i, blockRank) => {
    const r = scoreOf.get(i);
    return { i, score: r ? r.fused : 0, bm25: r ? r.bm25 : 0, dense: r ? r.dense : null, block: blockRank != null, section: blockRank, lead: leads.has(i) };
  };
  // Direct hits: the clauses that match the question about as well as the
  // best one. They are kept whatever section was chosen. General provisions
  // only for questions about a fact or a definition: a procedure is not there.
  const eligible = ranked
    .filter((c) => c.bm25 > 0 && !isPara(c.i) && (fact || definition || !GENERAL_SECTION.test(sectionOf(c.i))))
    .sort((x, y) => y.bm25 - x.bm25);
  const bestBm = eligible.length ? eligible[0].bm25 : 0;
  const leads = new Set(eligible.filter((c) => c.bm25 >= leadRatio * bestBm).slice(0, 3).map((c) => c.i));
  // "Как получить ...", "как оформить ...": the words of such a question
  // name the regulation and stand in every clause of it. What the employee
  // needs is where the procedure starts: the first clauses of the chosen
  // sections in which an application is filed, or, if they have none, the
  // first such clause of the document.
  if (!fact && !definition && entries > 0) {
    const filed = eligible
      .filter((c) => ENTRY_CUE.test(index.chunks[c.i].text))
      .sort((x, y) => index.chunks[x.i].order - index.chunks[y.i].order);
    const inside = filed.filter((c) => rankOfSection.has(sectionOf(c.i)));
    for (const c of inside.length ? inside.slice(0, entries) : filed.slice(0, 1)) leads.add(c.i);
  }
  let block = allIdx
    .filter((i) => rankOfSection.has(sectionOf(i)) && index.chunks[i].kind !== 'para')
    .map((i) => entry(i, rankOfSection.get(sectionOf(i))));
  if (!block.length) block = allIdx.filter((i) => rankOfSection.has(sectionOf(i))).map((i) => entry(i, rankOfSection.get(sectionOf(i))));
  if (block.length > size) {
    block = block.slice().sort((x, y) => x.section - y.section || y.score - x.score).slice(0, size);
  }
  const chosen = new Set(block.map((x) => x.i));
  const extra = [];
  for (const c of ranked) {
    if (chosen.size + extra.length >= size) break;
    if (chosen.has(c.i) || c.bm25 <= 0) continue;
    extra.push(entry(c.i, null));
  }
  // direct hits come on top of `size`: the chosen section is not cut for them
  for (const i of leads) if (!chosen.has(i) && !extra.some((x) => x.i === i)) extra.push(entry(i, null));
  const byOrder = (x, y) => index.chunks[x.i].order - index.chunks[y.i].order;
  return [...block.sort(byOrder), ...extra.sort(byOrder)];
}

module.exports = { retrieve, DEFAULTS, rankOf, rrf, neighbours, expandQuery, buildVocabIndex };
