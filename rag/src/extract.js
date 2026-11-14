'use strict';
// Plain-text extraction for .docx, .pdf and .html without dependencies.
//
// docx: a ZIP of XML. We read the ZIP directory ourselves (node:zlib inflates
//   the entries) and rebuild Word's automatic list numbering from
//   numbering.xml, because regulations are usually typed with auto-numbered
//   lists: the "2.3." the reader sees is not in the text at all.
// pdf:  `pdftotext` (poppler, ships with Git for Windows / most Linux distros)
//   if it is on PATH or in RAG_PDFTOTEXT; otherwise a small built-in reader
//   that handles text PDFs (Flate streams, object streams, ToUnicode CMaps,
//   Identity-H fonts). A scanned PDF has no text layer: it goes through OCR
//   (see ocr.js) when that is available, otherwise it is reported as a scan.
// html: the main content only (navigation, header, footer and everything
//   before the first <h1> are dropped), block elements become line breaks,
//   ordered lists get their numbers back.

const fs = require('node:fs');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const ocr = require('./ocr');

// ---------------------------------------------------------------- ZIP

const ZIP_BUDGET = 64 * 1024 * 1024;

function readZip(buf) {
  // End of central directory record: signature 0x06054b50, in the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  // One budget for everything unpacked from this file: a workbook that lists
  // one sheet many times, or a small file that unpacks to gigabytes, stops here.
  const cache = new Map();
  let unpacked = 0;
  return {
    names: [...entries.keys()],
    read(name) {
      if (cache.has(name)) return cache.get(name);
      const e = entries.get(name);
      if (!e) return null;
      const out = unpack(e, name);
      unpacked += out.length;
      if (unpacked > ZIP_BUDGET) throw new Error('Файл распаковывается больше чем в 64 МБ, такие файлы не принимаются.');
      cache.set(name, out);
      return out;
    },
  };
  function unpack(e, name) {
    {
      const lp = e.localOff;
      const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
      const data = buf.subarray(start, start + e.compSize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: ZIP_BUDGET });
      throw new Error(`ZIP method ${e.method} not supported (${name})`);
    }
  }
}

// ---------------------------------------------------------------- XML helpers

const NAMED_ENTITIES = {
  nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sect: '§', numero: '№', copy: '©',
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&(nbsp|laquo|raquo|mdash|ndash|hellip|bdquo|ldquo|rdquo|lsquo|rsquo|sect|numero|copy);/g, (m, n) => NAMED_ENTITIES[n])
    .replace(/&amp;/g, '&');
}

function attr(tag, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- DOCX

const RU_LOWER = 'абвгдежзиклмнопрстуфхцчшщэюя';

function toRoman(n) {
  const t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
  return out;
}

function formatNumber(n, fmt) {
  switch (fmt) {
    case 'lowerLetter': return String.fromCharCode(96 + ((n - 1) % 26) + 1);
    case 'upperLetter': return String.fromCharCode(64 + ((n - 1) % 26) + 1);
    case 'russianLower': return RU_LOWER[(n - 1) % RU_LOWER.length];
    case 'russianUpper': return RU_LOWER[(n - 1) % RU_LOWER.length].toUpperCase();
    case 'lowerRoman': return toRoman(n).toLowerCase();
    case 'upperRoman': return toRoman(n);
    case 'bullet': return '';
    case 'none': return '';
    default: return String(n);
  }
}

function parseNumbering(xml) {
  const abstract = new Map(); // abstractNumId -> Map ilvl -> {start, fmt, text}
  if (!xml) return { abstract, nums: new Map() };
  for (const m of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const levels = new Map();
    for (const l of m[2].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
      const body = l[2];
      const start = /<w:start w:val="(\d+)"/.exec(body);
      const fmt = /<w:numFmt w:val="([^"]+)"/.exec(body);
      const text = /<w:lvlText w:val="([^"]*)"/.exec(body);
      levels.set(Number(l[1]), {
        start: start ? Number(start[1]) : 1,
        fmt: fmt ? fmt[1] : 'decimal',
        text: text ? decodeEntities(text[1]) : '',
        legal: /<w:isLgl\b/.test(body),
      });
    }
    abstract.set(m[1], levels);
  }
  const nums = new Map(); // numId -> {abstractId, overrides: Map ilvl -> start}
  for (const m of xml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const a = /<w:abstractNumId w:val="(\d+)"/.exec(m[2]);
    const overrides = new Map();
    for (const o of m[2].matchAll(/<w:lvlOverride w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvlOverride>/g)) {
      const so = /<w:startOverride w:val="(\d+)"/.exec(o[2]);
      if (so) overrides.set(Number(o[1]), Number(so[1]));
    }
    nums.set(m[1], { abstractId: a ? a[1] : null, overrides });
  }
  return { abstract, nums };
}

// styleId -> {numId, ilvl} for paragraph styles that carry numbering
function parseStyleNumbering(xml) {
  const map = new Map();
  if (!xml) return map;
  for (const m of xml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const numId = /<w:numId w:val="(\d+)"/.exec(m[2]);
    if (!numId) continue;
    const ilvl = /<w:ilvl w:val="(\d+)"/.exec(m[2]);
    map.set(m[1], { numId: numId[1], ilvl: ilvl ? Number(ilvl[1]) : 0 });
  }
  return map;
}

function paragraphText(inner) {
  let out = '';
  // runs in document order: text, tabs, breaks; skip deleted text
  for (const m of inner.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>|<w:delText\b[^>]*>[\s\S]*?<\/w:delText>|<w:noBreakHyphen\/>/g)) {
    const tok = m[0];
    if (tok.startsWith('<w:t')) {
      if (tok.startsWith('<w:tab')) out += '\t';
      else out += decodeEntities(m[1]);
    } else if (tok.startsWith('<w:br') || tok.startsWith('<w:cr')) out += '\n';
    else if (tok.startsWith('<w:noBreakHyphen')) out += '-';
  }
  return out;
}

function docxToText(buf) {
  const zip = readZip(buf);
  const docXml = zip.read('word/document.xml');
  if (!docXml) throw new Error('word/document.xml not found: not a .docx file');
  const numbering = parseNumbering(zip.read('word/numbering.xml')?.toString('utf8'));
  const styleNum = parseStyleNumbering(zip.read('word/styles.xml')?.toString('utf8'));
  let xml = docXml.toString('utf8');
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml);
  if (body) xml = body[1];

  // Table rows -> one synthetic paragraph "cell | cell | cell".
  xml = xml.replace(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g, (m, row) => {
    const cells = [...row.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((c) => [...c[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
      .map((p) => paragraphText(p[1]).trim()).filter(Boolean).join(' '));
    const text = cells.join(' | ').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  });

  const counters = new Map(); // abstractId -> array of counters per level
  const seenNum = new Set();
  const lines = [];
  for (const m of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:p\b[^>]*\/>/g)) {
    const inner = m[1] || '';
    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(inner);
    let numId = null;
    let ilvl = 0;
    if (pPr) {
      const n = /<w:numId w:val="(\d+)"/.exec(pPr[1]);
      const l = /<w:ilvl w:val="(\d+)"/.exec(pPr[1]);
      const st = /<w:pStyle w:val="([^"]+)"/.exec(pPr[1]);
      if (n) { numId = n[1]; ilvl = l ? Number(l[1]) : 0; }
      else if (st && styleNum.has(st[1])) ({ numId, ilvl } = styleNum.get(st[1]));
      if (l && !n && numId) ilvl = Number(l[1]);
    }
    let text = paragraphText(inner);
    if (numId && numId !== '0' && text.trim()) {
      const num = numbering.nums.get(numId);
      const levels = num && numbering.abstract.get(num.abstractId);
      if (levels && levels.has(ilvl)) {
        const key = num.abstractId;
        if (!counters.has(key)) counters.set(key, []);
        const c = counters.get(key);
        if (!seenNum.has(numId)) {
          seenNum.add(numId);
          // a <w:num> with startOverride starts a fresh list
          for (const [lv, start] of num.overrides) c[lv] = start - 1;
        }
        for (let k = 0; k < ilvl; k++) if (c[k] == null) c[k] = (levels.get(k)?.start ?? 1);
        c[ilvl] = c[ilvl] == null ? levels.get(ilvl).start : c[ilvl] + 1;
        c.length = ilvl + 1; // deeper levels restart
        const lvl = levels.get(ilvl);
        let label = lvl.text.replace(/%(\d)/g, (mm, d) => {
          const k = Number(d) - 1;
          const fmt = lvl.legal ? 'decimal' : (levels.get(k)?.fmt || 'decimal');
          return formatNumber(c[k] ?? 1, fmt);
        });
        if (lvl.fmt === 'bullet') label = '';
        if (label.trim()) text = `${label.trim()} ${text.trimStart()}`;
      }
    }
    lines.push(text);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------- HTML

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Page title: the first <h1>, else <title> up to the site name.
function htmlTitle(html) {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1 && stripTags(h1[1])) return stripTags(h1[1]);
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return t ? stripTags(t[1]).split(/\s+[—|–]\s+/)[0].trim() : '';
}

// <ol><li> numbers are drawn by the browser and are absent from the text.
function numberLists(s) {
  let out = s;
  // innermost lists first, so nested lists keep their own counters
  for (let guard = 0; guard < 50; guard++) {
    let changed = false;
    out = out.replace(/<ol\b([^>]*)>((?:(?!<ol\b)[\s\S])*?)<\/ol>/i, (m, attrs, inner) => {
      changed = true;
      let n = Number((/start="?(\d+)/i.exec(attrs) || [0, 1])[1]);
      const body = inner.replace(/<li\b[^>]*>/gi, () => `<li>${n++}. `);
      return `<div>${body}</div>`;
    });
    if (!changed) break;
  }
  return out;
}

function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|noscript|head|nav|footer|aside|form|button|select|svg|iframe)\b[\s\S]*?<\/\1>/gi, '');
  // a site page: the document starts at its <h1>, before it is the site's chrome
  const h1 = s.search(/<h1\b/i);
  if (h1 > 0) s = s.slice(h1);
  s = numberLists(s);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|table|section|article|blockquote|pre)>/gi, '\n');
  s = s.replace(/<(p|div|li|h[1-6]|tr|table|section|article|blockquote|pre)\b[^>]*>/gi, '\n');
  s = s.replace(/<\/t[dh]>/gi, ' | ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').replace(/\s*\|\s*$/, '').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------- PDF

function findPdftotext() {
  const cands = [process.env.RAG_PDFTOTEXT, 'pdftotext'].filter(Boolean);
  for (const c of cands) {
    try {
      execFileSync(c, ['-v'], { stdio: 'ignore', timeout: 5000 });
      return c;
    } catch (e) {
      // pdftotext -v exits 0 on new versions, 99 on old ones; ENOENT = absent
      if (e.code !== 'ENOENT' && e.status != null) return c;
    }
  }
  return null;
}

let pdftotextPath;
function pdfViaTool(file) {
  if (process.env.RAG_PDF_BUILTIN) return null;
  if (pdftotextPath === undefined) pdftotextPath = findPdftotext();
  if (!pdftotextPath) return null;
  try {
    const out = execFileSync(pdftotextPath, ['-enc', 'UTF-8', file, '-'], { maxBuffer: 64 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString('utf8');
  } catch {
    throw new Error('PDF повреждён или защищён паролем');
  }
}

// --- built-in reader

function inflate(data) {
  try { return zlib.inflateSync(data); } catch { /* fall through */ }
  try { return zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { /* fall through */ }
  try { return zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return Buffer.alloc(0); }
}

class PdfReader {
  constructor(buf) {
    this.buf = buf;
    this.src = buf.toString('latin1');
    this.objects = new Map(); // "n" -> { dict: string, stream: Buffer|null, body: string }
    this.scan();
  }

  scan() {
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(this.src))) {
      const start = m.index + m[0].length;
      const end = this.src.indexOf('endobj', start);
      if (end < 0) break;
      let body = this.src.slice(start, end);
      let stream = null;
      const si = body.search(/\bstream\r?\n/);
      if (si >= 0) {
        const dict = body.slice(0, si);
        const dataStart = start + si + body.slice(si).match(/^stream\r?\n/)[0].length;
        let len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
        let dataEnd = len ? dataStart + Number(len[1]) : -1;
        if (dataEnd < 0 || this.src.slice(dataEnd, dataEnd + 30).indexOf('endstream') < 0) {
          dataEnd = this.src.indexOf('endstream', dataStart);
          while (dataEnd > dataStart && /[\r\n]/.test(this.src[dataEnd - 1])) dataEnd--;
        }
        stream = this.buf.subarray(dataStart, dataEnd);
        body = dict;
      }
      this.objects.set(m[1], { dict: body, stream });
      re.lastIndex = end;
    }
    // objects packed in object streams (PDF 1.5+)
    for (const [, o] of [...this.objects]) {
      if (!o.stream || !/\/Type\s*\/ObjStm/.test(o.dict)) continue;
      const data = this.streamData(o).toString('latin1');
      const n = Number((/\/N\s+(\d+)/.exec(o.dict) || [])[1] || 0);
      const first = Number((/\/First\s+(\d+)/.exec(o.dict) || [])[1] || 0);
      const nums = data.slice(0, first).trim().split(/\s+/).map(Number);
      for (let k = 0; k < n; k++) {
        const id = nums[2 * k];
        const off = first + nums[2 * k + 1];
        const next = k + 1 < n ? first + nums[2 * k + 3] : data.length;
        if (!this.objects.has(String(id))) this.objects.set(String(id), { dict: data.slice(off, next), stream: null });
      }
    }
  }

  streamData(o) {
    if (!o.stream) return Buffer.alloc(0);
    if (o._data) return o._data;
    let d = o.stream;
    if (/\/FlateDecode|\/Fl\b/.test(o.dict)) d = inflate(d);
    o._data = d;
    return d;
  }

  get(ref) {
    if (ref == null) return null;
    const m = /^(\d+)\s+\d+\s+R$/.exec(String(ref).trim());
    return this.objects.get(m ? m[1] : String(ref)) || null;
  }

  // Value of /Key inside a dict string: ref "12 0 R", name, number, <<dict>> or [array]
  static value(dict, key) {
    const i = dict.search(new RegExp(`/${key}(?![A-Za-z0-9])`));
    if (i < 0) return null;
    let p = i + key.length + 1;
    while (/\s/.test(dict[p])) p++;
    if (dict.startsWith('<<', p)) return PdfReader.balanced(dict, p, '<<', '>>');
    if (dict[p] === '[') return PdfReader.balanced(dict, p, '[', ']');
    const m = /^(\d+\s+\d+\s+R|\/[^\s/<>[\]()]+|[-+]?\d*\.?\d+|true|false|null)/.exec(dict.slice(p));
    return m ? m[1] : null;
  }

  static balanced(s, p, open, close) {
    let depth = 0;
    for (let i = p; i < s.length; i++) {
      if (s.startsWith(open, i)) { depth++; i += open.length - 1; } else if (s.startsWith(close, i)) {
        depth--;
        i += close.length - 1;
        if (depth === 0) return s.slice(p, i + 1);
      }
    }
    return s.slice(p);
  }

  resolveDict(v) {
    if (!v) return '';
    if (/^\d+\s+\d+\s+R$/.test(v)) return (this.get(v) || {}).dict || '';
    return v;
  }

  pages() {
    const trailerRoot = /\/Root\s+(\d+\s+\d+\s+R)/.exec(this.src);
    let root = trailerRoot ? this.get(trailerRoot[1]) : null;
    if (!root) root = [...this.objects.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
    const out = [];
    const walk = (node, inherited, depth) => {
      if (!node || depth > 50) return;
      const res = PdfReader.value(node.dict, 'Resources') || inherited;
      if (/\/Type\s*\/Pages/.test(node.dict)) {
        const kids = PdfReader.value(node.dict, 'Kids') || '';
        for (const r of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(this.objects.get(r[1]), res, depth + 1);
      } else out.push({ node, resources: res });
    };
    if (root) walk(this.get(PdfReader.value(root.dict, 'Pages')), null, 0);
    if (!out.length) {
      for (const o of this.objects.values()) if (/\/Type\s*\/Page(?!s)/.test(o.dict)) out.push({ node: o, resources: PdfReader.value(o.dict, 'Resources') });
    }
    return out;
  }

  fonts(resources) {
    const fonts = new Map();
    const res = this.resolveDict(resources);
    const fdict = this.resolveDict(PdfReader.value(res, 'Font'));
    for (const m of fdict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+\s+\d+\s+R)/g)) {
      const fo = this.get(m[2]);
      if (!fo) continue;
      const enc = PdfReader.value(fo.dict, 'Encoding') || '';
      const tu = PdfReader.value(fo.dict, 'ToUnicode');
      const cmap = tu ? parseCMap(this.streamData(this.get(tu) || {}).toString('latin1')) : null;
      const twoByte = /Identity-H|Identity-V/.test(enc) || /\/Type0/.test(fo.dict) || (cmap && cmap.bytes === 2);
      fonts.set(m[1], { cmap, twoByte, cp1251: /1251|Cyrillic/i.test(enc) });
    }
    return fonts;
  }

  text() {
    const pages = [];
    for (const { node, resources } of this.pages()) {
      const fonts = this.fonts(resources);
      const contents = PdfReader.value(node.dict, 'Contents') || '';
      const parts = [];
      for (const r of contents.matchAll(/(\d+)\s+\d+\s+R/g)) {
        const o = this.objects.get(r[1]);
        if (o) parts.push(this.streamData(o));
      }
      pages.push(renderContent(Buffer.concat(parts).toString('latin1'), fonts));
    }
    return pages.join('\n\n');
  }
}

function hexToBytes(h) {
  const s = h.replace(/[^0-9a-f]/gi, '');
  const out = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2).padEnd(2, '0'), 16));
  return out;
}

function utf16beHex(h) {
  const b = hexToBytes(h);
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return s;
}

function parseCMap(src) {
  const map = new Map();
  let bytes = 1;
  const cs = /begincodespacerange\s*<([0-9a-f]+)>/i.exec(src);
  if (cs) bytes = Math.max(1, cs[1].length / 2);
  for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) map.set(parseInt(m[1], 16), utf16beHex(m[2]));
  }
  for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<[0-9a-f]*>|\[[^\]]*\])/gi)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (hi - lo > 65535) continue;
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9a-f]*)>/gi)].map((x) => utf16beHex(x[1]));
        for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, items[c - lo]);
      } else {
        const base = utf16beHex(m[3].slice(1, -1));
        const last = base.charCodeAt(base.length - 1);
        for (let c = lo; c <= hi; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(last + (c - lo)));
      }
    }
  }
  return { map, bytes };
}

const CP1251 = 'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';

function decodeString(bytes, font) {
  if (!font) return String.fromCharCode(...bytes);
  let s = '';
  const step = font.twoByte ? 2 : 1;
  for (let i = 0; i + step - 1 < bytes.length; i += step) {
    const code = step === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
    if (font.cmap && font.cmap.map.has(code)) s += font.cmap.map.get(code);
    else if (step === 1 && font.cp1251 && code >= 0x80) s += CP1251[code - 0x80];
    else if (step === 1) s += String.fromCharCode(code);
  }
  return s;
}

// Content-stream tokenizer + the handful of text operators that matter.
function renderContent(src, fonts) {
  const out = [];
  let line = '';
  let font = null;
  let lastY = null;
  const stack = [];
  const flush = () => { if (line.trim()) out.push(line.replace(/\s+/g, ' ').trim()); line = ''; };
  const newLineIfMoved = (y) => {
    if (lastY != null && Math.abs(y - lastY) > 1) flush();
    lastY = y;
  };
  let i = 0;
  const n = src.length;
  let ty = 0;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '%') { while (i < n && src[i] !== '\n' && src[i] !== '\r') i++; continue; }
    if (ch === '(') {
      // literal string with escapes and nested parentheses
      const bytes = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const c = src[i];
        if (c === '\\') {
          const d = src[i + 1];
          const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
          if (d in esc) { bytes.push(esc[d]); i += 2; } else if (/[0-7]/.test(d)) {
            const oct = /^[0-7]{1,3}/.exec(src.slice(i + 1, i + 4))[0];
            bytes.push(parseInt(oct, 8) & 255);
            i += 1 + oct.length;
          } else if (d === '\r' || d === '\n') { i += 2; if (d === '\r' && src[i] === '\n') i++; } else { i++; }
          continue;
        }
        if (c === '(') depth++;
        if (c === ')') { depth--; if (depth === 0) { i++; break; } }
        bytes.push(c.charCodeAt(0) & 255);
        i++;
      }
      stack.push({ str: bytes });
      continue;
    }
    if (ch === '<' && src[i + 1] !== '<') {
      const j = src.indexOf('>', i);
      stack.push({ str: hexToBytes(src.slice(i + 1, j)) });
      i = j + 1;
      continue;
    }
    if (ch === '<' || ch === '>') { i += 2; continue; } // dict delimiters, ignored
    if (ch === '[') { stack.push('['); i++; continue; }
    if (ch === ']') {
      const arr = [];
      while (stack.length && stack[stack.length - 1] !== '[') arr.unshift(stack.pop());
      stack.pop();
      stack.push({ arr });
      i++;
      continue;
    }
    const m = /^(\/[^\s/<>[\]()%]*|[-+]?\d*\.?\d+|[A-Za-z'"*][A-Za-z0-9'"*]*)/.exec(src.slice(i, i + 64));
    if (!m) { i++; continue; }
    const tok = m[1];
    i += tok.length;
    if (tok[0] === '/' || /^[-+]?\d*\.?\d+$/.test(tok)) { stack.push(tok[0] === '/' ? tok : Number(tok)); continue; }
    // operator
    switch (tok) {
      case 'BT': lastY = null; break;
      case 'ET': break;
      case 'Tf': font = fonts.get(String(stack[stack.length - 2] || '').slice(1)) || null; break;
      case 'Td': case 'TD': {
        const y = stack[stack.length - 1];
        const x = stack[stack.length - 2];
        if (typeof y === 'number' && Math.abs(y) > 0.5) { flush(); ty += y; lastY = ty; } else if (typeof x === 'number' && x > 0) line += ' ';
        break;
      }
      case 'Tm': {
        const y = stack[stack.length - 1];
        if (typeof y === 'number') { newLineIfMoved(y); ty = y; }
        break;
      }
      case 'T*': flush(); break;
      case 'Tj': case "'": case '"': {
        if (tok !== 'Tj') flush();
        const s = stack[stack.length - 1];
        if (s && s.str) line += decodeString(s.str, font);
        break;
      }
      case 'TJ': {
        const a = stack[stack.length - 1];
        if (a && a.arr) {
          for (const el of a.arr) {
            if (el && el.str) line += decodeString(el.str, font);
            else if (typeof el === 'number' && el < -180) line += ' ';
          }
        }
        break;
      }
      default: break;
    }
    stack.length = 0;
  }
  flush();
  return out.join('\n');
}

function pdfToTextBuiltin(buf) {
  return new PdfReader(buf).text();
}

// A scan often still has a little text (a stamp, a file name in the footer).
// Fewer letters than this per page means there is no real text layer.
const MIN_LETTERS_PER_PAGE = 200;

function letterCount(s) {
  return (s.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
}

// file -> { text, method: 'pdftotext' | 'pdf-builtin' | 'ocr', pages, cached? }
// Pages joined into one text; pageStarts[i] is the offset where page i+1 begins.
function joinPages(pageTexts) {
  const pageStarts = [];
  let text = '';
  for (const p of pageTexts) {
    if (text) text += '\n\n';
    pageStarts.push(text.length);
    text += p;
  }
  return { text, pageStarts };
}

function pdfExtract(file) {
  let text = null;
  let method = 'pdftotext';
  let pages = null;
  let pageStarts = null;
  const viaTool = pdfViaTool(file);
  if (viaTool != null) {
    const parts = viaTool.split('\f');
    if (parts.length > 1 && !parts[parts.length - 1].trim()) parts.pop();
    pages = Math.max(1, parts.length);
    ({ text, pageStarts } = joinPages(parts));
  }
  if (text == null || !text.trim()) {
    method = 'pdf-builtin';
    pageStarts = null;
    try { text = pdfToTextBuiltin(fs.readFileSync(file)); } catch { text = ''; }
  }
  // A one-page note can be honestly short, so a single sparse page is kept as
  // text and only flagged; no text at all, or several near-empty pages, is a scan.
  const letters = letterCount(text);
  const n = pages || 1;
  const isScan = letters < 30 || (n >= 2 && letters < MIN_LETTERS_PER_PAGE * n);
  if (!isScan) return { text, method, pages, pageStarts, sparse: letters < MIN_LETTERS_PER_PAGE * n };
  if (!ocr.ocrAvailable()) {
    const e = new Error(`в PDF нет текстового слоя (скан); ${ocr.ocrUnavailableReason()}`);
    e.code = 'SCAN';
    throw e;
  }
  const r = ocr.ocrPdf(file);
  return { ...joinPages(r.pageTexts), method: 'ocr', engine: r.engine, pages: r.pages, cached: r.cached };
}

function pdfToText(file) {
  return pdfExtract(file).text;
}

// ---------------------------------------------------------------- entry

const SUPPORTED = new Set(['.txt', '.md', '.markdown', '.json', '.docx', '.xlsx', '.pdf', '.html', '.htm']);

function decodeTextFile(buf) {
  // UTF-8 unless it is clearly not: then Windows-1251 (old Russian .txt files)
  const utf = buf.toString('utf8');
  if (!utf.includes('�')) return utf;
  let s = '';
  for (const b of buf) s += b < 0x80 ? String.fromCharCode(b) : CP1251[b - 0x80];
  return s;
}

// Is this readable text at all? A binary file renamed to .txt, a broken
// encoding or a PDF decoded with the wrong font map give mostly symbols.
function looksLikeText(text) {
  const sample = String(text).slice(0, 20000);
  if (sample.trim().length < 20) return false;
  const good = (sample.match(/[A-Za-zА-Яа-яЁё0-9\s.,;:!?()«»"'№%\-–—/|_]/g) || []).length;
  const letters = letterCount(sample);
  // the longest run without a space: real text has words
  const longest = sample.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
  return good / sample.length >= 0.85 && letters / sample.length >= 0.3 && longest <= 400;
}

// file -> { text, method, pages?, title?, cached? }. `method` says how the
// text was obtained and goes into the ingest report.
// Workbook -> [{ name, rows: [{ r, cells: [{ ref, col, value, formula }] }] }].
// Cached values are read as they are stored; formulas are kept as text.
const XLSX_MAX_CELLS = 200000;

function xlsxSheets(buffer) {
  const zip = readZip(buffer);
  const read = (name) => zip.read(name)?.toString('utf8') || '';
  const textRuns = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1])).join('');
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]));
  const relations = new Map([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]+>/g)]
    .map(([tag]) => [attr(tag, 'Id'), attr(tag, 'Target')]));
  const sheets = [];
  const seen = new Set();
  let cellCount = 0;
  for (const [sheet] of read('xl/workbook.xml').matchAll(/<sheet\s[^>]+>/g)) {
    const target = relations.get(attr(sheet, 'r:id'));
    // each sheet file is read once, even if the workbook lists it many times
    if (!target || seen.has(target)) continue;
    seen.add(target);
    const name = decodeEntities(attr(sheet, 'name') || 'Лист');
    const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const rows = [];
    for (const [, rowTag, row] of read(sheetPath).matchAll(/(<row\s[^>]*>)([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const [, tag, body] of row.matchAll(/(<c(?:\s[^>]*)?(?<!\/)>)([\s\S]*?)<\/c>/g)) {
        const ref = attr(tag, 'r') || '';
        const type = attr(tag, 't');
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const f = body.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/)?.[1];
        let value = type === 's' ? shared[Number(raw)] : type === 'inlineStr' ? textRuns(body) : raw && decodeEntities(raw);
        value = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
        // 0.30000000000000004 and the like: stored binary fractions
        if (/^-?\d+\.\d{7,}$/.test(value)) value = String(Number(Number(value).toFixed(6)));
        const formula = f ? `=${decodeEntities(f)}` : '';
        if (value || formula) cells.push({ ref, col: ref.replace(/\d+$/, ''), value, formula });
        if (++cellCount > XLSX_MAX_CELLS) throw new Error(`В таблице больше ${XLSX_MAX_CELLS} ячеек, такие файлы не принимаются.`);
      }
      if (cells.length) rows.push({ r: Number(attr(rowTag, 'r')) || rows.length + 1, cells });
    }
    if (rows.length) sheets.push({ name, rows });
  }
  return sheets;
}

function sheetsToText(sheets) {
  const lines = [];
  for (const sh of sheets) {
    for (const row of sh.rows) {
      lines.push(`Лист «${sh.name}», строка ${row.r}: ${row.cells.map((c) => `${c.ref} ${[c.value, c.formula].filter(Boolean).join(' ')}`).join(' | ')}`);
    }
  }
  return lines.join('\n\n');
}

function xlsxToText(buffer) {
  return sheetsToText(xlsxSheets(buffer));
}

function extractDocument(file, ext) {
  const buf = fs.readFileSync(file);
  switch (ext) {
    case '.xlsx': {
      const sheets = xlsxSheets(buf);
      return { text: sheetsToText(sheets), method: 'xlsx', sheets };
    }
    case '.docx': return { text: docxToText(buf), method: 'docx' };
    case '.pdf': return pdfExtract(file);
    case '.html': case '.htm': {
      const html = decodeTextFile(buf);
      return { text: htmlToText(html), method: 'html', title: htmlTitle(html) };
    }
    default: return { text: decodeTextFile(buf), method: 'text' };
  }
}

// file -> plain text (json is handled by the caller)
function extractText(file, ext) {
  return extractDocument(file, ext).text;
}

module.exports = {
  extractText, extractDocument, docxToText, xlsxSheets, xlsxToText, htmlToText, htmlTitle, pdfToText, pdfExtract, pdfToTextBuiltin, readZip, parseCMap,
  decodeTextFile, looksLikeText, SUPPORTED,
};
