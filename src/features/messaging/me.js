// 「我」tab — entry hub for player-facing settings & data.
// Hosts:
//   • 顶部 profile card with the active persona's name / avatar
//   • 钱包 row → wallet page (balance + transactions)
//   • 当前人设 row → persona picker page
//   • 收藏 row → favorites list
//   • 记忆 row → could later show cross-session memory index (deferred)

import * as db from '../../core/db.js';

export async function mountMe(container, params, router) {
  const settings = (await db.get('settings', 'default')) || {};
  const activePersonaId = settings.activePersonaId || null;
  const persona = activePersonaId ? await db.get('personas', activePersonaId) : null;
  const wallet = (await db.get('wallet', 'default')) || { balance: 0 };
  const favorites = await db.getAll('favorites');

  container.innerHTML = `
    <div class="me-body">
      <div class="me-profile">
        ${renderAvatar(persona)}
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

  const onClick = (e) => {
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
