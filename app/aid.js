'use strict';

const { people, scenes, clauses } = require('../notes/asset-library/aid-route-data');
const { docView } = require('../rag/server');

const documentId = 'mipt-matpomosch-obuch';
const props = {
  '1.2': ['fill', 'Заявление'],
  '1.4': ['send', 'Документы'],
  '2.1': ['approve', 'Протокол'],
  '2.4': ['send', 'Выписка'],
  '3.1': ['fill', 'Приказ'],
  '3.3': ['send', 'Письмо'],
  '3.4': ['approve', '1С Документооборот'],
  '3.5': ['send', 'Приказ'],
};

function normalized(text) {
  return text.replace(/^\d+\.\d+\.\s*/u, '').replace(/\s+/gu, ' ').trim();
}

function aidAnswer(store, question) {
  if (question.toLowerCase().trim().replace(/[?.!]+$/, '') !== 'как оформить материальную помощь') return null;
  const doc = store.docById.get(documentId);
  if (!doc) return null;
  const nodes = new Map(docView(doc).nodes.map(node => [node.id, node]));
  // The prepared summary applies only to the edition used for the storyboard.
  if (Object.entries(clauses).some(([id, quote]) => !nodes.has(id)
    || normalized(quote) !== normalized(nodes.get(id).text))) return null;
  const document = { id: doc.id, title: doc.title, url: doc.url };
  return {
    document,
    documents: [document],
    summary: 'Подайте заявление и подтверждающие документы в стипендиальную комиссию физтех-школы или ИНБИКСТ. Решение комиссии оформляют протоколом, на его основании готовят приказ.',
    steps: scenes.map((step, index) => {
      const [kind, prop] = props[step.cites[0]];
      return {
        n: index + 1,
        title: step.title,
        phase: step.phase,
        transition: step.transition,
        text: [step.text, step.condition].filter(Boolean).join(' '),
        scene: { kind, prop, art: step.object, cues: [] },
        sceneChoice: step.sceneChoice,
        people: step.actors.map(id => {
          const [art, name, role] = people[id];
          return { id, art, name, role };
        }),
        cites: step.cites.map(id => {
          const { label, anchor, text } = nodes.get(id);
          return { doc: doc.id, docTitle: doc.title, clause: id, label, anchor, quote: text };
        }),
      };
    }),
  };
}

module.exports = { aidAnswer };
