'use strict';
// LLM step generation over retrieved clauses, plus the no-LLM extractive mode.

const { chat } = require('./openai');
const { redactPeople } = require('./redact');

const MAX_CLAUSE_CHARS = 1500;
const MAX_CONTEXT_CHARS = 14000;

const SYSTEM_PROMPT = `Ты — навигатор по внутренним регламентам университета. Сотрудник описывает задачу, ты отвечаешь коротким пошаговым алгоритмом СТРОГО по тексту приведённых пунктов регламентов.

Правила:
1. Используй только приведённые фрагменты. Не добавляй ничего от себя: никаких сроков, сумм, должностей, подразделений, документов, ссылок и условий, которых нет в тексте пунктов.
2. Каждый шаг — одно действие или условие, пересказанное близко к тексту, теми же словами, что в пункте. У каждого шага в поле "cites" укажи идентификаторы пунктов в квадратных скобках из контекста, например "D1:3.1" или "D1:2.1(а)". Ссылайся только на пункты, из которых взят шаг.
3. Шаги располагай в порядке выполнения. Не больше 8 шагов. Общие положения и определения не превращай в шаги, если они не нужны для выполнения задачи.
4. Если во фрагментах нет ответа на вопрос, верни "not_found": true и пустой список шагов. Лучше честно сказать, что ответа нет, чем угадывать.
5. Если вопрос допускает разные толкования и от этого зависит ответ, заполни "clarifying_question" коротким уточняющим вопросом.
6. Необязательные поля шага: "who" — кто выполняет действие, "deadline" — срок, "form" — документ или форма (заявление, служебная записка, приложение). Заполняй их только словами из цитируемого пункта, иначе ставь null.
7. Поле "summary" — прямой ответ на вопрос сотрудника в одном-двух предложениях: кто, что и куда, теми же словами, что в пункте. Ссылайся в "cites" на пункты, из которых он взят. Если прямого ответа нет, поставь null.
8. Ответ — только JSON без пояснений и без markdown:
{"document": "D1", "summary": {"text": "...", "cites": ["D1:2.3"]}, "steps": [{"text": "...", "cites": ["D1:3.1"], "who": null, "deadline": null, "form": null}], "not_found": false, "clarifying_question": null}`;

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    document: { type: ['string', 'null'] },
    summary: {
      type: ['object', 'null'],
      properties: { text: { type: 'string' }, cites: { type: 'array', items: { type: 'string' } } },
      required: ['text', 'cites'],
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          cites: { type: 'array', items: { type: 'string' } },
          who: { type: ['string', 'null'] },
          deadline: { type: ['string', 'null'] },
          form: { type: ['string', 'null'] },
        },
        required: ['text', 'cites'],
      },
    },
    not_found: { type: 'boolean' },
    clarifying_question: { type: ['string', 'null'] },
  },
  required: ['document', 'steps', 'not_found'],
};

function clip(s, n) {
  s = String(s);
  return s.length <= n ? s : s.slice(0, n) + '…';
}

// slots: Map docId -> 'D1'
function buildContextText(context, docsById, slots) {
  const parts = [];
  let used = 0;
  for (const [docId, slot] of slots) {
    const d = docsById.get(docId);
    parts.push(`Документ ${slot}: «${redactPeople(d.title)}»`);
    for (const c of context.filter((x) => x.docId === docId)) {
      const head = c.path && c.path.length ? ` (раздел: ${clip(c.path[c.path.length - 1], 120)})` : '';
      const line = `[${slot}:${c.clauseId}]${redactPeople(head)} ${redactPeople(clip(c.text, MAX_CLAUSE_CHARS))}`;
      if (used + line.length > MAX_CONTEXT_CHARS) break;
      used += line.length;
      parts.push(line);
    }
    parts.push('');
  }
  return parts.join('\n');
}

function buildMessages(question, contextText) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Фрагменты регламентов:\n\n${contextText}\nЗадача сотрудника: ${redactPeople(question)}\n\nВерни JSON.` },
  ];
}

// Tolerant JSON extraction: strips <think> blocks and code fences, takes the
// outermost {...}, removes trailing commas.
function parseAnswer(content) {
  let s = String(content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('LLM answer has no JSON object');
  let body = s.slice(a, b + 1);
  try {
    return JSON.parse(body);
  } catch {
    body = body.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(body);
  }
}

async function generateWithLlm(question, context, docsById, slots, cfg) {
  const contextText = buildContextText(context, docsById, slots);
  const messages = buildMessages(question, contextText);
  const mode = (process.env.LLM_JSON_MODE || 'schema').toLowerCase();
  const attempts = [];
  if (mode === 'schema') attempts.push({ response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: ANSWER_SCHEMA } } });
  if (mode === 'schema' || mode === 'object') attempts.push({ response_format: { type: 'json_object' } });
  attempts.push({});
  let lastErr = null;
  for (const extra of attempts) {
    try {
      const { content } = await chat(messages, cfg, { max_tokens: 1500, ...extra });
      return { answer: parseAnswer(content), rawContent: content, prompt: messages };
    } catch (e) {
      lastErr = e;
      // 400 = server does not support this response_format -> try the next one.
      // Bad JSON -> also retry with a looser mode. Network errors -> give up.
      if (e.status && e.status !== 400 && e.status !== 422) break;
      if (!e.status && !/JSON/.test(e.message)) break;
    }
  }
  throw lastErr;
}

// Extractive mode: steps are the clause texts themselves (verbatim, trimmed at
// a sentence boundary). Used offline and as the fallback when the LLM fails.
function trimSentence(text, max = 500) {
  const t = String(text).replace(/\s*\n\s*/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (end > max * 0.4 ? cut.slice(0, end + 1) : cut) + ' …';
}

// Step attributes pulled from the clause text itself (extractive mode), so
// they are grounded by construction.
const ROLE_RE = /(?:^|[^а-яё])(ответственный исполнитель|руководитель подразделения(?:-инициатора)?|руководитель источника финансирования|отдел кадров|управление кадров|учебное управление|финансово-экономическое управление|планово-финансовое управление|юридический отдел|главный бухгалтер|бюро пропусков|стипендиальная комиссия|служба безопасности|бухгалтерия|деканат|работник|обучающийся|инициатор|владелец|посетитель|проректор(?: по [а-яё]+(?: [а-яё]+)?)?|ректор|руководитель|декан|комиссия)(?![а-яё-])/i;
const DEADLINE_RE = /(не позднее(?: чем)?[^,.;:]{1,70}|в течение[^,.;:]{1,70}|не реже[^,.;:]{1,40}|не чаще[^,.;:]{1,40}|до \d{1,2} (?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)|на ежемесячном заседании)/i;
// Nominative / accusative only: "подаёт заявление", "заявка подаётся".
const FORM_RE = /(?:^|[^а-яё])(по форме[^,.;:]{0,60}|(?:личное |письменное )?заявление(?: (?:на|о|об) [а-яё]+(?: [а-яё]+){0,2})?|заявк[ау](?: (?:на|о) [а-яё]+(?: [а-яё]+){0,1})?|служебн(?:ая|ую) записк[ау]|авансовый отч[её]т|копию [а-яё]+(?: [а-яё]+){0,4})(?![а-яё])/i;
const TRAIL_CUT = /\s(?:и|а также|либо|или)\s.*$/i;

function tidy(s) {
  let t = s.replace(TRAIL_CUT, '');
  const v = ACTIVE_VERB_RE.exec(t);
  if (v && v.index > 0) t = t.slice(0, v.index);
  const r = ROLE_RE.exec(t);
  if (r && r.index > 10) t = t.slice(0, r.index + (r[0].length - r[1].length));
  // trailing prepositions and particles: "заявление на выдачу аванса с"
  t = t.replace(/(?:\s+(?:в|во|с|со|на|по|к|о|об|от|до|за|из|для|при|через))+\s*$/i, '');
  return t.trim();
}
const ACTIVE_VERB_RE = /(?:^|\s)(?!отч[её]т|бюджет|лимит|кредит|предмет|объект|совет|пакет|билет|институт|маршрут)[а-яё]{3,}(?:ает|яет|еет|ует|ит|ет|ёт|ют|ят|ут)(?=[\s,.;:]|$)/i;

function firstSentence(text) {
  const t = String(text).replace(/\s*\n\s*/g, ' ').trim();
  const m = /^(.{20,}?[.;])(\s|$)/.exec(t);
  return m ? m[1] : t;
}

function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function stepAttributes(text) {
  const s = firstSentence(text);
  const out = {};
  // "who": a role mentioned before the first active verb of the sentence
  const v = ACTIVE_VERB_RE.exec(s);
  const head = v ? s.slice(0, v.index + 1) : '';
  const r = head && ROLE_RE.exec(head);
  if (r) out.who = r[1].toLowerCase();
  const d = DEADLINE_RE.exec(s);
  if (d) out.deadline = lowerFirst(tidy(d[1]));
  const f = FORM_RE.exec(s);
  if (f) out.form = lowerFirst(tidy(f[1]));
  return out;
}

function extractiveSteps(context, { maxSteps = 8, primaryDocId } = {}) {
  // Direct hits, then the chosen sections of the primary document in rank
  // order, cut at maxSteps (a long section keeps its best-scoring clauses);
  // the steps are shown in document order.
  const own = context.filter((c) => c.docId === primaryDocId);
  let block = own.filter((c) => c.inBestSection);
  if (!block.length) block = own;
  const ranks = [...new Set(block.map((c) => c.sectionRank ?? 0))].sort((x, y) => x - y);
  let picked = own.filter((c) => c.lead).sort((x, y) => y.bm25 - x.bm25).slice(0, maxSteps);
  for (const r of ranks) {
    let sec = block.filter((c) => (c.sectionRank ?? 0) === r && !picked.includes(c));
    const room = maxSteps - picked.length;
    if (room <= 0) break;
    if (sec.length > room) sec = sec.slice().sort((x, y) => y.score - x.score).slice(0, room);
    picked.push(...sec);
  }
  picked.sort((x, y) => x.order - y.order);
  return picked.map((c) => ({ text: trimSentence(c.text), cites: [c.clauseId], ...stepAttributes(c.text), _chunk: c }));
}

module.exports = { stepAttributes, generateWithLlm, extractiveSteps, parseAnswer, buildContextText, buildMessages, SYSTEM_PROMPT, trimSentence };
