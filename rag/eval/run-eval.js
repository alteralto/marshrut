#!/usr/bin/env node
'use strict';
// Evaluation over a question set.
//   node eval/run-eval.js --questions fixtures/eval-questions.json --index data/fixtures-index.json
//        [--docs fixtures/docs]   re-ingest into --index first
//        [--mode auto|llm|extractive] [--out eval/results/run.json] [--verbose]
//
// Question format (see fixtures/eval-questions.json):
//   { id, question, doc, clauses: ["2.1", ...] }        answerable
//   { id, question, answerable: false }                 nothing applies
//   { id, question, ambiguous: true, doc_any: [...] }   needs a clarifying question
//
// Metrics
//   doc hit@1        answer.document is the expected regulation (answerable only)
//   doc hit@3        expected regulation among the top-3 retrieved documents
//   clause recall    share of expected clauses cited by the returned steps
//   context recall   share of expected clauses present in the retrieved context
//   false not_found  answerable questions answered "не найдено"
//   not_found acc.   unanswerable questions answered "не найдено"
//   ambiguous        clarifying question asked (or a doc from doc_any returned)
//   verifier         rejection rate of generated steps, plus a stress test:
//                    synthetic corruptions of accepted steps (invented step,
//                    changed number, cite outside the context, flipped
//                    negation, text from another regulation) must be rejected,
//                    the original steps must still pass.

const fs = require('node:fs');
const path = require('node:path');
const rag = require('../src');
const { retrieve } = require('../src/retrieve');
const { buildCiteResolver, verifyStep } = require('../src/verify');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[k] = v;
  }
  return out;
}

// expected "2.2" is covered by a cite of "2.2", "2.2(а)" or "2.2.1"
function covers(citeId, expected) {
  const c = String(citeId).toLowerCase();
  const e = String(expected).toLowerCase();
  return c === e || c.startsWith(`${e}(`) || c.startsWith(`${e}.`);
}

const INVENTED = [
  'Получите в профкоме справку о составе семьи и согласуйте её с ректором.',
  'Оплатите государственную пошлину через портал Госуслуг и приложите квитанцию.',
  'Направьте запрос в Министерство науки и высшего образования через канцелярию.',
  'Пройдите инструктаж по охране труда в службе безопасности кампуса.',
];

function changeNumber(text) {
  if (/\d+/.test(text)) return text.replace(/\d+/, (d) => String(Number(d) + 7));
  const swapped = text.replace(/(^|[^а-яё])(одного|один|одну|двух|два|две|трёх|трех|три|пяти|пять|десяти)(?![а-яё])/i, '$1семи');
  if (swapped !== text) return swapped;
  return `${text.replace(/[.;]\s*$/, '')} в течение 7 рабочих дней.`;
}

function negate(text) {
  const re = /(^|\s)([а-яё]+(?:ет|ит|ют|ят|ется|ится|ются|ятся|ается|яется))(?=[\s,.;]|$)/i;
  if (!re.test(text)) return null;
  return text.replace(re, (m, sp, w) => `${sp}не ${w}`);
}

async function main() {
  const a = args(process.argv.slice(2));
  const qFile = a.questions || path.join(__dirname, '..', 'fixtures', 'eval-questions.json');
  const indexPath = a.index || path.join(__dirname, '..', 'data', 'fixtures-index.json');
  if (a.docs) {
    const r = await rag.ingest(String(a.docs).split(','), { out: indexPath });
    console.log(`ingested ${r.docs} docs, ${r.chunks} chunks -> ${r.out}`);
  }
  const qs = JSON.parse(fs.readFileSync(qFile, 'utf8'));
  const questions = Array.isArray(qs) ? qs : qs.questions;
  const store = rag.getStore({ indexPath });
  const mode = a.mode || 'auto';
  // A question may name its document by file name ("file"); null = no answer in the base.
  const idByFile = new Map(store.index.docs.map((d) => [d.file, d.id]));
  for (const q of questions) {
    if (!('file' in q)) continue;
    if (q.file === null) q.answerable = false;
    else if (idByFile.has(q.file)) q.doc = idByFile.get(q.file);
    else throw new Error(`${q.id}: в индексе нет документа «${q.file}»`);
  }

  const rows = [];
  const m = {
    answerable: 0, hit1: 0, hit3: 0, clauseRecall: 0, contextRecall: 0, falseNotFound: 0,
    unanswerable: 0, notFoundOk: 0, ambiguous: 0, ambiguousOk: 0,
    stepsGenerated: 0, stepsRejected: 0, latencyMs: [],
  };
  const stress = { genuine: 0, genuineRejected: 0 };
  const kinds = ['invented', 'number', 'foreign_cite', 'negation', 'other_doc'];
  for (const k of kinds) stress[k] = { total: 0, rejected: 0 };
  const acceptedPool = []; // steps from all answers, for the cross-document swap

  for (const q of questions) {
    const t0 = Date.now();
    const ans = await rag.ask(q.question, { indexPath, mode, debug: true });
    const ms = Date.now() - t0;
    m.latencyMs.push(ms);
    const docId = ans.document ? ans.document.id : null;
    const cited = ans.steps.flatMap((s) => s.cites.map((c) => (c.doc === q.doc ? c.clause : null))).filter(Boolean);
    const ctxIds = (ans.context || []).filter((c) => c.docId === q.doc).flatMap((c) => [c.clauseId, ...(c.subs || []).map((s) => s.id)]);
    const top3 = (ans.candidates || []).map((c) => c.id);
    m.stepsGenerated += ans.steps.length + (ans.rejected_steps || []).length;
    m.stepsRejected += (ans.rejected_steps || []).length;
    const row = { id: q.id, question: q.question, got: docId, not_found: ans.not_found, clarify: ans.clarifying_question || null, mode: ans.mode, ms };

    if (q.ambiguous) {
      m.ambiguous++;
      const ok = !!ans.clarifying_question || (ans.not_found && !(q.doc_any || []).length) || false;
      if (ok) m.ambiguousOk++;
      row.kind = 'ambiguous';
      row.ok = ok;
    } else if (q.answerable === false) {
      m.unanswerable++;
      if (ans.not_found) m.notFoundOk++;
      row.kind = 'unanswerable';
      row.ok = ans.not_found;
    } else {
      m.answerable++;
      const hit1 = !ans.not_found && docId === q.doc;
      const hit3 = top3.slice(0, 3).includes(q.doc);
      const exp = q.clauses || [];
      const rec = exp.length ? exp.filter((e) => cited.some((c) => covers(c, e))).length / exp.length : 0;
      const crec = exp.length ? exp.filter((e) => ctxIds.some((c) => covers(c, e))).length / exp.length : 0;
      if (hit1) m.hit1++;
      if (hit3) m.hit3++;
      if (ans.not_found) m.falseNotFound++;
      m.clauseRecall += rec;
      m.contextRecall += crec;
      Object.assign(row, { kind: 'answerable', expected: q.doc, hit1, hit3, clauseRecall: +rec.toFixed(2), contextRecall: +crec.toFixed(2), cited });
      row.ok = hit1;
    }
    if (!ans.not_found) for (const s of ans.steps) acceptedPool.push({ q: q.id, doc: docId, text: s.text });
    rows.push(row);
  }

  // Verifier stress test on the same retrieval contexts.
  let rot = 0;
  for (const q of questions) {
    if (q.answerable === false || q.ambiguous) continue;
    const ret = await retrieve(store, q.question, { indexPath });
    if (ret.notFound || !ret.context.length) continue;
    const slots = new Map(ret.docsInContext.map((id, k) => [id, `D${k + 1}`]));
    const resolve = buildCiteResolver(ret.context, slots);
    const ans = await rag.ask(q.question, { indexPath, mode, store });
    for (const s of ans.steps.slice(0, 3)) {
      const c = s.cites[0];
      if (!c) continue;
      const cite = `${slots.get(c.doc)}:${c.clause}`;
      const check = (kind, text, cites = [cite]) => {
        const v = verifyStep({ text, cites }, resolve);
        if (kind === 'genuine') {
          stress.genuine++;
          if (!v.ok) stress.genuineRejected++;
        } else {
          stress[kind].total++;
          if (!v.ok) stress[kind].rejected++;
        }
      };
      check('genuine', s.text);
      check('invented', INVENTED[rot++ % INVENTED.length]);
      check('number', changeNumber(s.text));
      check('foreign_cite', s.text, [`${slots.get(c.doc)}:99.9`]);
      const neg = negate(s.text);
      if (neg) check('negation', neg);
      const other = acceptedPool.find((p) => p.doc !== c.doc && p.q !== q.id && ((rot + p.text.length) % 3 === 0)) || acceptedPool.find((p) => p.doc !== c.doc);
      if (other) check('other_doc', other.text);
    }
  }

  const pct = (x, n) => (n ? `${((100 * x) / n).toFixed(1)}%` : 'n/a');
  const lat = m.latencyMs.slice().sort((x, y) => x - y);
  const corruptTotal = kinds.reduce((s, k) => s + stress[k].total, 0);
  const corruptRejected = kinds.reduce((s, k) => s + stress[k].rejected, 0);
  const summary = {
    questions: questions.length,
    mode,
    llm: !!(process.env.LLM_BASE_URL),
    embeddings: !!(store.vectors && process.env.EMBED_BASE_URL),
    answerable: m.answerable,
    doc_hit_at_1: +(m.hit1 / m.answerable).toFixed(3),
    doc_hit_at_3: +(m.hit3 / m.answerable).toFixed(3),
    clause_recall: +(m.clauseRecall / m.answerable).toFixed(3),
    context_recall: +(m.contextRecall / m.answerable).toFixed(3),
    false_not_found: m.falseNotFound,
    unanswerable: m.unanswerable,
    not_found_accuracy: m.unanswerable ? +(m.notFoundOk / m.unanswerable).toFixed(3) : null,
    ambiguous: m.ambiguous,
    ambiguous_handled: m.ambiguousOk,
    steps_generated: m.stepsGenerated,
    verifier_rejection_rate: m.stepsGenerated ? +(m.stepsRejected / m.stepsGenerated).toFixed(3) : 0,
    stress: {
      genuine_steps: stress.genuine,
      genuine_false_rejections: stress.genuineRejected,
      corrupted_steps: corruptTotal,
      corrupted_rejected: corruptRejected,
      by_kind: Object.fromEntries(kinds.map((k) => [k, `${stress[k].rejected}/${stress[k].total}`])),
    },
    latency_ms: { p50: lat[Math.floor(lat.length / 2)], max: lat[lat.length - 1] },
  };

  if (a.verbose) {
    for (const r of rows) {
      const mark = r.ok ? 'ok ' : 'BAD';
      const extra = r.kind === 'answerable' ? `exp=${r.expected} got=${r.got || '-'} rec=${r.clauseRecall} ctx=${r.contextRecall} cited=[${r.cited.join(',')}]` : `got=${r.got || '-'} nf=${r.not_found}`;
      console.log(`${mark} ${r.id} [${r.kind}] ${r.question}\n      ${extra}${r.clarify ? ' clarify' : ''}`);
    }
    console.log('');
  }
  console.log(`questions: ${summary.questions} (answerable ${m.answerable}, unanswerable ${m.unanswerable}, ambiguous ${m.ambiguous}); mode=${mode}; llm=${summary.llm}; embeddings=${summary.embeddings}`);
  console.log(`doc hit@1:            ${pct(m.hit1, m.answerable)}`);
  console.log(`doc hit@3:            ${pct(m.hit3, m.answerable)}`);
  console.log(`clause recall:        ${pct(m.clauseRecall, m.answerable)}`);
  console.log(`context recall:       ${pct(m.contextRecall, m.answerable)}`);
  console.log(`false not_found:      ${m.falseNotFound}/${m.answerable}`);
  console.log(`not_found accuracy:   ${pct(m.notFoundOk, m.unanswerable)} (${m.notFoundOk}/${m.unanswerable})`);
  console.log(`ambiguous handled:    ${m.ambiguousOk}/${m.ambiguous}`);
  console.log(`verifier rejections:  ${pct(m.stepsRejected, m.stepsGenerated)} of ${m.stepsGenerated} generated steps`);
  console.log(`verifier stress:      rejected ${corruptRejected}/${corruptTotal} corrupted steps (${pct(corruptRejected, corruptTotal)}); false rejections ${stress.genuineRejected}/${stress.genuine} genuine`);
  console.log(`                      ${kinds.map((k) => `${k} ${stress[k].rejected}/${stress[k].total}`).join(', ')}`);
  console.log(`latency:              p50 ${summary.latency_ms.p50} ms, max ${summary.latency_ms.max} ms`);

  const out = a.out || path.join(__dirname, 'results', `eval-${mode}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
  console.log(`details -> ${path.relative(process.cwd(), out)}`);
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
