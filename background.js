// background.js
let currentRules = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_RULES') {
    currentRules = message.rules;
    applyAllRules();
    sendResponse({ success: true });
  }
  return true;
});

async function applyAllRules() {
  const enabledRules = currentRules.filter(r => r.enabled);
  
  // Разделяем по типам действий
  const blockRules = enabledRules.filter(r => r.action === 'block');
  const mockRules = enabledRules.filter(r => r.action === 'mock');
  
  // Применяем блокировку
  await applyBlockRules(blockRules);
  
  // Для подмены - логируем или используем один из вариантов выше
  if (mockRules.length > 0) {
    console.log('Mock rules (требуется дополнительная настройка):', mockRules);
    // Здесь нужно реализовать один из методов подмены ответа
    await setupMockInterceptor(mockRules);
  }
}

async function applyBlockRules(rules) {
  const dynamicRules = rules.map((rule, idx) => ({
    id: idx + 1,
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter: rule.url,
      requestMethods: [rule.method.toLowerCase()],
      resourceTypes: ["xmlhttprequest", "main_frame", "sub_frame", "script"]
    }
  }));
  
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const existingIds = existingRules.map(r => r.id);
  
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingIds,
    addRules: dynamicRules
  });
  
  console.log(`Applied ${dynamicRules.length} block rules`);
}

async function setupMockInterceptor(mockRules) {
  // Вариант: логируем запросы для отладки
  console.table(mockRules.map(r => ({ url: r.url, method: r.method, mock: r.mockResponse })));
  
  // TODO: Реализовать через chrome.debugger или внешний прокси
  // Для production можно использовать специальный мок-сервер
}

// Инициализация при старте
chrome.runtime.onInstalled.addListener(async () => {
  const { rules = [] } = await chrome.storage.local.get('rules');
  currentRules = rules;
  await applyAllRules();
});