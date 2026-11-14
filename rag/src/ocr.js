'use strict';
// OCR for scanned PDFs (no text layer). Optional: the core works without it,
// a scan is then reported as "needs OCR" instead of being indexed empty.
//
// Engine: the recognizer built into Windows (Windows.Media.Ocr), driven by
// tools/ocr-win.ps1. Nothing is installed and nothing leaves the machine.
// Pages are rendered by `pdftoppm` (poppler; RAG_PDFTOPPM or PATH, or next to
// pdftotext). Results are cached by file hash: a 50-page scan takes about a
// minute, and the same file is usually ingested many times.
//
// Env: RAG_OCR=0 turns it off, RAG_OCR_LANG (ru), RAG_OCR_DPI (200),
//      RAG_OCR_CACHE (default: <os tmp>/rag-ocr-cache).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const PS1 = path.join(__dirname, '..', 'tools', 'ocr-win.ps1');

function which(cmd) {
  try {
    execFileSync(cmd, ['-v'], { stdio: 'ignore', timeout: 5000 });
    return cmd;
  } catch (e) {
    return e.code !== 'ENOENT' && e.status != null ? cmd : null;
  }
}

let pdftoppm;
function findPdftoppm() {
  if (pdftoppm !== undefined) return pdftoppm;
  const cands = [process.env.RAG_PDFTOPPM, 'pdftoppm'];
  if (process.env.RAG_PDFTOTEXT) cands.push(path.join(path.dirname(process.env.RAG_PDFTOTEXT), 'pdftoppm'));
  pdftoppm = null;
  for (const c of cands.filter(Boolean)) {
    if (which(c)) { pdftoppm = c; break; }
  }
  return pdftoppm;
}

let tesseract;
function findTesseract() {
  if (tesseract !== undefined) return tesseract;
  tesseract = null;
  for (const c of [process.env.RAG_TESSERACT, 'tesseract'].filter(Boolean)) {
    if (which(c)) { tesseract = c; break; }
  }
  return tesseract;
}

// Which recognizer runs here: the one built into Windows, or Tesseract
// (Linux, macOS, Docker; also Windows when RAG_OCR_ENGINE=tesseract).
function ocrEngine() {
  if (process.env.RAG_OCR === '0' || !findPdftoppm()) return null;
  const want = process.env.RAG_OCR_ENGINE;
  const win = process.platform === 'win32' && fs.existsSync(PS1);
  if (want === 'tesseract') return findTesseract() ? 'tesseract' : null;
  if (want === 'windows') return win ? 'windows' : null;
  if (win) return 'windows';
  return findTesseract() ? 'tesseract' : null;
}

function ocrAvailable() {
  return !!ocrEngine();
}

// Why OCR cannot run here, as a sentence for the ingest report.
function ocrUnavailableReason() {
  if (process.env.RAG_OCR === '0') return 'распознавание выключено (RAG_OCR=0)';
  if (!findPdftoppm()) return 'не найден pdftoppm (poppler): установите poppler-utils или укажите путь в RAG_PDFTOPPM';
  if (process.platform !== 'win32') return 'не найден tesseract: установите tesseract-ocr с русским языком (tesseract-ocr-rus)';
  return 'нет скрипта tools/ocr-win.ps1 и не найден tesseract';
}

// OCR output -> text. Each input line is "left<TAB>top<TAB>height<TAB>text",
// pages separated by a form feed. Lines are put in reading order, lines of one
// row are joined, a larger vertical gap becomes a blank line.
function layoutPages(raw) {
  const result = [];
  for (const page of raw.split('\f')) {
    const out = [];
    const items = [];
    for (const l of page.split('\n')) {
      const m = /^(\d+)\t(\d+)\t(\d+)\t(.*)$/.exec(l.replace(/\r$/, ''));
      if (m && m[4].trim()) items.push({ x: +m[1], y: +m[2], h: +m[3] || 20, t: m[4].trim() });
    }
    if (!items.length) { result.push(''); continue; }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(it.y - row.y) < 0.6 * Math.max(row.h, it.h)) {
        row.parts.push(it);
        row.h = Math.max(row.h, it.h);
      } else rows.push({ y: it.y, h: it.h, parts: [it] });
    }
    const heights = rows.map((r) => r.h).sort((a, b) => a - b);
    const lineH = heights[Math.floor(heights.length / 2)] || 30;
    let prev = null;
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      if (prev && r.y - prev.y > 2.2 * lineH) out.push('');
      out.push(fixOcrLine(r.parts.map((p) => p.t).join(' ')));
      prev = r;
    }
    result.push(out.join('\n').replace(/\n{3,}/g, '\n\n').trim());
  }
  return result;
}

function layoutToText(raw) {
  return layoutPages(raw).filter(Boolean).join('\n\n').trim();
}

// Typical confusions of the recognizer in Russian office text. Only the
// unambiguous ones are fixed: a clause number typed with the letter "З"
// instead of the digit 3, and "М 273-ФЗ" where the scan has "№".
function fixOcrLine(s) {
  let t = s;
  t = t.replace(/^([0-9ЗзОо]{1,2}(?:\.[0-9ЗзОо]{1,2}){0,3})\.(?=\s)/, (m0, num) => (/\d/.test(num) || /^[Зз]$/.test(num)
    ? `${num.replace(/[Зз]/g, '3').replace(/[Оо]/g, '0')}.`
    : m0));
  t = t.replace(/(^|\s)[МN][еo]?\s(?=\d{1,5}(?:[-/][0-9А-ЯЁа-яё]+)*(?:\s|[,.;)]|$))/g, '$1№ ');
  // "N2 138-1", "NQ 3897-1", "Ng 12": the sign "№" read as a letter and a digit
  t = t.replace(/(^|[\s(«"])(?:N[2QО°º9gо]|Ng)\s?(?=\d{1,5}(?:\s?-{1,2}\s?\d|\b))/g, '$1№ ');
  // "в течение З календарных дней": the digit 3 read as the letter
  t = t.replace(/(^|\s)[Зз](?=\s+(?:\(|календарн|рабоч|дн|месяц|час|суток|лет|год))/g, '$13');
  return t;
}

function cacheDir() {
  return process.env.RAG_OCR_CACHE || path.join(os.tmpdir(), 'rag-ocr-cache');
}

function renderPages(file, work, dpi) {
  execFileSync(findPdftoppm(), ['-r', dpi, '-gray', '-png', file, path.join(work, 'p')], { stdio: 'ignore', timeout: 15 * 60 * 1000 });
  // pdftoppm pads page numbers only as much as needed (p-1 ... p-12): pad so
  // the sort by name is the page order
  const names = [];
  for (const f of fs.readdirSync(work)) {
    const m = /^p-(\d+)\.png$/.exec(f);
    if (!m) continue;
    const name = `p-${m[1].padStart(5, '0')}.png`;
    fs.renameSync(path.join(work, f), path.join(work, name));
    names.push(name);
  }
  return names.sort();
}

function windowsPages(work, lang) {
  const tmpOut = path.join(work, 'out.txt');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Dir', work, '-Out', tmpOut, '-Lang', lang], {
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 30 * 60 * 1000,
  });
  const pages = layoutPages(fs.readFileSync(tmpOut, 'utf8'));
  if (pages.length > 1 && !pages[pages.length - 1]) pages.pop(); // the script ends every page with a form feed
  return pages;
}

// Tesseract is asked for word boxes (TSV), not for plain text: its own page
// segmentation puts a column of clause numbers ("1.1.", "1.2.") into a
// separate block before the text. Lines are rebuilt from the boxes with the
// same geometry rules as for the Windows engine, so a number stays on the
// line of its clause.
function tsvToLayout(tsv) {
  const lines = new Map();
  for (const row of tsv.split('\n')) {
    const f = row.split('\t');
    if (f[0] !== '5' || f.length < 12) continue; // level 5 = word
    const text = f.slice(11).join('\t').trim();
    if (!text) continue;
    const key = `${f[2]}-${f[3]}-${f[4]}`;
    const left = Number(f[6]);
    const top = Number(f[7]);
    const height = Number(f[9]);
    const l = lines.get(key);
    if (!l) lines.set(key, { left, top, height, words: [text] });
    else {
      l.left = Math.min(l.left, left);
      l.top = Math.min(l.top, top);
      l.height = Math.max(l.height, height);
      l.words.push(text);
    }
  }
  return [...lines.values()].map((l) => `${l.left}\t${l.top}\t${l.height}\t${l.words.join(' ')}`).join('\n');
}

function tesseractPages(work, names, lang) {
  return names.map((name) => {
    const out = execFileSync(findTesseract(), [path.join(work, name), 'stdout', '-l', lang, '--psm', '4', '-c', 'tessedit_create_tsv=1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    });
    const tsv = out.toString('utf8');
    if (!tsv.startsWith('level\tpage_num\t')) throw new Error('Tesseract не вернул координаты текста в формате TSV.');
    return layoutPages(tsvToLayout(tsv))[0] || '';
  });
}

// file -> { text, pages, pageTexts, engine, cached }. Throws with a readable message.
function ocrPdf(file, opts = {}) {
  const engine = ocrEngine();
  if (!engine) throw new Error(ocrUnavailableReason());
  const lang = opts.lang || process.env.RAG_OCR_LANG || (engine === 'tesseract' ? 'rus' : 'ru');
  const dpi = String(opts.dpi || process.env.RAG_OCR_DPI || (engine === 'tesseract' ? 300 : 200));
  const buf = fs.readFileSync(file);
  const key = crypto.createHash('sha1').update(buf).update(`${engine}:${lang}:${dpi}:v4`).digest('hex');
  const dir = opts.cacheDir || cacheDir();
  const cached = path.join(dir, `${key}.txt`);
  const done = (pageTexts, isCached) => ({ text: pageTexts.join('\n\n').trim(), pages: pageTexts.length, pageTexts, engine, cached: isCached });
  if (fs.existsSync(cached)) return done(fs.readFileSync(cached, 'utf8').split('\f'), true);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-ocr-'));
  try {
    const names = renderPages(file, work, dpi);
    const pageTexts = engine === 'tesseract' ? tesseractPages(work, names, lang) : windowsPages(work, lang);
    if (!pageTexts.some(text => text.trim())) throw new Error('На страницах скана не найден текст.');
    // the cache only saves time: a read-only or foreign folder must not fail the recognition
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cached, pageTexts.join('\f'));
    } catch { /* no cache */ }
    return done(pageTexts, false);
  } catch (e) {
    const msg = e.stderr && String(e.stderr).trim() ? String(e.stderr).trim().split('\n')[0] : e.message;
    throw new Error(`распознавание не удалось: ${msg}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { ocrAvailable, ocrEngine, ocrUnavailableReason, ocrPdf, layoutToText, layoutPages, tsvToLayout, fixOcrLine };
