'use strict';
// Ingestion (files -> parsed regulations -> chunks -> JSON index) and loading
// (JSON index -> in-memory BM25 + optional vectors).
//
// Storage is one JSON file on purpose: it is diffable, needs no native addon,
// and node:sqlite is still flagged experimental in Node 22 (prints a warning).
// The host app can keep it next to its own SQLite database.

const fs = require('node:fs');
const path = require('node:path');
const { parseRegulation } = require('./parser');
const { tokens } = require('./text');
const { BM25, countTokens } = require('./bm25');
const { embed, embedConfig } = require('./openai');
const { extractDocument, looksLikeText, SUPPORTED } = require('./extract');
const { docMeta, linkVersions } = require('./meta');

const INDEX_VERSION = 3;
const SKIP_FILE = /^(manifest\.json|eval[-_].*|readme.*|_.*|\..*)$/i;

function slug(s) {
  return String(s)
    .normalize('NFC')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'doc';
}

// Accepts several manifest shapes: array, {documents|items|files: [...]},
// or {"file.txt": {...}}. Returns Map basename(lowercase) -> entry.
function readManifest(dir) {
  const p = path.join(dir, 'manifest.json');
  const map = new Map();
  if (!fs.existsSync(p)) return map;
  let json;
  try {
    json = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn(`[rag] manifest.json is not valid JSON: ${e.message}`);
    return map;
  }
  let entries = [];
  if (Array.isArray(json)) entries = json;
  else if (json && typeof json === 'object') {
    const arr = json.documents || json.items || json.files || json.docs || json.regulations;
    if (Array.isArray(arr)) entries = arr;
    else entries = Object.entries(json).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => ({ file: k, ...v }));
  }
  for (const e of entries) {
    const file = e.file || e.filename || e.path || e.text_file || e.txt || e.text_path || e.local_path;
    if (!file) continue;
    map.set(path.basename(String(file)).normalize('NFC').toLowerCase(), e);
  }
  return map;
}

function entryMeta(e) {
  if (!e) return {};
  return {
    id: e.id || e.doc_id || e.slug,
    title: e.title || e.name || e.doc_title,
    url: e.url || e.source_url || e.source || e.link,
    group: e.group || e.category || e.type,
    date: e.date || e.approved || e.adopted,
  };
}

// One parsed regulation -> retrieval chunks.
// Headings are not chunks; subpoints а) б) are folded into their clause so the
// clause is retrieved as a whole but each subpoint stays citable.
function buildChunks(doc) {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const chunks = [];
  const folded = new Set();
  for (const n of doc.nodes) {
    if (n.kind === 'sub') continue;
    if (folded.has(n.id)) continue;
    const kids = n.children.map((c) => byId.get(c)).filter(Boolean);
    // "2.2. ... в следующем порядке:" followed by short leaf clauses 2.2.1-2.2.4:
    // fold the list items into the lead clause like подпункты.
    const listLike = !n.heading && /:\s*$/.test(n.text.trim()) && kids.length > 0
      && kids.every((k) => k.kind === 'sub' || (k.kind === 'clause' && !k.children.length && k.text.length < 300));
    if (listLike) for (const k of kids) folded.add(k.id);
    const subs = listLike ? kids : kids.filter((k) => k.kind === 'sub');
    const onlySubs = kids.length > 0 && subs.length === kids.length;
    if (n.heading && !onlySubs) continue;
    let text = n.text.trim();
    if (!text) continue;
    if (subs.length) text += '\n' + subs.map((s) => `${s.id.slice(s.id.lastIndexOf('(') + 1)} ${s.text.trim()}`).join('\n');
    chunks.push({
      id: `${doc.id}#${n.id}`,
      docId: doc.id,
      clauseId: n.id,
      label: n.label,
      kind: n.kind,
      path: n.path,
      text,
      subs: subs.map((s) => ({ id: s.id, label: s.label, text: s.text.trim() })),
      order: n.order,
      page: n.page || null,
    });
  }
  return chunks;
}

function collectFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) continue;
    if (SKIP_FILE.test(name)) continue;
    const ext = path.extname(name).toLowerCase();
    if (SUPPORTED.has(ext)) out.push(full);
    else if (ext === '.doc' || ext === '.rtf' || ext === '.odt') console.warn(`[rag] skip ${name}: convert to .docx first (see README)`);
  }
  return out;
}

// Why a file did not get into the index, in words for the person who loaded it.
function failure(file, e) {
  const known = e.code === 'SCAN' || e.code === 'EMPTY';
  return {
    file: path.basename(file),
    code: known ? e.code : 'READ',
    reason: known ? e.message : `файл не читается: ${/[\\/]|\n/.test(e.message) || e.message.length > 90 ? 'повреждён или это другой формат' : e.message}`,
  };
}

// Raw documents {id,title,text,url,group,file,...} from files and/or JSON.
// A file that cannot be read does not stop the batch: it goes to `.failures`.
function loadRawDocs(inputs) {
  const docs = [];
  const failures = [];
  for (const input of inputs) {
    const st = fs.statSync(input);
    const dir = st.isDirectory() ? input : path.dirname(input);
    const files = st.isDirectory() ? collectFiles(input) : [input];
    const manifest = readManifest(dir);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      let raw;
      let info = {};
      try {
        if (ext === '.json') raw = fs.readFileSync(file, 'utf8');
        else {
          info = extractDocument(file, ext);
          raw = info.text;
          if (!info.sheets && !looksLikeText(raw)) {
            const e = new Error('в файле нет читаемого текста');
            e.code = 'EMPTY';
            throw e;
          }
        }
      } catch (e) {
        failures.push(failure(file, e));
        console.warn(`[rag] skip ${path.basename(file)}: ${e.message}`);
        continue;
      }
      if (ext === '.json') {
        let json;
        try { json = JSON.parse(raw); } catch (e) { failures.push(failure(file, e)); continue; }
        const arr = Array.isArray(json) ? json : (Array.isArray(json.documents) ? json.documents : [json]);
        for (const d of arr) {
          const text = d && (d.content || d.text || d.body);
          if (!text) continue;
          docs.push({
            id: d.id ? String(d.id) : slug(d.title || path.basename(file)),
            title: d.title || '',
            text: String(text),
            url: d.url || d.source || null,
            group: d.group || null,
            file: d.file || d.title || path.basename(file),
            method: d.method || 'text',
            pages: d.pages || null,
            pageStarts: d.pageStarts || null,
            sheets: d.sheets || null,
          });
        }
        continue;
      }
      const meta = entryMeta(manifest.get(path.basename(file).normalize('NFC').toLowerCase()));
      docs.push({
        id: meta.id ? String(meta.id) : slug(path.basename(file)),
        title: meta.title || info.title || '',
        text: raw,
        url: meta.url || null,
        group: meta.group || null,
        date: meta.date || null,
        file: path.basename(file),
        method: info.method || 'text',
        engine: info.engine || null,
        pages: info.pages || null,
        pageStarts: info.pageStarts || null,
        sheets: info.sheets || null,
        sparse: !!info.sparse,
      });
    }
  }
  // unique ids
  const seen = new Map();
  for (const d of docs) {
    const n = seen.get(d.id) || 0;
    seen.set(d.id, n + 1);
    if (n) d.id = `${d.id}-${n + 1}`;
  }
  Object.defineProperty(docs, 'failures', { value: failures, enumerable: false });
  return docs;
}

// Workbook sheets -> one citable node per row. A row of column names (three
// or more short text cells) gives its names to the cells below it.
function sheetNodes(sheets) {
  const nodes = [];
  sheets.forEach((sh, si) => {
    let header = null;
    for (const row of sh.rows) {
      const names = row.cells.length >= 3 && row.cells.every((c) => /[A-Za-zА-Яа-яЁё]{2}/.test(c.value) && c.value.length <= 60 && !c.formula);
      const text = row.cells.map((c) => {
        const body = c.value || c.formula;
        const name = !names && header ? header.get(c.col) : null;
        return `${name ? `${name}: ` : ''}${body}${c.value && c.formula ? ` (формула ${c.formula})` : ''}`;
      }).join('; ');
      if (names) header = new Map(row.cells.map((c) => [c.col, c.value]));
      if (!/[A-Za-zА-Яа-яЁё0-9]/.test(text)) continue;
      nodes.push({
        id: `лист.${si + 1}/стр.${row.r}`,
        kind: 'row',
        label: `лист «${sh.name}», строка ${row.r}`,
        parent: null,
        children: [],
        number: null,
        text,
        heading: false,
        path: [`Лист «${sh.name}»`],
        order: nodes.length,
      });
    }
  });
  return nodes;
}

// Page of every node of a PDF: nodes follow the text order, so each one is
// searched for after the previous one.
function assignPages(nodes, text, pageStarts) {
  if (!pageStarts || pageStarts.length < 2 || !text) return;
  let pos = 0;
  let page = 1;
  for (const n of nodes) {
    const words = n.text.trim().split(/\s+/).slice(0, 4).filter((w) => w.length > 1);
    if (words.length >= 2) {
      const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\-]+'));
      const m = re.exec(text.slice(pos, pos + 200000));
      if (m) {
        pos += m.index;
        while (page < pageStarts.length && pageStarts[page] <= pos) page++;
      }
    }
    n.page = page;
  }
}

const LEVEL_NOTE = {
  flat: 'нумерация пунктов не найдена: ссылки ведут на абзацы',
  empty: 'в документе не найден текст',
};

// How well a document was read: for the person who loads it and for /docs.
function parseReport(raw, nodes) {
  const counts = {};
  for (const n of nodes) counts[n.kind] = (counts[n.kind] || 0) + 1;
  const numbered = (counts.clause || 0) + (counts.sub || 0) + (counts.row || 0);
  let level = 'partial';
  if (!nodes.length) level = 'empty';
  else if (!numbered) level = 'flat';
  else if (numbered >= 5 && numbered >= nodes.length * 0.5) level = 'ok';
  const warnings = [];
  if (raw.method === 'ocr') warnings.push('текст распознан со скана: возможны ошибки в отдельных словах и номерах');
  if (raw.method === 'pdf-builtin') warnings.push('PDF прочитан запасным способом: порядок строк может отличаться от оригинала');
  if (raw.sparse) warnings.push('в файле мало текста');
  if (LEVEL_NOTE[level]) warnings.push(LEVEL_NOTE[level]);
  return { method: raw.method || 'text', engine: raw.engine || null, pages: raw.pages || null, chars: (raw.text || '').length, nodes: counts, level, warnings };
}

function chunkEmbedText(doc, c) {
  const head = c.path.length ? c.path[c.path.length - 1] : '';
  return `${doc.title}. ${head}. ${c.text}`.slice(0, 2000);
}

async function buildIndex(inputs, opts = {}) {
  return indexFromRaws(loadRawDocs(Array.isArray(inputs) ? inputs : [inputs]), opts);
}

// raws: [{ id, file, text | sheets, title?, url?, method?, pages?, pageStarts? }]
async function indexFromRaws(raws, opts = {}) {
  const docs = [];
  const chunks = [];
  for (const r of raws) {
    const parsed = r.sheets
      ? { title: '', nodes: sheetNodes(r.sheets) }
      : parseRegulation(r.text, { title: r.title || undefined, fallbackTitle: r.file });
    const meta = docMeta(r.sheets ? '' : r.text, r.file, r.sheets ? '' : parsed.title);
    if (r.title) meta.title = r.title;
    if (!r.sheets) assignPages(parsed.nodes, r.text, r.pageStarts);
    const { title, ...passport } = meta;
    const doc = { id: r.id, title, url: r.url, group: r.group, date: r.date || meta.date || null, file: r.file, nodes: parsed.nodes };
    const cs = buildChunks(doc);
    docs.push({
      id: doc.id,
      title: doc.title,
      url: doc.url,
      group: doc.group,
      date: doc.date,
      file: doc.file,
      meta: passport,
      report: parseReport(r, parsed.nodes),
      headings: parsed.nodes.filter((n) => n.heading).map((n) => `${n.number} ${n.text}`),
      nodes: parsed.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, parent: n.parent, text: n.text, heading: n.heading, page: n.page || null })),
      chunkCount: cs.length,
    });
    chunks.push(...cs);
  }
  linkVersions(docs);
  const index = { version: INDEX_VERSION, createdAt: new Date().toISOString(), docs, chunks, failures: raws.failures || opts.failures || [], embeddings: null };

  const cfg = opts.embed === false ? null : embedConfig(opts);
  if (cfg) {
    const docById = new Map(docs.map((d) => [d.id, d]));
    const texts = chunks.map((c) => chunkEmbedText(docById.get(c.docId), c));
    try {
      const vecs = await embed(texts, cfg);
      const dim = vecs[0] ? vecs[0].length : 0;
      const flat = new Float32Array(vecs.length * dim);
      vecs.forEach((v, i) => flat.set(v, i * dim));
      index.embeddings = { model: cfg.model, dim, data: Buffer.from(flat.buffer).toString('base64') };
    } catch (e) {
      if (opts.requireEmbeddings) throw e;
      console.warn(`[rag] embeddings skipped: ${e.message}`);
    }
  }
  return index;
}

function saveIndex(index, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(index));
  return file;
}

// In-memory searchable form of an index.
//
// Two inverted indexes (clauses and whole documents) in typed arrays; nothing
// per-clause is kept besides them: no token arrays, no vocabulary sets.
// Clause-level BM25 inside one document is computed from the same postings
// (BM25.range), the document-level term counts are summed up from the clause
// counts while the clauses are tokenized, so every text is tokenized once.
function prepare(index) {
  const docById = new Map(index.docs.map((d) => [d.id, d]));
  const docIdx = new Map(index.docs.map((d, di) => [d.id, di]));
  const docChunks = new Map(index.docs.map((d) => [d.id, []]));
  index.chunks.forEach((c, i) => docChunks.get(c.docId).push(i));
  const chunkToks = (c) => tokens(`${c.path.join(' ')} ${c.text}`);

  // document = title x3 + file name + headings + all its clauses
  const titleVocab = [];
  const aboutVocab = []; // title, file name and headings: what the document is about
  const docCounts = index.docs.map((d) => {
    const t = tokens(d.title);
    const f = tokens(String(d.file || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_.]/g, ' '));
    titleVocab.push(new Set([...t, ...f]));
    const m = countTokens(t);
    for (const [k, v] of m) m.set(k, v * 3);
    let extra = 0;
    for (const k of new Set(f)) if (!m.has(k)) { m.set(k, 2); extra += 2; }
    const head = tokens(d.headings.join(' '));
    for (const k of head) m.set(k, (m.get(k) || 0) + 1);
    aboutVocab.push(new Set([...t, ...f, ...head]));
    return { counts: m, len: t.length * 3 + extra + head.length };
  });
  // "финансового лицевого счета (далее – ФЛС)": abbreviation -> the stems it stands for
  const abbr = new Map();
  const ABBR = /\((?:далее[^)]{0,14}?[-–—─]\s*)?[«"]?([А-ЯЁ]{2,8})[»"]?\)/g;
  const SMALL = new Set(['и', 'в', 'на', 'по', 'для', 'с', 'к', 'о', 'об', 'от', 'при']);
  for (const c of index.chunks) {
    if (!c.text.includes('(')) continue;
    for (const m of c.text.matchAll(ABBR)) {
      const key = tokens(m[1])[0];
      if (!key || abbr.has(key)) continue;
      const before = c.text.slice(Math.max(0, m.index - 160), m.index).split(/[^А-Яа-яЁё]+/).filter((w) => w && !SMALL.has(w.toLowerCase()));
      while (before.length && before[before.length - 1].length > 1 && before[before.length - 1] === before[before.length - 1].toUpperCase()) before.pop();
      const wordsOf = before.slice(-m[1].length);
      if (wordsOf.length === m[1].length && wordsOf.map((w) => w[0]).join('').toLowerCase() === m[1].toLowerCase()) abbr.set(key, new Set(tokens(wordsOf.join(' '))));
    }
  }
  const chunkBm25 = BM25.fromCounts((function* chunkItems() {
    for (const c of index.chunks) {
      const toks = chunkToks(c);
      const counts = countTokens(toks);
      const d = docCounts[docIdx.get(c.docId)];
      for (const [k, v] of counts) d.counts.set(k, (d.counts.get(k) || 0) + v);
      d.len += toks.length;
      yield { counts, len: toks.length };
    }
  }()));
  const docBm25 = BM25.fromCounts(docCounts);

  // Clauses of a document normally sit next to each other in the index:
  // [start, end) per document, or null if they are scattered.
  const docRange = new Map();
  for (const [id, idxs] of docChunks) {
    const contiguous = idxs.length > 0 && idxs[idxs.length - 1] - idxs[0] === idxs.length - 1;
    docRange.set(id, contiguous ? [idxs[0], idxs[idxs.length - 1] + 1] : null);
  }

  let vectors = null;
  let vecFlat = null;
  let vecDim = 0;
  if (index.embeddings && index.embeddings.data) {
    const buf = Buffer.from(index.embeddings.data, 'base64');
    // small buffers come from a shared pool and may start at an odd offset
    vecFlat = buf.byteOffset % 4 === 0
      ? new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2)
      : new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.byteLength & ~3)));
    vecDim = index.embeddings.dim;
    vectors = index.chunks.map((_, i) => vecFlat.subarray(i * vecDim, (i + 1) * vecDim));
  }
  return {
    index, docById, docIdx, chunkBm25, docBm25, docChunks, docRange, titleVocab, aboutVocab, abbr, vectors, vecFlat, vecDim,
    // words of the clauses, then those that stand only in a title or a file name
    vocab: [...new Set([...chunkBm25.df.keys(), ...docBm25.df.keys()])],
    chunkTokensOf: (i) => chunkToks(index.chunks[i]),
    localBm25: new Map(), // docId -> BM25 over that doc's clauses (built lazily)
    embedModel: index.embeddings ? index.embeddings.model : null,
  };
}

function loadIndex(file) {
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (index.version !== INDEX_VERSION) {
    throw new Error(`Index ${file} has version ${index.version}, expected ${INDEX_VERSION}. Re-run ingest.`);
  }
  return prepare(index);
}

module.exports = { buildIndex, indexFromRaws, saveIndex, loadIndex, prepare, buildChunks, loadRawDocs, readManifest, slug, sheetNodes, parseReport };
