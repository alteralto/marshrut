'use strict';

const sceneRoute = document.getElementById('scene-route');
const cards = [...document.querySelectorAll('#scene-catalog article')];
const sceneCount = document.getElementById('scene-count');

function filterScenes() {
  let visible = 0;
  for (const card of cards) {
    const examples = [...card.querySelectorAll('[data-route]')];
    for (const example of examples) example.hidden = sceneRoute.value !== 'all' && example.dataset.route !== sceneRoute.value;
    card.hidden = examples.every(example => example.hidden);
    if (!card.hidden) visible++;
  }
  sceneCount.textContent = 'Сцен: ' + visible;
}
sceneRoute.closest('.scene-filter').hidden = false;
sceneRoute.addEventListener('change', filterScenes);
filterScenes();

for (const link of document.querySelectorAll('[data-commission]')) {
  link.addEventListener('click', () => {
    document.querySelector('#commission button[data-case="' + link.dataset.commission + '"]').click();
  });
}
const concertDocuments = document.getElementById('concert-documents');
if (location.hash === '#concert-documents') concertDocuments.open = true;

const sources = document.getElementById('indexed-sources');
const sourceStatus = document.getElementById('indexed-status');
let loadingSources = false;

async function loadSources() {
  loadingSources = true;
  sourceStatus.textContent = 'Загружаю список файлов…';
  try {
    const response = await fetch('/docs');
    if (!response.ok) throw new Error('Список недоступен');
    const documents = await response.json();
    for (const doc of documents) {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = doc.file || doc.title;
      const view = document.createElement('a');
      view.href = '/doc/' + encodeURIComponent(doc.id) + '?format=html';
      view.textContent = 'Текст';
      item.append(title, view);
      if (doc.url?.startsWith('/original/')) {
        const original = document.createElement('a');
        original.href = doc.url;
        original.textContent = 'Оригинал';
        item.append(original);
      }
      if (doc.supersededBy) {
        const note = document.createElement('p');
        note.textContent = 'Предыдущая редакция';
        item.append(note);
      }
      sources.append(item);
    }
    sourceStatus.textContent = 'Файлов в поисковой базе: ' + documents.length;
  } catch {
    sourceStatus.textContent = 'Не удалось загрузить список файлов.';
  } finally {
    loadingSources = false;
  }
}
const sourceDetails = sources.closest('details');
sourceDetails.addEventListener('toggle', () => {
  if (sourceDetails.open && !loadingSources && !sources.childElementCount) loadSources();
});
