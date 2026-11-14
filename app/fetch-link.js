'use strict';
// Import by link: the editor gives the address of a document or of a site page
// that lists documents (for example a page of mipt.ru). The server downloads them.
//
// Only public addresses are fetched: a link to localhost or to the internal network
// is refused before the request and after every redirect.

const dns = require('node:dns/promises');
const net = require('node:net');
const path = require('node:path');

const DOC_EXT = new Set(['.pdf', '.docx', '.xlsx', '.txt', '.md']);
const TYPE_EXT = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'text/markdown': '.md',
};
const maxFile = 40 * 1024 * 1024;
const maxPage = 4 * 1024 * 1024;
const maxLinks = 30;
const timeoutMs = 30000;

// Addresses of this machine and of private networks. net.BlockList also matches
// an IPv4 address written inside IPv6 ("::ffff:127.0.0.1" is turned by URL into
// "::ffff:7f00:1", which a string check missed).
const internal = new net.BlockList();
for (const [addr, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['100.64.0.0', 10], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 3]]) internal.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [['::', 128], ['::1', 128], ['::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]) internal.addSubnet(addr, bits, 'ipv6');

function privateAddress(ip) {
  const type = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null;
  return !type || internal.check(ip, type);
}

function parseLink(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { throw new Error('Введите ссылку HTTP или HTTPS.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Введите ссылку HTTP или HTTPS.');
  url.hash = '';
  return url;
}

async function checkHost(url, opts) {
  if (opts.allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(privateAddress)) throw new Error('Ссылка ведёт во внутреннюю сеть, такие адреса не загружаются.');
}

// GET with redirects followed by hand, so every hop is checked.
async function get(url, limit, opts) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await checkHost(current, opts);
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'marshrut-import/1.0' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = parseLink(new URL(res.headers.get('location'), current).href);
      continue;
    }
    if (!res.ok) throw new Error(`Сайт ответил ${res.status}: ${current.href}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > limit) throw new Error(`Файл больше ${Math.round(limit / 1048576)} МБ: ${current.href}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > limit) throw new Error(`Файл больше ${Math.round(limit / 1048576)} МБ: ${current.href}`);
      chunks.push(chunk);
    }
    return { url: current, type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), body: Buffer.concat(chunks) };
  }
  throw new Error('Слишком много перенаправлений.');
}

function fileName(url, type) {
  let base = path.posix.basename(url.pathname);
  try { base = decodeURIComponent(base); } catch { /* keep as is */ }
  base = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(-150) || 'document';
  const ext = path.extname(base).toLowerCase();
  if (DOC_EXT.has(ext)) return base;
  return base + (TYPE_EXT[type] || '.html');
}

// Document links on a page, same order as on the page, without repeats.
function documentLinks(html, pageUrl) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = (m[2] ?? m[3] ?? m[4] ?? '').replace(/&amp;/g, '&');
    let url;
    try { url = new URL(href, pageUrl); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    url.hash = '';
    let ext = path.extname(url.pathname).toLowerCase();
    try { ext = path.extname(decodeURIComponent(url.pathname)).toLowerCase(); } catch { /* keep */ }
    if (!DOC_EXT.has(ext) || seen.has(url.href)) continue;
    seen.add(url.href);
    out.push(url);
  }
  return out;
}

// Returns { files: [{ name, buffer, source }], failed: [{ name, reason }], page: bool }
async function fetchLink(raw, opts = {}) {
  const url = parseLink(raw);
  const first = await get(url, maxFile, opts);
  const isPage = first.type === 'text/html' || first.type === 'application/xhtml+xml';
  if (!isPage) return { files: [{ name: fileName(first.url, first.type), buffer: first.body, source: first.url.href }], failed: [], page: false };
  if (first.body.length > maxPage) throw new Error('Страница слишком большая.');
  const links = documentLinks(first.body.toString('utf8'), first.url);
  // a page without document links is itself the document
  if (!links.length) return { files: [{ name: fileName(first.url, first.type), buffer: first.body, source: first.url.href }], failed: [], page: true };
  const files = [];
  const failed = [];
  for (const link of links.slice(0, maxLinks)) {
    try {
      const got = await get(link, maxFile, opts);
      files.push({ name: fileName(got.url, got.type), buffer: got.body, source: got.url.href });
    } catch (error) {
      failed.push({ name: link.href, reason: error.message });
    }
  }
  if (links.length > maxLinks) failed.push({ name: first.url.href, reason: `На странице ${links.length} документов, загружены первые ${maxLinks}.` });
  return { files, failed, page: true };
}

module.exports = { fetchLink, documentLinks, privateAddress, fileName };
