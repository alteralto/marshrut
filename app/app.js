'use strict';

const el = id => document.getElementById(id);
const sceneLibrary = '/notes/asset-library/';
const form = el('question-form');
const input = el('question');
const notice = el('notice');
const steps = el('steps');
const sources = el('documents');
const routeSummary = el('route-summary');
const routeShare = el('route-share');
const submit = form.querySelector('button[type=submit]');
let shareableRoute;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// Who / deadline / form the reader looks for first. Taken from the step
// fields, otherwise from the step text itself.
const DEADLINE_TEXT = /(в течение [а-яё0-9]+(?: [а-яё]+)? (?:рабоч[а-яё]* |календарн[а-яё]* )?(?:дн[а-яё]*|час[а-яё]*|недел[а-яё]*|месяц[а-яё]*)|не позднее (?:чем )?за [^.,;]{3,30}?(?:дн[а-яё]*|месяц[а-яё]*)|до \d{1,2} числа(?: месяца)?)/i;
const ROLE_TEXT = /^(.{3,80}?)\s+(?:оформляет|направляет|проверяет|согласовывает|утверждает|регистрирует|рассматривает|сда[её]т|составляет|вносит|присваивает|подписывает|переда[её]т|запускает|осуществляет|принимает|заполняет|представляет)/;
function stepFacts(step) {
  const text = step.text || '';
  const who = (step.who || (ROLE_TEXT.exec(text) || [])[1] || '').replace(/\s+(?:в течение|после|не позднее|до \d).*$/i, '');
  const deadline = step.deadline || (DEADLINE_TEXT.exec(text) || [])[1] || '';
  const form = step.forms?.[0]?.title || step.form || '';
  return [['Кто', who], ['Срок', deadline], ['Бланк', form]].filter(([, value]) => value);
}

// Done marks: a route the employee walks through. Kept per document in this browser.
let doneKey = null;
function readDone() {
  try { return new Set(JSON.parse(localStorage.getItem(doneKey) || '[]')); } catch { return new Set(); }
}
function writeDone(done) {
  try { localStorage.setItem(doneKey, JSON.stringify([...done])); } catch { /* storage may be disabled */ }
}
function showProgress() {
  const items = [...steps.querySelectorAll(':scope > .step')].filter(item => item.querySelector('.step-done'));
  const box = el('progress');
  box.hidden = !doneKey || items.length < 2;
  if (box.hidden) return;
  const done = items.filter(item => item.classList.contains('done')).length;
  el('progress-count').textContent = done === items.length ? `Маршрут пройден: все ${items.length} шагов` : `Сделано ${done} из ${items.length}`;
  el('progress-fill').style.width = `${Math.round(done / items.length * 100)}%`;
  box.classList.toggle('complete', done === items.length);
}
function startRoute(docId) {
  // marks belong to this route: the same document asked another way gives other steps
  const titles = [...steps.querySelectorAll(':scope > .step h3')].map(h => h.textContent).join('|');
  let sign = 0;
  for (let i = 0; i < titles.length; i++) sign = (sign * 31 + titles.charCodeAt(i)) | 0;
  doneKey = docId && titles ? 'marshrut-done:' + docId + ':' + (sign >>> 0).toString(36) : null;
  const done = doneKey ? readDone() : new Set();
  for (const item of steps.querySelectorAll(':scope > .step')) {
    const box = item.querySelector('.step-done input');
    if (!box) continue;
    box.checked = done.has(item.dataset.n);
    item.classList.toggle('done', box.checked);
  }
  showProgress();
}

// Text size for readers who need it larger.
(() => {
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem('marshrut-text-size'); } catch { /* ignore */ }
  const apply = (value) => {
    root.style.setProperty('--text-scale', value);
    for (const b of document.querySelectorAll('[data-text-size]')) b.setAttribute('aria-pressed', String(b.dataset.textSize === value));
  };
  document.addEventListener('DOMContentLoaded', () => {
    if (saved) apply(saved);
    for (const b of document.querySelectorAll('[data-text-size]')) {
      b.addEventListener('click', () => { apply(b.dataset.textSize); try { localStorage.setItem('marshrut-text-size', b.dataset.textSize); } catch { /* ignore */ } });
    }
  });
})();

let session = {};
try { localStorage.removeItem('editor-code'); } catch { /* Storage may be disabled. */ }
const accessDialog = el('access-dialog');

function openAccess() {
  if (!accessDialog.open) accessDialog.showModal();
}

async function refreshSession() {
  session = await api('/session');
  el('open-access').hidden = !session.protected;
  el('open-access').textContent = session.role ? 'Доступ' : 'Войти';
  el('access-form').hidden = Boolean(session.role);
  el('access-logout').hidden = !session.role;
  el('access-status').textContent = session.role === 'editor' ? 'Доступ редактора'
    : session.role === 'reader' ? 'Доступ к внутренним регламентам' : '';
}

el('open-access').addEventListener('click', openAccess);
el('access-form').addEventListener('submit', async event => {
  event.preventDefault();
  const field = el('access-code');
  const code = field.value.trim();
  field.value = '';
  try {
    const response = await fetch('/session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    location.reload();
  } catch (error) {
    el('access-status').textContent = error.message || 'Не удалось войти.';
  }
});
el('access-logout').addEventListener('click', async () => {
  try {
    const response = await fetch('/session/logout', { method: 'POST' });
    if (!response.ok) throw new Error();
    location.reload();
  } catch {
    el('access-status').textContent = 'Не удалось выйти. Повторите попытку.';
  }
});

async function editorFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401 && session.protected) openAccess();
  return response;
}

async function api(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error('Ошибка запроса');
  return res.json();
}

function documentLink(doc, anchor = '') {
  return '/doc/' + encodeURIComponent(doc) + '?format=html' + (anchor ? '#' + encodeURIComponent(anchor) : '');
}

function copyButton(value, { label = 'Копировать ссылку', copied = 'Ссылка скопирована', multiline = false } = {}) {
  const button = element('button', label, 'secondary');
  button.type = 'button';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = copied;
    } catch {
      const field = element(multiline ? 'textarea' : 'input');
      field.value = value;
      field.readOnly = true;
      field.setAttribute('aria-label', multiline ? 'Текст для публикации' : 'Ссылка для копирования');
      button.replaceWith(field);
      field.focus();
      field.select();
    }
  });
  return button;
}

function shareLink(href) {
  return copyButton(new URL(href, location.origin).href);
}

function renderRouteShare(answer) {
  shareableRoute = answer;
  routeShare.replaceChildren();
  const doc = answer?.document;
  if (doc?.access !== 'shared' || !(answer.publishedAt || answer.route?.publishedAt)) return;
  const route = new URL('/', location.origin);
  route.searchParams.set('route', doc.id);
  const fallback = new URL(documentLink(doc.id), location.origin);
  const candidate = doc.source || doc.url || fallback.href;
  const source = URL.canParse(candidate, location.origin) ? new URL(candidate, location.origin) : fallback;
  const original = ['https:', 'http:'].includes(source.protocol) && !source.username && !source.password ? source.href : fallback.href;
  const text = ['Маршрут «' + doc.title + '»', route.href, 'Оригинал регламента: ' + original].join('\n');
  routeShare.append(copyButton(text, { label: 'Скопировать для публикации', copied: 'Текст скопирован', multiline: true }));
}

function sourceLink(label, href, className) {
  const link = element('a', label, className);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

const templatePlayers = new WeakMap();

const sceneObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    templatePlayers.get(entry.target)?.();
    sceneObserver.unobserve(entry.target);
  }
}, { threshold: .45 }) : null;

const sceneTemplates = Object.entries(window.SceneExamples).flatMap(([type, examples]) =>
  Object.entries(examples).flatMap(([example, { route }]) =>
    route?.clauses?.length ? [{ doc: route.doc, clauses: route.clauses, type, example }] : []));
const sceneRenderers = {
  prepare: { title: 'Оформить документ', renderer: window.DocumentPreparationScene },
  transfer: { title: 'Передать документ', renderer: window.DocumentTransferScene },
  check: { title: 'Проверить комплект · пример', renderer: window.DocumentCheckScene },
  commission: { title: 'Рассмотреть на комиссии', renderer: window.CommissionScene },
};

function renderTemplateScene(template) {
  const { title, renderer } = sceneRenderers[template.type];
  const example = window.SceneExamples[template.type][template.example];
  const href = template.type === 'commission' ? example.route.href : sceneLibrary + 'document-' + template.type + '.html?example=' + template.example;
  return renderSvgScene({ title, renderer, example, href });
}

function renderSvgScene({ title, renderer, example, href, cues, roles }) {
  const figure = element('figure', null, 'mini-film');
  const stage = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  stage.classList.add('template-stage');
  stage.setAttribute('aria-hidden', 'true');

  let frame;
  let player;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  function play() {
    cancelAnimationFrame(frame);
    if (!player) {
      player = renderer.create(stage, id => sceneLibrary + window.ComicPeople.portraitUrl(id));
      player.load(example);
      for (const label of stage.querySelectorAll('[data-fit]')) {
        const width = Number(label.dataset.fit);
        if (label.getComputedTextLength() > width) {
          label.setAttribute('textLength', width);
          label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
      }
    }
    if (motion.matches) {
      player.render(renderer.duration);
      return;
    }
    const start = performance.now();
    function tick(now) {
      if (!stage.isConnected) return;
      const time = motion.matches ? renderer.duration : Math.min(now - start, renderer.duration);
      player.render(time);
      if (time < renderer.duration) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  }

  const caption = element('figcaption', null, 'film-caption template-caption');
  if (roles?.length) {
    const cast = element('div', null, 'scene-editor-roles');
    cast.append(element('strong', title), element('span', [...new Set(roles)].join(' · ')));
    caption.append(cast);
  }
  if (cues?.length) {
    const beats = element('ol', null, 'film-cues');
    beats.append(...cues.map(cue => element('li', cue)));
    caption.append(beats);
  } else if (!roles?.length) caption.append(element('strong', title));
  if (!motion.matches) {
    const replay = element('button', '↻ Повторить', 'secondary film-replay');
    replay.type = 'button';
    replay.setAttribute('aria-label', 'Повторить сцену. ' + title);
    replay.addEventListener('click', () => {
      sceneObserver?.unobserve(stage);
      play();
    });
    caption.append(replay);
  }
  if (href) caption.append(sourceLink('Открыть сцену ↗', href, 'secondary'));
  figure.append(stage, caption);
  templatePlayers.set(stage, play);
  if (sceneObserver) sceneObserver.observe(stage);
  else requestAnimationFrame(play);
  return figure;
}

function renderSceneChoice(step, choice) {
  const { renderer, config } = window.RouteSceneEditor.build(choice, sceneLibrary, step.scene?.setting);
  if (renderer === window.CommissionScene && step.cites.some(cite =>
    cite.doc === 'порядок-перехода-с-платного-обучения-на-бесплатное' && cite.clause === '2.8') &&
    !step.cites.some(cite => ['2.9', '2.13'].includes(cite.clause))) config.meetingOnly = true;
  const title = window.SceneKit.titleFor(choice);
  const roles = choice.actors.map(actor => actor.role).filter(Boolean);
  return renderSvgScene({ title, renderer, example: config, roles, cues: step.scene?.cues });
}

function renderScene(step) {
  if (step.sceneChoice) return renderSceneChoice(step, step.sceneChoice);
  const template = sceneTemplates.find(({ doc, clauses }) => clauses.every(clause =>
    step.cites.some(cite => cite.doc === doc && cite.clause === clause)));
  if (template) return renderTemplateScene(template);
  if (step.scene.action) {
    const cast = step.people.map(person => ({ art: sceneLibrary + person.art, label: person.shortName || person.name }));
    return renderSvgScene({
      title: step.title, renderer: window.RouteActionScene, cues: step.scene.cues,
      example: { ...step.scene.action, setting: step.scene.setting, cast, art: sceneLibrary + step.scene.art },
    });
  }
  const choice = window.RouteSceneEditor.forDraft(step);
  if (choice) return renderSceneChoice(step, choice);
  return renderDraftScene(step);
}

function renderDraftScene(step) {
  const label = step.scene.prop || step.title;
  return renderSvgScene({
    title: label, renderer: window.RouteActionScene, cues: step.scene.cues,
    example: {
      effect: 'pass', art: sceneLibrary + (step.scene.art || 'document-icon.svg'),
      labels: [label, 'Действие по регламенту', label],
      cast: [{ art: sceneLibrary + window.ComicPeople.portraitUrl('employee'), label: step.people[0]?.name || 'Исполнитель' }],
    },
  });
}

const fillForm = el('fill-form');
const fillStatus = el('fill-status');
const fillSubmit = fillForm.querySelector('[type="submit"]');

function renderFormField(field, fill, name) {
  const wrapper = element('div', null, 'fill-field');
  const label = element('label', field.label);
  const input = element(field.options ? 'select' : field.type === 'textarea' ? 'textarea' : 'input');
  input.name = name;
  input.id = 'fill-field-' + name.replaceAll('.', '-');
  label.htmlFor = input.id;
  if (field.options) {
    const empty = element('option', 'Выберите значение');
    empty.value = '';
    input.append(empty, ...field.options.map(value => element('option', value)));
  } else {
    if (input.tagName === 'INPUT') input.type = field.type || 'text';
    if (input.tagName === 'TEXTAREA') {
      input.rows = 2;
      wrapper.classList.add('fill-wide');
    }
    if (field.type !== 'date') input.maxLength = field.maxLength || fill.maxLength;
  }
  wrapper.append(label, input);
  if (field.hint) {
    const hint = element('small', field.hint);
    hint.id = input.id + '-hint';
    input.setAttribute('aria-describedby', hint.id);
    wrapper.append(hint);
  }
  return wrapper;
}

function renderRepeatGroup(fieldset, group, fill) {
  const rows = new Map();
  const add = element('button', group.addLabel, 'secondary fill-wide');
  add.type = 'button';

  function update() {
    add.disabled = rows.size >= group.limit;
    let index = 0;
    for (const { row, legend, remove } of rows.values()) {
      const label = group.itemLabel + ' ' + ++index;
      legend.textContent = label;
      remove.setAttribute('aria-label', 'Удалить: ' + label);
      remove.hidden = rows.size === 1;
      row.querySelectorAll('input, textarea, select').forEach((input, col) => {
        input.name = group.repeat + '.' + (index - 1) + '.' + group.fields[col].row;
      });
    }
  }

  let rowId = 0;
  function append(focus = false) {
    if (rows.size >= group.limit) return;
    const key = rowId++;
    const row = element('fieldset', null, 'fill-group fill-repeat fill-wide');
    const legend = element('legend');
    const remove = element('button', 'Удалить', 'secondary');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      rows.delete(key);
      row.remove();
      update();
      add.focus();
    });
    row.append(legend, ...group.fields.map(field => renderFormField(field, fill, group.repeat + '.' + key + '.' + field.row)), remove);
    rows.set(key, { row, legend, remove });
    add.before(row);
    update();
    if (focus) row.querySelector('input, textarea, select').focus();
  }

  add.addEventListener('click', () => append(true));
  fieldset.append(add);
  for (let i = 0; i < group.initial; i++) append();
}

function renderFormEditor(fill) {
  fillForm.hidden = !fill;
  if (!fill || fillForm.dataset.endpoint === fill.endpoint) return;
  fillForm.dataset.endpoint = fill.endpoint;
  fillForm.dataset.filename = fill.filename;
  el('fill-intro').textContent = fill.intro || 'Можно заполнить часть полей и продолжить в Word.';
  const groups = fill.groups.map(group => {
    const fieldset = element('fieldset', null, 'fill-group');
    fieldset.append(element('legend', group.title));
    if (group.repeat) renderRepeatGroup(fieldset, group, fill);
    else fieldset.append(...group.fields.map(field => renderFormField(field, fill, String(field.row))));
    return fieldset;
  });
  el('fill-fields').replaceChildren(...groups);
}

fillForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (fillSubmit.disabled) return;
  const { endpoint, filename } = fillForm.dataset;
  const status = message => { if (fillForm.dataset.endpoint === endpoint) fillStatus.textContent = message; };
  const values = Object.fromEntries(new FormData(fillForm));
  if (!Object.values(values).some(value => value.trim())) {
    fillStatus.textContent = 'Заполните хотя бы одно поле.';
    return;
  }
  fillSubmit.disabled = true;
  status('Готовлю документ…');
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Не удалось подготовить документ.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = element('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('Скачивание началось.');
  } catch (error) {
    status(error.message);
  } finally {
    fillSubmit.disabled = false;
  }
});

function renderForms(forms) {
  const list = element('ul', null, 'step-forms');
  list.setAttribute('aria-label', 'Бланки для заполнения');
  for (const form of forms) {
    const row = element('li');
    const action = form.fill ? 'Заполнить бланк' : 'Открыть бланк';
    const open = element('button', action, 'secondary');
    open.type = 'button';
    open.setAttribute('aria-label', action + '. ' + form.title);
    open.addEventListener('click', () => {
      el('form-preview-title').textContent = form.title;
      el('form-preview-source').textContent = form.source;
      const image = el('form-preview-image');
      image.hidden = !form.preview;
      image.open = false;
      el('form-paper').hidden = Boolean(form.preview) || !form.fields.length;
      if (form.preview) image.querySelector('img').src = form.preview;
      else image.querySelector('img').removeAttribute('src');
      el('form-preview-fields').replaceChildren(...form.fields.map(field => element('li', field)));
      const download = el('form-preview-download');
      download.href = form.download;
      download.textContent = form.fill ? 'Скачать пустой бланк (' + form.format + ')' : 'Скачать ' + form.format;
      download.className = form.fill ? 'secondary' : 'primary';
      renderFormEditor(form.fill);
      fillStatus.textContent = '';
      const reference = el('form-preview-reference');
      reference.href = form.reference;
      reference.textContent = form.referenceLabel || (form.documentId ? 'Открыть страницу оригинала' : 'Пункт регламента');
      el('form-preview').showModal();
    });
    const download = element('a', form.format + ' ↓', 'secondary');
    download.href = form.download;
    download.download = '';
    download.setAttribute('aria-label', 'Скачать ' + form.format + '. ' + form.title);
    row.append(element('strong', form.title), open, download);
    list.append(row);
  }
  return list;
}

function showShortSource(answer) {
  const line = el('short-source');
  const doc = answer?.document;
  line.replaceChildren();
  line.hidden = !doc;
  el('short').classList.toggle('filled', Boolean(doc));
  if (!doc) return;
  if (doc.status) {
    const status = doc.status[0].toUpperCase() + doc.status.slice(1);
    const style = doc.status === 'действует' ? 'status-ok' : 'status-warn';
    const pill = element('span', status, 'status ' + style);
    if (doc.status === 'действует') pill.title = 'В загруженной базе нет документа, который его отменяет или заменяет';
    line.append(pill);
  }
  const order = doc.number
    ? 'приказ № ' + doc.number + (doc.date ? ' от ' + doc.date.split('-').reverse().join('.') : '')
    : doc.title;
  const cite = answer.summary_cite;
  line.append(sourceLink([cite?.label, order].filter(Boolean).join(' · '), documentLink(cite?.doc || doc.id, cite?.anchor)));
}

// The clause a step stands on, with the words and numbers the step took from it
// marked: the employee sees that the answer is the regulation's text, not a guess.
const STEM = word => word.toLowerCase().replace(/ё/g, 'е').slice(0, 5);
function evidence(step) {
  const cite = step.cites.find(c => c.quote);
  if (!cite || !step.title) return null; // a clause shown as it stands is its own evidence
  const words = new Set();
  for (const w of String(step.text || '').match(/[\p{L}\d]+(?:[.,]\d+)*/gu) || []) {
    if (/^\d/.test(w)) words.add(w);
    else if (w.length >= 4) words.add(STEM(w));
  }
  let quote = cite.quote.replace(/\s+/g, ' ').trim();
  const box = element('div', null, 'evidence');
  const head = element('p', null, 'evidence-head');
  head.append(element('span', 'Из документа', 'evidence-kicker'), ' ', element('span', [cite.docTitle, cite.label].filter(Boolean).join(' · ')));
  box.append(head);
  const marked = token => /^\d/.test(token) ? words.has(token) : token.length >= 4 && words.has(STEM(token));
  const parts = quote.split(/([\p{L}\d]+(?:[.,]\d+)*)/u);
  const first = parts.findIndex(marked);
  if (quote.length > 360 && first > 0) {
    const before = parts.slice(0, first).join('');
    if (before.length > 90) { parts.splice(0, first, '… ' + before.slice(-80)); }
  }
  const text = element('blockquote');
  let length = 0;
  for (const part of parts) {
    if (length > 420) { text.append('…'); break; }
    length += part.length;
    text.append(marked(part) ? element('mark', part) : part);
  }
  box.append(text);
  if (cite.original) box.append(sourceLink('Открыть оригинал' + (cite.page ? ' · стр. ' + cite.page : ''), cite.original, 'original-page'));
  return box;
}

function renderStep(step, idPrefix = "step-") {
  const item = element('li', null, 'step');
  item.id = idPrefix + step.n;
  const docs = step.cites.map(cite => cite.doc);
  const heading = element('h3', null, 'step-heading');
  const title = element('span');
  const clause = step.cites[0]?.label ? step.cites[0].label[0].toUpperCase() + step.cites[0].label.slice(1) : 'Пункт регламента';
  window.RouteGuide.annotate(title, step.title || clause, docs);
  heading.append(element('span', String(step.n), 'step-number'), title);
  if (!step.title) item.classList.add('step-clause');
  if (idPrefix === 'step-' && step.title) {
    item.dataset.n = String(step.n);
    const doneLabel = element('label', null, 'step-done');
    const doneBox = element('input');
    doneBox.type = 'checkbox';
    doneBox.addEventListener('change', () => {
      item.classList.toggle('done', doneBox.checked);
      if (doneKey) {
        const done = readDone();
        if (doneBox.checked) done.add(item.dataset.n);
        else done.delete(item.dataset.n);
        writeDone(done);
      }
      showProgress();
    });
    doneLabel.append(doneBox, element('span', 'Сделано'));
    const head = element('div', null, 'step-head');
    head.append(heading, doneLabel);
    item.append(head);
  } else {
    item.append(heading);
  }
  if (step.phase) item.append(element('p', step.phase, 'step-meta'));
  const description = element('p');
  window.RouteGuide.annotate(description, step.text, docs);
  item.append(description);
  const facts = stepFacts(step);
  if (facts.length) {
    const list = element('dl', null, 'step-facts');
    for (const [name, value] of facts) list.append(element('dt', name), element('dd', value));
    item.append(list);
  }
  if (step.transition) item.append(window.RouteGuide.transition(step.transition, docs));
  if (step.forms?.length) item.append(renderForms(step.forms));
  if (step.scene || step.sceneChoice) item.append(renderScene(step));

  const citations = element('div', null, 'citations');
  citations.setAttribute('aria-label', 'Пункты регламента');
  const pdfPages = new Map();
  for (const cite of step.cites) {
    const label = step.title ? cite.label : cite.label + ' · ' + cite.docTitle;
    const link = sourceLink(label, documentLink(cite.doc, cite.anchor), 'cite');
    link.title = cite.docTitle;
    citations.append(link);
    if (cite.original) pdfPages.set(cite.original, cite.page);
  }
  for (const [url, page] of pdfPages) citations.append(sourceLink('PDF · стр. ' + page, url, 'original-page'));
  item.append(citations);
  const proof = evidence(step);
  if (proof) item.append(proof);
  return item;
}

function checklist(answer) {
  const title = answer.draft ? 'Черновик чек-листа' : 'Чек-лист';
  const file = document.implementation.createHTMLDocument(title);
  file.documentElement.lang = 'ru';
  const meta = file.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  const viewport = file.createElement('meta');
  viewport.name = 'viewport';
  viewport.content = 'width=device-width, initial-scale=1';
  const style = file.createElement('style');
  style.textContent = `
    :root { color-scheme: light; color: #1d1d1f; }
    body { font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 760px; margin: 36px auto; padding: 0 18px; }
    h1 { font-size: clamp(2rem, 6vw, 3rem); line-height: 1.08; letter-spacing: -.045em; margin-bottom: 12px; }
    body > p { color: #555963; }
    ol { padding-left: 1.65em; }
    li { border-top: 1px solid #e3e4e9; padding: 14px 0; break-inside: avoid; }
    li > div { margin-top: 5px; }
    li > p { margin: 6px 0 0; }
    a { color: #0066cc; text-underline-offset: 3px; }
    input { accent-color: #0071e3; margin-right: .6em; }
  `;
  file.head.prepend(meta, viewport, style);
  const list = element('ol');
  for (const step of answer.steps) {
    const item = element('li');
    const label = element('label');
    const box = element('input');
    box.type = 'checkbox';
    label.append(box, element('strong', step.title || step.cites[0]?.label || 'Шаг ' + step.n));
    const refs = element('p');
    for (const cite of step.cites) {
      const url = new URL(documentLink(cite.doc, cite.anchor), location.origin);
      refs.append(sourceLink(cite.label, url), '  ');
      if (cite.original) refs.append(sourceLink('PDF · стр. ' + cite.page, new URL(cite.original, location.origin)), '  ');
    }
    for (const form of step.forms || []) refs.append(sourceLink(form.title, new URL(form.download, location.origin)), '  ');
    item.append(label);
    if (step.transition?.when) item.append(element('div', step.transition.when));
    item.append(element('div', step.checklistText || step.text), refs);
    list.append(item);
  }
  file.body.append(element('h1', title), element('p', answer.document.title), list);
  return new Blob(['<!doctype html>', file.documentElement.outerHTML], { type: 'text/html;charset=utf-8' });
}

function renderRouteSummary(answer, target = routeSummary, idPrefix = 'step-') {
  const title = element('h2', answer.draft ? 'Предпросмотр схемы' : 'Схема маршрута');
  if (target === routeSummary) title.id = 'route-title';
  const flow = element('ol', null, 'route-flow');
  for (const step of answer.steps) {
    const item = element('li');
    const link = element('a', step.title || step.cites[0]?.label || 'Шаг ' + step.n);
    link.href = '#' + idPrefix + step.n;
    if (answer.draft) link.addEventListener('click', event => {
      event.preventDefault();
      const card = el(idPrefix + step.n);
      card.closest('details').open = true;
      card.scrollIntoView({ block: 'nearest' });
    });
    const caption = element('div');
    caption.append(link);
    if (step.transition?.when) caption.append(element('span', step.transition.when, 'flow-condition'));
    item.append(caption);
    flow.append(item);
  }
  const download = element('button', 'Скачать чек-лист', 'primary');
  download.type = 'button';
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(checklist(answer));
    const link = element('a');
    link.href = url;
    link.download = answer.draft ? 'marshrut-checklist-draft.html' : 'marshrut-checklist.html';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  target.replaceChildren(title, flow, download);
  if (target === routeSummary && answer.document?.id === 'регламент-бронирования-конц-зала') {
    const documents = sourceLink('Документы для бронирования зала', sceneLibrary + 'mipt-scene-library.html#concert-documents', 'secondary');
    target.append(' ', documents);
  }
  target.hidden = false;
}

function renderDocument(doc, inLibrary = false) {
  const item = element('li');
  item.dataset.docId = doc.id;
  const link = element('a', doc.title);
  link.href = documentLink(doc.id);
  link.target = '_blank';
  link.rel = 'noopener';
  const actions = element('div', null, 'source-actions');
  actions.append(link);
  if (doc.access !== 'internal') actions.append(shareLink(doc.url?.startsWith('/original/') || /^https?:\/\//.test(doc.url || '') ? doc.url : link.href));
  else actions.append(element('span', 'Только после входа', 'document-access-label'));
  if (inLibrary) {
    const added = doc.addedAt ? new Date(doc.addedAt).toLocaleDateString('ru-RU') : '';
    item.append(element('span', doc.origin === 'upload' ? 'Загружен' + (added ? ' ' + added : '') : 'Из поставки', 'document-origin' + (doc.origin === 'upload' ? ' uploaded' : '')));
    if (doc.origin === 'upload' && session.canManage) {
      const remove = element('button', 'Удалить', 'secondary danger');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Удалить из базы — ' + doc.title);
      remove.addEventListener('click', async () => {
        if (!confirm('Удалить «' + doc.title + '» из базы? Ответы перестанут на него ссылаться.')) return;
        remove.disabled = true;
        try {
          const response = await editorFetch('/documents/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: doc.id }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          el('library-access-status').textContent = 'Документ удалён. В базе · ' + result.count;
          await refreshLibrary();
        } catch (error) {
          el('library-access-status').textContent = error.message || 'Не удалось удалить документ.';
          remove.disabled = false;
        }
      });
      actions.append(remove);
    }
    const review = element('button', 'Проверить маршрут', 'secondary');
    review.type = 'button';
    review.addEventListener('click', () => {
      el('library').close();
      openReview(doc.id);
    });
    actions.append(review);
    if (session.canManage) {
      const label = element('label', 'Доступ по ссылке', 'document-access-setting');
      const select = element('select');
      for (const [value, text] of [['shared', 'Открытый'], ['internal', 'Только после входа']]) {
        const option = element('option', text);
        option.value = value;
        select.append(option);
      }
      select.value = doc.access || 'shared';
      select.setAttribute('aria-label', 'Доступ по ссылке — ' + doc.title);
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          const result = await api('/documents/access', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: doc.id, mode: select.value }),
          });
          doc.access = result.mode;
          if (shareableRoute?.document.id === doc.id) {
            renderRouteShare({ ...shareableRoute, document: { ...shareableRoute.document, access: result.mode } });
          }
          el('library-access-status').textContent = result.mode === 'internal'
            ? 'Доступ по ссылке ограничен.' : 'Доступ по ссылке открыт.';
          renderLibrary();
          for (const item of sources.querySelectorAll('[data-doc-id]')) {
            if (item.dataset.docId === doc.id) item.replaceWith(renderDocument(doc));
          }
        } catch {
          select.value = doc.access || 'shared';
          el('library-access-status').textContent = 'Не удалось изменить доступ.';
        } finally {
          select.disabled = false;
        }
      });
      label.append(select);
      actions.append(label);
    }
  }
  item.append(actions);
  if (doc.url?.startsWith('/original/') || /^https?:\/\//.test(doc.url || '')) {
    const original = element('a', 'Оригинал', 'original');
    original.href = doc.url;
    original.target = '_blank';
    original.rel = 'noopener';
    item.append(original);
  }
  return item;
}

const storyExamples = new Map([
  ['aid', { question: 'Как оформить материальную помощь?', doc: 'mipt-matpomosch-obuch' }],
  ['trip', { question: 'Как оформить командировку?', doc: 'mipt-business-trip' }],
  ['fls', { question: 'Как открыть ФЛС для НИОКР?', doc: 'приказ-n-3065-1-от-25-11-2021' }],
  ['concert', { question: 'Как забронировать концертный зал?', doc: 'регламент-бронирования-конц-зала' }],
  ['staffing', { question: 'Как подобрать персонал?', doc: 'регламент-поиска-и-подбора-персонала' }],
  ['support', { question: 'Как подать обращение в техподдержку?', doc: 'приказ-и-регламент-работы-первой-линии-техподдержки' }],
  ['housing', { question: 'Как сотруднику заселиться в общежитие?', doc: 'регламент-поселения-сотрудников' }],
]);
let requestedStory;

function requestedRouteStep() {
  return /^#step-\d+$/u.test(location.hash) ? document.getElementById(location.hash.slice(1)) : null;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  const question = input.value.trim();
  if (!question) { notice.textContent = 'Введите вопрос.'; input.focus(); return; }
  submit.disabled = true;
  const current = new URL(location.href);
  const opening = requestedStory;
  requestedStory = null;
  current.searchParams.delete('route');
  if (!opening) {
    current.searchParams.delete('demo');
    current.searchParams.delete('step');
  }
  if (current.href !== location.href) history.replaceState(history.state, '', current);
  for (const stage of steps.querySelectorAll('.template-stage')) sceneObserver?.unobserve(stage);
  steps.replaceChildren();
  startRoute(null);
  showShortSource(null);
  sources.replaceChildren();
  routeSummary.hidden = true;
  routeSummary.replaceChildren();
  el('open-story').hidden = true;
  renderRouteShare(null);
  notice.textContent = 'Ищем ответ в регламентах…';
  const submitText = submit.textContent;
  submit.textContent = 'Ищем…';
  el('short').setAttribute('aria-busy', 'true');
  try {
    const answer = await api('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    if (answer.not_found) {
      const nearest = answer.nearest || [];
      notice.textContent = nearest.length
        ? 'В загруженных регламентах нет ответа на этот вопрос. Возможно, вы искали один из этих документов:'
        : [answer.message || 'В загруженных регламентах нет ответа на этот вопрос.', answer.clarifying_question || 'Попробуйте назвать процедуру или документ, например «командировка» или «смета».'].filter(Boolean).join(' ');
      if (nearest.length) {
        const list = element('ul', null, 'nearest-docs');
        for (const doc of nearest) {
          const item = element('li');
          item.append(sourceLink(doc.title, documentLink(doc.id)));
          list.append(item);
        }
        notice.append(list, element('span', 'Если вопрос о них, уточните формулировку.', 'nearest-hint'));
        sources.append(...nearest.map(doc => { const item = element('li'); item.append(sourceLink(doc.title, documentLink(doc.id))); return item; }));
      }
      return;
    }
    notice.textContent = [
      answer.summary || (answer.steps.some(step => step.title)
        ? 'Порядок действий по регламенту.'
        : 'Пункты регламента по вашему вопросу. Порядок действий из них не собран: проверьте условия в источнике.'),
      (answer.warnings || []).some(w => /^LLM failed/.test(w))
        ? 'Языковая модель сейчас не ответила, поэтому показаны пункты регламента дословно.' : '',
      answer.clarifying_question,
      ...(answer.notices || []).map(item => item.text),
    ].filter(Boolean).join(' ');
    if (answer.route && !answer.route.used) {
      notice.append(' ', sourceLink('Открыть проверенный маршрут', answer.route.url, 'cite'));
    }
    renderRouteShare(answer);
    showShortSource(answer);
    storySteps = answer.steps.filter(step => step.scene || step.sceneChoice);
    el('open-story').hidden = !storySteps.length;
    steps.append(...answer.steps.map(step => renderStep(step)));
    startRoute(answer.document?.id);
    const related = (answer.related || []).map(item => item.document).filter(doc => !answer.documents.some(used => used.id === doc.id));
    sources.append(...[...answer.documents, ...related].map(doc => renderDocument(doc)));
    if (storySteps.length > 1) renderRouteSummary(answer);
    if (!opening) {
      const result = el('result-title');
      if (result.getBoundingClientRect().top > window.innerHeight * 0.6) result.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    if (opening && answer.document?.id === opening.doc && storySteps.length > 1) {
      const target = requestedRouteStep();
      if (target) target.scrollIntoView({ block: 'start' });
      else showStory(Math.min(opening.index, storySteps.length - 1));
    }
  } catch {
    notice.textContent = 'Сейчас не удалось получить ответ. Вопрос остался в поле — нажмите «Найти ответ» ещё раз.';
  } finally {
    submit.disabled = false;
    submit.textContent = submitText;
    el('short').removeAttribute('aria-busy');
  }
});

let libraryDocs = [];
let libraryLimit = 25;
function renderLibrary(reset = false) {
  if (reset) libraryLimit = 25;
  const filter = el('library-filter').value.trim().toLowerCase();
  const onlyUploaded = el('library-uploaded')?.checked;
  const matches = libraryDocs.filter(doc => doc.title.toLowerCase().includes(filter) && (!onlyUploaded || doc.origin === 'upload'));
  el('library-docs').replaceChildren(...matches.slice(0, libraryLimit).map(doc => renderDocument(doc, true)));
  const uploaded = libraryDocs.filter(doc => doc.origin === 'upload').length;
  el('library-count').textContent = 'Найдено документов · ' + matches.length + (uploaded ? ' · загружено пользователями · ' + uploaded : '');
  el('more-documents').hidden = matches.length <= libraryLimit;
}
el('open-library').addEventListener('click', () => el('library').showModal());
el('empty-open-library')?.addEventListener('click', () => el('library').showModal());
el('library-filter').addEventListener('input', () => renderLibrary(true));
el('library-uploaded')?.addEventListener('change', () => renderLibrary(true));
el('more-documents').addEventListener('click', () => { libraryLimit += 25; renderLibrary(); });
el('import-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const status = el('import-status');
  const skipped = el('import-skipped');
  skipped.replaceChildren();
  button.disabled = true;
  status.textContent = 'Читаю файлы и обновляю индекс…';
  try {
    const response = await editorFetch('/import', { method: 'POST', body: new FormData(form) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    status.textContent = 'Добавлено · ' + result.added + '. В базе · ' + result.count;
    skipped.replaceChildren(
      ...(result.reports || []).map(doc => element('li', doc.file + ' · прочитан: ' + Object.values(doc.report.nodes).reduce((a, b) => a + b, 0)
        + ' фрагментов' + (doc.status && doc.status !== 'действует' ? ' · ' + doc.status : '') + (doc.report.warnings.length ? ' · ' + doc.report.warnings.join('; ') : ''))),
      ...result.skipped.map(file => element('li', file.name + ' · ' + file.reason)),
    );
    if (result.added) { form.reset(); await refreshLibrary(); }
  } catch (error) {
    status.textContent = error.message || 'Загрузка не завершилась.';
  } finally {
    button.disabled = false;
  }
});

let storySteps = [];
let storyIndex = 0;
let storyBranch = null;
const storyDialog = el('story');
const storyMap = el('story-map');
const storyStages = el('story-stages');
const storyFrame = el('story-frame');

function storyNeighbor(direction) {
  for (let index = storyIndex + direction; index >= 0 && index < storySteps.length; index += direction) {
    const branch = storySteps[index].branch;
    if (!storyBranch || !branch || branch.key === storyBranch) return index;
  }
  return -1;
}

function openStoryStep(index) {
  storyIndex = index;
  storyBranch = storySteps[index].branch?.key || storyBranch;
  renderStory();
}

function storyChoices() {
  const choices = new Map();
  storySteps.forEach((step, index) => {
    if (index > storyIndex && step.branch && !choices.has(step.branch.key)) {
      choices.set(step.branch.key, { label: step.branch.choice, index });
    }
  });
  return [...choices.values()];
}

function renderStory() {
  const current = storySteps[storyIndex];
  const step = renderStep(current, 'story-step-');
  const scene = element('article', null, 'story-step');
  scene.append(...step.childNodes);
  const choices = current.branchPoint ? storyChoices() : [];
  if (choices.length > 1) {
    const selector = element('div', null, 'story-branch-choices');
    selector.setAttribute('role', 'group');
    selector.setAttribute('aria-label', 'Выберите исход по кандидату');
    selector.append(element('p', 'Какое решение принято по кандидату?'));
    for (const { label, index } of choices) {
      const button = element('button', label, 'primary');
      button.type = 'button';
      button.addEventListener('click', () => {
        openStoryStep(index);
        const heading = storyFrame.querySelector('h3');
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      });
      selector.append(button);
    }
    scene.insertBefore(selector, scene.querySelector('.mini-film, .citations'));
  }
  const previous = storyFrame.querySelector('.template-stage');
  if (previous) sceneObserver?.unobserve(previous);
  storyFrame.replaceChildren(scene);
  storyFrame.scrollTop = 0;
  const position = 'Этап ' + (storyIndex + 1) + ' из ' + storySteps.length;
  el('story-position').textContent = position;
  storyMap.querySelector('summary').textContent = position + ' · Все этапы маршрута';
  storyStages.querySelector('[aria-current]')?.removeAttribute('aria-current');
  storyStages.children[storyIndex].querySelector('button').setAttribute('aria-current', 'step');
  el('story-back').disabled = storyNeighbor(-1) < 0;
  el('story-next').disabled = choices.length > 1 || storyNeighbor(1) < 0;
}

function showStory(index = 0) {
  storyIndex = index;
  storyBranch = storySteps[index].branch?.key || null;
  storyMap.open = false;
  storyStages.replaceChildren(...storySteps.map((step, index) => {
    const row = element('li');
    const button = element('button', step.title, 'story-stage-link');
    button.type = 'button';
    if (step.phase) button.append(element('small', [step.phase, step.branch?.label].filter(Boolean).join(' · ')));
    button.addEventListener('click', () => {
      openStoryStep(index);
      storyMap.open = false;
      storyMap.querySelector('summary').focus({ preventScroll: true });
    });
    row.append(button);
    return row;
  }));
  renderStory();
  storyDialog.showModal();
}

el('open-story').addEventListener('click', () => showStory());
function moveStory(direction) {
  const index = storyNeighbor(direction);
  if (index >= 0) openStoryStep(index);
}
el('story-back').addEventListener('click', () => moveStory(-1));
el('story-next').addEventListener('click', () => moveStory(1));

async function refreshLibrary() {
  const [corpus, documents] = await Promise.all([api('/corpus'), api('/docs'), refreshSession()]);
  libraryDocs = documents;
  renderLibrary(true);
  el('corpus-status').textContent = corpus.mixed ? 'Кейс и публичные документы · ' + corpus.count
    : corpus.official ? 'Документы кейса · ' + corpus.count
    : 'Публичные документы из архива · ' + corpus.count;
  if (el('examples').childElementCount) return;
  const examples = [...(corpus.examples || [])];
  if (documents.some(doc => doc.id === 'mipt-matpomosch-obuch')) {
    examples.splice(1, 0, 'Как оформить материальную помощь?');
  }
  for (const example of examples) {
    const button = element('button', example);
    button.type = 'button';
    button.addEventListener('click', () => { input.value = example; form.requestSubmit(); });
    el('examples').append(button);
  }
}
refreshLibrary().catch(() => { el('corpus-status').textContent = 'База документов недоступна'; });

const reviewDialog = el('review');
const reviewList = el('review-steps');
const reviewStatus = el('review-status');
const publishButton = el('publish-route');
const publishedButton = el('view-published');
let draft;
let decisions = new Map();
let checklistEdits = new Map();
let sceneEdits = new Map();
let stepEdits = new Map();
let attachmentEdits = new Map();
const scenesByDraft = new Map();
const reviewSource = el('review-source');
const pilotDocument = 'mipt-matpomosch-obuch';

function routeApi(endpoint, id) {
  return '/routes/' + endpoint + '?id=' + encodeURIComponent(id);
}

function renderReviewStatus() {
  const included = draft.steps.filter(step => decisions.get(step.cites[0].clause) === 'include');
  reviewStatus.textContent = `Проверено ${decisions.size} из ${draft.steps.length}. В маршрут включено ${included.length}.`;
  publishButton.disabled = decisions.size !== draft.steps.length || !included.length;
  const preview = el('review-summary');
  preview.hidden = !included.length;
  if (included.length) {
    const edited = included.map(step => {
      const clause = step.cites[0].clause;
      const attachment = attachmentEdits.get(clause);
      const forms = [...(step.forms || [])];
      if (attachment?.title.trim() && attachment.page >= 1 && attachment.page <= draft.original.pages) {
        const params = new URLSearchParams({ id: draft.document.id, page: attachment.page });
        forms.push({ title: attachment.title, download: '/forms/appendix?' + params });
      }
      return { ...step, ...stepEdits.get(clause), forms, checklistText: checklistEdits.get(clause)?.trim() };
    });
    renderRouteSummary({ ...draft, steps: edited }, preview, 'review-step-');
  }
  else preview.replaceChildren();
}

function reviewCard(step) {
  const clause = step.cites[0].clause;
  const card = element('li', null, 'review-card');
  const details = element('details');
  const heading = element('summary', stepEdits.get(clause)?.title || step.title);
  details.append(heading);
  const preview = renderStep({ ...step, scene: null, sceneChoice: null }, 'review-step-');
  const body = element('div');
  body.id = preview.id;
  body.append(...preview.childNodes);
  body.querySelector('h3').remove();
  const scenes = window.RouteSceneEditor.create(step, sceneEdits.get(clause) ?? step.sceneChoice, value => {
    sceneEdits.set(clause, value);
  }, (mount, sceneChoice) => {
    for (const stage of mount.querySelectorAll('.template-stage')) sceneObserver?.unobserve(stage);
    const choice = sceneChoice || step.sceneChoice;
    if (!choice && !step.scene) { mount.replaceChildren(); return; }
    const frame = choice ? renderSceneChoice(step, choice) : renderScene(step);
    mount.replaceChildren(frame);
  });
  body.querySelector('.citations').before(scenes);
  const edits = element('div', null, 'review-edit');
  const input = (label, control) => {
    const wrapper = element('label', label);
    wrapper.append(control);
    edits.append(wrapper);
    return control;
  };
  const title = input('Заголовок шага', element('input'));
  title.maxLength = 160;
  title.value = stepEdits.get(clause)?.title || step.title;
  const text = input('Текст шага', element('textarea'));
  text.rows = 4;
  text.maxLength = 6000;
  text.value = stepEdits.get(clause)?.text || step.text;
  const updateStep = () => {
    stepEdits.set(clause, { title: title.value, text: text.value });
    heading.textContent = title.value.trim() || step.title;
    renderReviewStatus();
  };
  title.addEventListener('input', updateStep);
  text.addEventListener('input', updateStep);
  if (draft.original) {
    const page = input('Страница бланка в исходном PDF', element('input'));
    page.type = 'number';
    page.min = 1;
    page.max = draft.original.pages;
    page.value = attachmentEdits.get(clause)?.page ?? '';
    const name = input('Название бланка', element('input'));
    name.maxLength = 160;
    name.value = attachmentEdits.get(clause)?.title || '';
    const reference = sourceLink('Проверить страницу бланка', draft.document.url);
    const updateAttachment = () => {
      const number = Number(page.value);
      reference.hidden = !page.value || !Number.isInteger(number) || number < 1 || number > draft.original.pages;
      reference.href = draft.document.url + '#page=' + number;
      if (page.value || name.value.trim()) attachmentEdits.set(clause, { page: number, title: name.value });
      else attachmentEdits.delete(clause);
    };
    edits.append(reference);
    for (const field of [page, name]) field.addEventListener('input', () => {
      updateAttachment();
      renderReviewStatus();
    });
    updateAttachment();
  }
  body.querySelector('.citations').before(edits);
  const choices = element('fieldset');
  choices.append(element('legend', 'После сверки с оригиналом'));
  for (const [value, text] of [['include', 'Включить'], ['exclude', 'Исключить']]) {
    const option = element('input');
    option.type = 'radio';
    option.name = 'review-' + clause;
    option.value = value;
    option.checked = decisions.get(clause) === value;
    option.addEventListener('change', () => {
      decisions.set(clause, value);
      renderReviewStatus();
    });
    const label = element('label');
    label.append(option, ' ' + text);
    choices.append(label);
  }
  const editLabel = element('label', 'Текст для чек-листа', 'checklist-edit');
  const editor = element('textarea');
  editor.rows = 3;
  editor.maxLength = 2000;
  editor.placeholder = 'Пустое поле оставит текст пункта из регламента';
  editor.value = checklistEdits.get(clause) || '';
  editor.addEventListener('input', () => {
    checklistEdits.set(clause, editor.value);
    renderReviewStatus();
  });
  editLabel.append(editor);
  body.append(editLabel, choices);
  details.append(body);
  card.append(details);
  card.dataset.clause = clause;
  return card;
}

function refreshAdditionalSteps() {
  const used = new Set(draft.steps.map(step => step.cites[0].clause));
  const available = draft.availableSteps.filter(step => !used.has(step.cites[0].clause));
  const select = el('review-add-source');
  select.replaceChildren(...available.map(step => {
    const option = element('option', step.cites[0].label + ' · ' + step.text.replace(/\s+/gu, ' ').slice(0, 125));
    option.value = step.cites[0].clause;
    return option;
  }));
  el('review-add').hidden = !available.length;
}

el('review-add-step').addEventListener('click', () => {
  const clause = el('review-add-source').value;
  const step = draft.availableSteps.find(item => item.cites[0].clause === clause);
  if (!step) return;
  draft.steps.push({ ...step, n: Math.max(0, ...draft.steps.map(item => item.n)) + 1 });
  draft.steps.sort((a, b) => a.sourceOrder - b.sourceOrder);
  const added = draft.steps.find(item => item.cites[0].clause === clause);
  const next = draft.steps[draft.steps.indexOf(added) + 1];
  const card = reviewCard(added);
  reviewList.insertBefore(card, next ? Array.from(reviewList.children).find(row => row.dataset.clause === next.cites[0].clause) : null);
  card.querySelector('details').open = true;
  card.querySelector('summary').focus();
  refreshAdditionalSteps();
  renderReviewStatus();
});

async function openReview(preferred = draft?.document.id || pilotDocument) {
  if (!reviewDialog.open) reviewDialog.showModal();
  if (reviewSource.disabled) return;
  if (!libraryDocs.length) {
    try { await refreshLibrary(); }
    catch { reviewStatus.textContent = 'Не удалось загрузить список регламентов.'; return; }
  }
  reviewSource.replaceChildren(...libraryDocs.map(doc => {
    const option = element('option', doc.title);
    option.value = doc.id;
    return option;
  }));
  if (libraryDocs.some(doc => doc.id === preferred)) reviewSource.value = preferred;
  await loadReview(reviewSource.value);
}

async function loadReview(id, force = false) {
  if (!id || reviewSource.disabled || (!force && draft?.document.id === id)) return;
  reviewSource.disabled = true;
  publishButton.disabled = true;
  publishedButton.hidden = true;
  reviewStatus.textContent = 'Собираю шаги из документа…';
  for (const stage of reviewList.querySelectorAll('.template-stage')) sceneObserver?.unobserve(stage);
  reviewList.replaceChildren();
  el('review-document').replaceChildren();
  el('review-summary').hidden = true;
  el('review-add').hidden = true;
  draft = null;
  decisions = new Map();
  checklistEdits = new Map();
  sceneEdits = new Map();
  stepEdits = new Map();
  attachmentEdits = new Map();
  try {
    draft = await api(routeApi('draft', id));
    const published = await api(routeApi('published', id)).catch(() => null);
    const savedScenes = scenesByDraft.get(draft.version);
    if (savedScenes) sceneEdits = savedScenes;
    const originals = new Map([...draft.steps, ...draft.availableSteps].map(step => [step.cites[0].clause, step]));
    const initial = new Set(draft.steps.map(step => step.cites[0].clause));
    for (const step of published?.steps || []) {
      const clause = step.cites[0].clause;
      const original = originals.get(clause);
      if (!original) continue;
      if (!initial.has(clause)) draft.steps.push({ ...original, n: draft.steps.length + 1 });
      decisions.set(clause, 'include');
      if (step.title !== original.title || step.text !== original.text) stepEdits.set(clause, { title: step.title, text: step.text });
      if (step.attachment) attachmentEdits.set(clause, step.attachment);
      if (step.checklistText) checklistEdits.set(clause, step.checklistText);
      if (!savedScenes && step.sceneChoice) sceneEdits.set(clause, step.sceneChoice);
    }
    if (published) for (const clause of initial) if (!decisions.has(clause)) decisions.set(clause, 'exclude');
    if (draft.availableSteps.length) draft.steps.sort((a, b) => a.sourceOrder - b.sourceOrder);
    scenesByDraft.set(draft.version, sceneEdits);
    publishedButton.hidden = !published;
    el('review-document').replaceChildren(sourceLink(draft.document.title, draft.document.url || documentLink(draft.document.id)));
    reviewList.replaceChildren(...draft.steps.map(reviewCard));
    if (reviewList.firstElementChild) reviewList.querySelector('details').open = true;
    refreshAdditionalSteps();
    renderReviewStatus();
  } catch {
    reviewStatus.textContent = 'Для этого документа не удалось собрать шаги с привязкой к пунктам.';
  } finally {
    reviewSource.disabled = false;
  }
}
el('open-review').addEventListener('click', () => openReview());
reviewSource.addEventListener('change', () => loadReview(reviewSource.value));

async function showPublishedRoute(route) {
  if (!route) route = await api(routeApi('published', reviewSource.value));
  if (reviewDialog.open) reviewDialog.close();
  for (const stage of steps.querySelectorAll('.template-stage')) sceneObserver?.unobserve(stage);
  notice.textContent = route.document.title;
  steps.replaceChildren(...route.steps.map(step => renderStep(step)));
  startRoute(route.document?.id);
  showShortSource(route);
  sources.replaceChildren(...route.documents.map(doc => renderDocument(doc)));
  storySteps = route.steps;
  el('open-story').hidden = false;
  renderRouteShare(route);
  renderRouteSummary(route);
  const url = new URL(location.href);
  url.searchParams.delete('demo');
  url.searchParams.delete('step');
  url.searchParams.delete('review');
  url.searchParams.set('route', route.document.id);
  history.replaceState(history.state, '', url);
  (requestedRouteStep() || el('result-title')).scrollIntoView({ block: 'start' });
}
publishedButton.addEventListener('click', () => showPublishedRoute().catch(() => {
  reviewStatus.textContent = 'Опубликованный маршрут недоступен для этой редакции.';
}));
publishButton.addEventListener('click', async () => {
  publishButton.disabled = true;
  reviewSource.disabled = true;
  reviewList.inert = true;
  try {
    const response = await editorFetch('/routes/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: draft.document.id, version: draft.version,
        decisions: Object.fromEntries(decisions),
        checklist: Object.fromEntries(checklistEdits),
        scenes: Object.fromEntries(sceneEdits),
        edits: Object.fromEntries(stepEdits),
        attachments: Object.fromEntries(attachmentEdits),
      }),
    });
    const route = await response.json();
    if (!response.ok) throw new Error(route.error);
    publishedButton.hidden = false;
    await showPublishedRoute(route);
  } catch (error) {
    reviewStatus.textContent = error.message || 'Не удалось опубликовать маршрут.';
  } finally {
    publishButton.disabled = false;
    reviewSource.disabled = false;
    reviewList.inert = false;
  }
});
const params = new URLSearchParams(location.search);
const requestedReview = params.get('review');
const requestedRoute = params.get('route');
if (requestedReview) {
  openReview(requestedReview);
} else if (requestedRoute) {
  api(routeApi('published', requestedRoute)).then(showPublishedRoute).catch(() => {
    notice.textContent = 'Маршрут ещё не опубликован или регламент изменился.';
  });
} else {
  const example = storyExamples.get(params.get('demo'));
  if (example) {
    const step = Number(params.get('step'));
    requestedStory = { doc: example.doc, index: Number.isSafeInteger(step) && step > 0 ? step - 1 : 0 };
    input.value = example.question;
    form.requestSubmit();
  }
}
