// Edit one apiConfig row. Name + url + key + model + temperature.
// "获取模型" fetches {apiUrl}/models and lets user pick one.
// "测试连接" temporarily activates this config and pings the endpoint.
// "设为当前" updates settings.activeApiConfigId.
// "删除" removes the row (and clears activeApiConfigId if it pointed here).

import * as db from '../../core/db.js';
import * as ai from '../../core/ai.js';

export async function mountApiDetail(container, params, router) {
  const id = params.id;
  if (!id) {
    container.innerHTML = `<div class="page"><div class="page-body">缺少 id</div></div>`;
    return () => {};
  }
  const config = await db.get('apiConfig', id);
  if (!config) {
    container.innerHTML = `<div class="page"><div class="page-body">配置不存在</div></div>`;
    return () => {};
  }
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  const isActive = settings.activeApiConfigId === id;

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">编辑 API 配置</div>
      </header>
      <div class="page-body">
        <form class="settings-form" autocomplete="off">
          <label>
            <div class="label-text">名称(自己看的,比如「OpenRouter Sonnet」)</div>
            <input name="name" type="text" placeholder="新配置" value="${esc(config.name)}">
          </label>
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
            <div class="row-with-action">
              <input name="modelName" type="text" placeholder="gpt-4o-mini" value="${esc(config.modelName)}">
              <button type="button" class="btn secondary fetch-models">获取模型</button>
            </div>
          </label>
          <div class="model-list" hidden></div>
          <label>
            <div class="label-text">Temperature(0-2)</div>
            <input name="temperature" type="number" step="0.1" min="0" max="2" value="${config.temperature ?? 0.8}">
          </label>
          <div class="form-actions">
            <button type="submit" class="btn">保存</button>
            <button type="button" class="btn secondary test-conn">测试连接</button>
            <button type="button" class="btn secondary set-active" ${isActive ? 'disabled' : ''}>
              ${isActive ? '当前使用中' : '设为当前'}
            </button>
            <button type="button" class="btn danger delete-btn">删除</button>
          </div>
          <div class="form-status"></div>
        </form>
      </div>
    </div>
  `;

  const form       = container.querySelector('form');
  const status     = container.querySelector('.form-status');
  const backBtn    = container.querySelector('.back');
  const testBtn    = container.querySelector('.test-conn');
  const fetchBtn   = container.querySelector('.fetch-models');
  const setActive  = container.querySelector('.set-active');
  const deleteBtn  = container.querySelector('.delete-btn');
  const modelList  = container.querySelector('.model-list');

  async function saveFromForm() {
    const fd = new FormData(form);
    const cfg = {
      id,
      name:        String(fd.get('name')      || '').trim() || '新配置',
      apiUrl:      String(fd.get('apiUrl')    || '').trim(),
      apiKey:      String(fd.get('apiKey')    || '').trim(),
      modelName:   String(fd.get('modelName') || '').trim(),
      temperature: parseFloat(fd.get('temperature')) || 0.8,
    };
    await db.set('apiConfig', cfg);
    return cfg;
  }

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = `form-status${kind ? ' ' + kind : ''}`;
  }

  const onBack = () => router.back();

  const onSubmit = async (e) => {
    e.preventDefault();
    await saveFromForm();
    setStatus('已保存', 'success');
  };

  const onTest = async () => {
    setStatus('保存配置...');
    try {
      const cfg = await saveFromForm();
      // Temporarily switch active to this config so callAI uses it
      const before = settings.activeApiConfigId;
      const sNow = (await db.get('settings', 'default')) || { id: 'default' };
      sNow.activeApiConfigId = cfg.id;
      await db.set('settings', sNow);
      setStatus('调用中...');
      try {
        const reply = await ai.callAI({
          systemPrompt: '你只用一句话回复。',
          messages: [{ role: 'user', content: 'ping' }],
          temperature: 0.5,
        });
        setStatus(`连接 OK,模型回复:${reply.trim().slice(0, 120)}`, 'success');
      } finally {
        // Restore previous active if user hadn't explicitly set this one
        if (before && before !== cfg.id) {
          sNow.activeApiConfigId = before;
          await db.set('settings', sNow);
        }
      }
    } catch (e) {
      setStatus(`连接失败:${String(e).slice(0, 300)}`, 'error');
    }
  };

  const onFetchModels = async () => {
    setStatus('获取模型列表...');
    try {
      const cfg = await saveFromForm();
      if (!cfg.apiUrl || !cfg.apiKey) {
        throw new Error('请先填 API URL 和 Key');
      }
      const url = `${cfg.apiUrl.replace(/\/+$/, '')}/models`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} — ${t.slice(0, 200)}`);
      }
      const data = await res.json();
      // OpenAI-compat: {data: [{id, ...}]}. Some endpoints just return an array.
      const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      const ids = list.map(m => (typeof m === 'string' ? m : m?.id)).filter(Boolean);
      if (ids.length === 0) {
        throw new Error('返回里没有找到模型列表');
      }
      ids.sort();
      modelList.hidden = false;
      modelList.innerHTML = `
        <div class="label-text">点一个填进 Model 输入框(${ids.length} 个)</div>
        <div class="model-picker">
          ${ids.map(m => `<button type="button" class="model-chip" data-model="${esc(m)}">${esc(m)}</button>`).join('')}
        </div>
      `;
      setStatus(`拉到 ${ids.length} 个模型`, 'success');
    } catch (e) {
      setStatus(`获取失败:${String(e).slice(0, 300)}`, 'error');
    }
  };

  const onPickModel = (e) => {
    const chip = e.target.closest('[data-model]');
    if (!chip) return;
    form.elements.modelName.value = chip.dataset.model;
    modelList.hidden = true;
    setStatus('已填入模型,记得点保存', 'success');
  };

  const onSetActive = async () => {
    const cfg = await saveFromForm();
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    s.activeApiConfigId = cfg.id;
    await db.set('settings', s);
    setActive.disabled = true;
    setActive.textContent = '当前使用中';
    setStatus('已设为当前使用的配置', 'success');
  };

  const onDelete = async () => {
    const all = await db.getAll('apiConfig');
    if (!confirm(`删除配置「${config.name || '(未命名)'}」?`)) return;
    await db.del('apiConfig', id);
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    if (s.activeApiConfigId === id) {
      const remaining = all.filter(c => c.id !== id);
      s.activeApiConfigId = remaining[0]?.id || null;
      await db.set('settings', s);
    }
    router.back();
  };

  backBtn.addEventListener('click', onBack);
  form.addEventListener('submit', onSubmit);
  testBtn.addEventListener('click', onTest);
  fetchBtn.addEventListener('click', onFetchModels);
  modelList.addEventListener('click', onPickModel);
  setActive.addEventListener('click', onSetActive);
  deleteBtn.addEventListener('click', onDelete);

  return () => {
    backBtn.removeEventListener('click', onBack);
    form.removeEventListener('submit', onSubmit);
    testBtn.removeEventListener('click', onTest);
    fetchBtn.removeEventListener('click', onFetchModels);
    modelList.removeEventListener('click', onPickModel);
    setActive.removeEventListener('click', onSetActive);
    deleteBtn.removeEventListener('click', onDelete);
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
