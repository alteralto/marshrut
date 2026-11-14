'use strict';
// Minimal OpenAI-compatible client (LM Studio, vLLM, Ollama /v1, llama.cpp
// server, Cloud.ru FM...) plus GigaChat with its own token. Uses global fetch
// from Node 22.

const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const tls = require('node:tls');

const GIGACHAT_API = 'https://gigachat.devices.sberbank.ru/api/v1';
const GIGACHAT_AUTH = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
// GigaChat certificates are issued by the Russian Trusted Root CA. It is
// trusted only for the GigaChat requests, not for the rest of the server.
const GIGACHAT_CA = path.join(__dirname, '..', 'certs', 'russian_trusted_root_ca.pem');

function isLocalUrl(u) {
  try {
    const host = new URL(u).hostname.replace(/^\[|\]$/g, '');
    return !host.includes('.') || host === 'host.docker.internal' || host === '::1'
      || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  } catch { return false; }
}

function trimSlash(u) {
  return String(u || '').replace(/\/+$/, '');
}

function baseWithV1(u) {
  const b = trimSlash(u);
  return /\/v\d+$/.test(b) ? b : `${b}/v1`;
}

// HTTPS with an extra root certificate: global fetch cannot take one per request.
function request(url, { method = 'POST', headers = {}, body = '', ca, timeoutMs = 60000 }) {
  if (!ca || !url.startsWith('https:')) {
    return fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) })
      .then(async (res) => ({ status: res.status, text: await res.text() }));
  }
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: { ...headers, 'content-length': Buffer.byteLength(body) }, ca, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout after ${timeoutMs} ms: ${url}`)));
    req.on('error', reject);
    req.end(body);
  });
}

let gigachatCa = null;
function caFor(cfg) {
  if (!cfg.gigachat) return undefined;
  if (!gigachatCa) gigachatCa = [...tls.rootCertificates, fs.readFileSync(cfg.gigachat.caFile, 'utf8')];
  return gigachatCa;
}

// A GigaChat token lives 30 minutes; it is taken again a minute before it ends.
const tokens = new Map();
async function bearer(cfg, fresh = false) {
  if (!cfg.gigachat) return cfg.apiKey;
  const { credentials, scope, authUrl } = cfg.gigachat;
  const cached = tokens.get(credentials);
  if (!fresh && cached && cached.expiresAt - Date.now() > 60000) return cached.token;
  const res = await request(authUrl, {
    headers: { authorization: `Basic ${credentials}`, rqUID: crypto.randomUUID(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: `scope=${encodeURIComponent(scope)}`,
    ca: caFor(cfg),
    timeoutMs: 20000,
  });
  if (res.status !== 200) {
    const err = new Error(`GigaChat authorization failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = JSON.parse(res.text);
  tokens.set(credentials, { token: json.access_token, expiresAt: Number(json.expires_at) || Date.now() + 25 * 60000 });
  return json.access_token;
}

async function postJson(url, body, cfg = {}) {
  const send = async (fresh) => {
    const headers = { 'content-type': 'application/json' };
    const token = await bearer(cfg, fresh);
    if (token) headers.authorization = `Bearer ${token}`;
    return request(url, { headers, body: JSON.stringify(body), ca: caFor(cfg), timeoutMs: cfg.timeoutMs || 60000 });
  };
  let res = await send(false);
  if (res.status === 401 && cfg.gigachat) res = await send(true);
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`HTTP ${res.status} from ${url}: ${res.text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${res.text.slice(0, 200)}`);
  }
}

function embedConfig(opts = {}) {
  const baseUrl = opts.embedBaseUrl ?? process.env.EMBED_BASE_URL;
  if (!baseUrl) return null;
  return {
    baseUrl: baseWithV1(baseUrl),
    model: opts.embedModel ?? process.env.EMBED_MODEL ?? 'text-embedding-bge-m3',
    apiKey: opts.embedApiKey ?? process.env.EMBED_API_KEY ?? '',
    timeoutMs: opts.embedTimeoutMs ?? 60000,
  };
}

function llmConfig(opts = {}) {
  const baseUrl = opts.llmBaseUrl ?? process.env.LLM_BASE_URL;
  const credentials = opts.gigachatCredentials ?? process.env.GIGACHAT_CREDENTIALS;
  if (!baseUrl && credentials) {
    return {
      baseUrl: process.env.GIGACHAT_BASE_URL || GIGACHAT_API,
      model: opts.llmModel || process.env.GIGACHAT_MODEL || 'GigaChat-2-Max',
      apiKey: '',
      timeoutMs: opts.llmTimeoutMs ?? Number(process.env.LLM_TIMEOUT_MS || 60000),
      external: true,
      gigachat: {
        credentials,
        scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
        authUrl: process.env.GIGACHAT_AUTH_URL || GIGACHAT_AUTH,
        caFile: process.env.GIGACHAT_CA_FILE || GIGACHAT_CA,
      },
    };
  }
  if (!baseUrl) return null;
  return {
    // anything outside this machine and the private network counts as external
    external: !isLocalUrl(baseUrl),
    baseUrl: baseWithV1(baseUrl),
    model: opts.llmModel ?? process.env.LLM_MODEL ?? 'local-model',
    apiKey: opts.llmApiKey ?? process.env.LLM_API_KEY ?? '',
    timeoutMs: opts.llmTimeoutMs ?? Number(process.env.LLM_TIMEOUT_MS || 120000),
  };
}

// Returns array of Float32Array (L2-normalized), same order as `texts`.
async function embed(texts, cfg, { batchSize = 32 } = {}) {
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const json = await postJson(`${cfg.baseUrl}/embeddings`, { model: cfg.model, input: batch }, cfg);
    const data = (json.data || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (data.length !== batch.length) throw new Error(`Embeddings: expected ${batch.length} vectors, got ${data.length}`);
    for (const d of data) out.push(l2(Float32Array.from(d.embedding)));
  }
  return out;
}

function l2(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// A personal GigaChat key serves one request at a time: questions asked in a
// row got HTTP 429 and silently fell back to plain clauses. Requests to one
// model wait in a queue, a 429 or 5xx is retried with growing pauses, and the
// reply to the same prompt is kept (the steps are still verified every time).
const queues = new Map(); // baseUrl -> { active, waiting }
const replies = new Map(); // prompt hash -> content, oldest first
const REPLY_CACHE = 300;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function inQueue(cfg, fn) {
  const limit = cfg.concurrency || Number(process.env.LLM_CONCURRENCY) || (cfg.gigachat ? 1 : 4);
  const maxWaiting = cfg.maxWaiting ?? Number(process.env.LLM_MAX_WAITING || 8);
  let q = queues.get(cfg.baseUrl);
  if (!q) queues.set(cfg.baseUrl, (q = { active: 0, waiting: [] }));
  if (q.active >= limit) {
    if (q.waiting.length >= maxWaiting) {
      const err = new Error('the language model is busy: too many questions in the queue');
      err.status = 429;
      throw err;
    }
    await new Promise((r) => q.waiting.push(r)); // the slot is handed over by the finishing request
  } else q.active++;
  try {
    return await fn();
  } finally {
    const next = q.waiting.shift();
    if (next) next(); else q.active--;
  }
}

async function chat(messages, cfg, extra = {}) {
  const body = { model: cfg.model, messages, temperature: 0, ...extra };
  const key = require('node:crypto').createHash('sha1').update(cfg.baseUrl + '\n' + JSON.stringify(body)).digest('hex');
  if (replies.has(key)) {
    const content = replies.get(key);
    replies.delete(key); replies.set(key, content); // most recent last
    return { content, raw: null, cached: true };
  }
  const budget = cfg.retryBudgetMs ?? Number(process.env.LLM_RETRY_BUDGET_MS || 20000);
  const pauses = cfg.retryPauses || [1000, 2500, 5000, 8000];
  const started = Date.now();
  const json = await inQueue(cfg, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await postJson(`${cfg.baseUrl}/chat/completions`, body, cfg);
      } catch (e) {
        const pause = pauses[attempt];
        if (!RETRY_STATUS.has(e.status) || pause == null || Date.now() - started + pause > budget) throw e;
        await sleep(pause + Math.floor(Math.random() * 300));
      }
    }
  });
  const msg = json.choices && json.choices[0] && json.choices[0].message;
  const content = (msg && msg.content) || '';
  if (content) {
    replies.set(key, content);
    if (replies.size > REPLY_CACHE) replies.delete(replies.keys().next().value);
  }
  return { content, raw: json };
}

module.exports = { embed, chat, embedConfig, llmConfig, dot, l2, baseWithV1 };
