// Theme editor. Tweaks the single active theme stored in settings.theme.
// Real-time preview: every input change calls applyTheme(draft) which writes
// CSS variables onto :root — so the whole phone-frame (including this very
// editor page) updates instantly. Plus a small inline preview card shows
// chat bubbles so users can judge the chat look without leaving the page.

import * as db from '../../core/db.js';
import { openConfirm } from '../../core/modal.js';
import {
  DEFAULT_THEME, FONT_OPTIONS, TEXTURE_OPTIONS, GLASS_OPTIONS, THEME_PRESETS,
  normalizeTheme, applyTheme,
} from '../../core/theme.js';

export async function mountTheme(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  let draft = normalizeTheme(settings.theme);
  const original = JSON.parse(JSON.stringify(draft));  // committed-on-disk snapshot
  let saved = false;
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
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    s.themePresets = userPresets;
    await db.set('settings', s);
  }

  function render() {
    container.innerHTML = `
      <div class="page theme-editor-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">外观</div>
          <div class="actions">
            <button class="btn reset-btn" title="重置为默认">重置</button>
          </div>
        </header>
        <div class="page-body">
          <div class="theme-preview">
            <div class="theme-preview-bubble char">嗨,在吗?</div>
            <div class="theme-preview-bubble user">在</div>
            <div class="theme-preview-bubble char">忙完啦 (･ω･)</div>
            <div class="theme-preview-bubble user">那来聊一下今天的事</div>
            <div class="theme-preview-meta">实时预览 · 顶部状态栏 / 聊天列表 / 设置 都会跟着变</div>
          </div>

          <h3 class="section-title">预设</h3>
          <div class="preset-picker preset-scroll">
            ${allPresets().map(p => `
              <div class="preset-chip-wrap" data-preset-id="${esc(p.id)}">
                <button type="button" class="model-chip preset-chip">${esc(p.label)}</button>
                ${p.builtin ? '' : `<button type="button" class="preset-delete" title="删除这个预设">×</button>`}
              </div>
            `).join('')}
            <button type="button" class="model-chip preset-save-current" title="把当前主题存成预设">+ 存为预设</button>
          </div>

          <h3 class="section-title">外形</h3>
          <label class="checkbox-row">
            <input type="checkbox" data-key="notch"${draft.notch ? ' checked' : ''}>
            <span>启用 iPhone 刘海(顶部黑条 + 圆角外壳)</span>
          </label>
          <label>
            <div class="label-text">圆角:<span class="radius-readout">${draft.radius}</span> px(气泡 / 卡片 / 按钮的圆角程度)</div>
            <input type="range" min="0" max="20" step="1" data-key="radius" value="${draft.radius}">
          </label>

          <div class="label-text">桌面壁纸(只在首页 — 透明卡片小组件的衬底)</div>
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

          <h3 class="section-title">字体</h3>
          <label>
            <div class="label-text">字体族</div>
            <select data-key="fontFamily">
              ${FONT_OPTIONS.map(f => `<option value="${f.id}"${f.id === draft.fontFamily ? ' selected' : ''}>${f.label}</option>`).join('')}
            </select>
          </label>
          <div class="custom-font-block"${draft.fontFamily === 'custom' ? '' : ' hidden'}>
            <label>
              <div class="label-text">font-family(可填多个,逗号分隔。例:<code>"Crimson Pro", "Noto Serif SC", serif</code>)</div>
              <input type="text" data-key="customFontFamily" value="${esc(draft.customFontFamily)}" placeholder='"My Font", serif'>
            </label>
            <label>
              <div class="label-text">@import URL(可选 · 如 Google Fonts 的 css 链接,留空表示字体已系统安装)</div>
              <input type="text" data-key="customFontImportUrl" value="${esc(draft.customFontImportUrl)}" placeholder="https://fonts.googleapis.com/css2?family=...">
            </label>
          </div>
          <label>
            <div class="label-text">字号:<span class="font-size-readout">${draft.fontSize}</span> px</div>
            <input type="range" min="12" max="20" step="1" data-key="fontSize" value="${draft.fontSize}">
          </label>

          <h3 class="section-title">颜色</h3>
          ${colorRow('强调色 / 按钮 / 链接', 'accent')}
          ${colorRow('页面背景', 'bg')}
          ${colorRow('卡片 / 列表底色', 'surface')}
          ${colorRow('正文文字', 'fg')}
          ${colorRow('次要文字', 'muted')}
          ${colorRow('分割线 / 边框', 'border')}
          ${colorRow('外壳底色(手机框外)', 'outsideBg')}
          ${colorRow('置顶项底色', 'bgPinned')}
          <div class="color-pair">
            ${colorRow('我的气泡 · 背景', 'bubbleUser')}
            ${colorRow('我的气泡 · 文字', 'bubbleUserFg')}
          </div>
          <div class="color-pair">
            ${colorRow('对方气泡 · 背景', 'bubbleChar')}
            ${colorRow('对方气泡 · 文字', 'bubbleCharFg')}
          </div>

          <h3 class="section-title">特效</h3>
          <label>
            <div class="label-text">玻璃质感</div>
            <select data-fx="glass">
              ${GLASS_OPTIONS.map(g => `<option value="${g.id}"${g.id === draft.effects.glass ? ' selected' : ''}>${g.label}</option>`).join('')}
            </select>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" data-fx="gradient"${draft.effects.gradient ? ' checked' : ''}>
            <span>渐变背景</span>
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
            <p class="hint">在聊天页,主题背景色叠加到「聊天美化」里设的图片上的不透明度。0% = 完全看到图片;100% = 完全盖住。</p>
          </label>

          <div class="form-actions">
            <button type="button" class="btn save-btn">保存</button>
          </div>
          <div class="form-status"></div>
        </div>
      </div>
    `;
    wire();
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
    const el = container.querySelector('.form-status');
    if (el) {
      el.textContent = text;
      el.className = `form-status${kind ? ' ' + kind : ''}`;
    }
  }

  function applyDraft() { applyTheme(draft); }

  function wire() {
    container.querySelector('.back').addEventListener('click', () => router.back());
    // Wallpaper uploader — separate from the theme object; writes
    // settings.wallpaper directly and immediately (no save button needed).
    const uploadWallpaperBtn = container.querySelector('.upload-wallpaper');
    const clearWallpaperBtn  = container.querySelector('.clear-wallpaper');
    const wallpaperFile      = container.querySelector('.wallpaper-file');
    uploadWallpaperBtn.addEventListener('click', () => wallpaperFile.click());
    wallpaperFile.addEventListener('change', () => {
      const file = wallpaperFile.files?.[0];
      wallpaperFile.value = '';
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        status(`图片太大(${(file.size/1024/1024).toFixed(1)} MB),建议 < 5 MB`, 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        currentWallpaper = reader.result;
        const s = (await db.get('settings', 'default')) || { id: 'default' };
        s.wallpaper = currentWallpaper;
        await db.set('settings', s);
        render();
        status('壁纸已保存(回首页查看)', 'success');
      };
      reader.onerror = () => status('读取图片失败', 'error');
      reader.readAsDataURL(file);
    });
    clearWallpaperBtn.addEventListener('click', async () => {
      currentWallpaper = null;
      const s = (await db.get('settings', 'default')) || { id: 'default' };
      s.wallpaper = null;
      await db.set('settings', s);
      render();
      status('壁纸已清除', 'success');
    });

    container.querySelector('.preset-picker').addEventListener('click', async (e) => {
      // Save current draft as a new user preset.
      if (e.target.closest('.preset-save-current')) {
        const name = prompt('给这套主题起个名字:', '我的主题');
        if (!name) return;
        const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        userPresets.push({
          id, label: name.trim(),
          theme: JSON.parse(JSON.stringify({ ...draft, effects: { ...draft.effects } })),
        });
        await persistUserPresets();
        render();
        status(`已存为预设「${name.trim()}」`, 'success');
        return;
      }
      // Delete a user preset (only user-added ones have a delete button).
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
      const wrap = e.target.closest('[data-preset-id]');
      if (!wrap) return;
      const p = allPresets().find(x => x.id === wrap.dataset.presetId);
      if (!p) return;
      draft = JSON.parse(JSON.stringify(p.theme));
      draft.effects = { ...p.theme.effects };
      applyDraft();
      render();
      status(`已套用「${p.label}」(还没保存)`, 'success');
    });
    container.querySelector('.reset-btn').addEventListener('click', () => {
      draft = JSON.parse(JSON.stringify(DEFAULT_THEME));
      draft.effects = { ...DEFAULT_THEME.effects };
      applyDraft();
      render();
      status('已重置为默认(还没保存)', 'success');
    });
    container.querySelector('.save-btn').addEventListener('click', async () => {
      const s = (await db.get('settings', 'default')) || { id: 'default' };
      s.theme = draft;
      await db.set('settings', s);
      // Commit: future teardown should not roll back, since draft IS the saved state.
      saved = true;
      status('已保存', 'success');
    });

    // Color pickers — keep paired text input in sync, write to draft live.
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
    // Mirror readouts
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
  }
  function onTextFieldChange(el) {
    const key = el.dataset.keyText;
    const v = el.value.trim();
    if (!/^#[0-9a-fA-F]{3,8}$/.test(v)) return;  // invalid hex — wait for next keystroke
    writeKey(draft, key, v);
    const colorInput = container.querySelector(`[data-key="${cssEscape(key)}"]`);
    if (colorInput) colorInput.value = v;
    applyDraft();
  }
  function onFxChange(el) {
    const key = `effects.${el.dataset.fx}`;
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.type === 'range' || el.type === 'number') val = Number(el.value);
    else val = el.value;
    writeKey(draft, key, val);
    if (el.dataset.fx === 'transparency') {
      const r = container.querySelector('.transparency-readout');
      if (r) r.textContent = val;
    }
    applyDraft();
  }

  render();

  // Teardown: if user navigates away without saving, revert to the stored
  // (pre-edit) theme so unsaved tweaks don't leak. If they hit 保存, the saved
  // theme === draft, so we leave the live application as-is.
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
