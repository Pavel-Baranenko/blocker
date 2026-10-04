const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

test('the editor shows, validates, saves and restores the JSON field', async () => {
  const elements = new Map();
  function element(key) {
    if (!elements.has(key)) elements.set(key, {
      hidden: false, value: '', checked: false, required: false, validationMessage: '', dataset: {},
      listeners: {}, classList: { remove() {}, toggle() {} },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      setCustomValidity(message) { this.validationMessage = message; },
      setAttribute() {}, focus() {}, replaceChildren() {}, append() {}
    });
    return elements.get(key);
  }
  const editor = element('.rule__editor');
  const list = element('.rules');
  const root = element('ruleMethodDropdown');
  const controls = ['add-rule', 'delete-rule', 'cancel-edit', 'rule-name', 'rule-url',
    'rule-status', 'rule-replace-response', 'rule-response'].map(element);
  root.querySelector = element;
  root.querySelectorAll = () => [];
  editor.reportValidity = () => controls.every(control => !control.validationMessage && (!control.required || control.value));
  element('rule-template').content = {
    firstElementChild: {
      cloneNode: () => ({ dataset: {}, querySelector: element })
    }
  };
  let savedRules = [];
  let saves = 0;
  const chrome = { runtime: {
    sendMessage(message, callback) {
      if (message.type === 'saveRule') {
        saves++;
        savedRules = [message.rule];
      }
      callback({ rules: savedRules });
    }
  } };
  const document = {
    getElementById: element, querySelector: element, querySelectorAll: () => controls,
    createElement: () => element('empty'), addEventListener() {}
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  vm.runInNewContext(source, { document, chrome, URL, crypto });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const submit = () => editor.listeners.submit({ preventDefault() {} });
  await settle();
  element('add-rule').listeners.click();
  assert.equal(list.hidden, true);
  assert.equal(editor.hidden, false);
  assert.equal(element('response-editor').hidden, true);
  const toggle = element('rule-replace-response');
  const response = element('rule-response');
  toggle.checked = true;
  toggle.listeners.change();
  assert.equal(element('response-editor').hidden, false);
  assert.equal(response.required, true);
  element('rule-name').value = 'Mock API';
  element('rule-url').value = 'https://example.com/api';
  response.value = '{broken}';
  submit();
  assert.match(response.validationMessage, /JSON/);
  assert.equal(saves, 0);
  response.value = '{"success":true}';
  response.listeners.input();
  submit();
  await settle();
  assert.equal(savedRules[0].replaceResponse, true);
  assert.equal(savedRules[0].responseBody, response.value);
  assert.equal(editor.hidden, true);
  list.listeners.click({ target: {
    closest: () => ({ dataset: { action: 'edit' }, closest: () => ({ dataset: { id: savedRules[0].id } }) })
  } });
  assert.equal(toggle.checked, true);
  assert.equal(element('response-editor').hidden, false);
  assert.equal(response.value, '{"success":true}');
  toggle.checked = false;
  toggle.listeners.change();
  assert.equal(element('response-editor').hidden, true);
  assert.equal(response.required, false);
  submit();
  await settle();
  assert.equal(savedRules[0].replaceResponse, false);
  assert.equal(savedRules[0].responseBody, '{"success":true}');
});