const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'background.js'), 'utf8');
const example = {
  id: 'first', name: 'API request', url: 'https://example.com/api?value=1.2', method: 'POST', active: true
};

function createHarness(initialRules = []) {
  const listeners = {};
  const state = {
    rules: structuredClone(initialRules), session: [], tabId: 7,
    pageMessages: [],
    regexSupported: true, failStorage: false, failUpdate: false
  };
  const event = name => ({ addListener: callback => { listeners[name] = callback; } });
  const chrome = {
    storage: {
      local: {
        get: async () => ({ rules: structuredClone(state.rules) }),
        set: async data => {
          if (state.failStorage) throw new Error('Storage failed');
          state.rules = structuredClone(data.rules);
          listeners.storage({ rules: { newValue: state.rules } }, 'local');
        }
      },
      onChanged: event('storage')
    },
    tabs: {
      query: async query => {
        if (!query.active) return [7, 20, 30, 40].map(id => ({ id }));
        assert.equal(query.active, true);
        assert.equal(query.lastFocusedWindow, true);
        return state.tabId === null ? [] : [{ id: state.tabId }];
      },
      sendMessage: async (tabId, message) => { state.pageMessages.push({ tabId, ...message }); },
      onActivated: event('activated'), onRemoved: event('removed')
    },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: event('focus') },
    declarativeNetRequest: {
      isRegexSupported: async () => ({ isSupported: state.regexSupported }),
      getSessionRules: async () => structuredClone(state.session),
      updateSessionRules: async update => {
        if (state.failUpdate) throw new Error('Filter update failed');
        assert.deepEqual(Array.from(update.removeRuleIds), state.session.map(rule => rule.id));
        state.session = structuredClone(update.addRules);
      }
    },
    runtime: {
      id: 'extension', onMessage: event('message'),
      onInstalled: event('installed'), onStartup: event('startup')
    }
  };
  const context = vm.createContext({ chrome, URL, console: { error() {} } });
  vm.runInContext(source, context);
  return {
    state, listeners,
    flush: () => vm.runInContext('pending', context),
    send: (message, tabId) => new Promise(resolve => listeners.message(message, {
      id: 'extension', ...(tabId === undefined ? {} : { tab: { id: tabId } })
    }, resolve))
  };
}

test('CRUD persists rules and filters exact URL, method and active tab', async () => {
  const harness = createHarness();
  await harness.flush();
  assert.equal(harness.state.session.length, 0);
  const saved = await harness.send({ type: 'saveRule', rule: example });
  assert.ok(!saved.error);
  assert.equal(harness.state.rules.length, 1);
  const condition = harness.state.session[0].condition;
  assert.deepEqual(Array.from(condition.tabIds), [7]);
  assert.deepEqual(Array.from(condition.requestMethods), ['post']);
  assert.equal(condition.isUrlFilterCaseSensitive, true);
  const matcher = new RegExp(condition.regexFilter);
  assert.ok(matcher.test(example.url));
  assert.ok(!matcher.test(example.url + '&extra=1'));
  assert.ok(!matcher.test(example.url.replace('1.2', '1x2')));
  assert.ok(!matcher.test(example.url.replace('/api', '/API')));
  await harness.send({ type: 'saveRule', rule: { ...example, active: false, name: 'Edited' } });
  assert.equal(harness.state.session.length, 0);
  assert.equal(harness.state.rules[0].name, 'Edited');
  assert.equal((await harness.send({ type: 'getRules' })).rules.length, 1);
  await harness.send({ type: 'deleteRule', id: example.id });
  assert.equal(harness.state.rules.length, 0);
  assert.equal(harness.state.session.length, 0);
});

test('restores saved rules and moves blocking between tabs and windows', async () => {
  const harness = createHarness([example]);
  await harness.flush();
  assert.equal(harness.state.session.length, 1);
  harness.state.tabId = 20;
  harness.listeners.activated();
  await harness.flush();
  assert.equal(harness.state.session[0].condition.tabIds[0], 20);
  harness.state.tabId = 30;
  harness.listeners.focus(2);
  await harness.flush();
  assert.equal(harness.state.session[0].condition.tabIds[0], 30);
  harness.state.tabId = null;
  harness.listeners.removed();
  await harness.flush();
  assert.equal(harness.state.session.length, 0);
  harness.state.tabId = 40;
  harness.listeners.startup();
  await harness.flush();
  assert.equal(harness.state.session[0].condition.tabIds[0], 40);
});

test('rejects invalid input and unsupported filters without changing storage', async () => {
  const harness = createHarness();
  await harness.flush();
  for (const change of [{ url: 'file:///test' }, { url: 'invalid' }, { name: ' ' }, { method: 'INVALID' }, { active: 'yes' }]) {
    assert.ok((await harness.send({ type: 'saveRule', rule: { ...example, ...change } })).error);
    assert.equal(harness.state.rules.length, 0);
  }
  harness.state.regexSupported = false;
  assert.ok((await harness.send({ type: 'saveRule', rule: example })).error);
  assert.equal(harness.state.rules.length, 0);
  harness.state.regexSupported = true;
  harness.state.failUpdate = true;
  assert.ok((await harness.send({ type: 'saveRule', rule: example })).error);
  assert.equal(harness.state.rules.length, 0);
});

test('rolls back filters when browser storage fails', async () => {
  const harness = createHarness([example]);
  await harness.flush();
  harness.state.failStorage = true;
  assert.ok((await harness.send({ type: 'deleteRule', id: example.id })).error);
  assert.equal(harness.state.rules.length, 1);
  assert.equal(harness.state.session.length, 1);
});

test('serializes concurrent changes without losing another rule', async () => {
  const harness = createHarness();
  await harness.flush();
  const responses = await Promise.all([
    harness.send({ type: 'saveRule', rule: example }),
    harness.send({ type: 'saveRule', rule: { ...example, id: 'second', method: 'GET' } })
  ]);
  assert.ok(responses.every(response => !response.error));
  await harness.flush();
  assert.equal(harness.state.rules.length, 2);
  assert.equal(new Set(harness.state.session.map(rule => rule.id)).size, 2);
});

test('persists JSON replacement without installing a blocking filter', async () => {
  const harness = createHarness();
  await harness.flush();
  const mock = { ...example, replaceResponse: true, responseBody: '{"success":true}' };
  assert.ok(!(await harness.send({ type: 'saveRule', rule: mock })).error);
  assert.equal(harness.state.rules[0].responseBody, mock.responseBody);
  assert.equal(harness.state.rules[0].replaceResponse, true);
  assert.equal(harness.state.session.length, 0);
  const invalid = await harness.send({ type: 'saveRule', rule: { ...mock, responseBody: '{invalid}' } });
  assert.match(invalid.error, /valid JSON/);
  assert.equal(harness.state.rules[0].responseBody, mock.responseBody);
  await harness.send({ type: 'saveRule', rule: { ...mock, replaceResponse: false } });
  assert.equal(harness.state.session.length, 1);
  assert.equal(harness.state.rules[0].responseBody, mock.responseBody);
});

test('only the active tab receives replacement rules, including on first page load', async () => {
  const mock = { ...example, replaceResponse: true, responseBody: '{"success":true}' };
  const harness = createHarness([mock]);
  await harness.flush();
  assert.equal((await harness.send({ type: 'getPageRules' }, 7)).rules.length, 1);
  assert.equal((await harness.send({ type: 'getPageRules' }, 20)).rules.length, 0);
  assert.equal(harness.state.pageMessages.find(message => message.tabId === 7).rules.length, 1);
  assert.equal(harness.state.pageMessages.find(message => message.tabId === 20).rules.length, 0);
  harness.state.pageMessages = [];
  harness.state.tabId = 20;
  harness.listeners.activated();
  await harness.flush();
  assert.equal(harness.state.pageMessages.find(message => message.tabId === 7).rules.length, 0);
  assert.equal(harness.state.pageMessages.find(message => message.tabId === 20).rules.length, 1);
});