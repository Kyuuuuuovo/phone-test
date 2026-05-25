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
          <label class="settings-item toggle-row">
            <span class="settings-label">显示头像</span>
            <input type="checkbox" data-toggle="showAvatars"${session.showAvatars !== false ? ' checked' : ''}>
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
          <button class="settings-item" data-action="export">
            <span class="settings-label">导出聊天数据</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-action="import">
            <span class="settings-label">导入聊天数据</span>
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

    } else if (action === 'export') {
      try {
        const payload = await buildSessionExport(sessionId);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const charName = (payload.character?.name || 'chat').replace(/[\\/:*?"<>|]/g, '_');
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        a.download = `phone-app-chat-${charName}-${ts}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert(`已导出:${payload.chatMessages.length} 条消息 + ${payload.memories.length} 条记忆`);
      } catch (e) {
        alert(`导出失败:${String(e).slice(0, 200)}`);
      }

    } else if (action === 'import') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        document.body.removeChild(input);
        if (!file) return;
        if (!confirm('导入会创建一个新对话(原数据不动)。继续吗?')) return;
        try {
          const newSid = await importSessionFromFile(file);
          alert('导入成功');
          router.navigate('chat', { sessionId: newSid });
        } catch (e) {
          alert(`导入失败:${String(e).slice(0, 300)}`);
        }
      }, { once: true });
      input.click();

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

// Bundle everything needed to recreate this session on another machine:
// the session row, all its messages + memories, the character (so the
// import doesn't require the same character to already exist), the persona
// (if bound), and any worldbooks mounted to that character (with entries
// and the link rows).
async function buildSessionExport(sessionId) {
  const session = await db.get('chatSessions', sessionId);
  if (!session) throw new Error('会话不存在');
  const chatMessages = await db.query('chatMessages', 'sessionId', sessionId);
  const memories     = await db.query('memories',     'sessionId', sessionId);
  const character    = session.characterId ? await db.get('characters', session.characterId) : null;
  const persona      = session.personaId   ? await db.get('personas',   session.personaId)   : null;
  const cwbRels = session.characterId
    ? await db.query('characterWorldbooks', 'characterId', session.characterId)
    : [];
  const worldbooks = [];
  const worldbookEntries = [];
  for (const rel of cwbRels) {
    const wb = await db.get('worldbooks', rel.worldbookId);
    if (wb) worldbooks.push(wb);
    const entries = await db.query('worldbookEntries', 'worldbookId', rel.worldbookId);
    worldbookEntries.push(...entries);
  }
  return {
    _meta: { app: 'phone-app', kind: 'session-export', version: 1, exportedAt: Date.now() },
    session,
    chatMessages,
    memories,
    character,
    persona,
    worldbooks,
    worldbookEntries,
    characterWorldbooks: cwbRels,
  };
}

// Insert payload as a new session — keeps original IDs for character /
// worldbook / persona / link rows (skip if already present locally), but
// generates a fresh sessionId and fresh message/memory IDs so re-importing
// the same file twice produces two independent sessions. reply.quoteMsgId
// is remapped through the new IDs to keep quote bubbles pointing at the
// right messages.
async function importSessionFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data?._meta?.kind !== 'session-export') {
    throw new Error('文件不是 session 导出格式');
  }

  if (data.character) {
    const existing = await db.get('characters', data.character.id);
    if (!existing) await db.set('characters', data.character);
  }
  if (data.persona) {
    const existing = await db.get('personas', data.persona.id);
    if (!existing) await db.set('personas', data.persona);
  }
  for (const wb of data.worldbooks || []) {
    if (!(await db.get('worldbooks', wb.id))) await db.set('worldbooks', wb);
  }
  for (const we of data.worldbookEntries || []) {
    if (!(await db.get('worldbookEntries', we.id))) await db.set('worldbookEntries', we);
  }
  for (const cwb of data.characterWorldbooks || []) {
    if (!(await db.get('characterWorldbooks', cwb.id))) await db.set('characterWorldbooks', cwb);
  }

  const newSid = db.newId();
  const baseTs = Date.now();
  await db.set('chatSessions', {
    ...data.session,
    id: newSid,
    createdAt: baseTs,
    lastMessageAt: baseTs,
  });

  const msgIdMap = new Map();
  for (const m of data.chatMessages || []) msgIdMap.set(m.id, db.newId());
  for (const m of data.chatMessages || []) {
    const remappedActions = (m.actions || []).map(a => {
      if (a.type === 'reply' && a.quoteMsgId && msgIdMap.has(a.quoteMsgId)) {
        return { ...a, quoteMsgId: msgIdMap.get(a.quoteMsgId) };
      }
      return a;
    });
    await db.set('chatMessages', {
      ...m,
      id: msgIdMap.get(m.id),
      sessionId: newSid,
      actions: remappedActions,
    });
  }

  for (const mem of data.memories || []) {
    await db.set('memories', {
      ...mem,
      id: db.newId(),
      sessionId: newSid,
    });
  }

  return newSid;
}
