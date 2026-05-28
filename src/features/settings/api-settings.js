// API config list. Each row is one named config; one is marked active.
// Click row to edit. "+" creates a new blank config and navigates to detail.

import * as db from '../../core/db.js';
import { esc } from '../../core/util.js';

export async function mountApiSettings(container, params, router) {
  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">API 设置</div>
        <div class="actions">
          <button class="new-api" title="新建配置" aria-label="新建配置"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
        </div>
      </header>
      <div class="page-body api-list-body"></div>
    </div>
  `;

  const body = container.querySelector('.api-list-body');

  async function renderList() {
    const settings = (await db.get('settings', 'default')) || { id: 'default' };
    const activeId = settings.activeApiConfigId || null;
    const configs = await db.getAll('apiConfig');
    configs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (configs.length === 0) {
      body.innerHTML = `
        <p class="hint">还没有配置。点右上角 + 新建一组,填好 API URL / Key / 模型后就能开聊。</p>
      `;
      return;
    }
    body.innerHTML = `
      <div class="settings-list">
        ${configs.map(c => {
          const active = c.id === activeId;
          const sub = [c.modelName, truncate(c.apiUrl, 32)].filter(Boolean).join(' · ');
          return `
            <button class="settings-item api-row" data-id="${esc(c.id)}">
              <span class="settings-label">
                <div class="api-name">${esc(c.name || '(未命名)')}</div>
                <div class="api-sub">${esc(sub || '未填写')}</div>
              </span>
              <span class="api-active${active ? ' on' : ''}">${active ? '使用中' : '›'}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  await renderList();

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    if (e.target.closest('.new-api')) {
      const id = db.newId();
      await db.set('apiConfig', {
        id, name: '新配置', apiUrl: '', apiKey: '', modelName: '', temperature: 0.8,
      });
      return router.navigate('settings-api-detail', { id });
    }
    const row = e.target.closest('[data-id]');
    if (row) router.navigate('settings-api-detail', { id: row.dataset.id });
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
