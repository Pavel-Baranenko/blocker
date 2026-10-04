const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'interceptor.js'), 'utf8');
const rule = { url: 'https://example.com/api', method: 'GET', responseBody: '{"success":true}' };

function createHarness(initialRules = [rule]) {
  const calls = { fetch: [], xhr: [] };
  class FakeXHR extends EventTarget {
    constructor() {
      super();
      this.nativeReadyState = 0;
      this.responseType = '';
    }
    get readyState() { return this.nativeReadyState; }
    get responseText() { return 'native'; }
    open(method, url) { this.nativeReadyState = 1; this.nativeUrl = url; }
    send(body) {
      calls.xhr.push({ url: this.nativeUrl, body });
      this.nativeReadyState = 4;
      this.dispatchEvent(new Event('loadend'));
    }
    abort() { this.nativeReadyState = 0; }
    getResponseHeader() { return 'native'; }
    getAllResponseHeaders() { return 'native'; }
    setRequestHeader() {}
  }
  class FakeProgressEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      Object.assign(this, options);
    }
  }
  const window = new EventTarget();
  window.fetch = async (...args) => { calls.fetch.push(args); return new Response('native'); };
  window.postMessage = () => {};
  const context = vm.createContext({
    window, XMLHttpRequest: FakeXHR, location: { href: 'https://example.com/page', origin: 'https://example.com' },
    URL, Request, Response, Blob, TextEncoder, DOMException, Event, ProgressEvent: FakeProgressEvent,
    setTimeout, clearTimeout, queueMicrotask
  });
  vm.runInContext(source, context);
  function updateRules(rules) {
    const event = new Event('message');
    Object.assign(event, {
      source: window, origin: 'https://example.com',
      data: { source: 'lock-blocker-extension', type: 'rules', rules }
    });
    window.dispatchEvent(event);
  }
  if (initialRules !== null) updateRules(initialRules);
  return { window, calls, XHR: FakeXHR, updateRules };
}

test('fetch returns the JSON response without a network request', async () => {
  const harness = createHarness();
  const response = await harness.window.fetch('/api#fragment');
  assert.equal(response.status, 200);
  assert.equal(response.url, rule.url);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(harness.calls.fetch.length, 0);
  assert.equal(await (await harness.window.fetch('/api?extra=1')).text(), 'native');
  await harness.window.fetch('/api', { method: 'POST' });
  assert.equal(harness.calls.fetch.length, 2);
  harness.updateRules([]);
  await harness.window.fetch('/api');
  assert.equal(harness.calls.fetch.length, 3);
});

test('fetch supports Request objects, HEAD and canceled requests', async () => {
  const harness = createHarness([rule, { ...rule, method: 'HEAD' }]);
  assert.deepEqual(await (await harness.window.fetch(new Request(rule.url))).json(), { success: true });
  assert.equal(await (await harness.window.fetch(rule.url, { method: 'HEAD' })).text(), '');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(harness.window.fetch(rule.url, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(harness.calls.fetch.length, 0);
});

test('an early fetch waits for the initial configuration and can be aborted while waiting', async () => {
  const harness = createHarness(null);
  const pending = harness.window.fetch(rule.url);
  harness.updateRules([rule]);
  assert.deepEqual(await (await pending).json(), { success: true });
  const waiting = createHarness(null);
  const controller = new AbortController();
  const canceled = waiting.window.fetch(rule.url, { signal: controller.signal });
  controller.abort();
  await assert.rejects(canceled, { name: 'AbortError' });
  waiting.updateRules([]);
});

test('XHR delivers JSON, headers and the normal completion events', async () => {
  const harness = createHarness();
  const xhr = new harness.XHR();
  const states = [];
  xhr.open('GET', '/api');
  xhr.responseType = 'json';
  xhr.addEventListener('readystatechange', () => states.push(xhr.readyState));
  const done = new Promise(resolve => xhr.addEventListener('loadend', resolve, { once: true }));
  xhr.send();
  await done;
  assert.deepEqual(states, [2, 3, 4]);
  assert.equal(xhr.status, 200);
  assert.equal(xhr.responseURL, rule.url);
  assert.equal(xhr.response.success, true);
  assert.equal(xhr.response, xhr.response);
  assert.throws(() => xhr.responseText, { name: 'InvalidStateError' });
  assert.match(xhr.getResponseHeader('Content-Type'), /application\/json/);
  assert.equal(harness.calls.xhr.length, 0);
});

test('XHR supports text, Blob and ArrayBuffer responses and synchronous requests', async () => {
  const harness = createHarness();
  for (const type of ['', 'blob', 'arraybuffer']) {
    const xhr = new harness.XHR();
    xhr.open('GET', '/api');
    xhr.responseType = type;
    const done = new Promise(resolve => xhr.addEventListener('loadend', resolve, { once: true }));
    xhr.send();
    await done;
    if (type === '') assert.equal(xhr.responseText, rule.responseBody);
    else if (type === 'blob') assert.equal(await xhr.response.text(), rule.responseBody);
    else assert.equal(new TextDecoder().decode(xhr.response), rule.responseBody);
  }
  const xhr = new harness.XHR();
  xhr.open('GET', '/api', false);
  xhr.send();
  assert.equal(xhr.readyState, 4);
  assert.equal(xhr.responseText, rule.responseBody);
});

test('XHR can be aborted and reused; unmatched requests use the native transport', async () => {
  const harness = createHarness();
  const xhr = new harness.XHR();
  const events = [];
  xhr.addEventListener('abort', () => events.push('abort'));
  xhr.addEventListener('load', () => events.push('load'));
  xhr.open('GET', '/api');
  xhr.send();
  assert.throws(() => xhr.send(), { name: 'InvalidStateError' });
  assert.throws(() => xhr.setRequestHeader('Test', 'value'), { name: 'InvalidStateError' });
  xhr.abort();
  assert.equal(xhr.readyState, 0);
  assert.deepEqual(events, ['abort']);
  xhr.open('POST', '/api');
  xhr.send('body');
  assert.equal(harness.calls.xhr.length, 1);
  assert.equal(xhr.responseText, 'native');
  assert.equal(xhr.getAllResponseHeaders(), 'native');
  await Promise.resolve();
  assert.deepEqual(events, ['abort']);
});