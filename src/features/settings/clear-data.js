// Clear data. Default: keep apiConfig. Optional checkbox to wipe it too.

import * as db from '../../core/db.js';
import { openConfirm } from '../../core/modal.js';

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
    if (!await openConfirm(container, {
      title: '清空数据',
      message: msg,
      confirmLabel: '清空',
      danger: true,
    })) return;
    try {
      status.className = 'form-status';
      status.textContent = '清空中…';
      // settings 整体不清,但里面"布局/UI 状态"字段要重置(否则 tileOrder 等
      // 旧布局残留,user 在手机上清空后排布跟桌面对不上 — 已知 bug)。保留
      // "真正的用户偏好":主题、API、记忆配置、天气、向量、桌宠位置、人设
      // 风格选择 等。
      const PROTECTED = new Set(['settings', ...(includesApi ? [] : ['apiConfig'])]);
      const cleared = [];
      for (const name of Object.keys(db.STORES)) {
        if (PROTECTED.has(name)) continue;
        await db.clear(name);
        cleared.push(name);
      }
      // settings 内重置布局相关字段 + 一次性 migration flag(让 home 下次 mount
      // 走默认排布)。理想是把"清的字段"做白名单 — 不在白名单的都清掉 —
      // 但风险更大(新字段忘加白名单就被清);现在按黑名单逐个 delete。
      await db.updateSettings(s => {
        delete s.tileOrder;
        delete s.dockOrder;
        delete s.unifiedGridV1;
        delete s.favoritesMigratedV1;
        delete s.rowsClampV1;
        delete s.appIconOverrides;
        delete s.scheduleNotifiedIds;
        delete s.scheduleMode;
        delete s.frequentPhrases;
        delete s.quickCommands;
        delete s.petDismissed;
        if (includesApi) s.activeApiConfigId = null;
        return s;
      });
      cleared.push('settings 布局字段');
      if (includesApi) cleared.push('apiConfig');
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
