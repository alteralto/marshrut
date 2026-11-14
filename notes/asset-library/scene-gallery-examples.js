'use strict';

const galleryExamples = (() => {
const actor = (portrait, role) => ({ portrait, role });
return [
  {
    group: 'Командировка',
    doc: 'mipt-business-trip', clause: '47',
    scene: { template: 'prepare', actors: [actor('employee', 'Работник')], object: 'document', objectLabel: 'Решение о командировании', variant: '', result: '',
      fields: [{ label: 'Цель', value: 'Конференция' }, { label: 'Место', value: 'Казань' }, { label: 'Срок', value: '3 дня' }] },
  },
  {
    group: 'Командировка',
    doc: 'mipt-business-trip', clause: '53',
    scene: { template: 'deadline', actors: [actor('employee', 'Работник')], object: 'document', objectLabel: 'Решение', variant: 'before', result: 'Решение подано вовремя',
      term: 'не позднее чем за 7 раб. дней', eventLabel: 'Командировка' },
  },
  {
    group: 'Командировка',
    doc: 'mipt-business-trip', clause: '53',
    scene: { template: 'transfer', actors: [actor('employee', 'Работник'), actor('specialist', 'Группа командирования ОМС')], object: 'document', objectLabel: 'Решение о командировании', variant: 'handoff', result: 'Решение передано' },
  },
  {
    group: 'Командировка',
    doc: 'mipt-business-trip', clause: '60',
    scene: { template: 'pay', actors: [actor('finance', 'Бухгалтерия'), actor('employee', 'Работник')], object: 'money', objectLabel: 'Аванс на поездку', variant: 'advance', result: 'Аванс перечислен', account: 'Командируемый работник' },
  },
  {
    group: 'Командировка',
    doc: 'mipt-business-trip', clause: '65',
    scene: { template: 'deadline', actors: [actor('employee', 'Работник')], object: 'document', objectLabel: 'Отчёт о расходах', variant: 'after', result: 'Отчёт сдан в срок',
      term: 'в течение 3 раб. дней', eventLabel: 'Возвращение' },
  },
  {
    group: 'Открытие ФЛС',
    doc: 'приказ-n-3065-1-от-25-11-2021', clause: '2.2',
    scene: { template: 'check', actors: [actor('finance', 'Сотрудник ФЭУ')], object: 'document', objectLabel: 'Карточка проекта', variant: 'criteria', result: 'Карточка проекта проверена' },
  },
  {
    group: 'Открытие ФЛС',
    doc: 'приказ-n-3065-1-от-25-11-2021', clause: '3.1.6',
    collection: 'review',
    description: 'Директор сверяет проект и приложения с требованиями и согласовывает проект приказа.',
    scene: { template: 'review', actors: [actor('specialist', 'Директор Физтех-школы / центра / института')], object: 'order', objectLabel: 'Приказ «О начале работ»', variant: 'approval', result: 'Проект приказа согласован' },
  },
  {
    group: 'Открытие ФЛС',
    doc: 'приказ-n-3065-1-от-25-11-2021', clause: '3.1.7',
    collection: 'review',
    description: 'Курирующий проректор или директор утверждает приказ и подписывает его электронной подписью.',
    scene: { template: 'review', actors: [actor('director', 'Курирующий проректор или директор')], object: 'order', objectLabel: 'Приказ «О начале работ»', variant: 'electronic', result: 'Приказ утверждён и подписан' },
  },
  {
    group: 'Открытие ФЛС',
    doc: 'приказ-n-3065-1-от-25-11-2021', clause: '2.8',
    scene: { template: 'register', actors: [actor('specialist', 'Административный отдел')], object: 'order', objectLabel: 'Приказ', variant: 'list', result: 'Приказ зарегистрирован' },
  },
  {
    group: 'Внутреннее заимствование',
    doc: 'приказ-5990-1-от-03-11-2026-новый', clause: 'прил.2/2',
    scene: { template: 'pay', actors: [actor('finance', 'Отдел бухгалтерского учёта'), actor('director', 'Руководитель проекта')], object: 'money', objectLabel: 'Внутренний заём', variant: 'loan', result: 'Заём выдан', account: 'ФЛС проекта' },
  },
  {
    group: 'Техподдержка',
    doc: 'приказ-и-регламент-работы-первой-линии-техподдержки', clause: 'прил.1/2.1',
    collection: 'delivery', order: 2,
    scene: { template: 'transfer', actors: [actor('employee', 'Сотрудник'), actor('specialist', 'Первая линия ТП УИТ')], object: 'ticket', objectLabel: 'Не работает принтер', variant: 'portal', address: 'Система управления обращениями', documentStatus: 'Принтер не печатает из кабинета', result: 'Обращение отправлено' },
  },
  {
    group: 'Техподдержка',
    doc: 'приказ-и-регламент-работы-первой-линии-техподдержки', clause: 'прил.1/2.1',
    scene: { template: 'decide', actors: [actor('employee', 'Сотрудник')], object: 'ticket', objectLabel: 'Обращение', variant: '', result: 'Канал выбран',
      paths: ['Система заявок', 'Почта УИТ'] },
  },
  {
    group: 'Центр обработки данных',
    doc: 'регламент-эксплуатации-центра-обработки-данных-мфти-физтех', clause: '4.3',
    scene: { template: 'transfer', actors: [actor('employee', 'Пользователь ЦОД'), actor('specialist', 'Техподдержка УИТ')], object: 'ticket', objectLabel: 'Доступ к сервису ЦОД', variant: 'email', result: 'Обращение отправлено' },
  },
  {
    group: 'Центр обработки данных',
    doc: 'регламент-эксплуатации-центра-обработки-данных-мфти-физтех', clause: '2.2',
    scene: { template: 'equipment', actors: [actor('employee', 'Подразделение'), actor('specialist', 'Специалист ЦОД')], object: 'server', objectLabel: 'Сервер', variant: '', result: 'Сервер размещён в ЦОД' },
  },
  {
    group: 'Концертный зал',
    doc: 'регламент-бронирования-конц-зала', clause: '2.6',
    collection: 'delivery', order: 1,
    scene: { template: 'transfer', actors: [actor('employee', 'Организатор'), actor('finance', 'Сотрудник КМО')], object: 'document', objectLabel: 'Служебная записка', variant: 'email', address: 'kmo@mipt.ru', documentStatus: 'Подписана руководителем', result: 'Записка направлена в КМО' },
  },
  {
    group: 'Концертный зал',
    doc: 'регламент-бронирования-конц-зала', clause: '2.3',
    scene: { template: 'deadline', actors: [actor('director', 'Организатор')], object: 'document', objectLabel: 'Служебная записка', variant: 'before', result: 'Записка подана заранее',
      term: 'не позднее чем за 2 месяца', eventLabel: 'Мероприятие' },
  },
  {
    group: 'Концертный зал',
    doc: 'регламент-бронирования-конц-зала', clause: '2.5',
    scene: { template: 'schedule', actors: [actor('employee', 'Организатор'), actor('specialist', 'Начальник КМО')], object: 'calendar', objectLabel: 'Даты мероприятия и репетиций', variant: 'availability', result: 'Доступность дат проверена' },
  },
  {
    group: 'Подбор персонала',
    doc: 'регламент-поиска-и-подбора-персонала', clause: '3.14',
    scene: { template: 'schedule', actors: [actor('director', 'Руководитель подразделения'), actor('student', 'Кандидат')], object: 'calendar', objectLabel: 'Дата выхода', variant: 'agreement', result: 'Дата выхода согласована' },
  },
  {
    group: 'Концертный зал',
    doc: 'регламент-бронирования-конц-зала', clause: '2.2',
    scene: { template: 'schedule', actors: [actor('specialist', 'Начальник КМО')], object: 'calendar', objectLabel: 'График мероприятий', variant: 'record', result: 'Мероприятие внесено в график' },
  },
  {
    group: 'Общежитие',
    doc: 'регламент-поселения-сотрудников', clause: '5.1',
    scene: { template: 'deadline', actors: [actor('employee', 'Сотрудник')], object: 'document', objectLabel: 'Договор найма', variant: 'after', result: 'Договор заключён',
      term: 'в течение 5 раб. дней', eventLabel: 'Уведомление' },
  },
  {
    group: 'Общежитие',
    doc: 'регламент-поселения-сотрудников', clause: '5.4',
    scene: { template: 'deadline', actors: [actor('employee', 'Сотрудник')], object: 'key', objectLabel: 'Жилое помещение', variant: 'after', result: 'Помещение освобождено',
      term: 'в течение 3 календарных дней', eventLabel: 'Расторжение договора' },
  },
  {
    group: 'Подбор персонала',
    doc: 'регламент-поиска-и-подбора-персонала', clause: '3.9',
    scene: { template: 'interview', actors: [actor('specialist', 'Специалист по подбору'), actor('student', 'Кандидат')], object: 'resume', objectLabel: 'Резюме', variant: '', result: 'Итоги интервью записаны' },
  },
  {
    group: 'Переход на бесплатное обучение',
    doc: 'порядок-перехода-с-платного-обучения-на-бесплатное', clause: '2.5',
    collection: 'materials',
    description: 'Обучающийся сверяет заявление и приложения перед подачей. В примере есть особые достижения, но подтверждение ещё не приложено.',
    scene: { template: 'materials', actors: [actor('student', 'Обучающийся')], object: 'application', objectLabel: 'Заявление о переходе', variant: 'present', result: 'Приложить подтверждение достижений',
      extraItems: [{ object: 'document', label: 'Подтверждение достижений', present: false }] },
  },
  {
    group: 'Переход на бесплатное обучение',
    doc: 'порядок-перехода-с-платного-обучения-на-бесплатное', clause: '2.13',
    collection: 'materials',
    description: 'Комиссия обсуждает заявление и приложения, голосует и оформляет решение протоколом.',
    scene: { template: 'materials', actors: [actor('member-one', 'Член комиссии'), actor('director', 'Председатель'), actor('secretary', 'Секретарь'), actor('member-two', 'Член комиссии')], object: 'application', objectLabel: 'Заявление о переходе', variant: 'commission', result: 'Протокол' },
  },
];

})();

if (typeof module === 'object' && module.exports) module.exports = galleryExamples;
else window.SceneGalleryExamples = galleryExamples;
