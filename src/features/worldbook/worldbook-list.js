// Worldbook list. Each row shows name + entry count + how many characters mount it.

import * as db from '../../core/db.js';

export async function mountWorldbookList(container, params, router) {
  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">世界书</div>
        <div class="actions">
          <button class="new-entity" title="新建世界书">+</button>
        </div>
      </header>
      <div class="page-body entity-list-body"></div>
    </div>
  `;

  const body = container.querySelector('.entity-list-body');

  async function renderList() {
    const wbs = await db.getAll('worldbooks');
    wbs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (wbs.length === 0) {
      body.innerHTML = `<div class="empty-state">还没有世界书<br>点右上角 + 新建一个</div>`;
      return;
    }
    // Pre-count entries + mounts in batch
    const entriesAll  = await db.getAll('worldbookEntries');
    const bindingsAll = await db.getAll('characterWorldbooks');
    const rows = wbs.map(wb => {
      const entryCount = entriesAll.filter(e => e.worldbookId === wb.id).length;
      const mountCount = bindingsAll.filter(b => b.worldbookId === wb.id).length;
      const meta = [
        `${entryCount} 个条目`,
        mountCount > 0 ? `${mountCount} 个角色挂载` : '未挂载',
      ].join(' · ');
      return `
        <button class="entity-row" data-id="${esc(wb.id)}">
          <div class="entity-avatar wb-avatar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 16H8v-2h8v2zm0-4H8v-2h8v2zm0-4H8V8h8v2z"/></svg></div>
          <div class="entity-info">
            <div class="entity-name">${esc(wb.name || '(未命名)')}</div>
            <div class="entity-sub">${esc(wb.description || '(没有描述)')}</div>
            <div class="entity-meta">${esc(meta)}</div>
          </div>
          <div class="entity-chevron">›</div>
        </button>
      `;
    }).join('');
    body.innerHTML = `<div class="entity-list">${rows}</div>`;
  }

  await renderList();

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    if (e.target.closest('.new-entity')) {
      const id = db.newId();
      const now = Date.now();
      await db.set('worldbooks', {
        id, name: '新世界书', description: '', createdAt: now, updatedAt: now,
      });
      return router.navigate('worldbook-detail', { id });
    }
    const row = e.target.closest('[data-id]');
    if (row) router.navigate('worldbook-detail', { id: row.dataset.id });
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
