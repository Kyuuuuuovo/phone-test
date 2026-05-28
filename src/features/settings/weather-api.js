// Weather API config. User fills a URL template (with {lat}/{lon}/{key} placeholders)
// plus an optional key. Three preset buttons fill in the template for OpenWeather /
// QWeather / Seniverse — user can edit afterwards. Test button hits Beijing's coords.

import * as db from '../../core/db.js';
import { PRESET_TEMPLATES, fetchWeather } from '../../core/weather.js';
import { bindFormDirty } from '../../core/form-helpers.js';

export async function mountWeatherApi(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  // Legacy: settings.weatherApi used to be { provider, apiKey }. Migrate to
  // { urlTemplate, apiKey } by looking the preset up. If user already has a
  // urlTemplate, leave it.
  const cfg = migrateConfig(settings.weatherApi);

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">天气 API</div>
      </header>
      <div class="page-body">
        <p class="hint">天气数据由你自己注册的服务提供,URL 和 key 只存在你浏览器里,不会经过任何服务器。会话设置里开启天气工具后,AI 调用工具时才会用这里的配置去拉数据。</p>
        <form class="settings-form" autocomplete="off">
          <div class="label-text">快速填充(点一下自动写入 URL 模板)</div>
          <div class="model-picker preset-picker">
            ${PRESET_TEMPLATES.map(p => `
              <button type="button" class="model-chip preset-chip" data-preset-id="${p.id}" title="${esc(p.keyHint)}">${esc(p.label)}</button>
            `).join('')}
          </div>
          <label>
            <div class="label-text">URL 模板</div>
            <input name="urlTemplate" type="text" placeholder="https://.../weather?lat={lat}&lon={lon}&appid={key}" value="${esc(cfg.urlTemplate)}">
          </label>
          <p class="hint">支持占位符 <code>{lat}</code> <code>{lon}</code> <code>{key}</code>。前端不解析响应,会把响应原文(最多 1500 字)塞给 AI 让模型自己看里面的字段。</p>
          <label>
            <div class="label-text">API Key(模板里没用 <code>{key}</code> 时可以留空)</div>
            <input name="apiKey" type="password" placeholder="key" value="${esc(cfg.apiKey)}">
          </label>
          <p class="hint preset-hint"></p>
          <div class="form-actions">
            <button type="submit" class="btn">保存</button>
            <button type="button" class="btn secondary test-btn">测试(用北京坐标试一次)</button>
          </div>
          <div class="form-status"></div>
        </form>
      </div>
    </div>
  `;

  const form        = container.querySelector('form');
  const status      = container.querySelector('.form-status');
  const backBtn     = container.querySelector('.back');
  const testBtn     = container.querySelector('.test-btn');
  const presetPicker = container.querySelector('.preset-picker');
  const presetHint  = container.querySelector('.preset-hint');
  const urlInput    = form.elements.urlTemplate;
  const saveBtn     = form.querySelector('button[type="submit"]');
  const dirty       = bindFormDirty(form, saveBtn);
  dirty.markSaved();

  function showPresetHint() {
    const match = PRESET_TEMPLATES.find(p => p.urlTemplate === urlInput.value.trim());
    presetHint.textContent = match ? match.keyHint : '';
  }
  showPresetHint();

  async function saveFromForm() {
    const fd = new FormData(form);
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    s.weatherApi = {
      urlTemplate: String(fd.get('urlTemplate') || '').trim(),
      apiKey:      String(fd.get('apiKey')      || '').trim(),
    };
    await db.set('settings', s);
    return s.weatherApi;
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
    dirty.markSaved();
  };
  const onTest = async () => {
    setStatus('保存配置...');
    try {
      const c = await saveFromForm();
      if (!c.urlTemplate) throw new Error('先填 URL 模板');
      setStatus('调用 API...');
      const raw = await fetchWeather({ lat: 39.9, lon: 116.4, urlTemplate: c.urlTemplate, apiKey: c.apiKey });
      setStatus(`OK · 收到 ${raw.length} 字响应:\n${raw.slice(0, 400)}`, 'success');
    } catch (e) {
      setStatus(`失败:${String(e).slice(0, 400)}`, 'error');
    }
  };
  const onPreset = (e) => {
    const chip = e.target.closest('[data-preset-id]');
    if (!chip) return;
    const preset = PRESET_TEMPLATES.find(p => p.id === chip.dataset.presetId);
    if (!preset) return;
    urlInput.value = preset.urlTemplate;
    showPresetHint();
    setStatus(`已填入「${preset.label}」模板,补完 key 后点保存`, 'success');
    dirty.markDirty();
  };
  const onUrlInput = () => showPresetHint();

  backBtn.addEventListener('click', onBack);
  form.addEventListener('submit', onSubmit);
  testBtn.addEventListener('click', onTest);
  presetPicker.addEventListener('click', onPreset);
  urlInput.addEventListener('input', onUrlInput);

  return () => {
    backBtn.removeEventListener('click', onBack);
    form.removeEventListener('submit', onSubmit);
    testBtn.removeEventListener('click', onTest);
    presetPicker.removeEventListener('click', onPreset);
    urlInput.removeEventListener('input', onUrlInput);
  };
}

// Read-only migration from legacy { provider, apiKey } shape. Doesn't write back —
// happens on next save.
function migrateConfig(stored) {
  if (!stored) return { urlTemplate: '', apiKey: '' };
  if (stored.urlTemplate !== undefined) {
    return { urlTemplate: stored.urlTemplate || '', apiKey: stored.apiKey || '' };
  }
  if (stored.provider) {
    const preset = PRESET_TEMPLATES.find(p => p.id === stored.provider);
    return { urlTemplate: preset?.urlTemplate || '', apiKey: stored.apiKey || '' };
  }
  return { urlTemplate: '', apiKey: stored.apiKey || '' };
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
