// Theme editor — tabbed layout.
//
// Five tabs (预设 / 颜色 / 字体 / 玻璃 / 壁纸) replace the old one-long-page
// arrangement. The previous layout dumped 8 color rows, 4 effect controls,
// font + size, notch + radius, and a wallpaper uploader into a single
// vertical scroll — the Save button at the bottom was a known pain point
// because it was 6+ scrolls from the top.
//
// The bottom of the page is a sticky strip:
//   - Mini preview (tile row + chat bubbles + dock pill) — reflects every
//     CSS-variable tweak instantly, just like the surrounding phone-frame.
//   - Action bar: 重置默认 / status text / 保存
// So save is always one tap away from any tab.
//
// Save semantics unchanged from the old editor:
//   - Each control change calls applyDraft() to write the in-memory theme
//     to :root, so the whole frame previews live.
//   - settings.theme is only written on 保存. Teardown rolls back if the
//     user leaves the page without saving (via applyTheme(original)).

import * as db from '../../core/db.js';
import { openConfirm, openModal } from '../../core/modal.js';
import {
  DEFAULT_THEME, FONT_OPTIONS, TEXTURE_OPTIONS, GLASS_OPTIONS, THEME_PRESETS,
  normalizeTheme, applyTheme, applyWallpaper,
} from '../../core/theme.js';

export async function mountTheme(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  let draft = normalizeTheme(settings.theme);
  const original = JSON.parse(JSON.stringify(draft));  // committed-on-disk snapshot
  let saved = false;
  // T8: dirty 是这一轮"按了保存之后,有没有改过新东西" — 跟 saved 不同。
  //   saved 描述"整个 session 里点过 save 没",cleanup 用它判断要不要 revert。
  //   dirty 描述"现在还没保存的修改",save-btn 视觉用它。
  let dirty = false;
  let activeTab = 'preset';
  // User presets live in settings.themePresets (array of { id, label, theme }).
  let userPresets = Array.isArray(settings.themePresets) ? settings.themePresets : [];
  // Wallpaper is stored at the settings root (settings.wallpaper) — not part of
  // the theme object since it's a heavy image and orthogonal to the color set.
  let currentWallpaper = settings.wallpaper || null;

  function allPresets() {
    return [
      ...THEME_PRESETS.map(p => ({ ...p, builtin: true })),
      ...userPresets.map(p => ({ ...p, builtin: false })),
    ];
  }

  async function persistUserPresets() {
    await db.updateSettings(s => { s.themePresets = userPresets; });
  }

  function render() {
    // Mini-preview shows the current wallpaper behind a translucent page
    // surface so "壁纸透出" (surfaceAlpha) is actually visible in the
    // preview — without a wallpaper backdrop, the slider had no effect on
    // the preview frame and users couldn't tell what it did.
    const previewStyle = currentWallpaper
      ? `style="background-image: url('${esc(currentWallpaper)}');"`
      : '';
    container.innerHTML = `
      <div class="page theme-editor-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">外观</div>
        </header>
        <div class="theme-tabs">
          <button class="theme-tab${activeTab === 'preset'    ? ' active' : ''}" data-tab="preset">预设</button>
          <button class="theme-tab${activeTab === 'color'     ? ' active' : ''}" data-tab="color">颜色</button>
          <button class="theme-tab${activeTab === 'font'      ? ' active' : ''}" data-tab="font">字体</button>
          <button class="theme-tab${activeTab === 'effect'    ? ' active' : ''}" data-tab="effect">特效</button>
          <button class="theme-tab${activeTab === 'wallpaper' ? ' active' : ''}" data-tab="wallpaper">壁纸</button>
        </div>
        <div class="page-body theme-tab-body">
          ${renderTab()}
        </div>
        <div class="theme-sticky">
          <div class="theme-mini-preview" ${previewStyle}>
            <div class="mini-page-surface">
              <div class="mini-tile-row">
                <div class="mini-tile"></div>
                <div class="mini-tile"></div>
                <div class="mini-tile"></div>
              </div>
              <div class="mini-chat">
                <div class="mini-bubble char">嗨,在吗?</div>
                <div class="mini-bubble user">在</div>
              </div>
              <div class="mini-dock">
                <div class="mini-dock-icon"></div>
                <div class="mini-dock-icon"></div>
              </div>
            </div>
          </div>
          <div class="theme-actions-bar">
            <button type="button" class="btn secondary reset-btn">重置默认</button>
            <span class="theme-status"></span>
            <button type="button" class="btn save-btn">保存</button>
          </div>
        </div>
      </div>
    `;
    wire();
  }

  function renderTab() {
    switch (activeTab) {
      case 'preset':    return renderPresetTab();
      case 'color':     return renderColorTab();
      case 'font':      return renderFontTab();
      case 'effect':    return renderEffectTab();
      case 'wallpaper': return renderWallpaperTab();
      default:          return '';
    }
  }

  function renderPresetTab() {
    return `
      <p class="hint">点 chip 套用一套预设。「+ 存为预设」会把你当前的调整存成一条可复用的预设。</p>
      <div class="preset-picker preset-scroll">
        ${allPresets().map(p => `
          <div class="preset-chip-wrap" data-preset-id="${esc(p.id)}">
            <button type="button" class="model-chip preset-chip">${esc(p.label)}</button>
            ${p.builtin ? '' : `<button type="button" class="preset-delete" title="删除这个预设">×</button>`}
          </div>
        `).join('')}
        <button type="button" class="model-chip preset-save-current" title="把当前主题存成预设">+ 存为预设</button>
      </div>
      <p class="hint" style="font-size:11px;margin-top:14px;">预设包含颜色、字体、圆角、特效。<b>壁纸不在预设里</b> — 单独在「壁纸」tab 设,切预设不影响。</p>
    `;
  }

  function renderColorTab() {
    return `
      <h3 class="section-title">强调色</h3>
      ${colorRow('强调色 / 按钮 / 链接', 'accent')}

      <h3 class="section-title">背景</h3>
      ${colorRow('页面背景', 'bg')}
      ${colorRow('卡片 / 列表底色', 'surface')}
      ${colorRow('外壳底色(手机框外)', 'outsideBg')}
      ${colorRow('置顶项底色', 'bgPinned')}

      <h3 class="section-title">文字 / 边</h3>
      ${colorRow('正文文字', 'fg')}
      ${colorRow('次要文字', 'muted')}
      ${colorRow('分割线 / 边框', 'border')}

      <h3 class="section-title">气泡</h3>
      <div class="color-pair">
        ${colorRow('我的 · 背景', 'bubbleUser')}
        ${colorRow('我的 · 文字', 'bubbleUserFg')}
      </div>
      <div class="color-pair">
        ${colorRow('对方 · 背景', 'bubbleChar')}
        ${colorRow('对方 · 文字', 'bubbleCharFg')}
      </div>
    `;
  }

  function renderFontTab() {
    return `
      <label>
        <div class="label-text">字体族</div>
        <select data-key="fontFamily">
          ${FONT_OPTIONS.map(f => `<option value="${f.id}"${f.id === draft.fontFamily ? ' selected' : ''}>${f.label}</option>`).join('')}
        </select>
      </label>
      <div class="custom-font-block"${draft.fontFamily === 'custom' ? '' : ' hidden'}>
        <p class="hint">中英文可分别指定。最终 font-family 会拼成「英文, 中文, 系统兜底」— 英文优先匹配 ASCII,中文字符自动 fallback 到中文字体。两侧 import URL 各自加 &lt;link&gt;,只留空表示字体本机已安装。</p>
        <div class="font-pair">
          <div class="font-pair-title">中文字体</div>
          <label>
            <div class="label-text">font-family 名(单个,不要逗号)</div>
            <input type="text" data-key="customFontFamilyCn" value="${esc(draft.customFontFamilyCn)}" placeholder="比如 ZCOOL KuaiLe / Noto Serif SC">
          </label>
          <label>
            <div class="label-text">@import URL(可选 · Google Fonts 等)</div>
            <input type="text" data-key="customFontImportUrlCn" value="${esc(draft.customFontImportUrlCn)}" placeholder="https://fonts.googleapis.com/css2?family=...">
          </label>
        </div>
        <div class="font-pair">
          <div class="font-pair-title">英文字体</div>
          <label>
            <div class="label-text">font-family 名(单个)</div>
            <input type="text" data-key="customFontFamilyEn" value="${esc(draft.customFontFamilyEn)}" placeholder="比如 Great Vibes / Crimson Pro">
          </label>
          <label>
            <div class="label-text">@import URL(可选)</div>
            <input type="text" data-key="customFontImportUrlEn" value="${esc(draft.customFontImportUrlEn)}" placeholder="https://fonts.googleapis.com/css2?family=...">
          </label>
        </div>
      </div>
      <label>
        <div class="label-text">字号:<span class="font-size-readout">${draft.fontSize}</span> px</div>
        <input type="range" min="12" max="20" step="1" data-key="fontSize" value="${draft.fontSize}">
      </label>
    `;
  }

  function renderEffectTab() {
    return `
      <h3 class="section-title">外形</h3>
      <label class="checkbox-row">
        <input type="checkbox" data-key="notch"${draft.notch ? ' checked' : ''}>
        <span>启用 iPhone 刘海(顶部黑条 + 圆角外壳)</span>
      </label>
      <label>
        <div class="label-text">圆角:<span class="radius-readout">${draft.radius}</span> px(气泡 / 卡片 / 按钮的圆角程度)</div>
        <input type="range" min="0" max="20" step="1" data-key="radius" value="${draft.radius}">
      </label>

      <h3 class="section-title">玻璃质感</h3>
      <label>
        <div class="label-text">玻璃风格</div>
        <select data-fx="glass">
          ${GLASS_OPTIONS.map(g => `<option value="${g.id}"${g.id === draft.effects.glass ? ' selected' : ''}>${g.label}</option>`).join('')}
        </select>
      </label>
      <label>
        <div class="label-text">玻璃程度:<span class="glass-intensity-readout">${draft.effects.glassIntensity ?? 100}</span>%(0 = 没玻璃感、100 = 当前风格满档)</div>
        <input type="range" min="0" max="100" step="5" data-fx="glassIntensity" value="${draft.effects.glassIntensity ?? 100}">
      </label>
      <label>
        <div class="label-text">壁纸透出:<span class="surface-alpha-readout">${draft.effects.surfaceAlpha ?? 0}</span>%(0 = 看不见壁纸、100 = 页面全透明)</div>
        <input type="range" min="0" max="100" step="5" data-fx="surfaceAlpha" value="${draft.effects.surfaceAlpha ?? 0}">
      </label>

      <h3 class="section-title">渐变 / 纹理</h3>
      <label class="checkbox-row${currentWallpaper ? ' disabled-row' : ''}">
        <input type="checkbox" data-fx="gradient"${draft.effects.gradient ? ' checked' : ''}${currentWallpaper ? ' disabled' : ''}>
        <span>启用渐变背景${currentWallpaper ? ' <span class="muted-hint">已设壁纸,渐变不生效</span>' : ''}</span>
      </label>
      ${colorRow('渐变结束色', 'effects.gradientTo')}
      <label>
        <div class="label-text">纹理</div>
        <select data-fx="texture">
          ${TEXTURE_OPTIONS.map(t => `<option value="${t.id}"${t.id === draft.effects.texture ? ' selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </label>
      <label>
        <div class="label-text">聊天背景遮罩:<span class="transparency-readout">${draft.effects.transparency}</span>%</div>
        <input type="range" min="0" max="100" step="5" data-fx="transparency" value="${draft.effects.transparency}">
        <p class="hint">在聊天页,「颜色」tab 里的「页面背景」色盖在「聊天美化」设的图片上的不透明度。0% = 完全看到图片;100% = 页面背景色完全盖住图片。</p>
      </label>
    `;
  }

  function renderWallpaperTab() {
    return `
      <p class="hint">首页用的桌面壁纸 — 透明卡片小组件会衬在它上面。改了立即生效,不需要保存。</p>
      <div class="avatar-uploader wallpaper-uploader">
        <div class="avatar-preview wallpaper-preview${currentWallpaper ? '' : ' placeholder'}">
          ${currentWallpaper ? `<img src="${esc(currentWallpaper)}" alt="">` : '无'}
        </div>
        <div class="avatar-controls">
          <button type="button" class="btn secondary upload-wallpaper">上传壁纸</button>
          <button type="button" class="btn secondary clear-wallpaper"${currentWallpaper ? '' : ' disabled'}>清除</button>
          <input type="file" accept="image/*" class="wallpaper-file" hidden>
        </div>
      </div>
    `;
  }

  function colorRow(label, key) {
    const v = readKey(draft, key);
    return `
      <label class="color-row">
        <div class="label-text">${esc(label)}</div>
        <div class="color-row-controls">
          <input type="color" data-key="${esc(key)}" value="${esc(v)}">
          <input type="text"  data-key-text="${esc(key)}" value="${esc(v)}">
        </div>
      </label>
    `;
  }

  function readKey(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) cur = cur?.[p];
    return cur;
  }
  function writeKey(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function status(text, kind) {
    const el = container.querySelector('.theme-status');
    if (el) {
      el.textContent = text;
      el.className = `theme-status${kind ? ' ' + kind : ''}`;
    }
  }

  function applyDraft() { applyTheme(draft); }

  // T8: save-btn 视觉同步。render 重建 .save-btn 后,wire() 调用一次 sync;
  // onField 改 dirty=true 再 sync;save 后 dirty=false 再 sync。
  function syncSaveBtnState() {
    const btn = container.querySelector('.save-btn');
    if (!btn) return;
    if (dirty) {
      btn.classList.remove('saved');
      btn.textContent = '保存';
    } else {
      btn.classList.add('saved');
      btn.textContent = '已保存';
    }
  }

  function wire() {
    container.querySelector('.back').addEventListener('click', () => router.back());

    // Tabs
    container.querySelectorAll('.theme-tab').forEach(t => {
      t.addEventListener('click', () => {
        if (t.dataset.tab === activeTab) return;
        activeTab = t.dataset.tab;
        render();
      });
    });

    // Per-tab specific wiring
    if (activeTab === 'preset')    wirePresetTab();
    if (activeTab === 'wallpaper') wireWallpaperTab();

    // Generic field wiring — applies on any tab that contains the controls
    container.querySelectorAll('[data-key]').forEach(el => {
      el.addEventListener('input', () => onFieldChange(el));
      el.addEventListener('change', () => onFieldChange(el));
    });
    container.querySelectorAll('[data-key-text]').forEach(el => {
      el.addEventListener('input', () => onTextFieldChange(el));
    });
    container.querySelectorAll('[data-fx]').forEach(el => {
      el.addEventListener('input', () => onFxChange(el));
      el.addEventListener('change', () => onFxChange(el));
    });

    // Sticky actions — always present
    container.querySelector('.reset-btn').addEventListener('click', () => {
      draft = JSON.parse(JSON.stringify(DEFAULT_THEME));
      draft.effects = { ...DEFAULT_THEME.effects };
      applyDraft();
      dirty = true;
      render();
      status('已重置为默认(还没保存)', 'success');
    });
    container.querySelector('.save-btn').addEventListener('click', async () => {
      await db.updateSettings(s => { s.theme = draft; });
      saved = true;
      dirty = false;
      status('已保存', 'success');
      syncSaveBtnState();
    });
    syncSaveBtnState();
  }

  function wirePresetTab() {
    const picker = container.querySelector('.preset-picker');
    if (!picker) return;
    picker.addEventListener('click', async (e) => {
      // Save current draft as a new user preset — uses openModal so the
      // input flow matches the rest of the app's in-frame modals (no
      // browser prompt() that breaks the phone-frame illusion).
      if (e.target.closest('.preset-save-current')) {
        const result = await openModal(container, {
          title: '存为预设',
          fields: [{ name: 'name', label: '名字', kind: 'text', required: true, default: '我的主题' }],
          submitLabel: '存',
        });
        if (!result) return;
        const name = String(result.name || '').trim();
        if (!name) return;
        const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        userPresets.push({
          id, label: name,
          theme: JSON.parse(JSON.stringify({ ...draft, effects: { ...draft.effects } })),
        });
        await persistUserPresets();
        render();
        status(`已存为预设「${name}」`, 'success');
        return;
      }
      // Delete a user preset (only user-added ones expose a delete button)
      const delBtn = e.target.closest('.preset-delete');
      if (delBtn) {
        e.stopPropagation();
        const wrap = delBtn.closest('[data-preset-id]');
        const pid = wrap?.dataset.presetId;
        const p = userPresets.find(x => x.id === pid);
        if (!p) return;
        if (!await openConfirm(container, {
          title: '删除预设',
          message: `删除预设「${p.label}」?`,
          confirmLabel: '删除',
          danger: true,
        })) return;
        userPresets = userPresets.filter(x => x.id !== pid);
        await persistUserPresets();
        render();
        return;
      }
      // Apply a preset.
      // 之前会 render() 重建整个面板。问题:render() 重建 .preset-picker 的
      // DOM,触屏 :hover 状态在新 DOM 上看起来落在错的 chip 上(用户报的
      // "先 highlight 蓝灰衬线,再点一次正常"),而且 scroll position 被
      // 重置。修法:不 re-render。applyDraft 写 :root CSS vars,mini-preview
      // 和 phone-frame 都直接联动。color/font 等其他 tab 的 input 值要等到
      // user 切到那个 tab 时下次 render 才更新 — 可接受,user 切 preset 后
      // 一般继续在 preset tab 看效果,不会立刻切到 color tab。
      const wrap = e.target.closest('[data-preset-id]');
      if (!wrap) return;
      const p = allPresets().find(x => x.id === wrap.dataset.presetId);
      if (!p) return;
      draft = JSON.parse(JSON.stringify(p.theme));
      draft.effects = { ...p.theme.effects };
      applyDraft();
      // T22: 套用 preset 后必须 flip dirty + sync saveBtn,否则 status 文本
      //   写「还没保存」但 saveBtn 仍显「已保存」灰扁,user 困惑。
      dirty = true;
      syncSaveBtnState();
      status(`已套用「${p.label}」(还没保存)`, 'success');
    });
  }

  function wireWallpaperTab() {
    const uploadBtn = container.querySelector('.upload-wallpaper');
    const clearBtn  = container.querySelector('.clear-wallpaper');
    const fileEl    = container.querySelector('.wallpaper-file');
    if (!uploadBtn || !clearBtn || !fileEl) return;
    uploadBtn.addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', () => {
      const file = fileEl.files?.[0];
      fileEl.value = '';
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        status(`图片太大(${(file.size/1024/1024).toFixed(1)} MB),建议 < 5 MB`, 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        currentWallpaper = reader.result;
        // 如果 surfaceAlpha 还是 0(默认),自动把 .page 调成半透明 —— 否则
        // user 上传壁纸后,只有 home(.page.home transparent 已经特判)能
        // 看到壁纸,其他 page(settings / chat-list 等)的 .page bg 不透明
        // 完全盖住壁纸,user 会觉得"上传完外观下面看不到壁纸,点进 app
        // 也没壁纸"。30% 是一个温和的默认,文字仍然可读、壁纸隐约透出。
        const currentAlpha = draft?.effects?.surfaceAlpha ?? 0;
        const autoBumped = currentAlpha < 20;
        if (autoBumped) {
          if (!draft.effects) draft.effects = {};
          draft.effects.surfaceAlpha = 30;
        }
        await db.updateSettings(s => {
          s.wallpaper = currentWallpaper;
          if (autoBumped) {
            if (!s.theme) s.theme = {};
            if (!s.theme.effects) s.theme.effects = {};
            s.theme.effects.surfaceAlpha = 30;
          }
        });
        // Apply now so the gradient mutex (body[data-fx-wallpaper]) kicks
        // in immediately + the new surfaceAlpha shows in main view.
        applyWallpaper(currentWallpaper);
        applyTheme(draft);
        render();
        status(autoBumped
          ? '壁纸已保存。已自动把「壁纸透出」调到 30%,所有 app 都能透出壁纸'
          : '壁纸已保存(回首页查看)', 'success');
      };
      reader.onerror = () => status('读取图片失败', 'error');
      reader.readAsDataURL(file);
    });
    clearBtn.addEventListener('click', async () => {
      currentWallpaper = null;
      await db.updateSettings(s => { s.wallpaper = null; });
      applyWallpaper(null);
      render();
      status('壁纸已清除', 'success');
    });
  }

  function onFieldChange(el) {
    const key = el.dataset.key;
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.type === 'range' || el.type === 'number') val = Number(el.value);
    else val = el.value;
    writeKey(draft, key, val);
    // Mirror color → text companion
    const text = container.querySelector(`[data-key-text="${cssEscape(key)}"]`);
    if (text && el.type === 'color') text.value = val;
    // Mirror live readouts (no need to re-render the whole tab)
    if (key === 'fontSize') {
      const r = container.querySelector('.font-size-readout');
      if (r) r.textContent = val;
    }
    if (key === 'radius') {
      const r = container.querySelector('.radius-readout');
      if (r) r.textContent = val;
    }
    if (key === 'fontFamily') {
      const block = container.querySelector('.custom-font-block');
      if (block) block.hidden = (val !== 'custom');
    }
    applyDraft();
    dirty = true;
    syncSaveBtnState();
  }
  function onTextFieldChange(el) {
    const key = el.dataset.keyText;
    const v = el.value.trim();
    if (!/^#[0-9a-fA-F]{3,8}$/.test(v)) return;  // invalid hex — wait for next keystroke
    writeKey(draft, key, v);
    const colorInput = container.querySelector(`[data-key="${cssEscape(key)}"]`);
    if (colorInput) colorInput.value = v;
    applyDraft();
    dirty = true;
    syncSaveBtnState();
  }
  function onFxChange(el) {
    const key = `effects.${el.dataset.fx}`;
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.type === 'range' || el.type === 'number') val = Number(el.value);
    else val = el.value;
    writeKey(draft, key, val);
    // Live-update the numeric readouts so the user sees the % follow the slider
    // without waiting for a re-render.
    if (el.dataset.fx === 'transparency') {
      const r = container.querySelector('.transparency-readout');
      if (r) r.textContent = val;
    }
    if (el.dataset.fx === 'glassIntensity') {
      const r = container.querySelector('.glass-intensity-readout');
      if (r) r.textContent = val;
    }
    if (el.dataset.fx === 'surfaceAlpha') {
      const r = container.querySelector('.surface-alpha-readout');
      if (r) r.textContent = val;
    }
    applyDraft();
    dirty = true;
    syncSaveBtnState();
  }

  render();

  // Teardown: if user navigates away without saving, revert to the stored
  // (pre-edit) theme so unsaved tweaks don't leak.
  return () => {
    if (!saved) applyTheme(original);
  };
}

// CSS.escape would be ideal, but selector strings only have alphanumeric +
// '.' + '_' here (e.g. "effects.gradientTo"). Escape '.' so QSA matches.
function cssEscape(s) {
  return s.replace(/\./g, '\\.');
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
