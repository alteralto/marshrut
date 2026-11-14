'use strict';
// Shared fixtures for tests: an in-memory index over fixtures/docs (no model
// endpoints involved) and tiny builders for .docx / .pdf files.

const path = require('node:path');
const zlib = require('node:zlib');
const { buildIndex, prepare } = require('../src/store');
const { writeZip: zip } = require('../src/zip');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'docs');
// Explicitly empty endpoints: tests must not depend on the developer's env.
const OFFLINE = { llmBaseUrl: '', embedBaseUrl: '', synonymsFile: null };

let storePromise = null;
function fixtureStore() {
  if (!storePromise) storePromise = buildIndex([FIXTURES], { embed: false }).then(prepare);
  return storePromise;
}

// .docx with Word auto-numbering: paragraphs given as [text, numId|null, ilvl]
function docx(paragraphs, numberingXml) {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = paragraphs.map(([text, numId, ilvl]) => {
    const pPr = numId ? `<w:pPr><w:numPr><w:ilvl w:val="${ilvl || 0}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` : '';
    return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  }).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    'word/numbering.xml': `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}>${numberingXml}</w:numbering>`,
  });
}

// One-page text PDF with an Identity-H font, a ToUnicode CMap and a
// Flate-compressed content stream: the layout real exporters produce.
function pdf(lines) {
  const chars = [...new Set(lines.join(''))];
  const code = new Map(chars.map((c, k) => [c, k + 1]));
  const hex = (s) => [...s].map((c) => code.get(c).toString(16).padStart(4, '0')).join('');
  const content = `BT /F1 12 Tf 72 720 Td ${lines.map((l, k) => `${k ? '0 -16 Td ' : ''}<${hex(l)}> Tj`).join(' ')} ET`;
  const deflated = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const u16 = (c) => Buffer.from(c, 'utf16le').swap16().toString('hex');
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
${chars.length} beginbfchar
${chars.map((c) => `<${code.get(c).toString(16).padStart(4, '0')}> <${u16(c)}>`).join('\n')}
endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const parts = [];
  const obj = (n, s) => parts.push(Buffer.from(`${n} 0 obj\n${s}\nendobj\n`, 'latin1'));
  parts.push(Buffer.from('%PDF-1.4\n', 'latin1'));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
  obj(4, '<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /ToUnicode 6 0 R >>');
  parts.push(Buffer.from(`5 0 obj\n<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), deflated, Buffer.from('\nendstream\nendobj\n', 'latin1'));
  obj(6, `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
  parts.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
  return Buffer.concat(parts);
}

module.exports = { fixtureStore, FIXTURES, OFFLINE, zip, docx, pdf };
