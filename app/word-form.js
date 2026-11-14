'use strict';

const { writeZip } = require('../rag/src/zip');

const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const esc = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const run = (text, bold, size) => '<w:r>' + (bold || size ? '<w:rPr>' + (bold ? '<w:b/>' : '') + (size ? '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' : '') + '</w:rPr>' : '') +
  text.split(/\r\n?|\n/u).map(line => '<w:t xml:space="preserve">' + esc(line) + '</w:t>').join('<w:br/>') + '</w:r>';
function paragraph(text, { align, before = 0, after = 100, keep = false, style, bold = false, indent = 0, size, split = false } = {}) {
  return '<w:p><w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '') +
    (keep ? '<w:keepNext/>' : '') + (split ? '' : '<w:keepLines/>') + '<w:spacing w:before="' + before + '" w:after="' + after + '" w:line="264" w:lineRule="auto"/>' +
    (indent ? '<w:ind w:firstLine="' + indent + '"/>' : '') +
    (align ? '<w:jc w:val="' + align + '"/>' : '') + '</w:pPr>' + run(text, bold, size) + '</w:p>';
}

function wordForm(body) {
  return writeZip({
    '[Content_Types].xml': xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': xml + '<w:styles xmlns:w="' + word + '"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style></w:styles>',
    'word/document.xml': xml + '<w:document xmlns:w="' + word + '"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1270" w:right="1273" w:bottom="1270" w:left="1273" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
  });
}

module.exports = { paragraph, wordForm };
