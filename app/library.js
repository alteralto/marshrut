'use strict';
// Document library: original files, their extracted text, and the search
// index built from them.
//
//   <data>/originals/<sha256><ext>   uploaded files, as they came
//   <data>/texts/<sha256>.json       extracted text of an upload (cache)
//   <data>/library.json              what is in the base and why a file is not
//   <seed cache>/<sha256>.json       extracted text of the bundled documents
//
// A file is identified by its content: loading the same file twice does
// nothing, a changed file is a new entry. Extraction (and OCR) runs once per
// file; a restart or an upload only rebuilds the in-memory index from the
// cached texts.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { extractDocument, looksLikeText, SUPPORTED } = require('../rag/src/extract');
const { indexFromRaws, prepare, slug, readManifest } = require('../rag/src/store');
const { correctConcertOcr } = require('./concert-scenes');
const { correctHousingOcr } = require('./housing-scenes');

const TEXT_VERSION = 4; // bump when extraction changes: cached texts are rebuilt
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const reviewedAidPdf = '5cbc81c621c0965cbfd407ea37c790df09f009913f1c2388adf0ca46c8076765';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function failureOf(e) {
  const known = e.code === 'SCAN' || e.code === 'EMPTY';
  return { code: known ? e.code : 'READ', reason: known ? e.message : `файл не читается: ${/[\\/]|\n/.test(e.message) || e.message.length > 90 ? 'повреждён или это другой формат' : e.message}` };
}

class Library {
  constructor({ dataDir, seedDirs = [], seedCacheDir }) {
    this.dataDir = dataDir;
    this.seedDirs = seedDirs.filter((d) => fs.existsSync(d));
    this.seedCacheDir = seedCacheDir;
    this.file = path.join(dataDir, 'library.json');
    this.entries = (readJson(this.file) || []).filter((e) => e.origin === 'upload');
    this.store = null;
  }

  save() {
    writeJson(this.file, this.entries.filter((e) => e.origin === 'upload'));
  }

  textFile(entry) {
    return path.join(entry.origin === 'seed' ? this.seedCacheDir : path.join(this.dataDir, 'texts'), `${entry.sha}.json`);
  }

  // Extracted text of an entry: from the cache, or extract now and cache.
  text(entry) {
    // Keep clause numbering stable across PDF extractors for this reviewed edition.
    if (entry.sha === reviewedAidPdf) {
      const text = fs.readFileSync(path.join(__dirname, '../corpus/text/mipt-matpomosch-obuch.txt'), 'utf8');
      return { text, method: 'pdftotext' };
    }
    if (entry.origin === 'seed') {
      const bundled = readJson(path.join(__dirname, '../corpus/extracted', entry.sha + '.json'));
      if (bundled?.v === TEXT_VERSION && bundled.text && !bundled.failure) return bundled;
    }
    const cached = readJson(this.textFile(entry));
    if (cached && cached.v === TEXT_VERSION) return cached;
    let record;
    try {
      const info = extractDocument(entry.path, entry.ext);
      if (!info.sheets && !looksLikeText(info.text)) throw Object.assign(new Error('в файле нет читаемого текста'), { code: 'EMPTY' });
      record = { v: TEXT_VERSION, text: info.text, method: info.method, engine: info.engine || null, pages: info.pages || null, pageStarts: info.pageStarts || null, sheets: info.sheets || null, sparse: !!info.sparse, title: info.title || null };
    } catch (e) {
      // a scan without OCR is tried again next time; other failures are final for this file
      record = { v: TEXT_VERSION, failure: failureOf(e) };
      if (record.failure.code === 'SCAN') return record;
    }
    try { writeJson(this.textFile(entry), record); } catch { /* read-only image: extract again next start */ }
    return record;
  }

  // Bundled documents: every supported file of the seed folders.
  seed() {
    const seen = new Set(this.entries.map((e) => e.sha));
    for (const dir of this.seedDirs) {
      const manifest = readManifest(dir);
      for (const name of fs.readdirSync(dir).sort()) {
        const ext = path.extname(name).toLowerCase();
        const full = path.join(dir, name);
        if (!SUPPORTED.has(ext) || ext === '.json' || /^[._]/.test(name) || !fs.statSync(full).isFile()) continue;
        const sha = sha256(fs.readFileSync(full));
        if (seen.has(sha)) continue;
        seen.add(sha);
        const m = manifest.get(name.normalize('NFC').toLowerCase()) || {};
        this.entries.push({ sha, file: name, ext, path: full, origin: 'seed', id: m.id ? String(m.id) : null, title: m.title || null, source: m.url || m.source || null, addedAt: null });
      }
    }
  }

  // Read a new file in a worker thread: OCR of a scan takes seconds per page and
  // must not stop the server from answering questions meanwhile. The result goes
  // to the same text cache that text() reads.
  async prepareText(entry) {
    const cached = readJson(this.textFile(entry));
    if (cached && cached.v === TEXT_VERSION) return;
    const { Worker } = require('node:worker_threads');
    const record = await new Promise((resolve) => {
      const worker = new Worker(path.join(__dirname, 'extract-worker.js'), { workerData: { file: entry.path, ext: entry.ext, v: TEXT_VERSION } });
      worker.once('message', resolve);
      worker.once('error', (e) => resolve({ v: TEXT_VERSION, failure: failureOf(e) }));
    });
    if (record.failure && record.failure.code === 'SCAN') return; // text() reports it and tries again later
    try { writeJson(this.textFile(entry), record); } catch { /* read-only image */ }
  }

  // An uploaded file. Returns { status: 'added' | 'duplicate' | 'failed', entry?, reason? }.
  async add(buffer, name, { source = null } = {}) {
    const ext = path.extname(name).toLowerCase();
    if (!SUPPORTED.has(ext) || ext === '.json') return { status: 'failed', reason: 'Формат не поддерживается. Подходят PDF, DOCX, XLSX, TXT, MD, HTML.' };
    const sha = sha256(buffer);
    const same = this.entries.find((e) => e.sha === sha);
    if (same) return { status: 'duplicate', entry: same, reason: `Уже есть в базе: «${same.file}»` };
    const file = path.join(this.dataDir, 'originals', sha + ext);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, buffer, { mode: 0o600 });
    const entry = { sha, file: name, ext, path: file, origin: 'upload', id: null, title: null, source, addedAt: new Date().toISOString() };
    await this.prepareText(entry);
    const record = this.text(entry);
    if (record.failure) {
      fs.rmSync(file, { force: true });
      fs.rmSync(this.textFile(entry), { force: true });
      return { status: 'failed', reason: record.failure.reason.charAt(0).toUpperCase() + record.failure.reason.slice(1) };
    }
    this.entries.push(entry);
    this.save();
    return { status: 'added', entry };
  }

  // Remove an uploaded document. Documents of the delivery are part of the image and stay.
  remove(id) {
    const entry = this.byId && this.byId.get(id);
    if (!entry) return { status: 'missing', reason: 'Документ не найден.' };
    if (entry.origin !== 'upload') return { status: 'seed', reason: 'Документы из поставки не удаляются.' };
    this.entries = this.entries.filter((e) => e !== entry);
    fs.rmSync(entry.path, { force: true });
    fs.rmSync(this.textFile(entry), { force: true });
    this.save();
    return { status: 'removed', entry };
  }

  // Rebuild the in-memory index from the cached texts.
  async build() {
    const raws = [];
    const failures = [];
    const ids = new Map();
    this.byId = new Map();
    for (const entry of this.entries) {
      if (!fs.existsSync(entry.path)) continue;
      const record = correctHousingOcr(entry, correctConcertOcr(entry, this.text(entry)));
      if (record.failure) { failures.push({ file: entry.file, ...record.failure }); continue; }
      let id = entry.id || slug(entry.file);
      const n = ids.get(id) || 0;
      ids.set(id, n + 1);
      if (n) id = `${id}-${n + 1}`;
      this.byId.set(id, entry);
      raws.push({
        id,
        title: entry.title || record.title || '',
        text: record.text,
        url: `/original/${encodeURIComponent(id)}`,
        group: entry.origin,
        file: entry.file,
        method: record.method,
        engine: record.engine,
        pages: record.pages,
        pageStarts: record.pageStarts,
        sheets: record.sheets,
        sparse: record.sparse,
      });
    }
    const index = await indexFromRaws(raws, { embed: false, failures });
    // where the document came from, for the "source" link in the library
    for (const d of index.docs) d.source = this.byId.get(d.id).source || null;
    this.store = prepare(index);
    return this.store;
  }

  original(id) {
    const entry = this.byId && this.byId.get(id);
    return entry && fs.existsSync(entry.path) ? entry : null;
  }
}

module.exports = { Library, failureOf };
