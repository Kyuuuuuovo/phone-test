// API config form. Edits apiConfig.default. "Test connection" pings the endpoint.

import * as db from '../../core/db.js';
import * as ai from '../../core/ai.js';

export async function mountApiSettings(container, params, router) {
  const config = (await db.get('apiConfig', 'default')) || {
    id: 'default', apiUrl: '', apiKey: '', modelName: '', temperature: 0.8,
  };

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">API 设置</div>
      </header>
      <div class="page-body">
        <form class="settings-form" autocomplete="off">
          <label>
            <div class="label-text">API URL(不带 /chat/completions)</div>
            <input name="apiUrl" type="text" placeholder="https://api.openai.com/v1" value="${esc(config.apiUrl)}">
          </label>
          <label>
            <div class="label-text">API Key</div>
            <input name="apiKey" type="password" placeholder="sk-..." value="${esc(config.apiKey)}">
          </label>
          <label>
            <div class="label-text">Model</div>
            <input name="modelName" type="text" placeholder="gpt-4o-mini" value="${esc(config.modelName)}">
          </label>
          <label>
            <div class="label-text">Temperature(0-2)</div>
            <input name="temperature" type="number" step="0.1" min="0" max="2" value="${config.temperature ?? 0.8}">
          </label>
          <div class="form-actions">
            <button type="submit" class="btn">保存</button>
            <button type="button" class="btn secondary test-conn">测试连接</button>
          </div>
          <div class="form-status"></div>
        </form>
      </div>
    </div>
  `;

  const form    = container.querySelector('form');
  const status  = container.querySelector('.form-status');
  const backBtn = container.querySelector('.back');
  const testBtn = container.querySelector('.test-conn');

  async function saveFromForm() {
    const fd = new FormData(form);
    const cfg = {
      id: 'default',
      apiUrl:    String(fd.get('apiUrl')    || '').trim(),
      apiKey:    String(fd.get('apiKey')    || '').trim(),
      modelName: String(fd.get('modelName') || '').trim(),
      temperature: parseFloat(fd.get('temperature')) || 0.8,
    };
    await db.set('apiConfig', cfg);
    return cfg;
  }

  const onBack = () => router.back();
  const onSubmit = async (e) => {
    e.preventDefault();
    await saveFromForm();
    status.textContent = '已保存';
    status.className = 'form-status success';
  };
  const onTest = async () => {
    status.className = 'form-status';
    status.textContent = '保存配置...';
    try {
      await saveFromForm();
      status.textContent = '调用中...';
      const reply = await ai.callAI({
        systemPrompt: '你只用一句话回复。',
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0.5,
      });
      status.textContent = `连接 OK,模型回复:${reply.trim().slice(0, 120)}`;
      status.className = 'form-status success';
    } catch (e) {
      status.textContent = `连接失败:${String(e).slice(0, 300)}`;
      status.className = 'form-status error';
    }
  };

  backBtn.addEventListener('click', onBack);
  form.addEventListener('submit', onSubmit);
  testBtn.addEventListener('click', onTest);

  return () => {
    backBtn.removeEventListener('click', onBack);
    form.removeEventListener('submit', onSubmit);
    testBtn.removeEventListener('click', onTest);
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
