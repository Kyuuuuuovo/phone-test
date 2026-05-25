// Character list. Active chars first (by updatedAt desc), blocked at the bottom.

import * as db from '../../core/db.js';

export async function mountCharacterList(container, params, router) {
  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">角色</div>
        <div class="actions">
          <button class="new-entity" title="新建角色">+</button>
        </div>
      </header>
      <div class="page-body entity-list-body"></div>
    </div>
  `;

  const body = container.querySelector('.entity-list-body');

  async function renderList() {
    const all = await db.getAll('characters');
    // Hide reserved system characters (e.g. __bear__ for the desk pet).
    // They're managed via 设置 → 桌宠 instead.
    const chars = all.filter(c => c.id !== '__bear__');
    chars.sort((a, b) => {
      if (!!a.blocked !== !!b.blocked) return a.blocked ? 1 : -1;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
    const sessions = await db.getAll('chatSessions');
    const sessCount = new Map();
    for (const s of sessions) sessCount.set(s.characterId, (sessCount.get(s.characterId) ?? 0) + 1);

    if (chars.length === 0) {
      body.innerHTML = `<div class="empty-state">还没有角色<br>点右上角 + 新建一个</div>`;
      return;
    }
    body.innerHTML = `
      <div class="entity-list">
        ${chars.map(c => {
          const blocked = c.blocked ? ' blocked' : '';
          const sub = (c.persona || '').slice(0, 60) || '(没有人设描述)';
          const meta = [
            sessCount.get(c.id) ? `${sessCount.get(c.id)} 个对话` : '',
            c.blocked ? '<span class="blocked-badge">已拉黑</span>' : '',
          ].filter(Boolean).join(' · ');
          return `
            <button class="entity-row${blocked}" data-id="${esc(c.id)}">
              ${renderAvatar(c)}
              <div class="entity-info">
                <div class="entity-name">${esc(c.name || '(未命名)')}</div>
                <div class="entity-sub">${esc(sub)}</div>
                ${meta ? `<div class="entity-meta">${meta}</div>` : ''}
              </div>
              <div class="entity-chevron">›</div>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  await renderList();

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    if (e.target.closest('.new-entity')) {
      const id = db.newId();
      const now = Date.now();
      await db.set('characters', {
        id, name: '新角色', persona: '', notes: '', avatar: null,
        blocked: false, createdAt: now, updatedAt: now,
      });
      return router.navigate('character-detail', { id });
    }
    const row = e.target.closest('[data-id]');
    if (row) router.navigate('character-detail', { id: row.dataset.id });
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}

function renderAvatar(c) {
  if (c?.avatar) {
    return `<div class="entity-avatar"><img src="${esc(c.avatar)}" alt=""></div>`;
  }
  const initial = (c?.name ?? '?').slice(0, 1);
  return `<div class="entity-avatar">${esc(initial)}</div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
