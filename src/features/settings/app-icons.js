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
import { applyAppIconStyle } from '../../core/theme.js';

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
//
// 顶部还有一段「全局风格」(透明度 / 圆角 / 倾斜)— 所有 app icon 一并生效,
//   写 settings.appIconStyle。slider 拖动时实时 applyAppIconStyle 让 :root
//   CSS var 同步,顶部 mini preview 立刻反映效果。保存按钮把 draft 落盘。
//   离开页面没保存就走回路由,预览效果还在(因为 :root vars 已经设了)— 但
//   reload 后会从 IDB 重新读 settings 应用,所以未保存的改动会丢。这个权衡:
//   不强制 save 防止 user 改了忘按按钮,但也不 auto save 防止误调一档子又
//   不想要。提示文案明示了。
export async function mountAppIcons(container, params, router) {
  // 动态 import 避免循环依赖(home.js 也会反过来 import 这个 module)
  const { APP_REGISTRY } = await import('../home/home.js');

  function renderMiniPreviewIcons() {
    // 3 个示例 app icon — emoji 表示内容(实际生效的是全局风格,内容只是
    //   占位让 user 看出"还是 app icon")。复用 .app-icon 现有 CSS。
    const samples = [
      { id: 'preview-1', label: '电话', emoji: '📞' },
      { id: 'preview-2', label: '日记', emoji: '📓' },
      { id: 'preview-3', label: '相册', emoji: '🖼' },
    ];
    return samples.map(s => `
      <button class="app-icon" tabindex="-1">
        <div class="icon"><span class="icon-emoji">${escHtml(s.emoji)}</span></div>
        <div class="label">${escHtml(s.label)}</div>
      </button>
    `).join('');
  }

  async function refresh() {
    const settings = (await db.get('settings', 'default')) || {};
    const overrides = settings.appIconOverrides || {};
    const style = settings.appIconStyle || {};
    // form 默认:transparency=100、radius 留空(跟主题默认)、tilt=0
    const fTransparency = Number.isFinite(style.transparency) ? style.transparency : 100;
    const fRadius = Number.isFinite(style.radius) ? style.radius : '';
    const fTilt = Number.isFinite(style.tilt) ? style.tilt : 0;

    container.innerHTML = `
      <div class="page app-icons-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">app 图标</div>
        </header>
        <div class="page-body">
          <h3 class="settings-section-title">全局风格</h3>
          <div class="settings-hint">下面拖动会即时反映在预览里,点保存才落盘。离开页面 reload 后未保存的会丢。</div>
          <div class="app-icon-preview">
            <span class="preview-label">预览</span>
            ${renderMiniPreviewIcons()}
          </div>
          <form class="app-icon-style-form" autocomplete="off">
            <label>
              <div class="label-text">透明度:<span class="readout-transparency">${fTransparency}</span>%</div>
              <input type="range" min="0" max="100" step="5" name="transparency" value="${fTransparency}">
            </label>
            <label>
              <div class="label-text">圆角(px,最左 = 跟主题):<span class="readout-radius">${fRadius === '' ? '跟主题' : fRadius + ' px'}</span></div>
              <input type="range" min="-1" max="40" step="1" name="radius" value="${fRadius === '' ? -1 : fRadius}">
            </label>
            <label>
              <div class="label-text">倾斜:<span class="readout-tilt">${fTilt}</span>°</div>
              <input type="range" min="-30" max="30" step="1" name="tilt" value="${fTilt}">
            </label>
            <div class="form-actions">
              <button type="button" class="btn secondary reset-style">恢复默认</button>
              <button type="submit" class="btn">保存</button>
            </div>
            <div class="form-status"></div>
          </form>

          <h3 class="settings-section-title">单个 app 图标</h3>
          <div class="settings-hint">点任意一项改它的图标内容(emoji / 文字 / 本地图片 / 图床 URL)。风格(透明度/圆角/倾斜)上面统一控制。</div>
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

    // form 元素引用 + readout 实时同步 + applyAppIconStyle 即时预览
    const form = container.querySelector('.app-icon-style-form');
    const transInput = form.querySelector('[name=transparency]');
    const radiusInput = form.querySelector('[name=radius]');
    const tiltInput = form.querySelector('[name=tilt]');
    const transReadout = form.querySelector('.readout-transparency');
    const radiusReadout = form.querySelector('.readout-radius');
    const tiltReadout = form.querySelector('.readout-tilt');
    const status = form.querySelector('.form-status');

    function liveApply() {
      const transN = parseInt(transInput.value, 10);
      const radiusN = parseInt(radiusInput.value, 10);
      const tiltN = parseInt(tiltInput.value, 10) || 0;
      const draftStyle = {
        transparency: Number.isFinite(transN) ? transN : 100,
        radius: Number.isFinite(radiusN) && radiusN >= 0 ? radiusN : undefined,
        tilt: tiltN,
      };
      applyAppIconStyle(draftStyle);
      transReadout.textContent = String(draftStyle.transparency);
      radiusReadout.textContent = draftStyle.radius == null ? '跟主题' : draftStyle.radius + ' px';
      tiltReadout.textContent = String(draftStyle.tilt);
    }
    form.addEventListener('input', liveApply);
    // 初次也跑一次 — 保证 readout 跟当前 setting 一致(尤其 radius=-1 → 跟主题)
    liveApply();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const transN = parseInt(transInput.value, 10) || 100;
      const radiusN = parseInt(radiusInput.value, 10);
      const tiltN = parseInt(tiltInput.value, 10) || 0;
      const newStyle = {};
      if (Number.isFinite(transN) && transN >= 0 && transN < 100) newStyle.transparency = transN;
      if (Number.isFinite(radiusN) && radiusN >= 0) newStyle.radius = radiusN;
      if (tiltN !== 0) newStyle.tilt = tiltN;
      await db.updateSettings(s => {
        if (Object.keys(newStyle).length > 0) s.appIconStyle = newStyle;
        else delete s.appIconStyle;
      });
      applyAppIconStyle(newStyle);
      status.textContent = '已保存';
      status.className = 'form-status success';
    });

    form.querySelector('.reset-style').addEventListener('click', async () => {
      transInput.value = '100';
      radiusInput.value = '-1';
      tiltInput.value = '0';
      liveApply();
      await db.updateSettings(s => { delete s.appIconStyle; });
      status.textContent = '已恢复默认';
      status.className = 'form-status success';
    });
  }

  await refresh();

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    // form 内的 click(slider / button)交给 form handler,不进 picker
    if (e.target.closest('.app-icon-style-form')) return;
    const row = e.target.closest('.app-icon-row');
    if (!row) return;
    const appId = row.dataset.appId;
    if (!appId) return;
    await openIconPicker(container, appId, refresh);
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}
