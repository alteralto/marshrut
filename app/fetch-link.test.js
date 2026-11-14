'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { fetchLink, documentLinks, privateAddress, fileName } = require('./fetch-link');

function serve(routes) {
  const server = http.createServer((req, res) => {
    const r = routes[req.url];
    if (!r) { res.writeHead(404).end(); return; }
    res.writeHead(r.status || 200, r.headers || {});
    res.end(r.body || '');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('page links: documents only, resolved, without repeats', () => {
  const html = `<a href="/files/a.pdf">A</a><a href='b.docx'>B</a><a href="/files/a.pdf#p2">A again</a>
    <a href="/news">news</a><a href="mailto:x@y">mail</a><a href=c.XLSX>C</a>`;
  const links = documentLinks(html, new URL('https://mipt.ru/docs/'));
  assert.deepStrictEqual(links.map(String), ['https://mipt.ru/files/a.pdf', 'https://mipt.ru/docs/b.docx', 'https://mipt.ru/docs/c.XLSX']);
});

test('internal addresses are refused', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.2', '172.20.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1']) {
    assert.ok(privateAddress(ip), ip);
  }
  assert.ok(!privateAddress('176.53.224.203'));
  // URL rewrites an IPv4 address inside IPv6 to hex; it is still this machine
  for (const h of ['[::ffff:127.0.0.1]', '[::ffff:c0a8:1]', '[64:ff9b::7f00:1]']) assert.ok(privateAddress(new URL('http://' + h + '/').hostname.slice(1, -1)), h);
  await assert.rejects(fetchLink('http://127.0.0.1:9/x.pdf'), /внутреннюю сеть/);
  await assert.rejects(fetchLink('file:///etc/passwd'), /HTTP или HTTPS/);
});

test('file name keeps the Russian name and adds an extension by type', () => {
  assert.strictEqual(fileName(new URL('https://mipt.ru/upload/%D0%9F%D0%BE%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5.docx'), ''), 'Положение.docx');
  assert.strictEqual(fileName(new URL('https://mipt.ru/download?id=5'), 'application/pdf'), 'download.pdf');
});

test('a document link downloads the file; a page link downloads every document on it', async () => {
  const server = await serve({
    '/doc.pdf': { headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.4 test' },
    '/moved': { status: 302, headers: { location: '/doc.pdf' } },
    '/page': { headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<a href="/doc.pdf">1</a> <a href="/missing.docx">2</a>' },
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const one = await fetchLink(base + '/moved', { allowPrivate: true });
    assert.strictEqual(one.page, false);
    assert.strictEqual(one.files[0].name, 'doc.pdf');
    assert.strictEqual(one.files[0].source, base + '/doc.pdf');
    assert.strictEqual(one.files[0].buffer.toString(), '%PDF-1.4 test');

    const page = await fetchLink(base + '/page', { allowPrivate: true });
    assert.strictEqual(page.page, true);
    assert.deepStrictEqual(page.files.map((f) => f.name), ['doc.pdf']);
    assert.strictEqual(page.failed.length, 1);
    assert.match(page.failed[0].reason, /404/);
  } finally {
    server.close();
  }
});
