'use strict';

window.RouteSceneEditor = (() => {
  const kit = window.SceneKit;
  const characters = window.ComicPeople.portraits;
  const objectOptions = Object.entries(kit.objects).map(([id, entry]) => [id, entry.label]);
  const commissionPortraits = ['member-one', 'director', 'secretary', 'member-two'];
  const defaultPortraits = {
    materials: ['specialist'],
    review: ['director'],
    register: ['specialist'],
    followup: ['specialist', 'employee'],
    pay: ['finance', 'employee'],
    deadline: ['employee'],
  };

  function defaults(template, step) {
    const entry = kit.templates[template];
    const portraits = defaultPortraits[template] || ['employee', 'specialist'];
    const firstRole = step.people?.[0]?.name;
    return {
      template,
      actors: entry.roles.map((role, index) => ({
        portrait: portraits[index],
        role: index === 0 && firstRole ? firstRole.slice(0, kit.maxRole) : role,
      })),
      object: entry.object,
      objectLabel: '',
      variant: Object.keys(entry.variants || {})[0] || '',
      result: '',
      ...(template === 'decide' ? { paths: ['', ''] } : {}),
    };
  }

  function create(step, saved, onChange, draw) {
    saved = kit.normalize(saved);
    const group = document.createElement('fieldset');
    group.className = 'scene-editor';
    const legend = document.createElement('legend');
    legend.textContent = 'Сцена для шага';
    const fields = document.createElement('div');
    fields.className = 'scene-editor-fields';
    const mount = document.createElement('div');
    mount.className = 'scene-editor-preview';
    mount.setAttribute('aria-label', 'Предпросмотр сцены');
    const choices = new Map(saved ? [[saved.template, structuredClone(saved)]] : []);
    const materialVariants = new Map();
    let selected = saved?.template || '';
    let pending;

    function field(container, title, control, wide = false) {
      const label = document.createElement('label');
      if (wide) label.className = 'scene-editor-wide';
      label.append(title, control);
      container.append(label);
      return control;
    }

    function select(container, title, options, value, change, wide = false) {
      const control = document.createElement('select');
      control.append(...options.map(([key, label]) => new Option(label, key)));
      control.value = value;
      control.addEventListener('change', () => change(control.value));
      return field(container, title, control, wide);
    }

    function input(container, title, value, maxLength, change, placeholder = '') {
      const control = document.createElement('input');
      control.type = 'text';
      control.maxLength = maxLength;
      control.value = value;
      control.placeholder = placeholder;
      control.addEventListener('input', () => change(control.value));
      return field(container, title, control);
    }

    function config() {
      return choices.get(selected);
    }

    function update({ delayed = false } = {}) {
      clearTimeout(pending);
      const current = config();
      // Browser inputs can temporarily contain an incomplete title while editing.
      // Persist a snapshot so editing never mutates a previously published object.
      const value = current ? structuredClone(current) : null;
      onChange(value);
      if (delayed) pending = setTimeout(() => { if (mount.isConnected) draw(mount, value); }, 180);
      else draw(mount, value);
    }

    function settings(focusVariant = false) {
      fields.replaceChildren();
      const current = config();
      if (!current) return;
      const entry = kit.templates[current.template];
      const roles = kit.rolesFor(current.template, current.variant);
      current.actors.forEach((actor, index) => {
        const actorNumber = current.actors.length > 1 ? ' ' + (index + 1) : '';
        select(fields, 'Персонаж' + actorNumber, kit.portraits.map(id => [id, characters[id].name]), actor.portrait, value => {
          actor.portrait = value;
          update();
        });
        input(fields, 'Роль' + actorNumber, actor.role, kit.maxRole, value => {
          actor.role = value;
          update({ delayed: true });
        }, roles[index]);
      });
      const object = select(fields, 'Предмет', objectOptions, current.object, value => {
        current.object = value;
        objectLabel.placeholder = kit.objects[value].label;
        update();
      });
      const objectLabel = input(fields, 'Название предмета', current.objectLabel, kit.maxObject, value => {
        current.objectLabel = value;
        update({ delayed: true });
      }, kit.objects[object.value].label);
      if (entry.variants) {
        const variantSelect = select(fields, 'Вариант сцены', Object.entries(entry.variants), current.variant, value => {
          const previousRoles = kit.rolesFor(current.template, current.variant);
          const wasCommission = current.variant === 'commission';
          current.variant = value;
          const nextRoles = kit.rolesFor(current.template, value);
          const rolesChanged = nextRoles.join() !== previousRoles.join();
          if (current.template === 'materials' && rolesChanged) {
            const commission = value === 'commission';
            materialVariants.set(wasCommission, { actors: current.actors, result: current.result });
            const previous = materialVariants.get(commission);
            current.actors = previous?.actors || (commission
              ? nextRoles.map((role, index) => ({ role, portrait: commissionPortraits[index] }))
              : defaults('materials', step).actors);
            current.result = previous?.result || '';
          } else if (rolesChanged) current.actors = nextRoles.map((role, index) => {
            const actor = current.actors[index];
            if (!actor) return { role, portrait: 'specialist' };
            return { ...actor, role: actor.role === previousRoles[index] ? role : actor.role };
          });
          if (rolesChanged || current.template === 'transfer') settings(true);
          update();
        });
        if (focusVariant) variantSelect.focus();
      }
      if (current.template !== 'prepare') {
        input(fields, 'Итог в кадре', current.result, kit.maxResult, value => {
          current.result = value;
          update({ delayed: true });
        }, 'Оставить стандартную подпись');
      }
      if (current.template === 'transfer' && ['email', 'portal'].includes(current.variant)) {
        input(fields, current.variant === 'email' ? 'Адрес получателя' : 'Название системы',
          current.address || '', 80, value => { current.address = value; update({ delayed: true }); });
        input(fields, current.variant === 'email' ? 'Статус документа' : 'Описание обращения',
          current.documentStatus || '', 64, value => { current.documentStatus = value; update({ delayed: true }); });
        if (current.variant === 'email') {
          input(fields, 'Тема письма', current.subject || '', kit.maxObject, value => {
            current.subject = value;
            update({ delayed: true });
          });
          select(fields, 'Содержимое письма', [['attachment', 'Документ во вложении'], ['message', 'Текст уведомления']],
            current.attachment === false ? 'message' : 'attachment', value => {
              current.attachment = value === 'attachment';
              update();
            });
        }
      }
      if (current.template === 'followup') {
        input(fields, 'Сообщение в кадре', current.message || '', kit.maxMessage, value => {
          current.message = value;
          update({ delayed: true });
        });
        input(fields, 'Ответ или статус в кадре', current.reply || '', kit.maxMessage, value => {
          current.reply = value;
          update({ delayed: true });
        });
      }
      if (current.template === 'materials' && current.variant !== 'commission') checkItems(current);
      if (current.template === 'deadline') {
        input(fields, 'Срок', current.term || '', 32, value => { current.term = value; update({ delayed: true }); }, '7 рабочих дней');
        input(fields, 'Событие', current.eventLabel || '', 32, value => { current.eventLabel = value; update({ delayed: true }); }, 'Начало поездки');
      }
      if (current.template === 'pay') {
        input(fields, 'Куда поступают средства', current.account || '', 40, value => { current.account = value; update({ delayed: true }); }, 'Лицевой счёт');
      }
      if (current.template === 'decide') {
        current.paths.forEach((path, index) => input(fields, 'Вариант действий ' + (index + 1), path, kit.maxObject, value => {
          current.paths[index] = value;
          update({ delayed: true });
        }));
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'secondary';
        toggle.textContent = current.paths.length === 2 ? 'Добавить третий вариант' : 'Убрать третий вариант';
        toggle.addEventListener('click', () => {
          if (current.paths.length === 2) current.paths.push('');
          else current.paths.pop();
          settings();
          update();
        });
        fields.append(toggle);
      }
    }

    function checkItems(current) {
      const items = current.extraItems ||= [];
      const extra = document.createElement('div');
      extra.className = 'scene-editor-extra scene-editor-wide';
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'secondary';
      add.textContent = 'Добавить предмет в комплект';

      function renderItems() {
        extra.replaceChildren();
        items.forEach((item, index) => {
          const row = document.createElement('fieldset');
          row.className = 'scene-editor-fields scene-editor-item';
          const caption = document.createElement('legend');
          caption.textContent = 'Предмет ' + (index + 2);
          row.append(caption);
          select(row, 'Вид предмета', objectOptions, item.object, value => {
            item.object = value;
            name.placeholder = kit.objects[value].label;
            update();
          });
          const name = input(row, 'Название предмета', item.label, kit.maxObject, value => {
            item.label = value;
            update({ delayed: true });
          }, kit.objects[item.object].label);
          select(row, 'В комплекте', [['yes', 'На месте'], ['no', 'Не хватает']], item.present ? 'yes' : 'no', value => {
            item.present = value === 'yes';
            update();
          });
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'secondary';
          remove.textContent = 'Удалить предмет ' + (index + 2);
          remove.addEventListener('click', () => {
            items.splice(index, 1);
            renderItems();
            add.focus();
            update();
          });
          row.append(remove);
          extra.append(row);
        });
        add.disabled = items.length >= kit.maxExtraItems;
        extra.append(add);
      }

      add.addEventListener('click', () => {
        items.push({ object: 'document', label: '', present: true });
        renderItems();
        const rows = extra.querySelectorAll('fieldset');
        rows[rows.length - 1].querySelector('select').focus();
        update();
      });
      renderItems();
      fields.append(extra);
    }

    group.append(legend);
    select(group, 'Шаблон из библиотеки', [['', 'Сцена черновика'], ...Object.entries(kit.templates).map(([id, entry]) => [id, entry.label])], selected, value => {
      selected = value;
      if (value && !choices.has(value)) choices.set(value, defaults(value, step));
      settings();
      update();
    }, true);
    group.append(fields, mount);
    settings();
    draw(mount, saved || null);
    return group;
  }

  function build(value, sceneLibrary, setting) {
    const config = kit.validate(value);
    const { template, actors, variant, object, objectLabel, result } = config;
    const roles = actors.map(actor => actor.role);
    const art = sceneLibrary + kit.objects[object].art;
    const [first, second] = actors;
    const roleLabels = [...new Set(roles)].join(' · ');
    if (template === 'prepare') return {
      renderer: window.DocumentPreparationScene,
      config: {
        actor: first.portrait, art,
        document: { title: objectLabel, subtitle: roleLabels },
        fields: config.fields || [{ label: 'Документ', value: objectLabel }],
      },
    };
    if (template === 'materials' && variant === 'commission') return {
      renderer: window.CommissionScene,
      config: { art, portraits: actors.map(actor => actor.portrait), document: objectLabel, outcome: result || 'Протокол' },
    };
    if (template === 'materials') return {
      renderer: window.DocumentCheckScene,
      config: {
        actor: first.portrait, art, title: objectLabel, subtitle: roleLabels,
        criteria: variant === 'criteria',
        items: [{ label: objectLabel, present: variant !== 'missing', art },
          ...(config.extraItems || []).map(item => ({
            label: item.label, present: item.present, art: sceneLibrary + kit.objects[item.object].art,
          }))],
        completeMessage: result || 'Сверка завершена',
        missingMessage: result || 'Не хватает документа',
      },
    };
    if (template === 'transfer' && variant !== 'handoff') return {
      renderer: window.DocumentTransferScene,
      config: {
        art, channel: variant,
        sender: { portrait: first.portrait, sleeve: '#7a9689', skin: '#e8ac86' },
        recipient: { portrait: second.portrait, sleeve: '#77608b', skin: '#f3c39f', label: second.role,
          address: config.address || (variant === 'portal' ? 'Система заявок' : second.role) },
        document: { title: objectLabel, subtitle: first.role, status: config.documentStatus || (variant === 'portal' ? '' : 'К передаче'),
          filename: objectLabel, subject: config.subject || objectLabel, format: '', ticket: object === 'ticket', attachment: config.attachment },
        result: result || (object === 'ticket' ? 'Обращение отправлено' : 'Документ передан'),
      },
    };
    const actions = {
      interview: { effect: 'interview', labels: ['Материалы готовы', 'Вопросы и ответы', 'Итоги интервью записаны'] },
      review: {
        effect: variant === 'approval' ? 'approve' : 'sign',
        labels: {
          approval: ['Проект на согласовании', 'Сверка требований', 'Документ согласован'],
          electronic: ['Документ готов к подписанию', 'Электронная подпись', 'Документ подписан'],
          paper: ['Документ готов к подписанию', 'Подпись на бумаге', 'Документ подписан'],
          acceptance: ['Документ передан', 'Подпись о получении', 'Получение подтверждено'],
        }[variant],
      },
      register: variant === 'availability'
        ? { effect: 'availability', labels: ['Желаемые даты', 'Сверка с графиком', 'Даты сверены'] }
        : { effect: 'register', labels: ['Данные подготовлены', 'Внесение записи', 'Запись внесена'] },
      schedule: {
        effect: 'schedule',
        labels: {
          availability: ['Даты предложены', 'Сверка с графиком', 'Доступность проверена'],
          agreement: ['Дата предложена', 'Обсуждение даты', 'Дата согласована'],
          record: ['Дата подтверждена', 'Внесение в график', 'Дата внесена в график'],
        }[variant],
      },
      transfer: { effect: 'pass', labels: ['Материалы готовы', 'Передача', 'Материалы переданы'] },
      followup: {
        effect: 'followup',
        labels: {
          clarify: ['Нужны дополнительные сведения', 'Запрос уточнения', 'Обработка продолжится после ответа'],
          escalate: ['Первичная обработка завершена', 'Передача обращения', 'Обращение на следующей линии'],
          confirm: ['Работы выполнены', 'Результат направлен автору', 'Автор подтверждает результат'],
        }[variant],
      },
      equipment: { effect: 'pass', labels: ['Предмет у передающего', 'Передача', 'Предмет принят'] },
      decide: { effect: 'branch', labels: ['Исходные условия', 'Варианты действий', 'Порядок действий выбран'] },
      pay: {
        effect: 'pay',
        labels: {
          advance: ['Сумма рассчитана', 'Перечисление', 'Средства поступили'],
          loan: ['Заём одобрен', 'Перечисление займа', 'Заём выдан, возврат по графику'],
          refund: ['Остаток к возврату', 'Возврат', 'Остаток возвращён'],
        }[variant] || ['Сумма рассчитана', 'Перечисление', 'Средства поступили'],
      },
      deadline: { effect: 'deadline', labels: ['Срок отсчитывается от события', 'Отсчёт срока', 'Документ подан в срок'] },
    };
    const { effect, labels } = actions[template];
    return {
      renderer: window.RouteActionScene,
      config: {
        effect, art, objectLabel, setting, branches: config.paths,
        term: config.term, eventLabel: config.eventLabel, account: config.account,
        message: config.message, reply: config.reply,
        layout: variant,
        cast: actors.map(({ portrait, role }) => ({ art: sceneLibrary + window.ComicPeople.portraitUrl(portrait), label: role })),
        labels: [labels[0], labels[1], result || labels[2]],
      },
    };
  }

  function forDraft(step) {
    const { kind, prop } = step.scene;
    const template = { approve: 'review', sign: 'review', fill: 'prepare', send: 'transfer', report: 'transfer', advance: 'pay', book: 'materials' }[kind];
    if (!template) return null;
    const choice = defaults(template, step);
    if (template === 'transfer') choice.variant = 'handoff';
    if (kind === 'book') choice.variant = 'criteria';
    if (kind === 'sign') {
      choice.variant = step.scene.action?.layout === 'electronic' ? 'electronic' : 'paper';
      choice.actors[0].role = step.people?.[0]?.name?.slice(0, kit.maxRole) || kit.rolesFor(template, choice.variant)[0];
    }
    choice.actors.forEach((actor, index) => {
      const person = step.people?.[index];
      const portrait = person?.art?.split('#').pop();
      if (kit.portraits.includes(portrait)) actor.portrait = portrait;
      actor.role = (person?.role || person?.name || actor.role).slice(0, kit.maxRole);
    });
    choice.objectLabel = (prop || '').slice(0, kit.maxObject);
    return choice;
  }

  return { create, build, forDraft };
})();
