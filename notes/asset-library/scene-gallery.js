'use strict';

const base = new URL('.', location.href).href;
const list = document.getElementById('gallery');
const groupFilter = document.getElementById('group');
const typeFilter = document.getElementById('type');
const search = document.getElementById('search');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const { templates, titleFor, validate } = window.SceneKit;

function node(tag, text) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  return item;
}

function makeCard(example) {
  const choice = validate(example.scene);
  const type = templates[choice.template];
  const label = titleFor(choice);
  const variant = choice.template === 'materials' && ['present', 'missing'].includes(choice.variant)
    ? (choice.variant === 'missing' || choice.extraItems?.some(item => !item.present) ? 'Комплект неполный' : 'Комплект полный')
    : type.variants?.[choice.variant];
  const { renderer, config } = window.RouteSceneEditor.build(choice, base);
  const card = node('article');
  const stage = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  stage.setAttribute('aria-hidden', 'true');
  const caption = node('div');
  caption.className = 'caption';
  const title = node('h2', label);
  const details = node('p', [example.group, variant !== label ? variant : ''].filter(Boolean).join(' · '));
  const summary = [choice.objectLabel, choice.term, choice.result].filter(Boolean).join(' · ');
  const replay = node('button', 'Смотреть');
  replay.type = 'button';
  replay.setAttribute('aria-label', 'Смотреть сцену «' + label + '» — ' + choice.objectLabel);
  replay.hidden = motion.matches;
  const actions = node('div');
  actions.className = 'card-actions';
  if (example.href) {
    const source = node('a', example.sourceLabel || 'Пункт регламента');
    source.href = example.href;
    actions.append(source);
  }
  actions.append(replay);
  caption.append(title, details, node('p', example.description || summary), actions);
  card.append(stage, caption);
  list.append(card);

  const player = renderer.create(stage, id => base + window.ComicPeople.portraitUrl(id));
  player.load(config);
  const previewTime = example.collection === 'delivery' ? renderer.channelPreviewTime : renderer.duration;
  player.render(previewTime ?? renderer.duration);
  let frame = 0;
  const finish = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    player.render(renderer.duration);
    replay.textContent = 'Повторить';
  };
  replay.addEventListener('click', () => {
    cancelAnimationFrame(frame);
    let start;
    replay.textContent = 'Сначала';
    frame = requestAnimationFrame(function tick(now) {
      start ??= now;
      const time = now - start;
      if (time >= renderer.duration || motion.matches) { finish(); return; }
      player.render(time);
      frame = requestAnimationFrame(tick);
    });
  });
  motion.addEventListener('change', () => {
    replay.hidden = motion.matches;
    if (frame) finish();
  });
  return {
    card, group: example.group, type: choice.template, variant: choice.variant,
    terms: [example.group, type.label, label, variant, example.sourceLabel, summary, example.description, ...choice.actors.map(actor => actor.role)]
      .filter(Boolean).join(' ').toLocaleLowerCase('ru').replaceAll('ё', 'е'),
    stop: () => { if (frame) finish(); },
  };
}

const params = new URLSearchParams(location.search);
const collection = params.get('compare');
const comparison = new Map([
  ['delivery', ['transfer', 'В письме записка становится вложением. В системе заявок сотрудник отправляет заполненную форму.']],
  ['review', ['review', 'Два последовательных этапа работы с приказом «О начале работ». Сначала директор сверяет проект и согласовывает его, затем уполномоченный руководитель утверждает и подписывает приказ.']],
  ['materials', ['materials', 'На примере перехода на бесплатное обучение: сначала обучающийся сверяет комплект перед подачей. После передачи заявления комиссия обсуждает материалы и фиксирует решение в протоколе.']],
]).get(collection);
const examples = comparison
  ? window.SceneGalleryExamples.filter(example => example.collection === collection).sort((a, b) => (a.order || 0) - (b.order || 0))
  : window.SceneGalleryExamples;
if (comparison) {
  const [template, description] = comparison;
  list.classList.add('comparison');
  document.querySelector('h1').textContent = templates[template].label;
  document.querySelector('.lead').textContent = description;
}
const cards = examples.map(makeCard);
const groups = [...new Set(cards.map(card => card.group))];
for (const group of groups) groupFilter.append(new Option(group, group));
for (const type of new Set(cards.map(card => card.type))) typeFilter.append(new Option(templates[type].label, type));
const initialType = params.get('type');
let legacyType = ['check', 'commission'].includes(initialType) ? initialType : '';
const selectedType = legacyType ? 'materials' : initialType;
if (Array.from(typeFilter.options).some(option => option.value === selectedType)) typeFilter.value = selectedType;

function applyFilter() {
  const words = search.value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е').split(/\s+/u);
  let shown = 0;
  for (const entry of cards) {
    const matches = (!groupFilter.value || groupFilter.value === entry.group)
      && (!typeFilter.value || typeFilter.value === entry.type)
      && (!legacyType || (legacyType === 'commission') === (entry.variant === 'commission'))
      && words.every(word => entry.terms.includes(word));
    entry.card.hidden = !matches;
    if (matches) shown += 1;
    else entry.stop();
  }
  document.getElementById('count').textContent = 'Сцен: ' + shown + ' из ' + cards.length;
  document.getElementById('empty').hidden = shown > 0;
}

groupFilter.addEventListener('change', applyFilter);
typeFilter.addEventListener('change', () => { legacyType = ''; applyFilter(); });
search.addEventListener('input', applyFilter);
document.getElementById('reset').addEventListener('click', () => {
  groupFilter.value = typeFilter.value = search.value = '';
  legacyType = '';
  applyFilter();
  search.focus();
});
applyFilter();
