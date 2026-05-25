// Player persona list.

import * as db from '../../core/db.js';

export async function mountPersonaList(container, params, router) {
  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">玩家人设</div>
        <div class="actions">
          <button class="new-entity" title="新建人设">+</button>
        </div>
      </header>
      <div class="page-body entity-list-body"></div>
    </div>
  `;

  const body = container.querySelector('.entity-list-body');

  async function renderList() {
    const personas = await db.getAll('personas');
    personas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    if (personas.length === 0) {
      body.innerHTML = `<div class="empty-state">还没有玩家人设<br>点右上角 + 新建一个<br><br>人设描述「你是谁」,角色聊天时知道在跟什么样的人说话</div>`;
      return;
    }
    const sessions = await db.getAll('chatSessions');
    const refCount = new Map();
    for (const s of sessions) if (s.personaId) {
      refCount.set(s.personaId, (refCount.get(s.personaId) ?? 0) + 1);
    }
    body.innerHTML = `
      <div class="entity-list">
        ${personas.map(p => {
          const sub = (p.persona || '').slice(0, 60) || '(没有人设描述)';
          const meta = refCount.get(p.id) ? `${refCount.get(p.id)} 个对话在用` : '';
          return `
            <button class="entity-row" data-id="${esc(p.id)}">
              <div class="entity-avatar">${esc((p.name ?? '?').slice(0, 1))}</div>
              <div class="entity-info">
                <div class="entity-name">${esc(p.name || '(未命名)')}</div>
                <div class="entity-sub">${esc(sub)}</div>
                ${meta ? `<div class="entity-meta">${esc(meta)}</div>` : ''}
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
      await db.set('personas', {
        id, name: '新人设', persona: '', createdAt: now, updatedAt: now,
      });
      return router.navigate('persona-detail', { id });
    }
    const row = e.target.closest('[data-id]');
    if (row) router.navigate('persona-detail', { id: row.dataset.id });
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
