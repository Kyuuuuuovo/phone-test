// Favorites list — flat view of every saved (msgId, actionIdx) tuple across
// all chat sessions. Tapping an entry jumps into the source chat (future:
// scroll to message). Each row shows: from-character, preview of the action's
// text, when saved.

import * as db from '../../core/db.js';
import { esc } from '../../core/util.js';

export async function mountFavoritesList(container, params, router) {
  async function render() {
    const favs = await db.getAll('favorites');
    favs.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));

    // Hydrate each favorite with its message + character info.
    const rows = [];
    for (const f of favs) {
      const msg = await db.get('chatMessages', f.msgId);
      const action = msg?.actions?.[f.actionIdx ?? 0];
      const session = msg ? await db.get('chatSessions', msg.sessionId) : null;
      const character = session ? await db.get('characters', session.characterId) : null;
      rows.push({
        id: f.id,
        sessionId: f.sessionId,
        savedAt: f.savedAt,
        charName: character?.name || '(已删除角色)',
        preview: actionPreview(action),
        valid: !!msg && !!action,
      });
    }

    container.innerHTML = `
      <div class="page favorites-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">收藏</div>
        </header>
        <div class="page-body">
          ${rows.length === 0 ? `
            <p class="hint">还没有收藏。在聊天里长按 / 右键消息选「收藏」就会出现这里。</p>
          ` : `
            <div class="favorite-list">
              ${rows.map(r => `
                <div class="favorite-row" data-id="${esc(r.id)}" data-session-id="${esc(r.sessionId)}">
                  <div class="favorite-info">
                    <div class="favorite-from">${esc(r.charName)}${!r.valid ? ' <span class="favorite-stale">原消息已删</span>' : ''}</div>
                    <div class="favorite-preview">${esc(r.preview)}</div>
                    <div class="favorite-when">${esc(formatTime(r.savedAt))}</div>
                  </div>
                  <button type="button" class="favorite-del" title="移除收藏">×</button>
                </div>
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
    const list = container.querySelector('.favorite-list');
    if (!list) return;
    list.addEventListener('click', async (e) => {
      const del = e.target.closest('.favorite-del');
      if (del) {
        e.stopPropagation();
        const row = del.closest('[data-id]');
        const id = row?.dataset.id;
        if (!id) return;
        await db.del('favorites', id);
        await render();
        return;
      }
      const row = e.target.closest('.favorite-row');
      if (!row) return;
      const sid = row.dataset.sessionId;
      if (sid) router.navigate('chat', { sessionId: sid });
    });
  }

  await render();
  return () => {};
}

function actionPreview(a) {
  if (!a) return '(原消息已删除)';
  switch (a.type) {
    case 'text':   return a.content || '';
    case 'reply':  return a.content || '';
    case 'image':  return `[图片] ${a.description || ''}`;
    case 'voice':  return `[语音] ${a.content || ''}`;
    case 'recall': return '[消息已撤回]';
    case 'red_packet': return `[红包 ¥${Number(a.amount || 0).toFixed(2)}] ${a.message || ''}`;
    case 'transfer':   return `[转账 ¥${Number(a.amount || 0).toFixed(2)}] ${a.message || ''}`;
    case 'unblock_request': return `[请求解除拉黑] ${a.content || ''}`;
    default: return `[${a.type}]`;
  }
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getMonth()+1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
