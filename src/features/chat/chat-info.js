// Chat info page — opened by the chat header's "⋯ more" button.
// Replaces the inline dropdown. Acts like WeChat's "聊天信息" page.

import * as db from '../../core/db.js';

export async function mountChatInfo(container, params, router) {
  const sessionId = params.sessionId;
  if (!sessionId) {
    container.innerHTML = `<div class="page"><div class="page-body">缺少 sessionId</div></div>`;
    return () => {};
  }
  const session = await db.get('chatSessions', sessionId);
  if (!session) {
    container.innerHTML = `<div class="page"><div class="page-body">会话不存在</div></div>`;
    return () => {};
  }
  const character = await db.get('characters', session.characterId);
  const isBlocked = !!character?.blocked;

  container.innerHTML = `
    <div class="page chat-info-page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">聊天信息</div>
      </header>
      <div class="page-body">
        <div class="chat-info-card">
          ${renderAvatar(character)}
          <div class="chat-info-name">${esc(character?.name ?? '(未知角色)')}${isBlocked ? ' <span class="blocked-badge">已拉黑</span>' : ''}</div>
        </div>
        <div class="settings-list">
          <button class="settings-item" data-action="pin">
            <span class="settings-label">${session.isPinned ? '取消置顶' : '置顶聊天'}</span>
            <span class="settings-chevron">›</span>
          </button>
          <label class="settings-item toggle-row">
            <span class="settings-label">显示已读标记</span>
            <input type="checkbox" data-toggle="showReadReceipts"${session.showReadReceipts !== false ? ' checked' : ''}>
          </label>
          <button class="settings-item" data-action="settings">
            <span class="settings-label">会话设置</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-action="beautify">
            <span class="settings-label">聊天美化</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-action="memory">
            <span class="settings-label">记忆总结</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-action="character">
            <span class="settings-label">编辑角色资料</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item danger" data-action="clear">
            <span class="settings-label">清空聊天记录</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item${isBlocked ? '' : ' danger'}" data-action="block">
            <span class="settings-label">${isBlocked ? '解除拉黑' : '加入黑名单'}</span>
            <span class="settings-chevron">›</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const onToggle = async (e) => {
    const cb = e.target.closest('[data-toggle]');
    if (!cb) return;
    const key = cb.dataset.toggle;
    const fresh = await db.get('chatSessions', sessionId);
    fresh[key] = cb.checked;
    await db.set('chatSessions', fresh);
  };
  container.addEventListener('change', onToggle);

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    const item = e.target.closest('[data-action]');
    if (!item) return;
    const action = item.dataset.action;

    if (action === 'pin') {
      const fresh = await db.get('chatSessions', sessionId);
      fresh.isPinned = !fresh.isPinned;
      await db.set('chatSessions', fresh);
      item.querySelector('.settings-label').textContent = fresh.isPinned ? '取消置顶' : '置顶聊天';

    } else if (action === 'settings') {
      router.navigate('chat-settings', { sessionId });

    } else if (action === 'beautify') {
      router.navigate('chat-beautify', { sessionId });

    } else if (action === 'memory') {
      router.navigate('memory-manage', { sessionId });

    } else if (action === 'character') {
      router.navigate('character-detail', { id: session.characterId });

    } else if (action === 'clear') {
      if (!confirm('清空这个对话的所有消息和记忆?角色保留。')) return;
      const msgs = await db.query('chatMessages', 'sessionId', sessionId);
      for (const m of msgs) await db.del('chatMessages', m.id);
      const mems = await db.query('memories', 'sessionId', sessionId);
      for (const m of mems) await db.del('memories', m.id);
      alert('已清空');

    } else if (action === 'block') {
      const fresh = await db.get('characters', session.characterId);
      if (!fresh) return;
      const goingToBlock = !fresh.blocked;
      if (goingToBlock && !confirm(`把「${fresh.name || '这个角色'}」加入黑名单?对话和消息会保留,AI 会通过 system prompt 知道这个状态,你可以随时解除。`)) return;
      fresh.blocked = goingToBlock;
      fresh.updatedAt = Date.now();
      await db.set('characters', fresh);
      // Bounce back to chat to refresh the blocked banner.
      router.navigate('chat', { sessionId });
    }
  };
  container.addEventListener('click', onClick);
  return () => {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onToggle);
  };
}

function renderAvatar(c) {
  if (c?.avatar) {
    return `<div class="chat-info-avatar"><img src="${esc(c.avatar)}" alt=""></div>`;
  }
  const initial = (c?.name ?? '?').slice(0, 1);
  return `<div class="chat-info-avatar placeholder">${esc(initial)}</div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
