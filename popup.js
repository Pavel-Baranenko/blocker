(function () {
  const list = document.querySelector('.rules');
  const template = document.getElementById('rule-template');
  const editor = document.querySelector('.rule__editor');
  const addButton = document.getElementById('add-rule');
  const deleteButton = document.getElementById('delete-rule');
  const cancelButton = document.getElementById('cancel-edit');
  const errorBox = document.getElementById('popup-error');
  const nameInput = document.getElementById('rule-name');
  const urlInput = document.getElementById('rule-url');
  const statusInput = document.getElementById('rule-status');
  const root = document.getElementById('ruleMethodDropdown');
  const trigger = root.querySelector('.dropdown__trigger');
  const valueEl = root.querySelector('.dropdown__value');
  const options = [...root.querySelectorAll('.dropdown__option')];
  let rules = [];
  let editingId = null;
  let method = 'GET';
  let activeIndex = 0;
  let busy = false;
  let ready = false;

  function showError(message = '') {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function setBusy(value) {
    busy = value;
    document.querySelectorAll('button, input, textarea').forEach(control => {
      control.disabled = value || !ready;
    });
  }

  function request(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(`Ошибка фонового скрипта: ${error.message}. Перезагрузите расширение в chrome://extensions.`));
        } else if (response?.error) {
          reject(new Error(response.error));
        } else if (!Array.isArray(response?.rules)) {
          reject(new Error('Фоновый скрипт не вернул список правил. Перезагрузите расширение в chrome://extensions.'));
        } else {
          resolve(response.rules);
        }
      });
    });
  }

  function renderRules() {
    list.replaceChildren();
    if (!rules.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Нет правил';
      list.append(empty);
    }
    for (const rule of rules) {
      const row = template.content.firstElementChild.cloneNode(true);
      row.dataset.id = rule.id;
      row.querySelector('.rule__name').textContent = rule.name;
      row.title = `${rule.method} ${rule.url}`;
      const status = row.querySelector('.rule__status');
      status.setAttribute('aria-checked', String(rule.active));
      const label = rule.active ? 'Отключить правило' : 'Включить правило';
      status.title = label;
      status.setAttribute('aria-label', `${label}: ${rule.name}`);
      list.append(row);
    }
  }

  function showList() {
    close();
    editingId = null;
    editor.hidden = true;
    list.hidden = false;
    addButton.hidden = false;
    renderRules();
    addButton.focus();
  }

  function showEditor(rule) {
    showError();
    editingId = rule?.id || null;
    nameInput.value = rule?.name || '';
    urlInput.value = rule?.url || '';
    statusInput.checked = rule?.active ?? true;
    nameInput.setCustomValidity('');
    urlInput.setCustomValidity('');
    setMethod(rule?.method || 'GET');
    deleteButton.hidden = !rule;
    list.hidden = true;
    editor.hidden = false;
    addButton.hidden = true;
    nameInput.focus();
  }

  async function mutate(message, returnToList = true) {
    if (busy) return;
    showError();
    close();
    setBusy(true);
    try {
      rules = await request(message);
      if (returnToList) showList();
      else renderRules();
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
      if (editor.hidden) addButton.focus();
    }
  }

  function setMethod(value) {
    method = value;
    activeIndex = options.findIndex(option => option.dataset.value === value);
    options.forEach(option => {
      const selected = option.dataset.value === value;
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-selected', String(selected));
    });
    valueEl.textContent = value;
    close();
  }

  function setActive(index) {
    options.forEach((option, optionIndex) => option.classList.toggle('is-active', optionIndex === index));
    activeIndex = index;
    options[index]?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    root.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    setActive(activeIndex);
  }

  function close() {
    root.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    options.forEach(option => option.classList.remove('is-active'));
  }

  function select(index) {
    if (busy || !options[index]) return;
    setMethod(options[index].dataset.value);
    trigger.focus();
  }

  trigger.addEventListener('click', () => {
    root.classList.contains('is-open') ? close() : open();
  });

  options.forEach((option, index) => {
    option.addEventListener('click', () => select(index));
    option.addEventListener('mouseenter', () => setActive(index));
  });

  trigger.addEventListener('keydown', (event) => {
    const isOpen = root.classList.contains('is-open');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) { open(); return; }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + direction + options.length) % options.length);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      isOpen ? select(activeIndex) : open();
    } else if (event.key === 'Escape') {
      if (isOpen) { event.preventDefault(); event.stopPropagation(); close(); }
    } else if (event.key === 'Tab') {
      if (isOpen) close();
    }
  });

  document.addEventListener('click', (event) => {
    if (!root.contains(event.target)) close();
  });

  addButton.addEventListener('click', () => showEditor());
  cancelButton.addEventListener('click', () => { showError(); showList(); });
  deleteButton.addEventListener('click', () => {
    if (editingId) mutate({ type: 'deleteRule', id: editingId });
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || busy || !ready) return;
    const rule = rules.find(rule => rule.id === button.closest('.rule').dataset.id);
    if (!rule) return;
    if (button.dataset.action === 'edit') showEditor(rule);
    else if (button.dataset.action === 'delete') mutate({ type: 'deleteRule', id: rule.id });
    else if (button.dataset.action === 'toggle') {
      mutate({ type: 'saveRule', rule: { ...rule, active: !rule.active } }, false);
    }
  });

  nameInput.addEventListener('input', () => nameInput.setCustomValidity(''));
  urlInput.addEventListener('input', () => urlInput.setCustomValidity(''));
  editor.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || !ready) return;
    nameInput.setCustomValidity(nameInput.value.trim() ? '' : 'Введите имя правила.');
    let url;
    try {
      url = new URL(urlInput.value.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      url.hash = '';
      urlInput.setCustomValidity('');
    } catch {
      urlInput.setCustomValidity('Введите полный HTTP или HTTPS URL.');
    }
    if (!editor.reportValidity()) return;
    mutate({
      type: 'saveRule',
      rule: {
        id: editingId || crypto.randomUUID(),
        name: nameInput.value.trim(),
        url: url.href,
        method,
        active: statusInput.checked
      }
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !editor.hidden && !busy) {
      event.preventDefault();
      showError();
      showList();
    }
  });

  setMethod('GET');
  setBusy(true);
  request({ type: 'getRules' }).then(savedRules => {
    rules = savedRules;
    ready = true;
    showList();
  }).catch(error => showError(error.message)).finally(() => setBusy(false));
})();