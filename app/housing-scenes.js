'use strict';

const { docView, embeddedClauseAnchor } = require('../rag/server');
const { validate } = require('../notes/asset-library/scene-kit');

const documentId = 'регламент-поселения-сотрудников';
const reviewedPdf = '0ea0b6ac27ee4ac755112860a405a4c8dbf948efac4ff84a5e1d5165bd5f029a';
const question = 'Как сотруднику заселиться в общежитие?';
const routeQuestion = /^(?:как (?:(?:сотруднику )?(?:заселиться|поселиться) в общежитие|сотруднику получить место в общежитии|подать заявку на (?:поселение|заселение) в общежитие|оформить заселение в общежитие)|порядок поселения сотрудников в общежитие)(?: мфти)?$/u;
const email = 'poselenie@mipt.ru';
const employee = { portrait: 'employee', role: 'Сотрудник МФТИ' };
const manager = { portrait: 'director', role: 'Руководитель подразделения' };
const office = { portrait: 'specialist', role: 'Управление внеучебной деятельности' };
const chair = { portrait: 'member-one', role: 'Председатель комиссии по поселению' };
const supervisor = { portrait: 'member-one', role: 'Курирующий проректор или директор' };

function step(title, phase, clauses, text, before, after, choice, when) {
  return {
    title, phase, clauses, text, transition: { before, after, when },
    scene: { cues: [] }, sceneChoice: validate({ variant: '', result: '', ...choice }),
  };
}

const steps = [
  step('Сверьте условия поселения', 'Подача заявки', ['1.2', '1.3', '1.4', '3.1'],
    'По общему правилу место может быть предоставлено сотруднику МФТИ на 1,0 ставки, не старше 40 лет, с регистрацией вне Москвы и Московской области, без долга за предыдущие периоды и без систематических задолженностей. Для сотрудников, которые также учатся в МФТИ, и для совместного поселения с семьёй действуют отдельные условия.',
    'Сотруднику нужно место в общежитии', 'Понятно, какие условия применяются',
    { template: 'materials', variant: 'criteria', actors: [employee], object: 'document', objectLabel: 'Трудоустройство на 1,0 ставки',
      extraItems: [{ object: 'document', label: 'Возраст не более 40 лет', present: true },
        { object: 'document', label: 'Регистрация вне Москвы и области', present: true },
        { object: 'document', label: 'Оплата предыдущего найма', present: true }], result: 'Основные условия сверены' }),
  step('Направьте заявку в УВД', 'Подача заявки', ['2.6', '2.7'],
    'Заявку по форме, на которую ссылается регламент, подаёт руководитель подразделения, где работает сотрудник. Он отправляет её на ' + email + ' с темой «Поселение сотрудников».',
    'Заявка по указанной форме подготовлена', 'Заявка поступила в УВД',
    { template: 'transfer', variant: 'email', actors: [manager, office], object: 'application', objectLabel: 'Заявка на поселение',
      address: email, subject: 'Поселение сотрудников', documentStatus: 'По форме из приложения', result: 'Заявка направлена в УВД' }),
  step('Как УВД обрабатывает заявки', 'Рассмотрение', ['2.8', '3.2', '3.8'],
    'УВД формирует список сотрудников, подавших заявки. Когда заявителей больше, чем мест, УВД передаёт список на утверждение курирующему поселение проректору или директору. Приоритеты перечислены в разделе 3.',
    'УВД собрало заявки', 'При нехватке мест список передан на утверждение',
    { template: 'decide', actors: [office], object: 'document', objectLabel: 'Список заявителей',
      paths: ['Мест хватает', 'Мест меньше, чем заявителей'], result: 'Порядок рассмотрения определён' }),
  step('Направьте записку по исключительному случаю', 'Рассмотрение', ['1.7', '4'],
    'Руководитель готовит мотивированную служебную записку на имя председателя комиссии по поселению. Согласуйте её с начальником службы социального развития и направьте через 1С:Документооборот.',
    'Случай требует отдельного рассмотрения', 'Записка направлена председателю комиссии',
    { template: 'transfer', variant: 'portal', actors: [manager, chair], object: 'document', objectLabel: 'Мотивированная служебная записка',
      address: '1С:Документооборот', documentStatus: 'Согласовано со службой социального развития', result: 'Записка направлена в комиссию' },
    'Если случай исключительный'),
  step('Получите уведомление о решении', 'Решение', ['2.9'],
    'Решение о поселении направляют на корпоративную почту сотрудника и его руководителя в домене mipt.ru. К заключению договора переходят после уведомления о его согласовании.',
    'Решение о поселении принято', 'Сотрудник и руководитель получили уведомление',
    { template: 'transfer', variant: 'email', actors: [office, { ...employee, role: 'Сотрудник и руководитель' }],
      object: 'document', objectLabel: 'Решение о поселении', address: 'Сотруднику и руководителю · mipt.ru',
      attachment: false, documentStatus: 'Решение о поселении', result: 'Уведомление направлено' }),
  step('Заключите договор найма', 'Договор', ['5.1', '5.3'],
    'Заключите договор найма в течение 5 рабочих дней с момента уведомления о согласовании договора. Если срок пропущен, место освобождается, а заявку аннулируют. Новый договор не заключают, пока не погашен долг по предыдущим договорам.',
    'Сотрудник получил уведомление о согласовании договора', 'Договор заключён в срок',
    { template: 'deadline', variant: 'after', actors: [employee], object: 'document', objectLabel: 'Договор найма',
      term: 'В течение 5 рабочих дней', eventLabel: 'Уведомление о согласовании', result: 'Договор заключён в срок' },
    'После уведомления о согласовании договора'),
  step('Сообщите об изменении условий работы', 'Проживание', ['3.9'],
    'Если в течение учебного года меняются должность, ставка или основное место работы и из-за этого условия поселения больше не выполняются, руководитель может попросить комиссию сохранить текущие условия до начала следующего учебного года. Для этого он подаёт служебную записку с ходатайством и объяснением причины.',
    'Условия работы изменились', 'Ходатайство передано в комиссию',
    { template: 'transfer', variant: 'handoff', actors: [manager, chair], object: 'document', objectLabel: 'Ходатайство о сохранении условий',
      result: 'Ходатайство передано в комиссию' },
    'Если сотрудник перестал соответствовать условиям поселения'),
  step('Проверьте последствия задолженности', 'Проживание', ['5.2', '5.3'],
    'Если долг превышает месяц, уведомляют сотрудника. Если он превышает два месяца, уведомляют руководителя. При долге более трёх месяцев уведомляют курирующего проректора и начинают готовить документы для искового заявления. Сроки блокировки карты доступа приведены в отдельном положении об общежитиях.',
    'Возник долг по оплате найма', 'Получатель уведомления зависит от срока долга',
    { template: 'decide', actors: [supervisor], object: 'document', objectLabel: 'Задолженность по найму',
      paths: ['Более 1 месяца', 'Более 2 месяцев', 'Более 3 месяцев'], result: 'Уведомление по сроку долга' },
    'Если есть задолженность'),
  step('Освободите комнату после расторжения договора', 'Выезд', ['5.4'],
    'После расторжения договора освободите жилое помещение в течение 3 календарных дней. Заберите вещи. Регламент указывает, что администрация не отвечает за оставленное в общежитии имущество.',
    'Договор расторгнут', 'Жилое помещение освобождено',
    { template: 'deadline', variant: 'after', actors: [employee], object: 'key', objectLabel: 'Жилое помещение',
      term: 'В течение 3 календарных дней', eventLabel: 'Договор расторгнут', result: 'Жилое помещение освобождено' }),
];

function correctHousingOcr(entry, record) {
  if (entry.sha !== reviewedPdf || !record.text || !record.pageStarts?.length) return record;
  const pageStarts = [];
  const pages = record.pageStarts.map((start, index) => record.text.slice(start, record.pageStarts[index + 1])
    .replace(/^3\.0(?= )/gmu, '3.9')
    .replace(/^3\.\](?= )/gmu, '3.1')
    .replace(/^1,3(?= )/gmu, '1.3')
    .replace(/^1\.[<‹]6(?= )/gmu, '1.6')
    .replace(/^(2\.[6-9])(?= )/gmu, '$1.')
    .replace('роз@ете@иирега', email)
    .replace('в домене пиреги.', 'в домене mipt.ru.')
    .replace('0.1 ставки ИПР', '0.1 ставки НПР'));
  let offset = 0;
  for (const page of pages) {
    pageStarts.push(offset);
    offset += page.length;
  }
  return { ...record, text: pages.join(''), pageStarts };
}

function housingCite(document, nodes, clause) {
  const node = nodes.get(clause);
  let { anchor, text, label, page } = node || {};
  if (!node) {
    // Section 2 starts at 2.6 in the scan, so the parser keeps its items inside the section.
    const section = nodes.get('2');
    if (!section || !/^2\.[6-9]$/u.test(clause)) return null;
    const lines = section.text.split('\n');
    const start = lines.findIndex(line => line.trimStart().startsWith(clause + '. '));
    if (start < 1) return null;
    const end = lines.findIndex((line, index) => index > start && /^\s*2\.[6-9]\.\s/u.test(line));
    anchor = embeddedClauseAnchor(section.anchor, start);
    text = lines.slice(start, end < 0 ? undefined : end).join('\n');
    label = 'п. ' + clause;
    page = 2;
  }
  return { doc: document.id, docTitle: document.title, clause, anchor, quote: text, label, page,
    ...(page ? { original: document.url + '#page=' + page } : {}) };
}

function fullHousingRoute(store, query, original) {
  const normalized = query.toLowerCase().trim().replace(/[.?!]+$/u, '').replace(/\s+/gu, ' ');
  if (original?.sha !== reviewedPdf || !routeQuestion.test(normalized)) return null;
  const doc = store.docById.get(documentId);
  if (!doc || doc.meta?.supersededBy || doc.meta?.status === 'утратил силу') return null;
  const nodes = new Map(docView(doc, store).nodes.map(node => [node.id, node]));
  const document = { id: doc.id, title: doc.title, url: doc.url };
  const route = steps.map(({ clauses, ...item }, index) => ({
    ...item, n: index + 1, cites: clauses.map(clause => housingCite(document, nodes, clause)),
  }));
  if (route.some(item => item.cites.some(cite => !cite))) return null;
  return {
    document, documents: [document],
    summary: 'Заявку на поселение направляет руководитель подразделения. После уведомления о согласовании договора заключите его в течение 5 рабочих дней. После расторжения договора освободите комнату в течение 3 календарных дней.',
    summary_cite: null,
    steps: route,
  };
}

module.exports = { documentId, question, fullHousingRoute, correctHousingOcr };
