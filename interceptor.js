(function () {
  const nativeFetch = window.fetch;
  const prototype = XMLHttpRequest.prototype;
  const nativeOpen = prototype.open;
  const nativeSend = prototype.send;
  const nativeAbort = prototype.abort;
  const nativeGetHeader = prototype.getResponseHeader;
  const nativeGetHeaders = prototype.getAllResponseHeaders;
  const nativeSetHeader = prototype.setRequestHeader;
  const requests = new WeakMap();
  const responseProperties = ['readyState', 'status', 'statusText', 'responseURL', 'response', 'responseText'];
  let rules = [];
  let initialized = false;
  let finishInitialization;
  const ready = new Promise(resolve => { finishInitialization = resolve; });
  const fallback = setTimeout(() => {
    initialized = true;
    finishInitialization();
  }, 1000);

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin ||
        event.data?.source !== 'lock-blocker-extension' || event.data.type !== 'rules' ||
        !Array.isArray(event.data.rules)) return;
    rules = event.data.rules.filter(rule => {
      if (typeof rule?.url !== 'string' || typeof rule.method !== 'string' || typeof rule.responseBody !== 'string') return false;
      try { JSON.parse(rule.responseBody); return true; } catch { return false; }
    });
    initialized = true;
    clearTimeout(fallback);
    finishInitialization();
  });

  function normalizeUrl(value) {
    const url = new URL(value, location.href);
    url.hash = '';
    return url.href;
  }

  function findRule(url, method) {
    return rules.find(rule => rule.url === url && rule.method === method);
  }

  function aborted() {
    return new DOMException('The operation was aborted.', 'AbortError');
  }

  function waitForRules(signal) {
    if (signal?.aborted) return Promise.reject(aborted());
    if (!signal || initialized) return ready;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(aborted());
      signal.addEventListener('abort', onAbort, { once: true });
      ready.then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  }

  window.fetch = async function (input, init) {
    const request = input instanceof Request ? input : null;
    let url;
    try { url = normalizeUrl(request ? request.url : input); } catch {
      return nativeFetch.call(this, input, init);
    }
    const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase();
    const signal = init?.signal ?? request?.signal;
    await waitForRules(signal);
    if (signal?.aborted) throw aborted();
    const rule = findRule(url, method);
    if (!rule) return nativeFetch.call(this, input, init);
    const response = new Response(method === 'HEAD' ? null : rule.responseBody, {
      status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };

  function isCurrent(xhr, state) {
    return requests.get(xhr) === state && !state.canceled;
  }

  function responseValue(xhr, state) {
    if (xhr.responseType === '' || xhr.responseType === 'text') {
      return state.readyState >= 3 && !state.canceled ? state.body : '';
    }
    if (state.readyState !== 4 || state.canceled) return null;
    const type = xhr.responseType;
    if (!state.responses.has(type)) {
      let value = state.body;
      if (type === 'json') value = state.body ? JSON.parse(state.body) : null;
      else if (type === 'blob') value = new Blob([state.body], { type: 'application/json' });
      else if (type === 'arraybuffer') value = new TextEncoder().encode(state.body).buffer;
      else if (type === 'document') value = null;
      state.responses.set(type, value);
    }
    return state.responses.get(type);
  }

  function installResponse(xhr, state) {
    state.mock = true;
    Object.defineProperties(xhr, {
      readyState: { configurable: true, get: () => state.readyState },
      status: { configurable: true, get: () => state.readyState >= 2 && !state.canceled ? 200 : 0 },
      statusText: { configurable: true, get: () => state.readyState >= 2 && !state.canceled ? 'OK' : '' },
      responseURL: { configurable: true, get: () => state.readyState >= 2 && !state.canceled ? state.url : '' },
      response: { configurable: true, get: () => responseValue(xhr, state) },
      responseText: { configurable: true, get: () => {
        if (xhr.responseType !== '' && xhr.responseType !== 'text') {
          throw new DOMException('responseText is only available for text responses.', 'InvalidStateError');
        }
        return state.readyState >= 3 && !state.canceled ? state.body : '';
      } }
    });
  }

  function complete(xhr, state, rule) {
    if (!isCurrent(xhr, state)) return;
    state.pending = false;
    state.body = state.method === 'HEAD' ? '' : rule.responseBody;
    installResponse(xhr, state);
    const length = new TextEncoder().encode(state.body).length;
    const progress = type => xhr.dispatchEvent(new ProgressEvent(type, {
      lengthComputable: true, loaded: length, total: length
    }));
    xhr.dispatchEvent(new ProgressEvent('loadstart'));
    for (const readyState of state.method === 'HEAD' ? [2, 4] : [2, 3, 4]) {
      if (!isCurrent(xhr, state)) return;
      state.readyState = readyState;
      if (readyState === 4) state.completed = true;
      xhr.dispatchEvent(new Event('readystatechange'));
      if (!isCurrent(xhr, state)) return;
      if (readyState === 3) progress('progress');
    }
    if (!isCurrent(xhr, state)) return;
    progress('load');
    if (isCurrent(xhr, state)) progress('loadend');
  }

  prototype.open = function (method, url, ...argumentsRest) {
    const previous = requests.get(this);
    if (previous) previous.canceled = true;
    if (previous?.mock) responseProperties.forEach(property => { delete this[property]; });
    const state = {
      method: String(method).toUpperCase(), url: normalizeUrl(url),
      async: argumentsRest[0] !== false, sent: false, pending: false, mock: false,
      canceled: false, completed: false, readyState: 1, body: '', responses: new Map()
    };
    requests.set(this, state);
    return nativeOpen.call(this, method, url, ...argumentsRest);
  };

  prototype.send = function (body) {
    const state = requests.get(this);
    if (!state || this.readyState !== 1) return nativeSend.call(this, body);
    if (state.sent) throw new DOMException('The request has already been sent.', 'InvalidStateError');
    state.sent = true;
    const rule = findRule(state.url, state.method);
    if ((initialized || !state.async) && !rule) return nativeSend.call(this, body);
    if (!state.async) return complete(this, state, rule);
    state.pending = true;
    queueMicrotask(async () => {
      await ready;
      if (!isCurrent(this, state)) return;
      const currentRule = findRule(state.url, state.method);
      if (currentRule) complete(this, state, currentRule);
      else {
        state.pending = false;
        try { nativeSend.call(this, body); } catch {
          this.dispatchEvent(new ProgressEvent('error'));
          this.dispatchEvent(new ProgressEvent('loadend'));
        }
      }
    });
  };

  prototype.abort = function () {
    const state = requests.get(this);
    if (!state || !state.mock && !state.pending) return nativeAbort.call(this);
    state.canceled = true;
    nativeAbort.call(this);
    if (!state.mock) installResponse(this, state);
    if (!state.completed) {
      state.readyState = 4;
      this.dispatchEvent(new Event('readystatechange'));
      this.dispatchEvent(new ProgressEvent('abort'));
      this.dispatchEvent(new ProgressEvent('loadend'));
    }
    state.readyState = 0;
  };

  prototype.getResponseHeader = function (name) {
    const state = requests.get(this);
    if (!state?.mock) return nativeGetHeader.call(this, name);
    return state.readyState >= 2 && !state.canceled && String(name).toLowerCase() === 'content-type'
      ? 'application/json; charset=utf-8' : null;
  };

  prototype.getAllResponseHeaders = function () {
    const state = requests.get(this);
    if (!state?.mock) return nativeGetHeaders.call(this);
    return state.readyState >= 2 && !state.canceled ? 'content-type: application/json; charset=utf-8\r\n' : '';
  };

  prototype.setRequestHeader = function (...argumentsRest) {
    if (requests.get(this)?.sent) throw new DOMException('The request has already been sent.', 'InvalidStateError');
    return nativeSetHeader.apply(this, argumentsRest);
  };

  window.postMessage({ source: 'lock-blocker-page', type: 'ready' }, location.origin);
})();