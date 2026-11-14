'use strict';

const fs = require('node:fs');
const path = require('node:path');
const projectCard = require('./project-card');
const concertMemo = require('./concert-memo');
const staffingApplication = require('./staffing-application');
const freeTuitionApplication = require('./free-tuition-application');
const { documentId: concert } = require('./concert-scenes');
const { documentId: staffing } = require('./staffing-scenes');

const caseDirectory = path.join(__dirname, '..', 'corpus', 'case');
const fls = 'приказ-n-3065-1-от-25-11-2021';
const budget = 'приказ-n-794-1-от-28-03-2023';
const entries = [
  {
    id: 'free-tuition-application',
    doc: 'порядок-перехода-с-платного-обучения-на-бесплатное',
    sourceSha: '9977bb6dff31860ebc67bd37c77a714a453bf399654028db237db75bcdf99b39',
    clauses: ['2.5'],
    referencePage: 5,
    file: 'forms/free-tuition-application.docx',
    fill: {
      endpoint: '/forms/free-tuition-application/filled',
      filename: freeTuitionApplication.filename,
      groups: freeTuitionApplication.groups,
      maxLength: freeTuitionApplication.maxLength,
      intro: 'Можно заполнить часть полей и продолжить в Word. Перед подачей подпишите заявление.',
    },
    generator: { parse: freeTuitionApplication.applicationValues, render: freeTuitionApplication.fillApplication },
    filename: 'Заявление о переходе на бесплатное обучение — пустой бланк.docx',
    title: 'Заявление о переходе на бесплатное обучение',
    source: 'По форме приложения № 1 к Порядку перехода МФТИ · стр. 5',
    fields: ['Адресат и сведения об обучающемся', 'Причина и условие перехода', 'Список приложений и дата'],
  },
  {
    id: 'staffing-application',
    doc: staffing,
    clauses: ['прил.1'],
    file: 'forms/staffing-application.docx',
    fill: {
      endpoint: '/forms/staffing-application/filled',
      filename: staffingApplication.filename,
      groups: staffingApplication.groups,
      maxLength: staffingApplication.maxLength,
      intro: 'Можно заполнить часть полей и продолжить в Word. Перед отправкой заполните все поля заявки по п. 3.2 регламента.',
    },
    generator: { parse: staffingApplication.applicationValues, render: staffingApplication.fillStaffingApplication },
    filename: 'Заявка на поиск и подбор персонала — пустой бланк.docx',
    title: 'Заявка на поиск и подбор персонала',
    source: 'По форме приложения к регламенту поиска и подбора персонала МФТИ · стр. 5',
    fields: ['Вакансия и подразделение', 'Сроки, формат и условия работы', 'Обязанности и требования к кандидату', 'Контакты интервьюера'],
  },
  {
    id: 'concert-booking-memo',
    doc: concert,
    clauses: ['прил.1'],
    file: 'forms/concert-booking-memo.pdf',
    previewFile: 'forms/concert-booking-memo.png',
    fill: {
      endpoint: '/forms/concert-booking-memo/filled',
      filename: concertMemo.filename,
      groups: concertMemo.groups,
      maxLength: concertMemo.maxLength,
      intro: 'Можно заполнить часть полей и продолжить в Word. Перед отправкой записку подписывает руководитель подразделения.',
    },
    generator: { parse: concertMemo.memoValues, render: concertMemo.fillConcertMemo },
    filename: 'Служебная записка о бронировании концертного зала — приложение 1.pdf',
    title: 'Служебная записка об организации мероприятия',
    source: 'Приложение № 1 к регламенту Концертного зала МФТИ · скан, 2 страницы',
    fields: ['Мероприятие, даты и время', 'Подразделение, организатор и ответственные лица', 'Источник финансирования и список для доступа', 'Расписание репетиций, оборудование и специалисты', 'Состояние зала после мероприятия'],
  },
  {
    id: 'project-card',
    doc: fls,
    clauses: ['2.1'],
    file: 'forms/project-card.docx',
    previewFile: 'forms/project-card.png',
    fill: {
      endpoint: '/forms/project-card/filled',
      filename: projectCard.filename,
      groups: projectCard.groups,
      maxLength: projectCard.maxLength,
    },
    generator: {
      parse: projectCard.cardValues,
      render: async (values, file) => projectCard.fillProjectCard(await fs.promises.readFile(file), values),
    },
    filename: 'Карточка проекта — приложение 1.docx',
    title: 'Карточка проекта',
    source: 'Приложение 1 к регламенту открытия ФЛС',
    fields: ['Номер и название договора', 'Даты заключения и завершения', 'Заказчик или грантодатель', 'Контакты руководителя проекта'],
  },
  {
    id: 'budget-1a',
    doc: budget,
    clauses: ['приказ/3', '2.1'],
    sourceDoc: 'приложение-1а-бланк-сметы',
    file: 'Приложение 1а Бланк сметы.docx',
    filename: 'Приложение 1а Бланк сметы.docx',
    title: 'Смета доходов и расходов · форма 1а',
    source: 'Приложение 1а к приказу № 794-1',
    fields: ['Период и номер ФЛС', 'Реквизиты договора', 'Доходы и расходы по месяцам'],
  },
  {
    id: 'budget-1b',
    doc: budget,
    clauses: ['приказ/3', '2.2'],
    sourceDoc: 'копия-приложение-1б-бланк-сметы-рцни',
    file: 'Копия Приложение 1б Бланк сметы РЦНИ.xlsx',
    filename: 'Приложение 1б Бланк сметы РЦНИ.xlsx',
    title: 'Годовая смета РЦНИ · форма 1б',
    source: 'Приложение 1б к приказу № 794-1 · договоры с физическими лицами',
    fields: ['Период сметы', 'Реквизиты договора', 'Показатели доходов и расходов'],
  },
].map(entry => ({ ...entry, path: path.join(caseDirectory, entry.file) }));

function formFile(id) {
  const entry = entries.find(form => form.id === id);
  return entry && fs.existsSync(entry.path) ? entry : null;
}

function appendixForm(doc, { page, title }) {
  const params = new URLSearchParams({ id: doc, page });
  return {
    title, source: 'Страница ' + page + ' исходного PDF', fields: [], format: 'PDF',
    download: '/forms/appendix?' + params, documentId: doc,
    reference: '/original/' + encodeURIComponent(doc) + '#page=' + page,
  };
}

function attachForms(answer) {
  for (const step of answer.steps) {
    const forms = entries.flatMap(entry => {
      const cite = step.cites.find(c => c.doc === entry.doc && entry.clauses.includes(c.clause));
      if (!cite || !fs.existsSync(entry.path)) return [];
      const { id, title, source, fields, filename } = entry;
      return [{
        title, source, fields,
        format: path.extname(filename).slice(1).toUpperCase(),
        download: '/forms/' + id,
        fill: entry.fill,
        preview: entry.previewFile ? '/forms/' + id + '/preview' : undefined,
        reference: entry.referencePage ? '/original/' + encodeURIComponent(cite.doc) + '#page=' + entry.referencePage
          : '/doc/' + encodeURIComponent(cite.doc) + '?format=html#' + encodeURIComponent(cite.anchor),
        referenceLabel: entry.referencePage ? 'Открыть страницу оригинала' : undefined,
      }];
    });
    if (forms.length) step.forms = [...forms, ...(step.forms || [])];
  }
  return answer;
}

module.exports = { appendixForm, attachForms, formFile };
