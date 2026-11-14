'use strict';
// Which document and which clauses answer a question: the rules that do not
// follow from word statistics alone. A small corpus is written to a temporary
// folder and indexed the usual way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rag = require('../src');
const { buildIndex, prepare } = require('../src/store');
const { retrieve, expandQuery } = require('../src/retrieve');
const { OFFLINE } = require('./helpers');

const DOCS = {
  'fls.txt': `РЕГЛАМЕНТ
открытия финансового лицевого счета

1. Общие положения
1.1. Настоящий Регламент определяет порядок открытия финансового лицевого счета для учета расходов по договорам.

2. Порядок открытия финансового лицевого счета
2.1. Ответственный исполнитель формирует карточку проекта и направляет ее в финансово-экономическое управление.
2.2. Сотрудник ФЭУ в течение одного рабочего дня проверяет содержание карточки проекта и присваивает номер счета.
2.3. Руководитель подразделения в течение одного рабочего дня рассматривает проект приказа и согласовывает его.

3. Порядок открытия финансового лицевого счета для проектов, выполняемых по государственным военным стандартам
3.1. Ответственный исполнитель формирует карточку проекта и направляет ее вместе с приказом о начале работ в финансово-экономическое управление.
3.2. Сотрудник отдела приоритетных исследований в течение одного рабочего дня проверяет достоверность карточки проекта.
3.3. Сотрудник ФЭУ в течение одного рабочего дня проверяет содержание карточки проекта и присваивает номер счета.
3.4. Сотрудник центра трансфера технологий в течение одного рабочего дня проверяет достоверность карточки проекта.
3.5. Руководитель подразделения в течение одного рабочего дня рассматривает проект приказа и согласовывает его.
`,
  'podbor.txt': `РЕГЛАМЕНТ
поиска и подбора персонала

1. Общие положения
1.1. Настоящий Регламент определяет порядок поиска и подбора персонала на вакантные должности.

2. Термины и определения
2.1. Внутренний заказчик – руководитель подразделения, которому требуется подобрать сотрудника.
2.2. Вышестоящий руководитель – руководитель, которому непосредственно подчиняется руководитель подразделения.

3. Порядок поиска и подбора
3.1. Инициатором подбора на вакантную должность является руководитель подразделения, он заполняет заявку на подбор.
3.2. Служебная записка согласуется вышестоящим руководителем и курирующим проректором.
3.3. Объявление о вакансии размещается на портале в течение одного рабочего дня.
3.4. Руководитель подразделения информирует управление о принятом решении по каждому кандидату на вакантную должность.
`,
  'zaem.txt': `РЕГЛАМЕНТ
о внутреннем заимствовании средств для реализации проектов

1. При наличии свободных денежных средств структурным подразделениям может предоставляться внутреннее заимствование для реализации проектов.
2. Приоритетное право на внутреннее заимствование предоставляется проектам по договорам с государственными органами.
3. Срок внутреннего заимствования для проекта может составлять от одного до четырех месяцев.
4. Внутреннее заимствование на проект не выдается при наличии просроченной задолженности подразделения.
5. Заявка на заимствование составляется по форме приложения 1 и направляется в финансово-экономическое управление до 18 числа месяца.
6. В случае нарушения сроков возврата внутреннего заимствования денежные средства проекта блокируются.
7. Информация о просроченных внутренних заимствованиях по проектам направляется директору по безопасности.
8. Внутреннее заимствование на проекты по субсидиям осуществляется на основании приказов ректора.
9. Распределение ответственности за возврат внутреннего заимствования на проект определяется приказом.
`,
  'smety.txt': `РЕГЛАМЕНТ
согласования смет доходов и расходов

1. Общие положения
1.1. Настоящий регламент устанавливает порядок согласования смет доходов и расходов.

2. Порядок согласования смет
2.1. Сметы заполняются руководителем проекта в системе документооборота.
2.2. Ответственный исполнитель несет ответственность за корректное составление сметы.
2.3. Сотрудник управления проверяет корректность составленной сметы.
2.4. Корректно составленная смета утверждается курирующим проректором.
`,
  'korrektirovka-smet.txt': `ИНСТРУКЦИЯ
по корректировке смет

1. Ввести в эксплуатацию функционал по подготовке смет в системе документооборота.
2. Для работы с утвержденными сметами руководствоваться настоящей инструкцией.
3. Контроль исполнения возложить на первого проректора.
`,
  'koncertnyy-zal.txt': `РЕГЛАМЕНТ
бронирования концертного зала

1. Общие положения
1.1. Концертный зал находится в управлении культурно-массового отдела.

2. Порядок бронирования
2.1. Служебная записка подается не позднее чем за два месяца до даты мероприятия.
2.2. В концертный зал запрещено проносить еду и напитки.
`,
};

let storePromise = null;
function corpus() {
  if (!storePromise) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-clauses-'));
    for (const [name, text] of Object.entries(DOCS)) fs.writeFileSync(path.join(dir, name), text);
    storePromise = buildIndex([dir], { embed: false }).then(prepare);
  }
  return storePromise;
}

async function stepsOf(question) {
  const store = await corpus();
  const a = await rag.ask(question, { ...OFFLINE, store, mode: 'extractive' });
  return { a, cited: a.steps.map((s) => s.cites[0].clause) };
}

test('a verb of the question counts when a document is titled with it', async () => {
  const store = await corpus();
  const r = await retrieve(store, 'как скорректировать утвержденную смету', OFFLINE);
  assert.equal(r.notFound, false, r.reason);
  assert.equal(r.primary.docId, 'korrektirovka-smet');
  // the word stands only in the title; the other regulation says "корректное составление сметы"
  const about = (res, id) => res.docs.find((d) => d.docId === id).about;
  assert.ok(about(r, 'korrektirovka-smet') > about(r, 'smety'));
  const plain = await retrieve(store, 'как скорректировать утвержденную смету', { ...OFFLINE, verbAbout: 0 });
  assert.equal(about(plain, 'korrektirovka-smet'), about(plain, 'smety'), 'without the rule both are equally about estimates');
});

test('aspect pairs are one word: "указать" finds "указывает"', () => {
  const { groups } = expandQuery(['указа'], ['указыва', 'указан', 'приказ'], 0.6);
  assert.deepEqual([...groups.get('указа')].sort(), ['указа', 'указан', 'указыва']);
});

test('the best clause is a step even when a longer twin section is chosen', async () => {
  const { a, cited } = await stepsOf('сколько времени сотрудник ФЭУ проверяет карточку проекта');
  assert.equal(a.document.id, 'fls');
  assert.ok(cited.includes('2.2'), `2.2 in ${cited}`);
  assert.equal(a.summary_cite.clause, '2.2');
});

test('a question about a term is answered from the definitions', async () => {
  const { a, cited } = await stepsOf('кто такой вышестоящий руководитель');
  assert.equal(a.document.id, 'podbor');
  assert.ok(cited.includes('2.2'), `2.2 in ${cited}`);
});

test('"how do I get" questions show the clause where the application is filed', async () => {
  const { a, cited } = await stepsOf('как получить внутренний заем на проект');
  assert.equal(a.document.id, 'zaem');
  assert.ok(cited.includes('5'), `5 in ${cited}`);
  const store = await corpus();
  const r = await retrieve(store, 'как получить внутренний заем на проект', { ...OFFLINE, entryClauses: 0 });
  assert.ok(!r.context.some((c) => c.clauseId === '5' && c.lead), 'without the rule clause 5 is not singled out');
});

test('the short answer quotes one of the listed steps', async () => {
  for (const q of ['можно ли проносить еду в концертный зал', 'как открыть финансовый лицевой счет']) {
    const { a, cited } = await stepsOf(q);
    assert.equal(a.not_found, false, q);
    assert.ok(cited.includes(a.summary_cite.clause), `${q}: ${a.summary_cite.clause} in ${cited}`);
  }
});
