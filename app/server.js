'use strict';
// «Маршрут»: the web application. Serves the interface, keeps the document
// library, answers questions from it, and stores routes checked by an editor.
//
//   node app/server.js              bundled documents (corpus/case) + uploads
//   node app/server.js <folder>     documents of <folder> instead of the bundled ones
//   node app/server.js --prepare    read (and OCR) the bundled documents, print the report, exit
//
// Environment: HOST, PORT, DATA_DIR, CORPUS_DIRS, EDITOR_TOKEN, READER_TOKEN,
// SECURE_COOKIES, LLM_BASE_URL, LLM_MODEL, LLM_API_KEY, GIGACHAT_CREDENTIALS, GIGACHAT_MODEL,
// ALLOW_EXTERNAL_LLM — see README.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { Library } = require('./library');
const { createAccess } = require('./document-access');
const sceneExamples = require('../notes/asset-library/scene-examples');
const sceneGalleryExamples = require('../notes/asset-library/scene-gallery-examples');
const glossary = require('../notes/asset-library/glossary-terms');
const { readForm, sourceUrl } = require('./import');
const { fetchLink } = require('./fetch-link');
const { makeDraft, publishedRoute, publishDraft } = require('./draft');
const { tripAnswer } = require('./trip');
const { aidAnswer } = require('./aid');
const { addFlsScenes, fullFlsRoute } = require('./fls-scenes');
const { documentId: concertId, fullConcertRoute } = require('./concert-scenes');
const { documentId: staffingId, question: staffingQuestion, fullStaffingRoute } = require('./staffing-scenes');
const { attachForms, formFile } = require('./forms');
const { documentId: supportId, question: supportQuestion, fullSupportRoute } = require('./support-scenes');
const { documentId: housingId, question: housingQuestion, fullHousingRoute } = require('./housing-scenes');
const { createHandler, docView, send } = require('../rag/server');

const root = path.resolve(__dirname, '..');
const sceneDirectory = 'notes/asset-library/';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain',
};
const ORIGINAL_MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const PROCEDURE = /^(как|каким образом|что (?:нужно|надо|делать)|с чего|порядок|какой порядок)(?![а-яё])/i;
const runFile = promisify(execFile);

async function extractPdfPage(file, page) {
  const pdfToText = process.env.RAG_PDFTOTEXT;
  const program = process.env.RAG_PDFSEPARATE || (pdfToText && path.isAbsolute(pdfToText)
    ? path.join(path.dirname(pdfToText), 'pdfseparate') : 'pdfseparate');
  const dir = await fs.promises.mkdtemp(path.join(tmpdir(), 'marshrut-appendix-'));
  try {
    const n = String(page);
    await runFile(program, ['-f', n, '-l', n, file, path.join(dir, 'page-%d.pdf')], { timeout: 10000 });
    return await fs.promises.readFile(path.join(dir, 'page-' + n + '.pdf'));
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

// Interface files and the scene library (flat folder of html/js/css/svg).
function staticAssets() {
  const assets = new Map([
    ['/', 'app/index.html'],
    ['/app.css', 'app/app.css'],
    ['/app.js', 'app/app.js'],
    ['/graphite.css', 'notes/mockup/graphite.css'],
    ['/graphite.js', 'notes/mockup/graphite.js'],
    ['/notes/mockup/graphite.css', 'notes/mockup/graphite.css'],
    ['/notes/mockup/graphite.js', 'notes/mockup/graphite.js'],
  ]);
  const scenes = path.join(root, sceneDirectory);
  if (fs.existsSync(scenes)) {
    for (const name of fs.readdirSync(scenes)) {
      if (MIME[path.extname(name)]) assets.set(`/${sceneDirectory}${name}`, sceneDirectory + name);
    }
  }
  // Saved MIPT source texts used by the scene boards outside the search corpus.
  const sourceDirectory = 'corpus/text/';
  const sourcePath = path.join(root, sourceDirectory);
  if (fs.existsSync(sourcePath)) {
    for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
      if (entry.isFile() && /^mipt-[a-z0-9-]+\.txt$/.test(entry.name)) {
        const file = sourceDirectory + entry.name;
        assets.set('/' + file, file);
      }
    }
  }
  return assets;
}

// A language model may see the documents only if it runs next to the
// application: this machine, the private network, or a service of the same
// compose file. Anything else needs an explicit ALLOW_EXTERNAL_LLM=1.
function modelIsLocal(url) {
  try {
    const host = new URL(url).hostname;
    return !host.includes('.') || host === 'host.docker.internal'
      || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '[::1]';
  } catch { return false; }
}

function config(env = process.env, argv = process.argv.slice(2)) {
  const folder = argv.find((a) => !a.startsWith('--'));
  const dirs = folder ? [folder] : (env.CORPUS_DIRS || 'corpus/case').split(/[;,]/).map((d) => d.trim()).filter(Boolean);
  for (const kind of ['LLM', 'EMBED']) {
    const url = env[`${kind}_BASE_URL`];
    if (url && env.ALLOW_EXTERNAL_LLM !== '1' && !modelIsLocal(url)) {
      console.warn(`[маршрут] ${kind}_BASE_URL указывает на внешний сервис и не используется: документы не покидают контур. Разрешить: ALLOW_EXTERNAL_LLM=1`);
      for (const key of Object.keys(env)) if (key.startsWith(`${kind}_`)) delete env[key];
    }
  }
  if (env.GIGACHAT_CREDENTIALS && !env.LLM_BASE_URL && env.ALLOW_EXTERNAL_LLM !== '1') {
    console.warn('[маршрут] GIGACHAT_CREDENTIALS заданы, но GigaChat — внешний сервис и не используется. Разрешить: ALLOW_EXTERNAL_LLM=1');
    for (const key of Object.keys(env)) if (key.startsWith('GIGACHAT_')) delete env[key];
  }
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8787),
    dataDir: path.resolve(root, env.DATA_DIR || 'data'),
    seedDirs: dirs.map((d) => path.resolve(root, d)),
    seedCacheDir: path.join(root, 'corpus', '.cache'),
    editorToken: env.EDITOR_TOKEN || '',
    readerToken: env.READER_TOKEN || '',
    secureCookies: env.SECURE_COOKIES === '1',
    llm: Boolean(env.LLM_BASE_URL || env.GIGACHAT_CREDENTIALS),
    examples: readExamples(),
  };
}

function readExamples() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'examples.json'), 'utf8')); } catch { return []; }
}

async function readJsonBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new Error('Слишком большой запрос.');
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function buildApplication(options = {}) {
  const cfg = { ...config(options.env, options.argv), ...options };
  const library = new Library({ dataDir: cfg.dataDir, seedDirs: cfg.seedDirs, seedCacheDir: cfg.seedCacheDir });
  library.seed();
  await library.build();
  const assets = staticAssets();
  const routesDir = path.join(cfg.dataDir, 'routes');
  const bundledRoutesDir = path.join(__dirname, 'bundled-routes');
  const publicationFor = (id) => path.join(routesDir, `${createHash('sha256').update(id).digest('hex').slice(0, 32)}.json`);
  const readablePublicationFor = (id) => {
    const saved = publicationFor(id);
    return fs.existsSync(saved) ? saved : path.join(bundledRoutesDir, path.basename(saved));
  };
  const store = () => library.store;
  function reviewedWalkthrough(st, id) {
    if (id === concertId) return fullConcertRoute(st, 'Как забронировать концертный зал?', library.original(id));
    if (id === staffingId) return fullStaffingRoute(st, staffingQuestion, library.original(id));
    if (id === supportId) return fullSupportRoute(st, supportQuestion, library.original(id));
    if (id === housingId) return fullHousingRoute(st, housingQuestion, library.original(id));
    return null;
  }
  const access = createAccess(library, cfg);
  const authenticatedEditor = req => access.role(req) === 'editor' || access.headerEditor(req);
  const canReadInternal = req => Boolean(access.role(req) || access.headerEditor(req));
  const demoEditor = !cfg.editorToken && !cfg.readerToken && ['127.0.0.1', '::1', 'localhost'].includes(cfg.host);
  const isEditor = req => demoEditor || authenticatedEditor(req);
  const mayRead = (req, id) => access.mode(id) !== 'internal' || canReadInternal(req);
  const mayReadForm = (req, entry) => entry && store().docById.has(entry.doc)
    && (!entry.sourceSha || library.original(entry.doc)?.sha === entry.sourceSha)
    && mayRead(req, entry.doc) && (!entry.sourceDoc || mayRead(req, entry.sourceDoc));
  const addAccessLabels = (result, req) => {
    const docs = [result.document, ...(result.documents || []), ...(result.related || []).map(row => row.document)];
    // Check again in case the editor restricted a document during a long search.
    if (docs.some(doc => doc?.id && !mayRead(req, doc.id))) {
      for (const key of Object.keys(result)) delete result[key];
      Object.assign(result, { not_found: true, message: 'Ответ по доступным регламентам не найден.', steps: [], documents: [] });
      return result;
    }
    for (const doc of docs) {
      if (doc?.id) {
        doc.access = access.mode(doc.id);
        const source = library.original(doc.id)?.source;
        if (source) doc.source = source;
      }
    }
    for (const step of result.steps || []) {
      if (step.forms) step.forms = step.forms.filter(form => form.documentId
        ? mayRead(req, form.documentId) : mayReadForm(req, formFile(form.download.split('/').pop())));
    }
    // A short answer that retells a whole route has no clause of its own: point it
    // at the clauses its steps come from, not at the document as a whole.
    if (result.summary && !result.summary_cite && result.document?.id) {
      const own = [];
      for (const step of result.steps || []) {
        for (const cite of step.cites || []) {
          if (cite.doc === result.document.id && cite.label && !own.some(c => c.label === cite.label)) own.push(cite);
        }
      }
      if (own.length) {
        const first = own[0], last = own[own.length - 1];
        const label = own.length === 1 ? first.label
          : 'пп. ' + String(first.clause || first.label).replace(/^п\.\s*/, '') + '–' + String(last.clause || last.label).replace(/^п\.\s*/, '');
        result.summary_cite = { ...first, label };
      }
    }
    return result;
  };

  const exampleDependencies = new Set([
    ...Object.values(sceneExamples).flatMap(group => Object.values(group).map(example => example.route.doc)),
    'mipt-otpuska-obuch', 'mipt-perevod', 'mipt-platnoe-besplatnoe', 'mipt-otchislenie',
    'mipt-stipendii', 'mipt-pvtr', 'mipt-kollektivnyy-dogovor',
    'mipt-polozhenie-o-zakupke', 'mipt-zakupka-ep-svyshe100',
  ]);

  // Links to the page of the original file, and the checked route if there is one.
  function decorate(answer, st) {
    const cites = [...answer.steps.flatMap((s) => s.cites), ...(answer.related || []).flatMap((r) => r.cites)];
    if (answer.summary_cite) cites.push(answer.summary_cite);
    for (const c of cites) {
      const entry = library.original(c.doc);
      if (entry && entry.ext === '.pdf' && c.page) c.original = `/original/${encodeURIComponent(c.doc)}#page=${c.page}`;
    }
    if (answer.not_found || !answer.document) return;
    const id = answer.document.id;
    const route = publishedRoute(st, readablePublicationFor(id), id, reviewedWalkthrough(st, id));
    if (!route) {
      const walkthrough = id === concertId
        ? fullConcertRoute(st, answer.question, library.original(id))
        : fullFlsRoute(st, answer.question);
      if (walkthrough?.document.id === id) {
        answer.steps = walkthrough.steps;
        answer.summary = walkthrough.summary;
        answer.summary_cite = walkthrough.summary_cite;
      } else if (PROCEDURE.test(answer.question)) addFlsScenes(answer);
      attachForms(answer);
      return;
    }
    answer.route = { id, url: `/?route=${encodeURIComponent(id)}`, publishedAt: route.publishedAt, used: false };
    if (PROCEDURE.test(answer.question)) {
      answer.steps = route.steps;
      addFlsScenes(answer);
      answer.summary = `Маршрут по документу «${answer.document.title}», проверенный редактором.`;
      answer.summary_cite = null;
      answer.route.used = true;
    }
    attachForms(answer);
  }

  const api = createHandler({
    getStore: req => access.store(canReadInternal(req)),
    accessMode: access.mode,
    annotate: addAccessLabels,
    // where each document came from, for the library list
    docExtra: (id) => { const e = library.byId.get(id); return e ? { origin: e.origin, addedAt: e.addedAt || null } : {}; },
    corsOrigin: 'null',
    localOnly: () => !cfg.llm,
    // only open documents may go to an external model
    mayLeave: id => access.mode(id) !== 'internal',
    preparedAnswer(st, question) {
      const answer = tripAnswer(st, question) || aidAnswer(st, question)
        || fullStaffingRoute(st, question, library.original(staffingId))
        || fullSupportRoute(st, question, library.original(supportId))
        || fullHousingRoute(st, question, library.original(housingId));
      if (!answer) return answer;
      if (!PROCEDURE.test(question)) return attachForms(answer);
      const id = answer.document.id;
      const route = publishedRoute(st, readablePublicationFor(id), id, reviewedWalkthrough(st, id));
      if (!route) return attachForms(answer);
      return attachForms({
        ...answer,
        steps: route.steps,
        summary: `Маршрут по документу «${answer.document.title}», проверенный редактором.`,
        summary_cite: null,
        route: { id, url: `/?route=${encodeURIComponent(id)}`, publishedAt: route.publishedAt, used: true },
      });
    },
    decorate,
    askOpts: { mode: cfg.llm ? 'auto' : 'extractive', maxSteps: 8 },
  });

  function listRoutes(req) {
    const out = [];
    const names = new Set([routesDir, bundledRoutesDir].flatMap(dir => fs.existsSync(dir) ? fs.readdirSync(dir) : []));
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const saved = path.join(routesDir, name);
      const file = fs.existsSync(saved) ? saved : path.join(bundledRoutesDir, name);
      let pub;
      try { pub = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      const doc = pub.id ? store().docById.get(pub.id) : null;
      if (!doc || !mayRead(req, pub.id)) continue;
      const live = publishedRoute(store(), file, pub.id, reviewedWalkthrough(store(), pub.id));
      out.push({ id: pub.id, title: doc.title, publishedAt: pub.publishedAt, url: `/?route=${encodeURIComponent(pub.id)}`, steps: pub.approved.length, stale: !live });
    }
    return out;
  }

  let importQueue = Promise.resolve();
  async function importFiles(req) {
    const form = await readForm(req);
    const files = form.getAll('files').filter((f) => typeof f !== 'string' && f.size > 0);
    const link = String(form.get('source') || '').trim();
    if (!files.length && !link) throw new Error('Выберите файлы или вставьте ссылку на документ или страницу сайта.');
    let incoming;
    let unreachable = [];
    if (files.length) {
      // with files the link only records where the file is published
      const source = sourceUrl(form, files.length);
      incoming = await Promise.all(files.map(async (f) => ({ name: path.basename(f.name), buffer: Buffer.from(await f.arrayBuffer()), source })));
    } else {
      // without files the server downloads the document, or every document listed on the page
      const got = await fetchLink(link);
      incoming = got.files;
      unreachable = got.failed;
    }
    const task = importQueue.then(async () => {
      const added = [];
      const skipped = [...unreachable];
      for (const file of incoming) {
        const result = await library.add(file.buffer, file.name, { source: file.source });
        if (result.status === 'added') added.push(result.entry);
        else skipped.push({ name: file.name, reason: result.reason });
      }
      if (added.length) await library.build();
      const shas = new Set(added.map((e) => e.sha));
      const reports = store().index.docs
        .filter((d) => shas.has(library.byId.get(d.id).sha))
        .map((d) => ({ id: d.id, file: d.file, title: d.title, status: d.meta.status, supersededBy: d.meta.supersededBy, report: d.report }));
      return { added: added.length, skipped, reports, count: store().index.docs.length };
    });
    importQueue = task.catch(() => {});
    return task;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, body) => send(res, status, body, { 'cache-control': 'no-store' });
    try {
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        const foreign = origin && !['http://', 'https://'].some(scheme => origin === scheme + req.headers.host);
        if (foreign || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) {
          res.writeHead(403).end();
          return;
        }
      }
      if (req.method === 'POST' && url.pathname === '/session') {
        const body = await readJsonBody(req, 8192).catch(() => ({}));
        const outcome = access.login(req, body?.code);
        if (outcome.cookie) res.setHeader('Set-Cookie', outcome.cookie);
        json(outcome.status, outcome.error ? { error: outcome.error } : { role: outcome.role });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/session/logout') {
        res.setHeader('Set-Cookie', access.logout(req));
        json(200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/documents/delete') {
        if (!authenticatedEditor(req)) { json(401, { error: 'Войдите с кодом редактора.' }); return; }
        try {
          const { id } = await readJsonBody(req, 8192);
          // in the same queue as uploads, so the two never rebuild the index at once
          const task = importQueue.then(async () => {
            const result = library.remove(String(id || ''));
            if (result.status !== 'removed') throw new Error(result.reason);
            await library.build();
            return { removed: id, count: store().index.docs.length };
          });
          importQueue = task.catch(() => {});
          json(200, await task);
        } catch (error) {
          json(400, { error: error.message });
        }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/documents/access') {
        if (!authenticatedEditor(req)) { json(401, { error: 'Войдите с кодом редактора.' }); return; }
        try {
          const { id, mode } = await readJsonBody(req, 8192);
          if (mode === 'internal' && !cfg.editorToken && !cfg.readerToken) throw new Error('Настройте код доступа.');
          access.change(id, mode);
          json(200, { id, mode });
        } catch (error) {
          json(400, { error: error.message });
        }
        return;
      }
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const fileName = path.basename(url.pathname);
        const archive = /^\/corpus\/text\/(mipt-[a-z0-9-]+)\.txt$/.exec(url.pathname);
        const isBoard = url.pathname.startsWith('/' + sceneDirectory);
        if ((archive && !mayRead(req, archive[1]))
          || (isBoard && /^aid-(?:route-data\.js|route\.html|comic\.html|animation\.html)$/.test(fileName)
            && !mayRead(req, 'mipt-matpomosch-obuch'))) {
          json(404, { error: 'Документ недоступен.' });
          return;
        }
        if (isBoard && ['mipt-scene-library.html', 'index.html'].includes(fileName)
          && [...exampleDependencies].some(id => !mayRead(req, id))) {
          res.writeHead(302, { location: '/' + sceneDirectory + 'scene-workshop.html' }).end();
          return;
        }
        if (isBoard && ['scene-examples.js', 'glossary-terms.js'].includes(fileName)) {
          const pairs = Object.entries(sceneExamples).map(([type, group]) =>
            [type, Object.fromEntries(Object.entries(group).filter(([, example]) => mayRead(req, example.route.doc)))]);
          const value = fileName === 'scene-examples.js' ? Object.fromEntries(pairs) : glossary.filter(term => mayRead(req, term.doc));
          const target = fileName === 'scene-examples.js' ? 'SceneExamples' : 'RouteTerms';
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
          res.end('window.' + target + ' = ' + JSON.stringify(value) + ';');
          return;
        }

        if (isBoard && fileName === 'scene-gallery-examples.js') {
          const examples = sceneGalleryExamples.flatMap(example => {
            if (!mayRead(req, example.doc)) return [];
            const doc = store().docById.get(example.doc);
            const cite = doc && docView(doc).nodes.find(node => node.id === example.clause);
            if (!cite) return [];
            return [{ ...example, sourceLabel: cite.label, href: '/doc/' + encodeURIComponent(example.doc)
              + '?format=html#' + encodeURIComponent(cite.anchor) }];
          });
          for (const { id, group, question, buildRoute, clauses, template } of [
            { id: supportId, group: 'Техподдержка', question: supportQuestion, buildRoute: fullSupportRoute,
              clauses: ['прил.1/4.4', 'прил.1/3.4', 'прил.1/4.6'], template: 'followup' },
            { id: housingId, group: 'Общежитие', question: housingQuestion, buildRoute: fullHousingRoute,
              clauses: ['2.7', '2.9'], template: 'transfer' },
          ]) {
            if (!mayRead(req, id)) continue;
            const route = buildRoute(store(), question, library.original(id));
            for (const step of route?.steps || []) {
              const cite = step.cites.find(item => clauses.includes(item.clause));
              if (!cite || step.sceneChoice.template !== template) continue;
              examples.push({
                group, doc: id, clause: cite.clause, scene: step.sceneChoice, sourceLabel: cite.label,
                href: '/doc/' + encodeURIComponent(id) + '?format=html#' + encodeURIComponent(cite.anchor),
              });
            }
          }
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
          res.end('window.SceneGalleryExamples = ' + JSON.stringify(examples) + ';');
          return;
        }

        const file = assets.get(url.pathname);
        fs.readFile(path.join(root, file), (error, data) => {
          if (error) { res.writeHead(404).end(); return; }
          res.writeHead(200, { 'content-type': `${MIME[path.extname(file)]}; charset=utf-8`, 'cache-control': 'no-store' });
          res.end(data);
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/forms/appendix') {
        const id = url.searchParams.get('id');
        const page = Number(url.searchParams.get('page'));
        const entry = library.original(id);
        const pages = store().docById.get(id)?.report?.pages;
        if (entry?.ext !== '.pdf' || !mayRead(req, id) || !pages || !Number.isInteger(page) || page < 1 || page > pages) {
          json(404, { error: 'Страница бланка недоступна.' });
          return;
        }
        let data;
        try { data = await extractPdfPage(entry.path, page); }
        catch {
          json(422, { error: 'Страницу не удалось скачать отдельно. Откройте её в оригинале регламента.' });
          return;
        }
        if (!mayRead(req, id)) { json(404, { error: 'Страница бланка недоступна.' }); return; }
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('Приложение — страница ' + page + '.pdf')}`,
          'cache-control': 'private, no-store',
        });
        res.end(data);
        return;
      }
      const form = /^\/forms\/([a-z0-9-]+)(\/preview)?$/.exec(url.pathname);
      if (req.method === 'GET' && form) {
        const entry = formFile(form[1]);
        if (!mayReadForm(req, entry)) { json(404, { error: 'Бланк не найден.' }); return; }
        if (form[2]) {
          const preview = entry.previewFile && path.join(path.dirname(entry.path), path.basename(entry.previewFile));
          if (!preview || !fs.existsSync(preview)) { json(404, { error: 'Предпросмотр недоступен.' }); return; }
          const data = await fs.promises.readFile(preview);
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, no-store' });
          res.end(data);
          return;
        }
        const data = await fs.promises.readFile(entry.path);
        res.writeHead(200, {
          'content-type': ORIGINAL_MIME[path.extname(entry.filename)] || 'application/octet-stream',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(entry.filename)}`,
          'x-content-type-options': 'nosniff',
          'cache-control': 'private, no-store',
        });
        res.end(data);
        return;
      }
      const original = /^\/original\/(.+)$/.exec(url.pathname);
      if (req.method === 'GET' && original) {
        const entry = library.original(decodeURIComponent(original[1]));
        if (!entry || !mayRead(req, decodeURIComponent(original[1]))) { json(404, { error: 'Оригинал не найден.' }); return; }
        // only PDF opens in the browser; everything else is downloaded, never rendered
        const inline = entry.ext === '.pdf';
        res.writeHead(200, {
          'content-type': ORIGINAL_MIME[entry.ext] || 'application/octet-stream',
          'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(entry.file)}`,
          'x-content-type-options': 'nosniff',
          'cache-control': 'private, no-store',
        });
        fs.createReadStream(entry.path).pipe(res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/corpus') {
        const visible = access.store(canReadInternal(req)).index;
        json(200, { official: true, mixed: false, count: visible.docs.length, failures: visible.failures, examples: cfg.examples, llm: cfg.llm });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/session') {
        json(200, { editor: isEditor(req), role: access.role(req), canManage: authenticatedEditor(req), protected: Boolean(cfg.editorToken || cfg.readerToken) });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/routes') { json(200, listRoutes(req)); return; }
      if (req.method === 'GET' && ['/routes/draft', '/routes/published'].includes(url.pathname)) {
        const id = url.searchParams.get('id') || '';
        if (!mayRead(req, id)) { json(404, { error: 'Маршрут недоступен.' }); return; }
        const walkthrough = reviewedWalkthrough(store(), id);
        const route = url.pathname === '/routes/draft'
          ? makeDraft(store(), id, walkthrough)
          : publishedRoute(store(), readablePublicationFor(id), id, walkthrough);
        json(route ? 200 : 404, route ? addAccessLabels(attachForms(route), req) : { error: 'Маршрут пока недоступен.' });
        return;
      }
      const fill = url.pathname.match(/^\/forms\/([a-z0-9-]+)\/filled$/);
      if (req.method === 'POST' && fill) {
        const template = formFile(fill[1]);
        if (!template?.generator || !mayReadForm(req, template)) {
          json(404, { error: 'Бланк для заполнения недоступен.' });
          return;
        }
        let values;
        try {
          values = template.generator.parse(await readJsonBody(req, 256 * 1024));
        } catch (error) {
          json(400, { error: error instanceof SyntaxError ? 'Не удалось прочитать поля бланка.' : error.message });
          return;
        }
        const document = await template.generator.render(values, template.path);
        res.writeHead(200, {
          'content-type': ORIGINAL_MIME['.docx'],
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(template.fill.filename)}`,
          'x-content-type-options': 'nosniff',
          'cache-control': 'private, no-store',
        });
        res.end(document);
        return;
      }
      if (req.method === 'POST' && ['/import', '/routes/publish'].includes(url.pathname)) {
        if (!(url.pathname === '/import' ? authenticatedEditor(req) : isEditor(req))) { json(401, { error: 'Войдите с кодом редактора.' }); return; }
        try {
          if (url.pathname === '/import') json(200, await importFiles(req));
          else {
            const review = await readJsonBody(req);
            if (typeof review?.id !== 'string' || !mayRead(req, review.id)) throw new Error('Выберите документ.');
            json(200, addAccessLabels(attachForms(publishDraft(store(), publicationFor(review.id), review, reviewedWalkthrough(store(), review.id))), req));
          }
        } catch (error) {
          json(400, { error: error.message });
        }
        return;
      }
      await api(req, res);
    } catch (error) {
      if (!res.headersSent) json(500, { error: 'Внутренняя ошибка. Повторите запрос.' });
      console.error(error);
    }
  });
  return { server, library, config: cfg, get store() { return library.store; } };
}

function printReport(store) {
  for (const d of store.index.docs) {
    const r = d.report;
    const n = Object.entries(r.nodes).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`  ${d.file}\n    ${r.method}${r.engine ? `/${r.engine}` : ''}${r.pages ? `, стр. ${r.pages}` : ''} · ${n} · ${d.meta.status}${r.warnings.length ? ` · ${r.warnings.join('; ')}` : ''}`);
  }
  for (const f of store.index.failures) console.log(`  НЕ ПРОЧИТАН ${f.file}: ${f.reason}`);
}

if (require.main === module) {
  buildApplication()
    .then(({ server, store, config: cfg }) => {
      const failed = store.index.failures.length;
      if (process.argv.includes('--prepare')) {
        console.log(`Прочитано документов: ${store.index.docs.length}, не прочитано: ${failed}`);
        printReport(store);
        return;
      }
      server.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
      server.listen(cfg.port, cfg.host, () => {
        console.log(`Маршрут · http://${cfg.host}:${cfg.port} · документов: ${store.index.docs.length}${failed ? `, не прочитано: ${failed}` : ''} · ответы: ${cfg.llm ? 'модель + проверка цитат' : 'выдержки из документов'}${cfg.editorToken ? ' · загрузка по коду редактора' : ''}`);
        for (const f of store.index.failures) console.log(`  не прочитан ${f.file}: ${f.reason}`);
      });
    })
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { buildApplication };
