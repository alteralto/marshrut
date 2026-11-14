'use strict';

const kit = window.SceneKit;
const portraits = window.ComicPeople;
const stage = document.getElementById('stage');
const objectSelect = document.getElementById('preview-object');
const candidate = document.getElementById('preview-candidate');
const assets = document.getElementById('assets');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const base = '/notes/asset-library/';
let frame;

for (const [id, item] of Object.entries(kit.objects)) {
  const card = document.createElement('li');
  const icon = document.createElement('img');
  icon.alt = '';
  icon.src = base + item.art;
  card.append(icon, item.label);
  assets.append(card);
  objectSelect.append(new Option(item.label, id));
}
for (const id of kit.portraits) candidate.append(new Option(portraits.portraits[id].name, id));
objectSelect.value = 'resume';
candidate.value = 'student';

function replay() {
  cancelAnimationFrame(frame);
  const { renderer, config } = window.RouteSceneEditor.build({
    template: 'interview',
    actors: [{ portrait: 'specialist', role: 'Интервьюер' }, { portrait: candidate.value, role: 'Кандидат' }],
    object: objectSelect.value, objectLabel: '', variant: '', result: '',
  }, base);
  const player = renderer.create(stage);
  player.load(config);
  const start = performance.now();
  function tick(now) {
    const time = motion.matches ? renderer.duration : now - start;
    player.render(time);
    if (time < renderer.duration) frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
}

document.getElementById('replay').addEventListener('click', replay);
objectSelect.addEventListener('change', replay);
candidate.addEventListener('change', replay);
replay();
