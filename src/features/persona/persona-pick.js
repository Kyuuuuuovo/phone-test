// Persona picker — pick which player persona is "currently you".
// Writes the selection to settings.activePersonaId. Future new-chat sessions
// pick this up (chat-list.js's createSessionForCharacter reads it).

import * as db from '../../core/db.js';

export async function mountPersonaPick(container, params, router) {
  async function render() {
    const personas = await db.getAll('personas');
    personas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const settings = (await db.get('settings', 'default')) || { id: 'default' };
    const activeId = settings.activePersonaId || null;

    container.innerHTML = `
      <div class="page persona-pick-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">当前人设</div>
          <div class="actions">
            <button class="new-persona" title="新建人设" aria-label="新建人设"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
          </div>
        </header>
        <div class="page-body">
          <p class="hint">选一个作为「我」。新建会话时会用这个人设。已经开的会话不变 — 各会话仍记着自己当时绑的 personaId。</p>
          ${personas.length === 0 ? `
            <p class="hint">还没有人设。点右上角 + 新建。</p>
          ` : `
            <div class="settings-list">
              <button class="settings-item" data-persona-id="">
                <span class="settings-label">不指定</span>
                <span class="theme-check${!activeId ? ' active' : ''}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></span>
              </button>
              ${personas.map(p => `
                <button class="settings-item" data-persona-id="${esc(p.id)}">
                  <span class="settings-label">
                    <div>${esc(p.name || '(未命名)')}</div>
                    <div class="theme-desc">${esc((p.persona || '').slice(0, 50))}</div>
                  </span>
                  <span class="theme-check${p.id === activeId ? ' active' : ''}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></span>
                </button>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
    wire();
  }

  function wire() {
    container.querySelector('.back').addEventListener('click', () => router.back());
    container.querySelector('.new-persona').addEventListener('click', () => {
      const id = db.newId();
      const now = Date.now();
      db.set('personas', { id, name: '新人设', persona: '', createdAt: now, updatedAt: now })
        .then(() => router.navigate('persona-detail', { id }));
    });
    container.querySelectorAll('[data-persona-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.personaId || null;
        const s = (await db.get('settings', 'default')) || { id: 'default' };
        s.activePersonaId = id;
        await db.set('settings', s);
        await render();
      });
    });
  }

  await render();
  return () => {};
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
