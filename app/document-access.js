'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { prepare } = require('../rag/src/store');

const cookieName = 'marshrut_session';
const sessionSeconds = 8 * 3600;

function sameSecret(a, b) {
  if (!a || !b || typeof a !== 'string') return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function createAccess(library, config) {
  const file = path.join(config.dataDir, 'access.json');
  const modes = new Map(fs.existsSync(file) ? Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))) : []);
  const secret = randomBytes(32);
  const sessions = new Map();
  const failures = new Map();
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  let cachedIndex, publicStore;

  function accessMode(entry) {
    if (modes.has(entry.sha)) return modes.get(entry.sha) === 'shared' ? 'shared' : 'internal';
    return entry.origin === 'upload' ? 'internal' : 'shared';
  }

  function mode(id) {
    const entry = library.original(id);
    return entry ? accessMode(entry) : null;
  }

  function change(id, next) {
    const entry = library.original(id);
    if (!entry || !['internal', 'shared'].includes(next)) throw new Error('Укажите документ и режим доступа.');
    const updated = new Map(modes).set(entry.sha, next);
    const temp = file + '.' + randomBytes(10).toString('hex');
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temp, JSON.stringify(Object.fromEntries(updated)), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
    modes.set(entry.sha, next);
    cachedIndex = null;
  }

  function store(internal) {
    if (internal) return library.store;
    const index = library.store.index;
    if (index === cachedIndex) return publicStore;
    const ids = new Set(index.docs.filter(doc => mode(doc.id) === 'shared').map(doc => doc.id));
    const docs = index.docs.filter(doc => ids.has(doc.id)).map(doc => {
      if (!doc.meta?.supersededBy || ids.has(doc.meta.supersededBy)) return doc;
      return { ...doc, meta: { ...doc.meta, supersededBy: null } };
    });
    publicStore = prepare({
      ...index, docs, chunks: index.chunks.filter(chunk => ids.has(chunk.docId)),
      embeddings: null, failures: [],
    });
    cachedIndex = index;
    return publicStore;
  }

  function sessionId(req) {
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim())
      .find(part => part.startsWith(cookieName + '='));
    const [id, signature] = cookie?.slice(cookieName.length + 1).split('.') || [];
    if (!id || !sameSecret(signature, sign(id))) return null;
    return id;
  }

  function role(req) {
    const id = sessionId(req);
    const session = sessions.get(id);
    if (!session) return null;
    if (session.until <= Date.now()) {
      sessions.delete(id);
      return null;
    }
    return session.role;
  }

  function headerEditor(req) {
    return sameSecret(req.headers['x-editor-token'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), config.editorToken);
  }

  function cookie(req, value, age) {
    return cookieName + '=' + value + '; Path=/; Max-Age=' + age + '; HttpOnly; SameSite=Strict'
      + (config.secureCookies || req.socket.encrypted ? '; Secure' : '');
  }

  function login(req, code) {
    const address = req.socket.remoteAddress;
    const now = Date.now();
    for (const [key, row] of failures) if (row.until <= now) failures.delete(key);
    const failed = failures.get(address);
    if (failed?.count >= 10) return { status: 429, error: 'Слишком много попыток. Повторите через 10 минут.' };
    const next = sameSecret(code, config.editorToken) ? 'editor'
      : sameSecret(code, config.readerToken) ? 'reader' : null;
    if (!next) {
      if (failures.size < 10000 || failed) failures.set(address, { count: (failed?.count || 0) + 1, until: failed?.until || now + 600000 });
      return { status: 401, error: 'Код доступа не подошёл.' };
    }
    failures.delete(address);
    for (const [id, session] of sessions) if (session.until <= now) sessions.delete(id);
    if (sessions.size >= 10000) return { status: 503, error: 'Сейчас слишком много активных сеансов.' };
    sessions.delete(sessionId(req));
    const id = randomBytes(32).toString('base64url');
    sessions.set(id, { role: next, until: now + sessionSeconds * 1000 });
    return { status: 200, role: next, cookie: cookie(req, id + '.' + sign(id), sessionSeconds) };
  }

  function logout(req) {
    sessions.delete(sessionId(req));
    return cookie(req, '', 0);
  }

  return { mode, change, store, role, headerEditor, login, logout };
}

module.exports = { createAccess };
