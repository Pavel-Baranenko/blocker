let currentRules = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadRules();
  
  document.getElementById('addRuleBtn').addEventListener('click', addRule);
});

async function loadRules() {
  const result = await chrome.storage.local.get(['rules']);
  currentRules = result.rules || [];
  renderRules();
}

function renderRules() {
  const container = document.getElementById('rulesList');
  const countSpan = document.getElementById('rulesCount');
  
  countSpan.textContent = currentRules.length;
  
  container.innerHTML = currentRules.map(rule => `
    <div class="rule-item ${rule.enabled ? 'enabled' : 'disabled'}">
      <div class="rule-url">${escapeHtml(rule.url)}</div>
      <div class="rule-method">${rule.method} | ${rule.action}</div>
      <div>
        <button onclick="window.toggleRule('${rule.id}')">
          ${rule.enabled ? 'Отключить' : 'Включить'}
        </button>
        <button onclick="window.deleteRule('${rule.id}')">Удалить</button>
      </div>
    </div>
  `).join('');
  
  window.toggleRule = toggleRule;
  window.deleteRule = deleteRule;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function addRule() {
  const url = document.getElementById('ruleUrl').value.trim();
  const method = document.getElementById('ruleMethod').value;
  const action = document.getElementById('ruleAction').value;
  
  if (!url) {
    alert('Введите URL');
    return;
  }
  
  const rule = {
    id: Date.now().toString(),
    url: url,
    method: method,
    action: action,
    enabled: true
  };
  
  currentRules.push(rule);
  await chrome.storage.local.set({ rules: currentRules });
  
  await chrome.runtime.sendMessage({ type: 'RULES_UPDATED' });
  
  renderRules();
  
  document.getElementById('ruleUrl').value = '';
}

async function toggleRule(ruleId) {
  const rule = currentRules.find(r => r.id === ruleId);
  if (rule) {
    rule.enabled = !rule.enabled;
    await chrome.storage.local.set({ rules: currentRules });
    await chrome.runtime.sendMessage({ type: 'RULES_UPDATED' });
    renderRules();
  }
}

async function deleteRule(ruleId) {
  currentRules = currentRules.filter(r => r.id !== ruleId);
  await chrome.storage.local.set({ rules: currentRules });
  await chrome.runtime.sendMessage({ type: 'RULES_UPDATED' });
  renderRules();
}