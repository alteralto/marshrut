'use strict';

const documentId = 'приказ-n-3065-1-от-25-11-2021';
const scenes = {
  '2.1': {
    title: 'Подготовьте карточку проекта',
    phase: 'Подготовка документов',
    transition: { before: 'Заключён договор', after: 'Карточка и скан договора направлены на согласование' },
    scene: { kind: 'fill', prop: 'Карточка проекта', cues: [] },
  },
  '2.2': {
    title: 'Проверка карточки и присвоение номера ФЛС',
    phase: 'Финансовая проверка',
    transition: { before: 'Карточка проекта поступила в ФЭУ', after: 'Присвоен номер ФЛС и подготовлен проект приказа' },
    scene: { kind: 'approve', prop: 'Карточка проекта', cues: [] },
  },
};

function addFlsScenes(answer) {
  if (answer.document?.id !== documentId) return;
  for (const step of answer.steps) {
    const cite = step.cites.find(c => c.doc === documentId);
    if (!cite) continue;
    const visual = scenes[cite.clause];
    if (visual) Object.assign(step, visual);
  }
}

// This walkthrough was checked against section 2 of the supplied order.
const { createHash } = require('node:crypto');
const { docView, embeddedClauseAnchor } = require('../rag/server');
const reviewedSection = '38e7a14e98abb98a6b69ddae97ee0920966db618e020fc0d7611611bf95ba500';
const routeQuestions = new Set([
  'как открыть флс для ниокр',
  'как открыть флс',
  'как открыть финансовый лицевой счет для ниокр',
  'порядок открытия флс для ниокр',
]);
const approval = 'Согласование приказа';
const order = 'Проект приказа';
const projectManager = { name: 'Руководитель проекта', art: 'comic-people.svg#employee' };

function approvalScene(person) {
  return {
    template: 'review', variant: 'approval', object: 'order', objectLabel: 'Проект приказа об открытии ФЛС',
    actors: [{ portrait: person.art.split('#')[1], role: person.name }],
    result: 'Проект приказа согласован',
  };
}

const walkthrough = [
  {
    clause: '2.1',
    ...scenes['2.1'],
    text: 'Заместитель руководителя или ответственный исполнитель оформляет карточку по приложению 1 и направляет её со скан-копией договора на согласование. По фундаментальным проектам конкурсов РНФ и РФФИ получатель — сотрудник отдела координации поисковых исследований, по прикладным исследованиям и разработкам — руководитель Центра трансфера технологий.',
    people: [{ name: 'Ответственный исполнитель', art: 'comic-people.svg#employee' }],
  },
  {
    clause: '2.2',
    ...scenes['2.2'],
    text: 'Сотрудник ФЭУ в течение одного рабочего дня проверяет в карточке накладные расходы и базу начисления, резерв отпускных и НДС. Затем присваивает номер ФЛС и формирует проект приказа по приложению 2.',
    people: [{ name: 'Сотрудник ФЭУ', art: 'comic-people.svg#specialist' }],
  },
  {
    clause: '2.3',
    title: 'Согласуйте проект приказа в Центре трансфера технологий',
    phase: approval,
    text: 'Руководитель Центра трансфера технологий в течение одного рабочего дня проверяет проект приказа об открытии ФЛС по приложению 2 и согласовывает его.',
    transition: { before: 'ФЭУ подготовило проект приказа', after: 'Руководитель центра согласовал проект приказа' },
    scene: { kind: 'approve', prop: order, outcome: 'Согласовано', cues: ['Сверить с приложением 2', 'Согласовать проект приказа'] },
    people: [{ name: 'Руководитель Центра трансфера технологий', art: 'comic-people.svg#director' }],
  },
  {
    clause: '2.4',
    title: 'Согласование руководителем проекта',
    phase: approval,
    text: 'Руководитель проекта в течение одного рабочего дня проверяет оформление, условия договора и соответствие локальным актам МФТИ, затем согласовывает проект приказа.',
    transition: { before: 'Проект приказа на проверке', after: 'Проект согласован руководителем проекта' },
    scene: { kind: 'approve', prop: order, outcome: 'Согласовано', cues: ['Сверить проект с договором и локальными актами', 'Согласовать проект приказа'] },
    people: [projectManager],
  },
  {
    clause: '2.5',
    title: 'Согласование руководителем подразделения',
    phase: approval,
    text: 'Руководитель подразделения в течение одного рабочего дня рассматривает проект приказа и согласовывает его.',
    transition: { before: 'Проект у руководителя подразделения', after: 'Подразделение согласовало проект' },
    scene: { kind: 'approve', prop: order, outcome: 'Согласовано', cues: ['Рассмотреть проект', 'Согласовать проект приказа'] },
    people: [{ name: 'Руководитель подразделения', art: 'comic-people.svg#director' }],
  },
  {
    clause: '2.6',
    title: 'Согласование директором',
    phase: approval,
    text: 'Директор Физтех-школы, центра или института в течение одного рабочего дня рассматривает проект приказа и согласовывает его.',
    transition: { before: 'Проект передан директору', after: 'Директор согласовал проект' },
    scene: { kind: 'approve', prop: order, outcome: 'Согласовано', cues: ['Рассмотреть проект', 'Согласовать проект приказа'] },
    people: [{ name: 'Директор Физтех-школы, центра или института', art: 'comic-people.svg#specialist' }],
  },
  {
    clause: '2.7',
    title: 'Согласование начальником ФЭУ',
    phase: approval,
    text: 'Начальник ФЭУ в течение одного рабочего дня проверяет размер отчислений проекта в фонд расходов института и начисление резерва отпускных, затем согласовывает проект приказа.',
    transition: { before: 'Проект передан начальнику ФЭУ', after: 'Финансовые условия согласованы' },
    scene: { kind: 'approve', prop: order, outcome: 'Согласовано', cues: ['Сверить отчисления и резерв отпускных', 'Согласовать проект приказа'] },
    people: [{ name: 'Начальник ФЭУ', art: 'comic-people.svg#finance' }],
  },
  {
    clause: '2.7',
    embedded: '2.6',
    title: 'Согласование первым проректором',
    phase: approval,
    text: 'Первый проректор в течение одного рабочего дня рассматривает проект приказа и согласовывает его.',
    transition: { before: 'Проект передан первому проректору', after: 'Первый проректор согласовал проект' },
    scene: { kind: 'approve', prop: order, outcome: 'Согласовано', cues: ['Рассмотреть проект', 'Согласовать проект приказа'] },
    people: [{ name: 'Первый проректор', art: 'comic-people.svg#member-one' }],
  },
  {
    clause: '2.7',
    embedded: '2.7',
    title: 'Утверждение и электронная подпись',
    phase: 'Выпуск приказа',
    text: 'Курирующий проректор или директор в течение одного рабочего дня утверждает приказ и подписывает его электронной подписью.',
    transition: { before: 'Проект согласован', after: 'Приказ утверждён и подписан ЭЦП' },
    scene: {
      kind: 'sign', prop: 'Приказ об открытии ФЛС', art: 'document-icon.svg',
      action: { effect: 'sign', layout: 'electronic', labels: ['Проект согласован', 'Электронная подпись', 'Приказ подписан'] },
      cues: ['Утвердить приказ', 'Подписать электронной подписью'],
    },
    people: [{ name: 'Курирующий проректор или директор', shortName: 'Подписант', art: 'comic-people.svg#director' }],
  },
  {
    clause: '2.8',
    title: 'Регистрация приказа и уведомление',
    phase: 'Выпуск приказа',
    text: 'Сотрудник административного отдела в течение одного рабочего дня регистрирует приказ и доводит его до сведения заинтересованных лиц в части, которая их касается.',
    transition: { before: 'Приказ подписан', after: 'Приказ зарегистрирован, заинтересованные лица уведомлены' },
    scene: {
      kind: 'register', prop: 'Приказ об открытии ФЛС', art: 'document-icon.svg',
      action: { effect: 'register', layout: 'list', labels: ['Приказ подписан', 'Регистрация приказа', 'Приказ зарегистрирован'] },
      cues: ['Зарегистрировать приказ', 'Довести приказ до сведения заинтересованных лиц'],
    },
    people: [{ name: 'Сотрудник административного отдела', shortName: 'Сотрудник отдела', art: 'comic-people.svg#secretary' }],
  },
  {
    clause: '2.9',
    title: 'Передача оригинала договора в бухгалтерию',
    phase: 'Передача договора',
    text: 'Руководитель проекта в течение одного рабочего дня после регистрации приказа сдаёт оригинал договора, контракта или соглашения под роспись в отдел учёта доходов (бухгалтерский учёт НИОКР и НИУ).',
    transition: { before: 'Приказ зарегистрирован', after: 'Оригинал договора передан в отдел учёта доходов под роспись' },
    scene: { kind: 'send', prop: 'Оригинал договора', cues: [] },
    people: [projectManager, { name: 'Отдел учёта доходов', art: 'comic-people.svg#finance' }],
  },
];

function citeFor(nodes, document, clause, embedded) {
  const node = nodes.find(item => item.id === clause);
  const lines = node.text.split('\n');
  const number = embedded || clause;
  const index = embedded ? lines.findIndex(line => line.trimStart().startsWith(embedded + '. ')) : 0;
  if (index < 0) return null;
  const next = lines.findIndex((line, i) => i > index && /^\s*\d+\.\d+\.\s/u.test(line));
  const anchor = embedded ? embeddedClauseAnchor(node.anchor, index) : node.anchor;
  return {
    doc: document.id, docTitle: document.title, clause: number, label: 'п. ' + number, anchor,
    quote: lines.slice(index, next < 0 ? undefined : next).join('\n').trim(),
  };
}

function fullFlsRoute(store, question) {
  const key = question.toLowerCase().trim().replace(/[.?!]+$/u, '').replaceAll('ё', 'е').replace(/\s+/gu, ' ');
  if (!routeQuestions.has(key)) return null;
  const doc = store.docById.get(documentId);
  if (!doc || doc.meta?.supersededBy) return null;
  const nodes = docView(doc, store).nodes;
  const section = nodes.filter(node => /^2(?:\.[1-9])?$/.test(node.id))
    .map(node => [node.id, node.text.replace(/\s+/gu, ' ').trim()]);
  if (createHash('sha256').update(JSON.stringify(section)).digest('hex') !== reviewedSection) return null;
  const document = { id: doc.id, title: doc.title, url: doc.url };
  const steps = walkthrough.map(({ clause, embedded, ...step }, index) => ({
    ...step,
    ...(step.phase === approval ? { sceneChoice: approvalScene(step.people[0]) } : {}),
    n: index + 1, cites: [citeFor(nodes, document, clause, embedded)],
  }));
  if (steps.some(step => !step.cites[0])) return null;
  return {
    document, steps,
    summary: 'Оформите карточку проекта и направьте её со скан-копией договора на согласование. После регистрации приказа руководитель проекта сдаёт оригинал договора в бухгалтерию под роспись в течение одного рабочего дня.',
    summary_cite: null,
  };
}

module.exports = { addFlsScenes, fullFlsRoute };
