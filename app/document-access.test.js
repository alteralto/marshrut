'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { buildApplication } = require('./server');

test('internal documents are absent from guest search and require a live reader or editor session', async t => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'marshrut-access-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const seedDir = path.join(directory, 'seed');
  await fs.mkdir(seedDir);
  await fs.writeFile(path.join(seedDir, 'omega.txt'),
    'Положение о передаче специальных заявок\n\n1. Сотрудник направляет заявку «Омега Сапфир» в управление для рассмотрения.');
  const { server } = await buildApplication({
    seedDirs: [seedDir], dataDir: path.join(directory, 'data'), seedCacheDir: path.join(directory, 'cache'),
    readerToken: 'reader-for-tests', editorToken: 'editor-for-tests', llm: false,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const get = (url, cookie) => fetch(origin + url, { headers: cookie ? { cookie } : {} });
  const post = (url, body, cookie) => fetch(origin + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const login = async code => {
    const response = await post('/session', { code });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const [doc] = await get('/docs').then(response => response.json());
  assert.equal(doc.access, 'shared');
  assert.equal((await get(doc.url)).status, 200);
  const editor = await login('editor-for-tests');
  const reader = await login('reader-for-tests');
  const policy = { id: doc.id, mode: 'internal' };
  assert.equal((await post('/documents/access', policy, reader)).status, 401);
  assert.equal((await post('/documents/access', policy, editor)).status, 200);
  assert.deepEqual(await get('/docs').then(response => response.json()), []);
  assert.equal((await get(doc.url)).status, 404);
  assert.equal((await get('/doc/' + doc.id + '?format=html')).status, 404);
  assert.equal((await get('/routes/draft?id=' + doc.id)).status, 404);
  const question = { question: 'Куда направляют заявку Омега Сапфир?' };
  assert.equal((await post('/ask', question).then(response => response.json())).not_found, true);
  assert.equal((await post('/ask', question, reader).then(response => response.json())).document.id, doc.id);
  assert.equal((await get(doc.url, reader)).headers.get('cache-control'), 'private, no-store');
  await post('/session/logout', {}, reader);
  assert.equal((await get(doc.url, reader)).status, 404);
  assert.equal((await post('/documents/access', { ...policy, mode: 'shared' }, editor)).status, 200);
  assert.equal((await get(doc.url)).status, 200);
});
