'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('./library');
const { docx } = require('../rag/test/helpers');

test('an uploaded file is read in a worker thread; a broken one is refused with a reason', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshrut-lib-'));
  try {
    const library = new Library({ dataDir });
    const good = docx([['Регламент выдачи ключей'], ['1. Ключ от аудитории выдаёт дежурный администратор.'], ['2. Ключ возвращают до 21:00.']], '');
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    const added = await library.add(good, 'ключи.docx');
    clearInterval(timer);
    assert.equal(added.status, 'added');
    assert.ok(ticks > 0, 'the main thread kept running while the file was read');
    const broken = await library.add(Buffer.from('PK\u0003\u0004 not really a zip'), 'сломанный.docx');
    assert.equal(broken.status, 'failed');
    assert.match(broken.reason, /читается|повреждён/);
    await library.build();
    assert.equal(library.store.index.docs.length, 1);
    assert.match(library.store.index.chunks.map((c) => c.text).join(' '), /дежурный администратор/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('an uploaded document can be removed; a document of the delivery cannot', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshrut-lib-'));
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshrut-seed-'));
  try {
    fs.writeFileSync(path.join(seedDir, 'поставка.txt'), 'Регламент поставки\n\n1. Пункт поставки о хранении документов.');
    const library = new Library({ dataDir, seedDirs: [seedDir], seedCacheDir: path.join(dataDir, 'seed-cache') });
    library.seed();
    const up = await library.add(docx([['Регламент ключей'], ['1. Ключ выдаёт дежурный администратор.']], ''), 'ключи.docx');
    assert.equal(up.status, 'added');
    await library.build();
    assert.equal(library.store.index.docs.length, 2);
    const ids = [...library.byId.keys()];
    const seedId = ids.find((id) => library.byId.get(id).origin === 'seed');
    const upId = ids.find((id) => library.byId.get(id).origin === 'upload');
    assert.equal(library.remove(seedId).status, 'seed');
    assert.equal(library.remove(upId).status, 'removed');
    assert.ok(!fs.existsSync(up.entry.path), 'the original file is gone');
    await library.build();
    assert.deepEqual(library.store.index.docs.map((d) => d.id), [seedId]);
    assert.equal(new Library({ dataDir, seedDirs: [seedDir], seedCacheDir: path.join(dataDir, 'seed-cache') }).entries.length, 0, 'the removal is saved');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(seedDir, { recursive: true, force: true });
  }
});
