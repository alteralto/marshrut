// Роль из регламента хранится отдельно от образа. Один SVG можно назначить разным ролям.
window.ComicPeople = (() => {
  const portraits = {
    secretary: { name: 'Ольга', color: '#dac9df' },
    'member-one': { name: 'Андрей', color: '#ceded7' },
    'member-two': { name: 'Вера', color: '#ead2c7' },
    student: { name: 'Никита', color: '#d7dfee' },
    employee: { name: 'Алексей', color: '#d7e1d2' },
    director: { name: 'Марина', color: '#ded4e8' },
    finance: { name: 'Денис', color: '#ecdac3' },
    specialist: { name: 'Лена', color: '#ead5df' }
  };
  const defaultRoles = [
    { label: 'Секретарь комиссии', person: 'secretary' },
    { label: 'Член комиссии', person: 'member-one' },
    { label: 'Обучающийся', person: 'student' },
    { label: 'Работник', person: 'employee' },
    { label: 'Руководитель подразделения', person: 'director' },
    { label: 'Финансовый специалист', person: 'finance' },
    { label: 'Сотрудник подразделения', person: 'specialist' }
  ];

  function portraitUrl(id) {
    return 'comic-people.svg#' + id;
  }

  function parseRoles(value) {
    if (value?.version !== 1 || !Array.isArray(value.roles) || !value.roles.length || value.roles.length > 100) {
      throw new Error('Выбери JSON, сохранённый с этой доски.');
    }
    const labels = new Set();
    return value.roles.map(role => {
      const label = typeof role?.label === 'string' ? role.label.trim() : '';
      if (!label || label.length > 70 || labels.has(label.toLowerCase()) || !Object.hasOwn(portraits, role.person)) {
        throw new Error('В файле есть неизвестный персонаж, пустая или повторяющаяся роль.');
      }
      labels.add(label.toLowerCase());
      return { label, person: role.person };
    });
  }

  return { portraits, defaultRoles, portraitUrl, parseRoles };
})();
