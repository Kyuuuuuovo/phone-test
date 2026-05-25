// Clear data. Default: keep apiConfig. Optional checkbox to wipe it too.

import * as db from '../../core/db.js';

export async function mountClearData(container, params, router) {
  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">清空数据</div>
      </header>
      <div class="page-body">
        <p class="hint danger-hint">这会删除你所有的角色、对话、世界书、人设和记忆记录。无法撤销。</p>
        <label class="checkbox-row">
          <input type="checkbox" class="include-api">
          <span>同时清除 API 设置</span>
        </label>
        <div class="form-actions">
          <button class="btn danger clear-btn">清空数据</button>
        </div>
        <div class="form-status"></div>
      </div>
    </div>
  `;

  const status     = container.querySelector('.form-status');
  const clearBtn   = container.querySelector('.clear-btn');
  const includeApi = container.querySelector('.include-api');
  const backBtn    = container.querySelector('.back');

  const onBack = () => router.back();

  const onClear = async () => {
    const includesApi = includeApi.checked;
    const msg = includesApi
      ? '真的要清空全部数据(包含 API 设置)吗?这无法撤销。'
      : '真的要清空角色 / 对话 / 世界书 / 人设 / 记忆吗?API 设置和主题会保留。';
    if (!confirm(msg)) return;
    try {
      status.className = 'form-status';
      status.textContent = '清空中…';
      // settings holds theme + activeApiConfigId — never wipe it, only edit.
      const PROTECTED = new Set(['settings', ...(includesApi ? [] : ['apiConfig'])]);
      const cleared = [];
      for (const name of Object.keys(db.STORES)) {
        if (PROTECTED.has(name)) continue;
        await db.clear(name);
        cleared.push(name);
      }
      // If wiping apiConfig, also null out the stale active pointer.
      if (includesApi) {
        const s = (await db.get('settings', 'default')) || { id: 'default' };
        s.activeApiConfigId = null;
        await db.set('settings', s);
        cleared.push('apiConfig');
      }
      status.textContent = `已清空:${cleared.join(', ')}`;
      status.className = 'form-status success';
    } catch (e) {
      status.textContent = `失败:${String(e)}`;
      status.className = 'form-status error';
    }
  };

  backBtn.addEventListener('click', onBack);
  clearBtn.addEventListener('click', onClear);

  return () => {
    backBtn.removeEventListener('click', onBack);
    clearBtn.removeEventListener('click', onClear);
  };
}
