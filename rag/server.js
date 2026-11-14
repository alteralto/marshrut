#!/usr/bin/env node
'use strict';
// HTTP API for the web UI. node:http only, no framework.
//
//   POST /ask           {"question": "...", "mode"?: "auto|llm|extractive", "verifier"?: "drop|flag"}
//   GET  /doc/:id       full regulation split into clauses, each with an anchor
//                       (?format=html for a ready page, &hl=2.3,2.4 to highlight)
//   GET  /docs          list of indexed regulations
//   GET  /health        index stats and which model endpoints are configured
//
// Env: PORT (8787), HOST (127.0.0.1), RAG_INDEX, CORS_ORIGIN (*), plus the
// LLM_* / EMBED_* variables used by ask().

const http = require('node:http');
const rag = require('./src');
const { llmConfig, embedConfig } = require('./src/openai');
const { decodeTextFile } = require('./src/extract');

const MAX_BODY = 64 * 1024;

function anchorOf(id) {
  return `cl-${String(id).replace(/[^0-9a-zа-яё]+/gi, '-').replace(/^-+|-+$/g, '')}`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function docView(d, store) {
  const used = new Set();
  const m = d.meta || {};
  const other = (id) => { const x = store && id ? store.docById.get(id) : null; return x ? { id: x.id, title: x.title } : null; };
  return {
    id: d.id,
    title: d.title,
    url: d.url || null,
    file: d.file || null,
    number: m.number || null,
    date: m.date || null,
    status: m.status || null,
    supersededBy: other(m.supersededBy),
    report: d.report || null,
    nodes: d.nodes.map((n) => {
      let a = anchorOf(n.id);
      while (used.has(a)) a += '-';
      used.add(a);
      return { id: n.id, anchor: a, kind: n.kind, label: n.label, parent: n.parent, heading: !!n.heading, text: n.text, page: n.page || null };
    }),
  };
}

function docSummary(d) {
  const m = d.meta || {};
  return {
    id: d.id, title: d.title, url: d.url || null, file: d.file || null, clauses: d.nodes.length,
    kind: m.kind || null, number: m.number || null, date: m.date || null, status: m.status || null, supersededBy: m.supersededBy || null,
    report: d.report || null,
  };
}

function embeddedClauseAnchor(anchor, line) {
  return `${anchor}-line-${line + 1}`;
}

function docHtml(view, highlight) {
  const hl = new Set(highlight);
  const rows = view.nodes.map((n) => {
    const tag = n.heading || n.kind === 'appendix' ? 'h3' : 'p';
    const cls = [n.kind, hl.has(n.id) ? 'hl' : ''].filter(Boolean).join(' ');
    const num = n.kind === 'para' || n.kind === 'appendix' ? '' : `<a class="num" href="#${n.anchor}">${escapeHtml(n.id.replace(/^прил\.\d+\//, ''))}</a> `;
    const text = n.text.split('\n').map((line, index) => {
      const escaped = escapeHtml(line);
      return index > 0 && /^\s*\d+\.\d+\.\s/u.test(line)
        ? `<span id="${embeddedClauseAnchor(n.anchor, index)}">${escaped}</span>`
        : escaped;
    }).join('<br>');
    return `<${tag} id="${n.anchor}" class="${cls}">${num}${text}</${tag}>`;
  });
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(view.title)}</title>
<style>
:root{color-scheme:light dark;--ink:#1d1d1f;--paper:#fff;--link:#0066cc;--mark:#e8f2ff;--mark-edge:#bfd7f2}
@media(prefers-color-scheme:dark){:root{--ink:#f5f5f7;--paper:#1c1c20;--link:#79baff;--mark:#1b344c;--mark-edge:#476684}}
@media print{:root{color-scheme:light;--ink:#1d1d1f;--paper:#fff;--link:#1d1d1f;--mark:#fff;--mark-edge:#ddd}}
body{font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:48rem;margin:clamp(24px,6vw,68px) auto;padding:0 20px;color:var(--ink);background:var(--paper)}
h1{font-size:clamp(1.6rem,4vw,2.5rem);line-height:1.12;letter-spacing:-.045em;font-weight:650;margin-bottom:1.6rem}
h3{font-size:1.1rem;line-height:1.3;margin-top:1.6rem}.sub{margin-left:1.5rem}
.num{color:var(--link);text-decoration:none;font-variant-numeric:tabular-nums}.num:hover{text-decoration:underline}
.hl,:target{background:var(--mark);outline:1px solid var(--mark-edge);outline-offset:4px;border-radius:6px}
[id]{scroll-margin-top:20px}
.status{padding:10px 14px;border:1px solid var(--mark-edge);border-radius:8px;background:var(--mark)}.file{opacity:.7;font-size:.9rem}
</style></head><body>
<h1>${escapeHtml(view.title)}</h1>
${view.status && view.status !== 'действует' ? `<p class="status">${escapeHtml(view.status.charAt(0).toUpperCase() + view.status.slice(1))}.${view.supersededBy ? ` Действует: <a href="/doc/${encodeURIComponent(view.supersededBy.id)}?format=html">${escapeHtml(view.supersededBy.title)}</a>` : ''}</p>` : ''}
${view.file ? `<p class="file">Файл: ${escapeHtml(view.file)}${view.report && view.report.warnings.length ? ` · ${escapeHtml(view.report.warnings.join('; '))}` : ''}</p>` : ''}
${rows.join('\n')}
<script>const h=document.querySelector('.hl');if(h&&!location.hash)h.scrollIntoView({block:'center'});</script>
</body></html>`;
}

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string';
  const data = isText ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': isText ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    // UTF-8, or Windows-1251 from a Windows console curl
    req.on('end', () => resolve(decodeTextFile(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

function createHandler(opts = {}) {
  const indexPath = opts.indexPath || process.env.RAG_INDEX || rag.DEFAULT_INDEX;
  const corsOrigin = opts.corsOrigin || process.env.CORS_ORIGIN || '*';
  const askOpts = opts.askOpts || {};
  const getStore = opts.getStore || (() => rag.getStore({ indexPath, store: opts.store }));

  return async (req, res) => {
    let snapshot;
    const store = () => (snapshot ||= getStore(req));
    const cors = {
      'access-control-allow-origin': corsOrigin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-max-age': '86400',
    };
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    if (corsOrigin !== '*') res.setHeader('vary', 'origin');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      if (req.method === 'GET' && url.pathname === '/health') {
        let st = null;
        let error = null;
        try { st = store(); } catch (e) { error = e.message; }
        send(res, st ? 200 : 503, {
          ok: !!st,
          error,
          index: indexPath,
          docs: st ? st.index.docs.length : 0,
          chunks: st ? st.index.chunks.length : 0,
          createdAt: st ? st.index.createdAt : null,
          llm: llmConfig(askOpts) ? { configured: true, model: llmConfig(askOpts).model } : { configured: false },
          embeddings: st && st.vectors ? { model: st.embedModel, query_endpoint: !!embedConfig(askOpts) } : null,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/docs') {
        const st = store();
        send(res, 200, st.index.docs.map(doc => ({ ...docSummary(doc), ...(opts.accessMode ? { access: opts.accessMode(doc.id) } : {}), ...(opts.docExtra ? opts.docExtra(doc.id) : {}) })));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/report') {
        const st = store();
        send(res, 200, { docs: st.index.docs.map(doc => ({ ...docSummary(doc), ...(opts.accessMode ? { access: opts.accessMode(doc.id) } : {}) })), failures: st.index.failures || [] });
        return;
      }

      const m = /^\/doc\/(.+)$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const id = decodeURIComponent(m[1]);
        const d = store().docById.get(id);
        if (!d) { send(res, 404, { error: `document ${id} not found` }); return; }
        const view = docView(d, store());
        if (url.searchParams.get('format') === 'html') {
          send(res, 200, docHtml(view, (url.searchParams.get('hl') || '').split(',').filter(Boolean)));
        } else send(res, 200, view);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/ask') {
        let body;
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch (e) {
          send(res, e.status || 400, { error: e.status ? e.message : 'body must be JSON: {"question": "..."}' });
          return;
        }
        const question = typeof body.question === 'string' ? body.question.trim() : '';
        if (!question) { send(res, 400, { error: 'field "question" is required' }); return; }
        if (question.length > 2000) { send(res, 400, { error: 'question is too long (max 2000 chars)' }); return; }
        const mode = (typeof opts.localOnly === 'function' ? opts.localOnly(req) : opts.localOnly) ? 'extractive' : ['auto', 'llm', 'extractive'].includes(body.mode) ? body.mode : askOpts.mode;
        const verifier = body.verifier === 'flag' ? 'flag' : 'drop';
        const prepared = opts.preparedAnswer?.(store(), question);
        if (prepared) { opts.annotate?.(prepared, req); send(res, 200, prepared); return; }
        const answer = await rag.ask(question, { ...askOpts, indexPath, store: store(), mode, verifier, mayLeave: opts.mayLeave, debug: body.debug === true });
        // links for the "show the source" panel
        const cites = [...answer.steps.flatMap((x) => x.cites), ...(answer.related || []).flatMap((x) => x.cites)];
        if (answer.summary_cite) cites.push(answer.summary_cite);
        for (const c of cites) c.anchor = anchorOf(c.clause);
        if (answer.document) answer.document.source = `/doc/${encodeURIComponent(answer.document.id)}`;
        if (opts.decorate) opts.decorate(answer, store());
        opts.annotate?.(answer, req);
        send(res, 200, answer);
        return;
      }

      send(res, 404, { error: 'not found', routes: ['POST /ask', 'GET /doc/:id', 'GET /docs', 'GET /report', 'GET /health'] });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  };
}

function createServer(opts = {}) {
  return http.createServer(createHandler(opts));
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => {
    console.log(`regulation navigator API on http://${host}:${port} (index: ${process.env.RAG_INDEX || rag.DEFAULT_INDEX})`);
  });
}

module.exports = { createServer, createHandler, anchorOf, embeddedClauseAnchor, docView, docSummary, send };
