// Per-session toggles for what the AI is allowed to read via tool calls.
// Two sections: 角色 and 我自己. Each has: time toggle + weather toggle + city picker.
//
// City picker modes:
//   preset — pick from built-in CITIES table (real city, label === name)
//   custom — user types a name (e.g. 虚构 "云霄阁" or just an uncovered real city)
//            AND picks a real-world counterpart from CITIES for tz/weather lookup

import * as db from '../../core/db.js';
import { CITIES, getCityByKey, citiesGroupedByOffset } from '../../core/cities.js';

export async function mountChatSettings(container, params, router) {
  const sessionId = params.sessionId;
  if (!sessionId) {
    container.innerHTML = `<div class="page"><div class="page-body">缺少 sessionId</div></div>`;
    return () => {};
  }
  const session = await db.get('chatSessions', sessionId);
  if (!session) {
    container.innerHTML = `<div class="page"><div class="page-body">会话不存在</div></div>`;
    return () => {};
  }
  const character = await db.get('characters', session.characterId);
  const settings = await db.get('settings', 'default');
  const hasWeatherKey = !!settings?.weatherApi?.urlTemplate;

  // Defaults for fields that may not exist on older sessions.
  const get = (k, d) => session[k] !== undefined ? session[k] : d;
  const initial = {
    char: {
      tz:      get('charTzEnabled', false),
      weather: get('charWeatherEnabled', false),
      loc:     get('charLocEnabled', false),
      mode:    get('charCityMode', 'preset'),
      key:     get('charCityKey', ''),
      label:   get('charCityLabel', ''),
    },
    user: {
      tz:      get('userTzEnabled', false),
      weather: get('userWeatherEnabled', false),
      loc:     get('userLocEnabled', false),
      mode:    get('userCityMode', 'preset'),
      key:     get('userCityKey', ''),
      label:   get('userCityLabel', ''),
    },
  };

  const citiesOpts = (selectedKey) => citiesGroupedByOffset().map(g => `
    <optgroup label="${g.offset}">
      ${g.cities.map(c => `<option value="${c.key}"${c.key === selectedKey ? ' selected' : ''}>${c.name}</option>`).join('')}
    </optgroup>
  `).join('');

  function sectionHtml(who, label, init) {
    return `
      <div class="cs-section">
        <h3>${label}</h3>
        <label class="checkbox-row">
          <input type="checkbox" data-key="${who}-tz"${init.tz ? ' checked' : ''}>
          <span>AI 可读${label}当前时间</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" data-key="${who}-weather"${init.weather ? ' checked' : ''}${hasWeatherKey ? '' : ' disabled'}>
          <span>AI 可读${label}所在地天气${hasWeatherKey ? '' : '<span class="muted-hint">(先去 设置 → 天气 API 填 URL 模板)</span>'}</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" data-key="${who}-loc"${init.loc ? ' checked' : ''}>
          <span>AI 可读${label}所在地名(只是城市名,不查 API)</span>
        </label>
        <div class="city-picker" data-who="${who}">
          <div class="label-text">${label}所在地</div>
          <div class="radio-row">
            <label><input type="radio" name="${who}-mode" value="preset"${init.mode === 'preset' ? ' checked' : ''}> 常用城市</label>
            <label><input type="radio" name="${who}-mode" value="custom"${init.mode === 'custom' ? ' checked' : ''}> 自定义 / 虚构</label>
          </div>
          <div class="preset-block"${init.mode !== 'preset' ? ' hidden' : ''}>
            <select data-key="${who}-preset">
              <option value="">— 选择 —</option>
              ${citiesOpts(init.mode === 'preset' ? init.key : '')}
            </select>
          </div>
          <div class="custom-block"${init.mode !== 'custom' ? ' hidden' : ''}>
            <label>
              <div class="label-text">城市名(给 AI 看的,可虚构)</div>
              <input data-key="${who}-custom-label" placeholder="比如:云霄阁 / 青岛" value="${esc(init.mode === 'custom' ? init.label : '')}">
            </label>
            <label>
              <div class="label-text">对应真实城市(用来查时区和天气)</div>
              <select data-key="${who}-custom-mapping">
                <option value="">— 选择真实城市 —</option>
                ${citiesOpts(init.mode === 'custom' ? init.key : '')}
              </select>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">会话设置</div>
      </header>
      <div class="page-body">
        <p class="hint">开启某项后,AI 在生成回复时可以通过工具调用读取对应数据。**需要你用的模型支持 tools / function calling**——不支持的会直接报错。</p>
        <form class="settings-form chat-settings-form" autocomplete="off">
          ${sectionHtml('char', '角色', initial.char)}
          ${sectionHtml('user', '我自己', initial.user)}
          <div class="form-actions">
            <button type="submit" class="btn">保存</button>
          </div>
          <div class="form-status"></div>
        </form>
      </div>
    </div>
  `;

  const form    = container.querySelector('form');
  const status  = container.querySelector('.form-status');
  const backBtn = container.querySelector('.back');

  // Toggle preset/custom block visibility on radio change.
  const onRadioChange = (e) => {
    const r = e.target.closest('input[type=radio]');
    if (!r) return;
    const who = r.name.split('-')[0]; // 'char' or 'user'
    const picker = form.querySelector(`.city-picker[data-who="${who}"]`);
    picker.querySelector('.preset-block').hidden = r.value !== 'preset';
    picker.querySelector('.custom-block').hidden = r.value !== 'custom';
  };
  form.addEventListener('change', onRadioChange);

  function gather(who) {
    const tz      = form.querySelector(`[data-key="${who}-tz"]`).checked;
    const weather = form.querySelector(`[data-key="${who}-weather"]`).checked;
    const loc     = form.querySelector(`[data-key="${who}-loc"]`).checked;
    const mode    = form.querySelector(`input[name="${who}-mode"]:checked`)?.value || 'preset';
    let key = '', label = '';
    if (mode === 'preset') {
      key = form.querySelector(`[data-key="${who}-preset"]`).value;
      const c = getCityByKey(key);
      label = c ? c.name : '';
    } else {
      key = form.querySelector(`[data-key="${who}-custom-mapping"]`).value;
      label = form.querySelector(`[data-key="${who}-custom-label"]`).value.trim();
    }
    return { tz, weather, loc, mode, key, label };
  }

  const onBack = () => router.back();
  const onSubmit = async (e) => {
    e.preventDefault();
    const c = gather('char');
    const u = gather('user');
    // Light validation: if a toggle is on, the city info must be usable.
    const needsCity = c.tz || c.weather;
    if (needsCity && !c.key) {
      status.textContent = '角色的时间/天气开了,但没指定角色所在的真实城市';
      status.className = 'form-status error';
      return;
    }
    if (c.mode === 'custom' && (c.tz || c.weather) && !c.label) {
      status.textContent = '角色自定义城市没填城市名';
      status.className = 'form-status error';
      return;
    }
    const uNeedsCity = u.tz || u.weather;
    if (uNeedsCity && !u.key) {
      status.textContent = '我自己的时间/天气开了,但没指定我所在的真实城市';
      status.className = 'form-status error';
      return;
    }
    if (u.mode === 'custom' && (u.tz || u.weather) && !u.label) {
      status.textContent = '我自己的自定义城市没填城市名';
      status.className = 'form-status error';
      return;
    }
    Object.assign(session, {
      charTzEnabled:      c.tz,
      charWeatherEnabled: c.weather,
      charLocEnabled:     c.loc,
      charCityMode:       c.mode,
      charCityKey:        c.key,
      charCityLabel:      c.label,
      userTzEnabled:      u.tz,
      userWeatherEnabled: u.weather,
      userLocEnabled:     u.loc,
      userCityMode:       u.mode,
      userCityKey:        u.key,
      userCityLabel:      u.label,
    });
    await db.set('chatSessions', session);
    status.textContent = '已保存';
    status.className = 'form-status success';
  };

  backBtn.addEventListener('click', onBack);
  form.addEventListener('submit', onSubmit);

  return () => {
    form.removeEventListener('change', onRadioChange);
    backBtn.removeEventListener('click', onBack);
    form.removeEventListener('submit', onSubmit);
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
