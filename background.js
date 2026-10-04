const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
let pending = Promise.resolve();

function enqueue(operation) {
  const result = pending.then(operation);
  pending = result.catch(error => console.error(error));
  return result;
}

function validateRule(rule) {
  if (!rule || typeof rule.id !== 'string' || !rule.id ||
      typeof rule.name !== 'string' || !rule.name.trim() ||
      typeof rule.url !== 'string' || !METHODS.has(rule.method) ||
      typeof rule.active !== 'boolean') {
    throw new Error('Invalid rule.');
  }
  const url = new URL(rule.url);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
  url.hash = '';
  const replaceResponse = rule.replaceResponse ?? false;
  const responseBody = rule.responseBody ?? '';
  if (typeof replaceResponse !== 'boolean' || typeof responseBody !== 'string') {
    throw new Error('Invalid response settings.');
  }
  if (replaceResponse) {
    try {
      JSON.parse(responseBody);
    } catch {
      throw new Error('Response must contain valid JSON.');
    }
  }
  return {
    id: rule.id, name: rule.name.trim(), url: url.href, method: rule.method,
    active: rule.active, replaceResponse, responseBody
  };
}

async function getRules() {
  const stored = await chrome.storage.local.get({ rules: [] });
  return stored.rules;
}

function getReplacementRules(rules) {
  return rules.filter(rule => rule.active && rule.replaceResponse).map(rule => ({
    url: rule.url, method: rule.method, responseBody: rule.responseBody
  }));
}

async function applyRules(rules) {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tabId = tabs[0]?.id;
  const addRules = [];
  if (Number.isInteger(tabId) && tabId >= 0) {
    for (const rule of rules.filter(rule => rule.active && !rule.replaceResponse)) {
      const regexFilter = '^' + rule.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
      const support = await chrome.declarativeNetRequest.isRegexSupported({
        regex: regexFilter,
        isCaseSensitive: true
      });
      if (!support.isSupported) throw new Error('This URL is too long or cannot be used as a request filter.');
      addRules.push({
        id: addRules.length + 1,
        priority: 1,
        action: { type: 'block' },
        condition: {
          regexFilter,
          isUrlFilterCaseSensitive: true,
          requestMethods: [rule.method.toLowerCase()],
          tabIds: [tabId]
        }
      });
    }
  }
  const current = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: current.map(rule => rule.id),
    addRules
  });
  const allTabs = await chrome.tabs.query({});
  const replacements = getReplacementRules(rules);
  await Promise.all(allTabs.filter(tab => Number.isInteger(tab.id)).map(tab =>
    chrome.tabs.sendMessage(tab.id, {
      type: 'setPageRules', rules: tab.id === tabId ? replacements : []
    }).catch(() => {})
  ));
}

async function handleMessage(message, sender) {
  const rules = await getRules();
  if (message.type === 'getRules') return rules;
  if (message.type === 'getPageRules') {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return sender.tab?.id === tabs[0]?.id ? getReplacementRules(rules) : [];
  }
  let nextRules;
  if (message.type === 'saveRule') {
    const rule = validateRule(message.rule);
    const exists = rules.some(current => current.id === rule.id);
    nextRules = exists ? rules.map(current => current.id === rule.id ? rule : current) : [...rules, rule];
  } else if (message.type === 'deleteRule' && typeof message.id === 'string') {
    nextRules = rules.filter(rule => rule.id !== message.id);
  } else {
    throw new Error('Unknown operation.');
  }
  await applyRules(nextRules);
  try {
    await chrome.storage.local.set({ rules: nextRules });
  } catch (error) {
    await applyRules(rules);
    throw error;
  }
  return nextRules;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !['getRules', 'getPageRules', 'saveRule', 'deleteRule'].includes(message?.type)) return;
  if (sender.tab && message.type !== 'getPageRules') return;
  enqueue(() => handleMessage(message, sender)).then(
    rules => sendResponse({ rules }),
    error => sendResponse({ error: error.message })
  );
  return true;
});

function refreshRules() {
  enqueue(async () => applyRules(await getRules()));
}

chrome.tabs.onActivated.addListener(refreshRules);
chrome.tabs.onRemoved.addListener(refreshRules);
chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshRules();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.rules) refreshRules();
});
chrome.runtime.onInstalled.addListener(refreshRules);
chrome.runtime.onStartup.addListener(refreshRules);
refreshRules();