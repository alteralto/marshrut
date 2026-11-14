'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { parseScene, checkScene } = require('../rag/src/scene');
const { docView } = require('../rag/server');
const { stepAttributes } = require('../rag/src/generate');
const { validate: validateScene } = require('../notes/asset-library/scene-kit');
const { appendixForm } = require('./forms');

const pilotId = 'mipt-matpomosch-obuch';
const actions = {
  approve: { title: 'Согласование', kind: 'approve' },
  fill: { title: 'Оформление документов', kind: 'fill' },
  handover: { title: 'Передача документов', kind: 'send' },
  money: { title: 'Выплата', kind: 'advance' },
  report: { title: 'Отчётность', kind: 'report' },
};
const actors = [
  [/^(?:при подаче документов в электронной форме )?(обучающийся)(?=\s)/iu, 'employee'],
  [/^(стипендиальные комиссии)(?=\s)/iu, 'manager'],
  [/^(сотрудник физтех-школы\/ИНБИКСТ)(?=\s)/iu, 'travel'],
  [/^(УВД)(?=\s)/u, 'finance'],
];

function roleFromClause(quote) {
  for (const [pattern, id] of actors) {
    const role = quote.match(pattern)?.[1];
    if (role) return [{ id, name: role }];
  }
  // any other regulation: the role the clause itself names
  const who = stepAttributes(quote).who;
  return who ? [{ id: 'employee', name: who }] : [];
}

function inferredAction(quote) {
  if (/осуществляют сбор заявлений|документы могут быть поданы|представляет все документы/iu.test(quote)) return 'fill';
  if (/проводят заседания.*рассмотрению/isu.test(quote)) return 'approve';
  if (/приказы формируются/iu.test(quote)) return 'fill';
  return checkScene(parseScene(quote), quote).scene;
}

function makeDraft(store, id = pilotId, walkthrough = null) {
  const doc = store.docById.get(id);
  if (!doc) return null;
  const view = docView(doc);
  const document = { id: doc.id, title: doc.title, url: doc.url };
  const steps = walkthrough?.steps || [];
  const availableSteps = [];
  const headings = new Map(view.nodes.filter(node => node.heading).map(node => [node.id, node.text]));
  for (const node of walkthrough ? [] : view.nodes) {
    // Pilot covers submission, review and issuing an order, with archival rules outside the route.
    if (node.heading || node.kind !== 'clause') continue;
    if (id === pilotId && !/^[123]\.\d+$/.test(node.id)) continue;
    const quote = node.text.trim();
    const action = actions[inferredAction(quote)];
    const people = roleFromClause(quote);
    const phase = headings.get(node.id.split('.')[0]);
    (action ? steps : availableSteps).push({
      n: action ? steps.length + 1 : 0,
      title: action ? action.title + ' · ' + node.label : node.label,
      phase,
      text: quote,
      people,
      ...(action ? { scene: { kind: action.kind, prop: action.title, cues: [] } } : {}),
      cites: [{ doc: doc.id, docTitle: doc.title, clause: node.id, label: node.label, anchor: node.anchor, quote }],
    });
  }
  if (!steps.length && !availableSteps.length) return null;
  const version = createHash('sha256').update(JSON.stringify({ document, nodes: view.nodes, steps })).digest('hex');
  const original = doc.file?.toLowerCase().endsWith('.pdf') && doc.report?.pages ? { pages: doc.report.pages } : null;
  const nodes = new Map(view.nodes.map(node => [node.id, node]));
  const order = new Map(view.nodes.map((node, index) => [node.id, index]));
  for (const step of [...steps, ...availableSteps]) {
    if (!walkthrough) step.sourceOrder = order.get(step.cites[0].clause);
    for (const cite of step.cites) {
      const page = cite.page || nodes.get(cite.clause)?.page;
      if (original && page && !cite.original) Object.assign(cite, { page, original: doc.url + '#page=' + page });
    }
  }
  return { document, documents: [document], steps, availableSteps, original, version, draft: true };
}

function publishedRoute(store, filename, id = pilotId, walkthrough = null) {
  if (!fs.existsSync(filename)) return null;
  const publication = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const version = publication.sourceVersion || publication.version;
  let draft = makeDraft(store, id, walkthrough);
  if (walkthrough && draft?.version !== version) {
    const legacyVariants = { availability: 'availability', agreement: 'availability', record: 'calendar' };
    const legacyResults = { availability: 'Даты и ресурсы сверены', record: 'Дата внесена в график' };
    const legacySteps = walkthrough.steps.map(step => {
      const scene = step.sceneChoice;
      if (scene?.template !== 'schedule') return step;
      return { ...step, sceneChoice: {
        ...scene, template: 'register', variant: legacyVariants[scene.variant],
        objectLabel: scene.variant === 'availability' ? 'Даты и репетиции' : scene.objectLabel,
        result: legacyResults[scene.variant] || scene.result,
      } };
    });
    const legacyDraft = makeDraft(store, id, { steps: structuredClone(legacySteps) });
    if (legacyDraft?.version === version) draft.version = version;
    else draft = makeDraft(store, id);
  }
  if (draft?.version !== version) return null;
  const catalog = [...draft.steps, ...draft.availableSteps];
  return {
    document: draft.document, documents: draft.documents, version: draft.version,
    draft: false,
    publishedAt: publication.publishedAt,
    steps: publication.approved
      .map(clause => catalog.find(item => item.cites[0].clause === clause))
      .filter(Boolean)
      .map((step, index) => {
        const clause = step.cites[0].clause;
        const attachment = publication.attachments?.[clause];
        return {
          ...step, ...publication.edits?.[clause], n: index + 1, checklistText: publication.checklist?.[clause],
          sceneChoice: publication.scenes?.[clause] || step.sceneChoice,
          ...(attachment ? { attachment, forms: [appendixForm(id, attachment)] } : {}),
        };
      }),
  };
}

function publishDraft(store, filename, review, walkthrough = null) {
  const id = review?.id || pilotId;
  const draft = makeDraft(store, id, walkthrough);
  if (!draft || draft.version !== review?.version) throw new Error('Документ изменился. Соберите и проверьте черновик заново.');
  const decisions = review.decisions;
  const clauses = draft.steps.map(step => step.cites[0].clause);
  const extra = draft.availableSteps.map(step => step.cites[0].clause);
  if (!decisions || !clauses.every(clause => ['include', 'exclude'].includes(decisions[clause]))
    || !Object.entries(decisions).every(([clause, decision]) => (clauses.includes(clause) || extra.includes(clause))
      && ['include', 'exclude'].includes(decision))) {
    throw new Error('Отметьте решение для каждого пункта.');
  }
  const order = extra.some(clause => decisions[clause] === 'include')
    ? docView(store.docById.get(id)).nodes.map(node => node.id) : clauses;
  const approved = [...new Set(order)].filter(clause => decisions[clause] === 'include');
  if (!approved.length) throw new Error('В маршруте должен быть хотя бы один проверенный шаг.');
  const checklist = Object.create(null);
  const scenes = Object.create(null);
  const edits = Object.create(null);
  const attachments = Object.create(null);
  if (review.scenes != null && (typeof review.scenes !== 'object' || Array.isArray(review.scenes))) {
    throw new Error('Передайте настройки сцен по пунктам регламента.');
  }
  for (const clause of approved) {
    const edit = review.edits?.[clause];
    if (edit) {
      if (typeof edit.title !== 'string' || !edit.title.trim() || edit.title.length > 160
        || typeof edit.text !== 'string' || !edit.text.trim() || edit.text.length > 6000) {
        throw new Error('Проверьте заголовок и текст шага по п. ' + clause + '.');
      }
      edits[clause] = { title: edit.title.trim(), text: edit.text.trim() };
    }
    const attachment = review.attachments?.[clause];
    if (attachment) {
      const { page, title } = attachment;
      if (!draft.original || !Number.isInteger(page) || page < 1 || page > draft.original.pages
        || typeof title !== 'string' || !title.trim() || title.length > 160 || /[\u0000-\u001f]/u.test(title)) {
        throw new Error('Укажите название бланка и страницу исходного PDF в п. ' + clause + '.');
      }
      attachments[clause] = { page, title: title.trim() };
    }
    if (review.scenes?.[clause] != null) {
      try { scenes[clause] = validateScene(review.scenes[clause]); }
      catch (error) { throw new Error('П. ' + clause + '. ' + error.message); }
    }
    const value = review.checklist?.[clause];
    if (value == null || value === '') continue;
    if (typeof value !== 'string' || value.length > 2000) throw new Error('Пункт чек-листа должен быть не длиннее 2000 символов.');
    if (value.trim()) checklist[clause] = value.trim();
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temp = filename + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify({ id, sourceVersion: draft.version, approved, checklist, scenes, edits, attachments, publishedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temp, filename);
  return publishedRoute(store, filename, id, walkthrough);
}

module.exports = { pilotId, makeDraft, publishedRoute, publishDraft };
