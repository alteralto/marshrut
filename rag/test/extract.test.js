'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { docxToText, htmlToText, pdfToTextBuiltin, decodeTextFile } = require('../src/extract');
const { buildIndex } = require('../src/store');
const { docx, pdf } = require('./helpers');

const NUMBERING = `
<w:abstractNum w:abstractNumId="0">
  <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
  <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1">
  <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="russianLower"/><w:lvlText w:val="%1)"/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>`;

const PARAS = [
  ['ПОЛОЖЕНИЕ', null],
  ['о командировках', null],
  ['Общие положения', '1', 0],
  ['Положение устанавливает порядок командировок.', '1', 1],
  ['Порядок оформления', '1', 0],
  ['Работник подаёт служебную записку:', '1', 1],
  ['в отдел кадров;', '2', 0],
  ['в бухгалтерию.', '2', 0],
  ['Аванс перечисляется на карту.', '1', 1],
];

test('docx: Word auto-numbering is rebuilt as text', () => {
  const text = docxToText(docx(PARAS, NUMBERING));
  assert.deepEqual(text.split('\n'), [
    'ПОЛОЖЕНИЕ', 'о командировках', '1. Общие положения', '1.1. Положение устанавливает порядок командировок.',
    '2. Порядок оформления', '2.1. Работник подаёт служебную записку:', 'а) в отдел кадров;', 'б) в бухгалтерию.', '2.2. Аванс перечисляется на карту.',
  ]);
});

test('docx and pdf files go through ingest into clauses', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-extract-'));
  try {
    fs.writeFileSync(path.join(dir, 'kom.docx'), docx(PARAS, NUMBERING));
    fs.writeFileSync(path.join(dir, 'prop.pdf'), pdf(['ИНСТРУКЦИЯ о пропусках', '1. При утрате пропуска сообщите в бюро пропусков.', '2. Дубликат изготавливается за три дня.']));
    process.env.RAG_PDF_BUILTIN = '1'; // exercise the built-in reader even if pdftotext is installed
    const index = await buildIndex([dir], { embed: false });
    const kom = index.docs.find((d) => d.id === 'kom');
    assert.equal(kom.title, 'Положение о командировках');
    assert.deepEqual(kom.nodes.map((n) => n.id), ['1', '1.1', '2', '2.1', '2.1(а)', '2.1(б)', '2.2']);
    const prop = index.docs.find((d) => d.id === 'prop');
    assert.deepEqual(prop.nodes.map((n) => n.id), ['1', '2']);
    assert.match(prop.nodes[0].text, /При утрате пропуска/);
  } finally {
    delete process.env.RAG_PDF_BUILTIN;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pdf: built-in reader decodes Identity-H text via ToUnicode', () => {
  const text = pdfToTextBuiltin(pdf(['Первая строка: «ёлка» №5', 'Вторая строка.']));
  assert.equal(text, 'Первая строка: «ёлка» №5\nВторая строка.');
});

test('html: block tags become lines, entities decoded, scripts dropped', () => {
  const t = htmlToText('<html><head><title>x</title></head><body><h1>Положение</h1><p>1.&nbsp;Первый&nbsp;пункт &laquo;А&raquo;</p><script>alert(1)</script><ul><li>а) один</li><li>б) два</li></ul><table><tr><td>Срок</td><td>3 дня</td></tr></table></body></html>');
  assert.deepEqual(t.split('\n').filter(Boolean), ['Положение', '1. Первый пункт «А»', 'а) один', 'б) два', 'Срок | 3 дня']);
});

test('text files in Windows-1251 are decoded', () => {
  const cp = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]); // "Привет"
  assert.equal(decodeTextFile(cp), 'Привет');
  assert.equal(decodeTextFile(Buffer.from('Привет', 'utf8')), 'Привет');
});
