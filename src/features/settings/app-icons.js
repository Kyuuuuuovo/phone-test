// app 图标管理 — picker(emoji / 文字 / 本地图片 / 图床 URL)+ 列表页。
//
// override 数据:settings.appIconOverrides[appId] = { kind, value }
//   - kind: 'emoji' | 'text' | 'image' | 'url'
//   - emoji.value: emoji 字符串(单 / 双 codepoint,如 '🐱' '📚')
//   - text.value:  短字符串(2-4 字,UI 会做长度提示但不强制截)
//   - image.value: base64 dataurl(本地上传)
//   - url.value:   http(s):// URL(图床外链,不下载,直接 <img src>)
//
// home.js 的 tileHtml 渲染时按 kind 分支:
//   image / url → <img class="icon-img">
//   emoji       → <span class="icon-emoji">
//   text        → <span class="icon-text">
// 没 override 的 fallback 默认 SVG。

import * as db from '../../core/db.js';
import { openAlert } from '../../core/modal.js';

export const ICON_EMOJI_PRESETS = ['📞', '📷', '📌', '🎵', '💌', '☕', '📖', '🐱', '🌸', '🎮', '🎨', '📚'];

const MAX_TEXT_LEN = 4;
const MAX_UPLOAD_MB = 1;

function escHtml(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function pickImageFile(maxMB = MAX_UPLOAD_MB) {
  const file = await new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
  if (!file) return null;
  if (file.size > maxMB * 1024 * 1024) {
    await openAlert(document.body, {
      title: '图片太大',
      message: `${(file.size/1024/1024).toFixed(1)} MB,建议 < ${maxMB} MB(app icon 显示在 60-80px,大图浪费 IDB)。`,
      danger: true,
    });
    return null;
  }
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

// 写 override 到 IDB。null = 删 override(恢复默认)。
async function applyOverride(appId, override) {
  await db.updateSettings(s => {
    if (!s.appIconOverrides || typeof s.appIconOverrides !== 'object') s.appIconOverrides = {};
    if (override === null) delete s.appIconOverrides[appId];
    else s.appIconOverrides[appId] = override;
  });
}

// 当前 override 的预览(用在 picker 顶部、列表行右侧),给 user 看现在选了啥。
function renderCurrentPreview(override) {
  if (!override) return `<span class="icon-current-tag default">默认</span>`;
  if (override.kind === 'emoji') return `<span class="icon-current-emoji">${escHtml(override.value || '')}</span>`;
  if (override.kind === 'text')  return `<span class="icon-current-text">${escHtml(override.value || '')}</span>`;
  if (override.kind === 'image' || override.kind === 'url') {
    return `<img class="icon-current-img" src="${escAttr(override.value)}" alt="">`;
  }
  return `<span class="icon-current-tag">?</span>`;
}

// 打开 picker modal。container 用于 append modal;appId 决定写入哪个 app 的
// override;onChanged 在 user 选完任何一种(包括恢复默认)后调,让 caller
// 触发 re-render(home re-mount 或 settings-app-icons 列表 refresh)。
export async function openIconPicker(container, appId, onChanged) {
  const settings = (await db.get('settings', 'default')) || {};
  const current = settings.appIconOverrides?.[appId] || null;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">改图标 · ${escHtml(appId)}</div>
      <div class="icon-picker">
        <div class="icon-picker-section">
          <div class="label-text">当前</div>
          <div class="icon-picker-current">${renderCurrentPreview(current)}</div>
        </div>

        <div class="icon-picker-section">
          <div class="label-text">预设 emoji(点一个立即应用)</div>
          <div class="icon-picker-emoji-grid">
            ${ICON_EMOJI_PRESETS.map(e => `
              <button type="button" class="icon-picker-emoji${current?.kind === 'emoji' && current.value === e ? ' active' : ''}" data-emoji="${escAttr(e)}">${escHtml(e)}</button>
            `).join('')}
          </div>
        </div>

        <div class="icon-picker-section">
          <div class="label-text">文字 / 单个 emoji(最多 ${MAX_TEXT_LEN} 字,比如「角色」/「📓」)</div>
          <div class="icon-picker-input-row">
            <input type="text" class="icon-picker-text-input" maxlength="${MAX_TEXT_LEN * 2}" placeholder="角色" value="${current?.kind === 'text' ? escAttr(current.value) : ''}">
            <button type="button" class="btn secondary apply-text">应用</button>
          </div>
        </div>

        <div class="icon-picker-section">
          <div class="label-text">本地图片(建议正方形 PNG,< ${MAX_UPLOAD_MB} MB)</div>
          <button type="button" class="btn secondary upload-icon">从相册选一张</button>
        </div>

        <div class="icon-picker-section">
          <div class="label-text">图床 URL(粘贴 https:// 直链,不下载本地)</div>
          <div class="icon-picker-input-row">
            <input type="url" class="icon-picker-url-input" placeholder="https://i.imgur.com/xxx.png" value="${current?.kind === 'url' ? escAttr(current.value) : ''}">
            <button type="button" class="btn secondary apply-url">应用</button>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary cancel-btn">取消</button>
        <button type="button" class="btn secondary reset-btn"${current ? '' : ' disabled'}>恢复默认</button>
      </div>
    </div>
  `;
  container.appendChild(modal);

  const close = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('.cancel-btn').addEventListener('click', close);

  async function commit(override) {
    await applyOverride(appId, override);
    close();
    onChanged?.();
  }

  modal.querySelector('.reset-btn').addEventListener('click', () => commit(null));

  modal.querySelectorAll('.icon-picker-emoji').forEach(btn => {
    btn.addEventListener('click', () => commit({ kind: 'emoji', value: btn.dataset.emoji }));
  });

  modal.querySelector('.apply-text').addEventListener('click', async () => {
    const input = modal.querySelector('.icon-picker-text-input');
    const v = String(input.value || '').trim();
    if (!v) {
      await openAlert(document.body, { title: '文字不能为空', message: '输入 1-4 个字再点应用。' });
      return;
    }
    // 用 Array.from 数 grapheme 大致量(emoji 是多 codepoint 不能用 .length)。
    // 超 MAX_TEXT_LEN * 2 (在 input maxlength 限了)且 Array.from 也太长就拒。
    if (Array.from(v).length > MAX_TEXT_LEN + 2) {
      await openAlert(document.body, { title: '文字太长', message: `最多 ${MAX_TEXT_LEN} 字左右,长了会被压扁。` });
      return;
    }
    await commit({ kind: 'text', value: v });
  });

  modal.querySelector('.upload-icon').addEventListener('click', async () => {
    const data = await pickImageFile();
    if (!data) return;
    await commit({ kind: 'image', value: data });
  });

  modal.querySelector('.apply-url').addEventListener('click', async () => {
    const input = modal.querySelector('.icon-picker-url-input');
    const v = String(input.value || '').trim();
    if (!v) {
      await openAlert(document.body, { title: 'URL 不能为空', message: '粘贴一个 https:// 开头的图片直链。' });
      return;
    }
    if (!/^https?:\/\//i.test(v)) {
      await openAlert(document.body, { title: 'URL 格式不对', message: '要 http:// 或 https:// 开头的直链。' });
      return;
    }
    await commit({ kind: 'url', value: v });
  });
}

// 设置 → app 图标 列表页 — 每行一个 app,点行打开 picker。
// PAGES + DOCK_CATALOG 是 home.js 的常量,这里通过 home.js export 拿。
// 列表渲染纯文本 + 当前 override 预览(没 override 时显示「默认」标签)。
export async function mountAppIcons(container, params, router) {
  // 动态 import 避免循环依赖(home.js 也会反过来 import 这个 module)
  const { APP_REGISTRY } = await import('../home/home.js');

  async function refresh() {
    const settings = (await db.get('settings', 'default')) || {};
    const overrides = settings.appIconOverrides || {};

    container.innerHTML = `
      <div class="page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">app 图标</div>
        </header>
        <div class="page-body">
          <div class="settings-hint">点任意一项改它的图标,可以用 emoji / 文字 / 本地图片 / 图床 URL。</div>
          <div class="settings-list app-icons-list">
            ${APP_REGISTRY.map(t => {
              const ov = overrides[t.id];
              return `
                <button class="settings-item app-icon-row" data-app-id="${escAttr(t.id)}">
                  <span class="app-icon-row-name">${escHtml(t.label)}</span>
                  <span class="app-icon-row-preview">${renderCurrentPreview(ov)}</span>
                  <span class="settings-chevron">›</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  await refresh();

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    const row = e.target.closest('.app-icon-row');
    if (!row) return;
    const appId = row.dataset.appId;
    if (!appId) return;
    await openIconPicker(container, appId, refresh);
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}
