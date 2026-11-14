'use strict';

const documentId = 'mipt-business-trip';
const originalPages = {
  46: 12, 47: 12, 51: 13, 53: 13, 54: 13, 55: 13, 56: 13, 57: 13,
  58: 13, 59: 13, 60: 13, 64: 14, 65: 14, 66: 14,
};
const roles = {
  employee: { name: 'Саша', role: 'Командируемый работник' },
  manager: { name: 'Марина', role: 'Руководитель подразделения' },
  travel: { name: 'Лена', role: 'Группа командирования ОМС' },
  finance: { name: 'Ирина', role: 'Финансовый отдел' },
  accounting: { name: 'Денис', role: 'Отдел бухгалтерского учёта' },
};
const route = [
  {
    title: 'Согласуйте направление в поездку',
    phase: 'До поездки',
    transition: { before: 'Есть документ-основание', after: 'Руководитель решил направить сотрудника в поездку' },
    scene: { kind: 'approve', prop: 'Основание поездки', cues: ['Руководитель принимает решение', 'Сотрудник прикладывает основание'] },
    sceneChoice: { template: 'decide', actors: [{ portrait: 'director', role: 'Руководитель подразделения' }],
      object: 'document', objectLabel: 'Основание поездки', variant: '', paths: ['Приглашение', 'Служебная записка или иной документ'],
      result: 'Решение принимает руководитель' },
    text: 'Руководитель подразделения принимает решение о направлении. Укажите дату и номер документа-основания в Решении о командировании и приложите его. Для приглашения на иностранном языке командируемый готовит построчный перевод на русский язык.',
    people: ['manager', 'employee'], clauses: ['46'],
  },
  {
    title: 'Заполните Решение о командировании',
    phase: 'До поездки',
    transition: { before: 'Определены основание и условия поездки', after: 'Заполнены условия, расходы и источники финансирования' },
    scene: { kind: 'fill', prop: 'Решение о командировании', cues: ['Сотрудник заполняет форму', 'Финансовый отдел проверяет раздел 3'] },
    text: 'Руководитель или по его указанию работник заполняет подразделы 1.1–1.3 и раздел 2. Согласуйте с финансовым отделом источники финансирования по каждой статье расходов и внесите их в раздел 3. Финансовый отдел проверяет и удостоверяет этот раздел.',
    people: ['employee', 'finance'], clauses: ['47', '51'],
  },
  {
    title: 'Передайте Решение в группу командирования ОМС',
    phase: 'До поездки',
    transition: { before: 'Решение согласовано и утверждено для бумажной подачи', after: 'Решение передано в ОМС для выпуска приказа', when: 'Показана бумажная подача' },
    scene: { kind: 'send', prop: 'Утверждённое Решение', cues: ['Сотрудник передаёт Решение', 'Группа ОМС готовит приказ при бумажном оформлении'] },
    text: 'Работник представляет Решение не позднее чем за 7 рабочих дней до поездки. Для однодневной поездки допускается оформление не позднее дня командирования. При бумажном оформлении группа командирования ОМС готовит приказ в течение 2 рабочих дней после получения утверждённого Решения. Работник подписывает лист ознакомления в течение 3 рабочих дней и хранит копии приказа и Решения до сдачи отчёта.',
    people: ['employee', 'travel'], clauses: ['53', '54', '55', '56', '57'],
  },
  {
    title: 'Оформите аванс при необходимости',
    phase: 'Подготовка расходов',
    transition: { before: 'Есть Решение и приказ о командировании', after: 'Бухгалтерия перечисляет аванс после согласования платёжных документов', when: 'При необходимости' },
    scene: { kind: 'advance', prop: 'Платёжные документы', cues: ['ОМС передаёт Решение и приказ', 'Бухгалтерия перечисляет аванс после подписания'] },
    sceneChoice: { template: 'pay', actors: [{ portrait: 'finance', role: 'Отдел бухгалтерского учёта' }, { portrait: 'employee', role: 'Работник' }],
      object: 'money', objectLabel: 'Аванс на командировку', variant: 'advance', result: 'Аванс перечислен', account: 'Командируемый работник' },
    text: 'Работник имеет право получить аванс на расходы из Решения. Группа командирования ОМС передаёт Решение и приказ в отдел бухгалтерского учёта. После согласования и подписания платёжных документов бухгалтерия перечисляет аванс. При задолженности по предыдущим авансам новый аванс не выплачивается до её погашения.',
    people: ['travel', 'accounting'], clauses: ['58', '59', '60'],
  },
  {
    title: 'Оформите билеты и жильё',
    phase: 'Подготовка расходов',
    transition: { before: 'В Решении указаны сроки поездки', after: 'Билеты и жильё оформлены на эти даты' },
    scene: { kind: 'book', prop: 'Билет и бронь', cues: ['Сотрудник сверяет даты с Решением', 'Даты билетов и проживания совпадают со сроками поездки'] },
    sceneChoice: { template: 'materials', actors: [{ portrait: 'employee', role: 'Командируемый работник' }],
      object: 'calendar', objectLabel: 'Даты в Решении', variant: 'criteria', result: 'Даты совпадают со сроками поездки',
      extraItems: [{ object: 'document', label: 'Даты билетов', present: true },
        { object: 'document', label: 'Даты проживания', present: true }] },
    text: 'Работник оформляет билеты, бронирует жильё и готовит остальные документы для поездки. Даты билетов и фактического проживания должны совпадать со сроками из Решения о командировании.',
    people: ['employee'], clauses: ['64'],
  },
  {
    title: 'Сдайте отчёт после возвращения',
    phase: 'После возвращения',
    transition: { before: 'Собраны документы о расходах и результаты поездки', after: 'Отчёт с приложениями передан в группу ОМС' },
    scene: { kind: 'report', prop: 'Отчёт 0504520', cues: ['Сотрудник собирает отчёт и приложения', 'Сотрудник передаёт комплект в группу ОМС'] },
    sceneChoice: { template: 'deadline', actors: [{ portrait: 'employee', role: 'Работник' }], object: 'document',
      objectLabel: 'Отчёт 0504520', variant: 'after', result: 'Отчёт сдан в срок', term: 'в течение 3 рабочих дней', eventLabel: 'Возвращение' },
    text: 'В течение 3 рабочих дней передайте в группу командирования ОМС отчёт о расходах по форме 0504520. Приложите копии Решения и приказа, документы о расходах и отчёт о результатах командировки. Маршрутный лист приложите, если он требуется по пунктам 14 или 61. Для зарубежной поездки приложите предусмотренные регламентом страницы загранпаспорта.',
    people: ['employee', 'travel'], clauses: ['65', '66'],
  },
];

const questions = new Map([
  ['как оформить командировку', route],
  ['за сколько дней подать решение о командировании', [route[2]]],
  ['как получить аванс на командировку', [route[3]]],
  ['что сдать после командировки', [route[5]]],
]);

function filingDeadlineAnswer(doc, node) {
  if (!node || !/не позднее чем за 7 рабочих дней до командировки/iu.test(node.text.replace(/\s+/gu, ' '))) return null;
  const document = { id: doc.id, title: doc.title, url: doc.url };
  const page = node.page || originalPages[53];
  const cite = {
    doc: doc.id, docTitle: doc.title, clause: '53', label: 'п. 53',
    anchor: 'cl-53', original: document.url + '#page=' + page, page, quote: node.text,
  };
  const summary = node.text.replace(/\s+/gu, ' ').trim();
  return { document, documents: [document], summary, summary_cite: cite, steps: [
    { n: 1, title: 'Срок подачи Решения о командировании', text: summary, cites: [cite] },
  ] };
}

function tripAnswer(store, question) {
  const key = question.toLowerCase().trim().replace(/[?.!]+$/, '').replace(/\s+/gu, ' ');
  const doc = store.docById.get(documentId);
  if (!doc) return null;
  const selected = questions.get(key);
  const deadline = /(?:за сколько|какой срок|когда)/u.test(key)
    && /(?:подать|подавать|пода[её]тся|представить)/u.test(key)
    && /(?:заявку(?: на командировку)?$|решение о командировании)/u.test(key)
    && /командиров|командирован/u.test(key)
    && !/отмен|продлен|продлён|отч[её]т|аванс|возмещен/u.test(key);
  if (!selected) return deadline ? filingDeadlineAnswer(doc, doc.nodes.find(node => node.id === '53')) : null;
  const document = { id: doc.id, title: doc.title, url: doc.url };
  const nodes = new Map(doc.nodes.map(node => [node.id, node]));
  if (selected.some(step => step.clauses.some(clause => !nodes.has(clause)))) return null;
  return {
    document,
    documents: [document],
    summary: selected === route
      ? 'Передайте Решение в группу командирования ОМС не позднее чем за 7 рабочих дней до поездки. Отчёт о расходах подайте в течение 3 рабочих дней после возвращения.'
      : null,
    steps: selected.map((step, index) => ({
      n: index + 1,
      title: step.title,
      phase: step.phase,
      transition: step.transition,
      text: step.text,
      scene: step.scene,
      sceneChoice: step.sceneChoice,
      people: step.people.map(id => ({ id, ...roles[id] })),
      cites: step.clauses.map(clause => ({
        doc: doc.id,
        docTitle: doc.title,
        clause,
        label: 'п. ' + clause,
        anchor: 'cl-' + clause,
        original: document.url + '#page=' + originalPages[clause],
        page: originalPages[clause],
        quote: nodes.get(clause).text,
      })),
    })),
  };
}

module.exports = { tripAnswer };
