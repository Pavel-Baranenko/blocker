(function () {
  let rules = null;

  function publish() {
    window.postMessage({ source: 'lock-blocker-extension', type: 'rules', rules }, location.origin);
  }

  function loadRules() {
    chrome.runtime.sendMessage({ type: 'getPageRules' }, response => {
      const error = chrome.runtime.lastError;
      rules = !error && Array.isArray(response?.rules) ? response.rules : [];
      publish();
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'setPageRules' || !Array.isArray(message.rules)) return;
    rules = message.rules;
    publish();
    sendResponse({ ok: true });
  });

  window.addEventListener('message', event => {
    if (event.source === window && event.origin === location.origin &&
        event.data?.source === 'lock-blocker-page' && event.data.type === 'ready' && rules !== null) publish();
  });
  window.addEventListener('pageshow', loadRules);
  loadRules();
})();