'use strict';
// Reads one uploaded file off the main thread (see Library.prepareText).
const { parentPort, workerData } = require('node:worker_threads');
const { extractDocument, looksLikeText } = require('../rag/src/extract');
const { failureOf } = require('./library');

const { file, ext, v } = workerData;
let record;
try {
  const info = extractDocument(file, ext);
  if (!info.sheets && !looksLikeText(info.text)) throw Object.assign(new Error('в файле нет читаемого текста'), { code: 'EMPTY' });
  record = { v, text: info.text, method: info.method, engine: info.engine || null, pages: info.pages || null, pageStarts: info.pageStarts || null, sheets: info.sheets || null, sparse: !!info.sparse, title: info.title || null };
} catch (e) {
  record = { v, failure: failureOf(e) };
}
parentPort.postMessage(record);
