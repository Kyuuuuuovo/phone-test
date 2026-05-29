// Clear data — 勾选要清的数据类别。主题 / 界面偏好(settings)始终保留;
// API 配置是单独一类(默认不勾)。每类映射到一组 IndexedDB store。
// embeddings 跨「记忆」「世界书」两类共用 —— 任一勾选就清(否则留孤儿向量)。
// 布局字段(tileOrder 等)只在清「角色」或「桌面装饰」时重置,免得清个钱包
// 把首页排布也弄乱。

import * as db from '../../core/db.js';
import { openConfirm } from '../../core/modal.js';

// 每类 → 一组 store。注释里写清楚清掉会丢什么,提示文案直接给用户看。
const CATEGORIES = [
  { key: 'chars',     label: '角色 & 对话',     hint: '角色、聊天记录、会话设置、世界书绑定', stores: ['characters', 'chatSessions', 'chatMessages', 'characterWorldbooks'] },
  { key: 'memory',    label: '记忆',           hint: '总结、时间线、纪念日、用户画像、向量', stores: ['memories', 'timeline', 'milestones', 'userProfiles'] },
  { key: 'worldbook', label: '世界书',         hint: '世界书和里面的条目', stores: ['worldbooks', 'worldbookEntries'] },
  { key: 'persona',   label: '人设',           hint: '玩家人设库', stores: ['personas'] },
  { key: 'wallet',    label: '钱包',           hint: '余额(流水由聊天记录决定)', stores: ['wallet'] },
  { key: 'favorites', label: '收藏',           hint: '收藏的消息', stores: ['favorites'] },
  { key: 'schedule',  label: '行程 & 打卡',     hint: '日程、打卡类型和打卡记录', stores: ['schedule', 'checkinTypes', 'checkins'] },
  { key: 'cycle',     label: '生理期',         hint: '周期配置和症状记录', stores: ['cycle', 'cycleSymptoms'] },
  { key: 'monitor',   label: '监控',           hint: '摄像头和画面历史', stores: ['cameras', 'activityLog'] },
  { key: 'drift',     label: '漂流瓶 & 千纸鹤', hint: '漂流瓶、千纸鹤记录', stores: ['bottles', 'keepsakes'] },
  { key: 'widgets',   label: '桌面装饰',       hint: '首页的 widget', stores: ['homeWidgets'] },
  { key: 'api',       label: 'API 设置',       hint: '清掉后要重新填 endpoint 和 key', stores: ['apiConfig'], danger: true },
];

export async function mountClearData(container, params, router) {
  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">清空数据</div>
      </header>
      <div class="page-body">
        <p class="hint danger-hint">勾选要清除的数据,无法撤销。主题和界面偏好始终保留。</p>
        <div class="clear-cats">
          ${CATEGORIES.map(c => `
            <label class="checkbox-row clear-cat-row${c.danger ? ' danger' : ''}">
              <input type="checkbox" data-cat="${c.key}">
              <span class="clear-cat-text">
                <span class="clear-cat-label">${c.label}</span>
                <span class="hint clear-cat-hint">${c.hint}</span>
              </span>
            </label>
          `).join('')}
        </div>
        <div class="form-actions">
          <button class="btn danger clear-btn">清除所选</button>
        </div>
        <div class="form-status"></div>
      </div>
    </div>
  `;

  const status   = container.querySelector('.form-status');
  const clearBtn  = container.querySelector('.clear-btn');
  const backBtn  = container.querySelector('.back');

  const onBack = () => router.back();

  const onClear = async () => {
    const picked = CATEGORIES.filter(c =>
      container.querySelector(`input[data-cat="${c.key}"]`)?.checked);
    if (picked.length === 0) {
      status.className = 'form-status';
      status.textContent = '没有勾选任何项。';
      return;
    }
    const labels = picked.map(c => c.label).join('、');
    if (!await openConfirm(container, {
      title: '清空数据',
      message: `确定清除:${labels}?无法撤销。`,
      confirmLabel: '清除',
      danger: true,
    })) return;
    try {
      status.className = 'form-status';
      status.textContent = '清空中…';
      const keys = picked.map(c => c.key);
      // 收集要清的 store。embeddings 跨 记忆/世界书 共用,任一选中就清。
      const stores = new Set();
      for (const c of picked) for (const s of c.stores) stores.add(s);
      if (keys.includes('memory') || keys.includes('worldbook')) stores.add('embeddings');
      for (const name of stores) await db.clear(name);
      // 生理期 type 挂在 checkinTypes(kind='period'),db.clear 整个 store 会误删
      // 普通打卡 —— 所以这里精确删 period type + 它的 checkin(只在选了「生理期」时)。
      if (keys.includes('cycle')) {
        const periodTypes = (await db.getAll('checkinTypes')).filter(t => t.kind === 'period');
        for (const pt of periodTypes) {
          const cks = await db.query('checkins', 'typeId', pt.id);
          for (const c of cks) await db.del('checkins', c.id);
          await db.del('checkinTypes', pt.id);
        }
      }
      // settings 内联状态收尾:布局字段(角色/装饰相关)+ 悬空引用。
      await db.updateSettings(s => {
        if (keys.includes('widgets') || keys.includes('chars')) {
          delete s.tileOrder; delete s.dockOrder; delete s.unifiedGridV1;
          delete s.favoritesMigratedV1; delete s.rowsClampV1; delete s.appIconOverrides;
        }
        if (keys.includes('chars')) {
          delete s.scheduleNotifiedIds; delete s.frequentPhrases;
          delete s.quickCommands; delete s.petDismissed;
        }
        if (keys.includes('persona')) s.activePersonaId = null;
        if (keys.includes('api'))     s.activeApiConfigId = null;
        return s;
      });
      status.textContent = `已清除:${labels}`;
      status.className = 'form-status success';
      // 取消勾选,避免重复点
      container.querySelectorAll('input[data-cat]').forEach(cb => { cb.checked = false; });
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
