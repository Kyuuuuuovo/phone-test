// 「我」tab — entry hub for player-facing settings & data.
// Hosts:
//   • 顶部 profile card with the active persona's name / avatar
//     (点击头像可换图,直接 patch persona.avatar — 写回 personas store)
//   • 钱包 / 当前人设 / 收藏 入口
//   • #49: 头像可换 — 点头像触发 file picker → base64 → persona.avatar update。
//     no active persona 时,提示 user 先去选 / 创建一个 persona。

import * as db from '../../core/db.js';
import { openAlert } from '../../core/modal.js';

export async function mountMe(container, params, router) {
  const settings = (await db.get('settings', 'default')) || {};
  const activePersonaId = settings.activePersonaId || null;
  const persona = activePersonaId ? await db.get('personas', activePersonaId) : null;
  const wallet = (await db.get('wallet', 'default')) || { balance: 0 };
  const favorites = await db.getAll('favorites');

  container.innerHTML = `
    <div class="me-body">
      <div class="me-profile">
        <div class="me-avatar-wrap" role="button" tabindex="0" aria-label="${persona ? '换头像' : '先去当前人设创建/选一个 persona'}">
          ${renderAvatar(persona)}
          ${persona ? '<div class="me-avatar-edit-badge" aria-hidden="true">换</div>' : ''}
        </div>
        <div class="me-profile-text">
          <div class="me-name">${esc(persona?.name || '未设置人设')}</div>
          <div class="me-sub">${esc((persona?.persona || '').slice(0, 40)) || '点「当前人设」选一个'}</div>
        </div>
      </div>

      <div class="settings-list me-list">
        <button class="settings-item" data-target="wallet">
          <span class="settings-label">钱包</span>
          <span class="me-row-value">¥${Number(wallet.balance || 0).toFixed(2)}</span>
          <span class="settings-chevron">›</span>
        </button>
        <button class="settings-item" data-target="persona-pick">
          <span class="settings-label">当前人设</span>
          <span class="me-row-value">${esc(persona?.name || '未设置')}</span>
          <span class="settings-chevron">›</span>
        </button>
        <button class="settings-item" data-target="favorites-list">
          <span class="settings-label">收藏</span>
          <span class="me-row-value">${favorites.length} 条</span>
          <span class="settings-chevron">›</span>
        </button>
      </div>
    </div>
  `;

  const avatarWrap = container.querySelector('.me-avatar-wrap');

  async function pickAndSaveAvatar() {
    if (!persona) {
      await openAlert(container, {
        title: '先选个人设',
        message: '当前没有 active persona — 点「当前人设」选一个或新建一个再换头像。',
      });
      return;
    }
    const file = await new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      await openAlert(container, {
        title: '图片太大',
        message: `${(file.size/1024/1024).toFixed(1)} MB,建议 < 2 MB(头像 60px 圆,大图浪费 IDB)。`,
        danger: true,
      });
      return;
    }
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    persona.avatar = dataUrl;
    persona.updatedAt = Date.now();
    await db.set('personas', persona);
    // 重新渲染头像区域(不重 mount 整个 me tab,避免闪烁)
    const newAvatar = renderAvatar(persona);
    avatarWrap.querySelector('.me-avatar')?.outerHTML && (avatarWrap.innerHTML = newAvatar + '<div class="me-avatar-edit-badge" aria-hidden="true">换</div>');
  }

  const onClick = (e) => {
    if (e.target.closest('.me-avatar-wrap')) {
      pickAndSaveAvatar();
      return;
    }
    const item = e.target.closest('[data-target]');
    if (!item) return;
    router.navigate(item.dataset.target);
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}

function renderAvatar(p) {
  if (p?.avatar) {
    return `<div class="me-avatar"><img src="${esc(p.avatar)}" alt=""></div>`;
  }
  const initial = (p?.name ?? '我').slice(0, 1);
  return `<div class="me-avatar">${esc(initial)}</div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
