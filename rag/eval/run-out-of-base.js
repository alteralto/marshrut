'use strict';
// Questions whose answer is not in the base: how many get an honest refusal.
//   node eval/run-out-of-base.js --questions fixtures/out-of-base-test.txt --index data/case-index.json
// out-of-base-dev.txt (119) was used to choose the refusal rule; out-of-base-test.txt (100) was written
// afterwards and nothing was tuned on it. No language model: the refusal is decided before it.
const fs = require('fs');
const path = require('path');
const rag = require('../src');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
(async () => {
  const qFile = arg('questions', path.join(__dirname, '..', 'fixtures', 'out-of-base-test.txt'));
  const store = await rag.getStore({ indexPath: arg('index', path.join(__dirname, '..', 'data', 'case-index.json')) });
  const qs = fs.readFileSync(qFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const answered = [];
  for (const q of qs) {
    const a = await rag.ask(q, { store, mode: 'extractive', llmBaseUrl: '', embedBaseUrl: '' });
    if (!a.not_found) answered.push(`${q} -> ${a.document?.title || ''}`);
  }
  console.log(`questions: ${qs.length}; refused: ${qs.length - answered.length}; answered from the nearest document: ${answered.length}`);
  for (const s of answered) console.log('  ' + s);
})().catch((e) => { console.error(e); process.exit(1); });
