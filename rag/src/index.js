'use strict';
// Public API.
//   const rag = require('./src');            // or require('mipt-reg-rag')
//   await rag.ingest(['corpus/text'], { out: 'data/index.json' });
//   const answer = await rag.ask('Как оформить командировку?', { indexPath: 'data/index.json' });

const fs = require('node:fs');
const path = require('node:path');
const { buildIndex, saveIndex, loadIndex, prepare } = require('./store');
const { retrieve } = require('./retrieve');
const { generateWithLlm, extractiveSteps, stepAttributes, trimSentence } = require('./generate');
const { verifyStep, buildCiteResolver } = require('./verify');
const { llmConfig } = require('./openai');
const { ruDate } = require('./meta');
const { tokens } = require('./text');

const DEFAULT_INDEX = process.env.RAG_INDEX || path.join(__dirname, '..', 'data', 'index.json');
const NOT_FOUND_MESSAGE = 'В загруженных документах нет информации, достаточной для ответа на этот вопрос.';

const cache = new Map(); // indexPath -> { mtimeMs, store }

function getStore(opts = {}) {
  if (opts.store) return opts.store;
  if (opts.index) return prepare(opts.index);
  const file = path.resolve(opts.indexPath || DEFAULT_INDEX);
  const st = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.store;
  const store = loadIndex(file);
  cache.set(file, { mtimeMs: st.mtimeMs, store });
  return store;
}

async function ingest(inputs, opts = {}) {
  const index = await buildIndex(inputs, opts);
  const out = path.resolve(opts.out || DEFAULT_INDEX);
  saveIndex(index, out);
  cache.delete(out);
  return {
    out,
    docs: index.docs.length,
    chunks: index.chunks.length,
    embeddings: index.embeddings ? { model: index.embeddings.model, dim: index.embeddings.dim } : null,
  };
}

function stepFields(s) {
  const out = {};
  for (const k of ['who', 'deadline', 'form']) if (s[k]) out[k] = s[k];
  return out;
}

function docInfo(store, id) {
  const d = store.docById.get(id);
  if (!d) return null;
  const m = d.meta || {};
  return { id: d.id, title: d.title, url: d.url || null, file: d.file || null, number: m.number || null, date: m.date || null, status: m.status || null };
}

function citeView(r, store) {
  const c = r.chunk;
  return {
    doc: c.docId,
    docTitle: store.docById.get(c.docId).title,
    clause: r.sub ? r.sub.id : c.clauseId,
    label: r.sub ? r.sub.label : c.label,
    quote: r.sub ? r.sub.text : c.text,
    page: c.page || null,
    file: store.docById.get(c.docId).file || null,
  };
}

const TERM_QUESTION = /срок|сколько|когда|как долго|как быстро|за сколько|в течение|дней|дня|времени/i;
const TERM_TEXT = /не позднее|в течение|не менее|не более|за \d|\d+\s*(?:\(|рабоч|календарн|дн|час|месяц|суток)/i;

// Short answer without a model: the sentence of the best matching clause
// that says the most about the question, word for word, with its reference.
// A word of the question counts in any of its forms and synonyms, the same
// way the clauses were found.
function extractiveSummary(question, ret, store, shown) {
  let own = ret.context.filter((c) => c.docId === ret.primary.docId);
  // the short answer quotes one of the clauses listed as steps
  const listed = shown ? own.filter((c) => shown.has(c.clauseId)) : [];
  if (listed.length) own = listed;
  if (!own.length) return null;
  const want = ret.qTerms.map((t) => [...((ret.groups && ret.groups.get(t)) || [t])]);
  const topBm = Math.max(1e-9, ...own.map((c) => c.bm25 || 0));
  const wantsTerm = TERM_QUESTION.test(question);
  let pick = null;
  let from = null;
  let top = -1;
  for (const c of own) {
    const sentences = c.text.replace(/\s*\n\s*/g, ' ').split(/(?<=[.!?])\s+(?=[А-ЯЁ«"(\d])/).map((x) => x.trim()).filter((x) => x.length > 20);
    for (const sent of sentences) {
      const has = new Set(tokens(sent));
      let sc = 0;
      for (const g of want) if (g.some((e) => has.has(e))) sc++;
      if (wantsTerm && TERM_TEXT.test(sent)) sc += 2;
      // equal sentences: the one from the clause that matches the question
      // better; a direct hit is worth one more word
      sc += (0.9 * (c.bm25 || 0)) / topBm + (c.lead ? 1 : 0);
      if (sc > top) { top = sc; pick = sent; from = c; }
    }
  }
  if (!pick) return null;
  const text = pick.length > 420 ? `${pick.slice(0, 420).replace(/\s+\S*$/, '')}…` : pick;
  return { text, cite: citeView({ chunk: from, sub: null }, store) };
}

// Clauses of the other regulations that got into the context: shown next to
// the answer as "see also", each with its own source.
function relatedClauses(ret, store, primaryId) {
  const out = [];
  for (const id of ret.docsInContext) {
    if (id === primaryId) continue;
    const cs = ret.context.filter((c) => c.docId === id).sort((a, b) => (b.bm25 || 0) - (a.bm25 || 0)).slice(0, 2);
    if (cs.length) out.push({ document: docInfo(store, id), cites: cs.map((c) => citeView({ chunk: c, sub: null }, store)) });
  }
  return out;
}

// What the reader must know about the editions of the documents used.
function versionNotices(store, ids) {
  const out = [];
  const name = (id) => { const d = store.docById.get(id); return d ? `«${d.title}»` : id; };
  for (const id of ids) {
    const m = (store.docById.get(id) || {}).meta;
    if (!m) continue;
    if (m.status === 'предыдущая редакция') out.push({ kind: 'outdated', doc: id, text: `${name(id)} — предыдущая редакция. ${m.supersededBy ? `Действует ${name(m.supersededBy)}.` : 'Действующая редакция в загруженной базе не найдена.'}` });
    else if (m.status === 'утратил силу') out.push({ kind: 'outdated', doc: id, text: `${name(id)} утратил силу${m.supersededBy ? `: отменён документом ${name(m.supersededBy)}` : ''}.` });
    else if (m.status === 'изменён') out.push({ kind: 'amended', doc: id, text: `В документ ${name(id)} внесены изменения: ${m.changedBy.map((c) => name(c.doc)).join(', ')}.` });
    else if (m.editions && m.editions.length > 1) {
      const older = m.editions.filter((x) => x !== id);
      out.push({ kind: 'current', doc: id, text: `Ответ дан по действующей редакции${m.effective ? ` (введена с ${ruDate(m.effective)})` : ''}. В базе есть и предыдущая: ${older.map(name).join(', ')}.` });
    }
  }
  return out;
}

function notFoundAnswer(question, base) {
  return {
    question,
    not_found: true,
    message: NOT_FOUND_MESSAGE,
    document: null,
    documents: [],
    steps: [],
    rejected_steps: [],
    clarifying_question: base.clarifying_question || null,
    ...base,
  };
}

/**
 * Answer an employee's task description.
 * opts: indexPath | store | index, mode ('auto'|'llm'|'extractive'),
 *       verifier ('drop'|'flag'), minSupport, maxSteps, minCoverage, minChunkCoverage,
 *       llmBaseUrl/llmModel/llmApiKey, embedBaseUrl/embedModel/embedApiKey, debug
 */
async function ask(question, opts = {}) {
  const t0 = Date.now();
  const store = getStore(opts);
  const q = String(question || '').trim();
  const ret = await retrieve(store, q, opts);
  const t1 = Date.now();
  const candidates = ret.docs.slice(0, 3).map((d) => ({ id: d.docId, title: d.title, score: d.score, coverage: d.coverage }));
  const cfg = llmConfig(opts);
  const wantLlm = opts.mode === 'llm' || (opts.mode !== 'extractive' && !!cfg);
  const warnings = [...ret.warnings];
  const diagnostics = { retrieval: ret.diagnostics || null, reason: ret.reason || null, timings: { retrieveMs: t1 - t0 } };

  if (ret.notFound) {
    let clarifying = null;
    let nearest = [];
    if (ret.reason === 'empty_query') clarifying = 'Опишите, пожалуйста, задачу подробнее: что именно нужно сделать?';
    // Partly matching regulations: say "not found", but name the nearest ones.
    else if (ret.primary && ret.primary.coverage >= 0.4) {
      const tied = ret.docs.filter((d) => d.coverage >= ret.primary.coverage - 0.05).slice(0, 3);
      // the nearest regulations go as links, so the employee can open them
      nearest = (tied.length >= 2 ? tied : [ret.primary]).map((d) => ({ id: d.docId, title: d.title }));
      clarifying = tied.length >= 2
        ? `Похожие слова встречаются в документах: ${tied.map((d) => `«${d.title}»`).join(', ')}. Если вопрос относится к одному из них, уточните формулировку.`
        : `Возможно, вопрос относится к документу «${ret.primary.title}»? Уточните, пожалуйста, задачу.`;
    }
    return notFoundAnswer(q, { mode: wantLlm && cfg ? 'llm' : 'extractive', candidates, nearest, diagnostics, warnings, clarifying_question: clarifying });
  }

  const slots = new Map(ret.docsInContext.map((id, k) => [id, `D${k + 1}`]));
  const resolve = buildCiteResolver(ret.context, slots);
  const docsById = store.docById;

  let mode = 'extractive';
  let raw = null;
  let llmNotFound = false;
  let clarifying = null;
  let docSlot = null;
  let candidateSteps = null;

  // A document closed to guests never leaves for an external model.
  const closed = cfg && cfg.external && typeof opts.mayLeave === 'function'
    ? ret.docsInContext.filter((id) => !opts.mayLeave(id)) : [];
  if (wantLlm && closed.length) {
    warnings.push('internal documents in the context: answered without the language model');
    diagnostics.llmSkipped = 'internal';
  } else if (wantLlm) {
    if (!cfg) {
      warnings.push('mode=llm requested but LLM_BASE_URL is not set; using extractive mode');
    } else {
      try {
        const g = await generateWithLlm(q, ret.context, docsById, slots, cfg);
        raw = g.answer;
        mode = 'llm';
        llmNotFound = raw.not_found === true;
        clarifying = typeof raw.clarifying_question === 'string' && raw.clarifying_question.trim() ? raw.clarifying_question.trim() : null;
        docSlot = typeof raw.document === 'string' ? raw.document.trim().toUpperCase() : null;
        candidateSteps = Array.isArray(raw.steps) ? raw.steps : [];
        if (opts.debug) diagnostics.llmRaw = g.rawContent;
      } catch (e) {
        warnings.push(`LLM failed, extractive fallback: ${e.message}`);
        diagnostics.llmUnavailable = true;
      }
    }
  }
  diagnostics.timings.generateMs = Date.now() - t1;

  // The model refuses only when it gives neither steps nor a short answer;
  // a short answer with no steps gets the clauses themselves as steps.
  const llmHasSummary = Boolean(raw && raw.summary && typeof raw.summary === 'object' && typeof raw.summary.text === 'string' && raw.summary.text.trim());
  if (mode === 'llm' && llmNotFound && !candidateSteps.length && !llmHasSummary) {
    return notFoundAnswer(q, { mode, candidates, diagnostics, warnings, clarifying_question: clarifying, reason_detail: 'llm_not_found' });
  }
  if (mode === 'llm' && candidateSteps && !candidateSteps.length) {
    warnings.push('the model gave no steps; clauses are shown as steps');
    candidateSteps = null;
    mode = 'llm+extractive';
  }

  if (!candidateSteps) {
    // under the model's short answer only the few clauses that carry it, not a page of raw text
    const maxSteps = mode === 'llm+extractive' ? Math.min(3, opts.maxSteps || 3) : (opts.maxSteps || 8);
    let picked = extractiveSteps(ret.context, { maxSteps, primaryDocId: ret.primary.docId });
    if (mode === 'llm+extractive') {
      // first the clauses the short answer itself cites, then the best of the rest
      const cited = (Array.isArray(raw.summary.cites) ? raw.summary.cites : [])
        .map(resolve).filter(Boolean).map((r) => r.chunk);
      const own = [...new Set(cited)].map((c) => ({ text: trimSentence(c.text), cites: [c.clauseId], ...stepAttributes(c.text), _chunk: c }));
      picked = [...own, ...picked.filter((s) => !cited.includes(s._chunk))];
    }
    candidateSteps = picked.slice(0, maxSteps)
      .map((s) => ({ ...stepFields(s), text: s.text, cites: [`${slots.get(s._chunk.docId)}:${s._chunk.clauseId}`] }));
  }

  const steps = [];
  const rejected = [];
  const verifiedCites = [];
  const policy = opts.verifier || 'drop';
  for (const s of candidateSteps.slice(0, opts.maxSteps || 8)) {
    const v = verifyStep(s, resolve, opts);
    const view = {
      text: v.text,
      cites: v.resolved.map((r) => citeView(r, store)),
      verified: v.ok,
      support: v.support,
      ...v.fields,
    };
    if (v.reasons.length) view.issues = v.reasons;
    if (v.ok) { steps.push(view); if (mode === 'llm') verifiedCites.push(...(Array.isArray(s.cites) ? s.cites : [s.cites])); }
    else {
      rejected.push({ ...view, raw_cites: s.cites, unsupported_terms: v.unsupported });
      if (policy === 'flag') steps.push(view);
    }
  }

  // Everything the LLM wrote was rejected: fall back to verbatim clauses.
  if (mode === 'llm' && !steps.some((s) => s.verified) && rejected.length) {
    warnings.push('all LLM steps failed verification; extractive fallback');
    const ex = extractiveSteps(ret.context, { maxSteps: opts.maxSteps || 8, primaryDocId: ret.primary.docId });
    for (const s of ex) {
      const v = verifyStep({ ...stepFields(s), text: s.text, cites: [`${slots.get(s._chunk.docId)}:${s._chunk.clauseId}`] }, resolve, opts);
      if (v.ok) steps.push({ text: s.text, cites: v.resolved.map((r) => citeView(r, store)), verified: true, support: v.support, ...v.fields, fallback: true });
    }
    mode = 'llm+extractive';
  }

  steps.forEach((s, k) => { s.n = k + 1; });
  if (!steps.length) {
    return notFoundAnswer(q, { mode, candidates, diagnostics, warnings, rejected_steps: rejected, clarifying_question: clarifying });
  }

  // Primary document: what the steps actually cite, majority vote.
  const votes = new Map();
  for (const s of steps) for (const c of s.cites) votes.set(c.doc, (votes.get(c.doc) || 0) + 1);
  let primaryId = ret.primary.docId;
  if (votes.size) primaryId = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  if (docSlot && mode === 'llm') {
    const bySlot = [...slots.entries()].find(([, sl]) => sl === docSlot);
    if (bySlot && votes.has(bySlot[0])) primaryId = bySlot[0];
  }

  if (!clarifying && ret.ambiguity) {
    clarifying = `Уточните, пожалуйста, о чём речь: «${ret.ambiguity[0]}» или «${ret.ambiguity[1]}»?`;
  }

  diagnostics.timings.totalMs = Date.now() - t0;
  const answer = {
    question: q,
    not_found: false,
    message: null,
    document: docInfo(store, primaryId),
    documents: [...votes.keys()].map((id) => docInfo(store, id)),
    steps,
    rejected_steps: policy === 'flag' ? rejected : rejected,
    clarifying_question: clarifying,
    summary: null,
    summary_cite: null,
    related: relatedClauses(ret, store, primaryId),
    notices: versionNotices(store, [...votes.keys()]),
    mode,
    candidates,
    diagnostics,
    warnings,
  };
  // The model's short answer is checked like a step: it must follow from the
  // clause it cites, otherwise the extract is shown instead.
  // A summary may retell several steps, so the clauses of the verified steps
  // count as its support too; it links to the clause it named itself.
  const llmSummary = mode.startsWith('llm') && raw && raw.summary && typeof raw.summary === 'object' ? raw.summary : null;
  const own = llmSummary && Array.isArray(llmSummary.cites) ? llmSummary.cites : [];
  const sv = llmSummary && typeof llmSummary.text === 'string' && own.length
    ? verifyStep({ text: llmSummary.text, cites: [...own, ...verifiedCites] }, resolve, opts) : null;
  const ownRef = sv && own.map(resolve).find(Boolean);
  if (sv && sv.ok && ownRef) {
    answer.summary = sv.text;
    answer.summary_cite = citeView(ownRef, store);
  } else {
    if (sv) diagnostics.summaryRejected = sv.reasons;
    const shown = new Set(steps.flatMap((st) => st.cites.filter((c) => c.doc === ret.primary.docId).map((c) => c.clause)));
    const sum = extractiveSummary(q, ret, store, shown);
    if (sum) { answer.summary = sum.text; answer.summary_cite = sum.cite; }
  }
  if (opts.debug) answer.context = ret.context;
  return answer;
}

// Plain-text rendering for CLI / logs.
function formatAnswer(a) {
  const out = [];
  if (a.not_found) {
    out.push(a.message || NOT_FOUND_MESSAGE);
    if (a.clarifying_question) out.push(a.clarifying_question);
    if (a.candidates && a.candidates.length) out.push(`(ближайшие документы: ${a.candidates.map((c) => `«${c.title}»`).join(', ')})`);
    return out.join('\n');
  }
  out.push(`Документ: «${a.document.title}»${a.document.url ? ` — ${a.document.url}` : ''}`);
  for (const s of a.steps) {
    const refs = s.cites.map((c) => (c.doc === a.document.id ? c.label : `${c.label} «${c.docTitle}»`)).join('; ');
    out.push(`${s.n}. ${s.text}${s.verified ? '' : ' [НЕ ПОДТВЕРЖДЁН]'}  (${refs})`);
    const meta = [s.who && `кто: ${s.who}`, s.deadline && `срок: ${s.deadline}`, s.form && `документ: ${s.form}`].filter(Boolean);
    if (meta.length) out.push(`   ${meta.join('; ')}`);
  }
  if (a.clarifying_question) out.push(`Уточнение: ${a.clarifying_question}`);
  if (a.rejected_steps && a.rejected_steps.length) out.push(`(отклонено проверкой: ${a.rejected_steps.length})`);
  out.push(`[режим: ${a.mode}]`);
  return out.join('\n');
}

module.exports = { ask, ingest, getStore, formatAnswer, retrieve, NOT_FOUND_MESSAGE, DEFAULT_INDEX, prepare };
