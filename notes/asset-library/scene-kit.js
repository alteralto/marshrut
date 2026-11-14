'use strict';

// Stable keys shared by the editor, the renderer and the route publication.
const sceneKit = (() => {
  const templates = {
    prepare: { label: 'Оформить документ', roles: ['Исполнитель'], object: 'document' },
    transfer: { label: 'Направить документ или обращение', roles: ['Отправитель', 'Получатель'], object: 'document', variants: {
      paper: 'Из рук в руки', email: 'По электронной почте', portal: 'Через систему заявок', handoff: 'Без указания способа',
    } },
    materials: { label: 'Проверить или рассмотреть материалы', roles: ['Проверяющий'], object: 'folder', variants: {
      present: 'Основной предмет на месте', missing: 'Основного предмета не хватает', criteria: 'Сверка условий', commission: 'Рассмотрение на комиссии',
    } },
    interview: { label: 'Провести интервью', roles: ['Интервьюер', 'Кандидат'], object: 'resume' },
    review: { label: 'Согласовать или подписать документ', roles: ['Согласующий'], object: 'document', variants: {
      approval: 'Согласование', paper: 'Подпись на бумаге', electronic: 'Электронная подпись', acceptance: 'При передаче под роспись',
    } },
    register: { label: 'Внести запись', roles: ['Ответственный за запись'], object: 'document', variants: { list: 'В реестре', calendar: 'В календаре', availability: 'Проверить свободные даты' } },
    schedule: { label: 'Работа с датой', roles: ['Запрашивает дату', 'Сверяет график'], object: 'calendar', variants: {
      availability: 'Сверить свободные даты', agreement: 'Согласовать дату', record: 'Внести дату в график',
    } },
    equipment: { label: 'Передать оборудование', roles: ['Передаёт', 'Принимает'], object: 'equipment' },
    followup: { label: 'Продолжить работу по обращению', roles: ['Специалист', 'Автор обращения'], object: 'ticket', variants: {
      clarify: 'Запросить уточнение', escalate: 'Передать на следующую линию', confirm: 'Запросить подтверждение результата',
    } },
    decide: { label: 'Выбрать порядок действий', roles: ['Ответственный за выбор'], object: 'document' },
    pay: { label: 'Перечислить средства', roles: ['Перечисляет', 'Получает'], object: 'money', variants: { advance: 'Аванс или выплата', loan: 'Заём с возвратом', refund: 'Возврат остатка' } },
    deadline: { label: 'Уложиться в срок', roles: ['Отвечает за срок'], object: 'document', variants: { before: 'Не позднее чем за … до события', after: 'В течение … после события' } },
  };
  const objects = {
    document: { label: 'Документ', art: 'document-icon.svg' },
    application: { label: 'Заявка', art: 'application-icon.svg' },
    resume: { label: 'Резюме', art: 'resume-icon.svg' },
    notes: { label: 'Заметки интервьюера', art: 'notes-icon.svg' },
    folder: { label: 'Папка с документами', art: 'scene-objects.svg#folder' },
    order: { label: 'Приказ', art: 'scene-objects.svg#order' },
    minutes: { label: 'Протокол', art: 'scene-objects.svg#minutes' },
    extract: { label: 'Выписка', art: 'scene-objects.svg#extract' },
    portal: { label: 'Личный кабинет или СЭД', art: 'scene-objects.svg#portal' },
    email: { label: 'Письмо', art: 'scene-objects.svg#email' },
    approval: { label: 'Лист согласования', art: 'scene-objects.svg#approval' },
    calendar: { label: 'Календарь', art: 'concert-calendar.svg' },
    equipment: { label: 'Микрофон и кликер', art: 'concert-mic.svg' },
    media: { label: 'Материалы для показа', art: 'concert-media.svg' },
    hall: { label: 'Зал', art: 'concert-hall.svg' },
    money: { label: 'Деньги', art: 'money-icon.svg' },
    ticket: { label: 'Обращение', art: 'ticket-icon.svg' },
    key: { label: 'Ключ и пропуск', art: 'key-icon.svg' },
    server: { label: 'Сервер', art: 'server-icon.svg' },
  };
  const portraits = ['employee', 'specialist', 'director', 'secretary', 'member-one', 'member-two', 'student', 'finance'];
  const maxRole = 48;
  const maxObject = 48;
  const maxResult = 44;
  const maxMessage = 48;
  const maxExtraItems = 3;

  function shortText(value, limit) {
    if (typeof value !== 'string' || value.length > limit || !value.isWellFormed() || /[\u0000-\u001f]/u.test(value)) {
      throw new Error('Проверьте подписи к персонажам и предмету в сцене.');
    }
    return value.trim();
  }

  function normalize(value) {
    if (value?.template === 'request') return { ...value, template: 'transfer' };
    if (value?.template === 'approve') return { ...value, template: 'review', variant: 'approval' };
    if (value?.template === 'sign') return { ...value, template: 'review' };
    if (value?.template === 'check') return { ...value, template: 'materials' };
    if (value?.template === 'commission') return { ...value, template: 'materials', variant: 'commission' };
    return value;
  }

  function validate(value) {
    value = normalize(value);
    if (!value || typeof value !== 'object' || !Object.hasOwn(templates, value.template)) {
      throw new Error('Выберите сцену из библиотеки.');
    }
    const { template, actors, object, objectLabel, variant, result } = value;
    const entry = templates[template];
    const roles = rolesFor(template, variant);
    if (!Array.isArray(actors) || actors.length !== roles.length ||
      !actors.every(actor => actor && portraits.includes(actor.portrait)) || !Object.hasOwn(objects, object)) {
      throw new Error('Выберите персонажей и предмет из библиотеки.');
    }
    if (entry.variants && !Object.hasOwn(entry.variants, variant)) throw new Error('Выберите вариант сцены.');
    const choice = {
      template,
      actors: actors.map((actor, index) => ({
        portrait: actor.portrait,
        role: shortText(actor.role, maxRole) || roles[index],
      })),
      object,
      objectLabel: shortText(objectLabel, maxObject) || objects[object].label,
      variant: entry.variants ? variant : '',
      result: shortText(result, maxResult),
    };
    if (template === 'decide') {
      if (!Array.isArray(value.paths) || value.paths.length < 2 || value.paths.length > 3) {
        throw new Error('Укажите два или три варианта действий.');
      }
      choice.paths = value.paths.map((item, index) => shortText(item, maxObject) || 'Вариант ' + (index + 1));
    }
    if (template === 'prepare' && value.fields != null) {
      if (!Array.isArray(value.fields) || value.fields.length < 1 || value.fields.length > 4) throw new Error('Укажите от одного до четырёх полей документа.');
      choice.fields = value.fields.map(item => ({
        label: shortText(item?.label, maxObject),
        value: shortText(item?.value, 64),
      }));
    }
    if (template === 'transfer') {
      if (value.address != null) choice.address = shortText(value.address, 80);
      if (value.documentStatus != null) choice.documentStatus = shortText(value.documentStatus, 64);
      if (variant === 'email' && value.subject != null) choice.subject = shortText(value.subject, maxObject);
      if (variant === 'email' && value.attachment === false) choice.attachment = false;
    }
    if (template === 'followup') {
      if (value.message != null) choice.message = shortText(value.message, maxMessage);
      if (value.reply != null) choice.reply = shortText(value.reply, maxMessage);
    }
    if (template === 'deadline') {
      if (value.term != null) choice.term = shortText(value.term, 32);
      if (value.eventLabel != null) choice.eventLabel = shortText(value.eventLabel, 32);
    }
    if (template === 'pay' && value.account != null) choice.account = shortText(value.account, 40);
    if (template === 'materials' && variant !== 'commission' && value.extraItems != null) {
      if (!Array.isArray(value.extraItems) || value.extraItems.length > maxExtraItems) throw new Error('В сцене проверки может быть не больше четырёх предметов.');
      choice.extraItems = value.extraItems.map(item => {
        if (!item || !Object.hasOwn(objects, item.object) || typeof item.present !== 'boolean') {
          throw new Error('Выберите предмет из библиотеки и укажите, есть ли он в комплекте.');
        }
        return {
          object: item.object,
          label: shortText(item.label, maxObject) || objects[item.object].label,
          present: item.present,
        };
      });
    }
    return choice;
  }

  function rolesFor(template, variant) {
    if (template === 'followup' && variant === 'escalate') return ['Передающая линия', 'Принимающая линия'];
    if (template === 'materials' && variant === 'commission') return ['Член комиссии', 'Председатель', 'Секретарь', 'Член комиссии'];
    if (template === 'register' && variant === 'availability') return ['Запрашивает дату', 'Сверяет график'];
    if (template === 'schedule' && variant === 'agreement') return ['Предлагает дату', 'Согласует дату'];
    if (template === 'schedule' && variant === 'record') return ['Вносит запись'];
    if (template === 'review' && variant === 'acceptance') return ['Сдаёт', 'Принимает'];
    if (template === 'review' && ['paper', 'electronic'].includes(variant)) return ['Подписант'];
    return templates[template].roles;
  }

  function titleFor(value) {
    const { template, variant, object } = normalize(value);
    if (template === 'transfer' && object === 'ticket') return 'Подать обращение';
    if (template === 'transfer') return 'Передать документ';
    if (template === 'followup') return templates.followup.variants[variant];
    if (template === 'review') return variant === 'approval' ? 'Согласовать документ' : 'Подписать документ';
    if (template === 'schedule') return templates.schedule.variants[variant];
    if (template === 'register' && variant === 'availability') return templates.schedule.variants.availability;
    if (template === 'materials') {
      if (variant === 'commission') return 'Рассмотреть на комиссии';
      return variant === 'criteria' ? 'Проверить условия' : 'Проверить комплект';
    }
    return templates[template].label;
  }

  return { templates, objects, portraits, maxRole, maxObject, maxResult, maxMessage, maxExtraItems, normalize, rolesFor, titleFor, validate };
})();

if (typeof module === 'object' && module.exports) module.exports = sceneKit;
else window.SceneKit = sceneKit;
