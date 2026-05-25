// Weather API config. Single config (provider + apiKey), stored in settings.weatherApi.
// Test button hits the provider with Beijing's coords as a smoke test.

import * as db from '../../core/db.js';
import { PROVIDERS, fetchWeather } from '../../core/weather.js';

export async function mountWeatherApi(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  const cfg = settings.weatherApi || { provider: 'openweather', apiKey: '' };

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">天气 API</div>
      </header>
      <div class="page-body">
        <p class="hint">天气数据由你自己注册的 provider 提供,key 只存在你浏览器里,不会经过任何服务器。会话设置里开启天气工具后,AI 调用工具时才会用这里的配置去拉数据。</p>
        <form class="settings-form" autocomplete="off">
          <label>
            <div class="label-text">Provider</div>
            <select name="provider">
              ${PROVIDERS.map(p => `<option value="${p.id}"${p.id === cfg.provider ? ' selected' : ''}>${p.label}</option>`).join('')}
            </select>
          </label>
          <p class="hint provider-hint"></p>
          <label>
            <div class="label-text">API Key</div>
            <input name="apiKey" type="password" placeholder="key" value="${esc(cfg.apiKey)}">
          </label>
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
  const providerSel = container.querySelector('select[name=provider]');
  const providerHint = container.querySelector('.provider-hint');

  function updateProviderHint() {
    const p = PROVIDERS.find(x => x.id === providerSel.value);
    providerHint.textContent = p?.keyHint || '';
  }
  updateProviderHint();

  async function saveFromForm() {
    const fd = new FormData(form);
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    s.weatherApi = {
      provider: String(fd.get('provider') || 'openweather'),
      apiKey:   String(fd.get('apiKey')   || '').trim(),
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
  };
  const onTest = async () => {
    setStatus('保存配置...');
    try {
      const c = await saveFromForm();
      if (!c.apiKey) throw new Error('先填 API Key');
      setStatus('调用 provider...');
      const w = await fetchWeather({ lat: 39.9, lon: 116.4, provider: c.provider, apiKey: c.apiKey });
      setStatus(`OK:北京 ${w.tempC}°C / ${w.summary}`, 'success');
    } catch (e) {
      setStatus(`失败:${String(e).slice(0, 300)}`, 'error');
    }
  };
  const onProviderChange = () => updateProviderHint();

  backBtn.addEventListener('click', onBack);
  form.addEventListener('submit', onSubmit);
  testBtn.addEventListener('click', onTest);
  providerSel.addEventListener('change', onProviderChange);

  return () => {
    backBtn.removeEventListener('click', onBack);
    form.removeEventListener('submit', onSubmit);
    testBtn.removeEventListener('click', onTest);
    providerSel.removeEventListener('change', onProviderChange);
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
