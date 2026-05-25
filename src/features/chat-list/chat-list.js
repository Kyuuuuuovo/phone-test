// Chat list page. Shows sessions sorted by lastMessageAt desc.
// "+" in header opens a modal to create character + session + navigate to chat.

import * as db from '../../core/db.js';

export async function mountChatList(container, params, router) {
  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">聊天</div>
        <div class="actions">
          <button class="new-chat" title="新建对话">+</button>
        </div>
      </header>
      <div class="page-body chat-list-body"></div>
    </div>
  `;

  const body = container.querySelector('.chat-list-body');

  async function renderList() {
    const sessions = await db.getAll('chatSessions');
    sessions.sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
    });
    if (sessions.length === 0) {
      body.innerHTML = `<div class="empty-state">还没有对话<br>点右上角 + 新建一个</div>`;
      return;
    }
    const rows = [];
    for (const s of sessions) {
      const char = await db.get('characters', s.characterId);
      const msgs = await db.query('chatMessages', 'sessionId', s.id);
      msgs.sort((a, b) => b.createdAt - a.createdAt);
      const lastMsg = msgs[0];
      const preview = lastMsg ? previewOfMessage(lastMsg) : '(暂无消息)';
      const timeText = formatTime(s.lastMessageAt);
      const initial = (char?.name ?? '?').slice(0, 1);
      const pinned = s.isPinned ? ' pinned' : '';
      rows.push(`
        <button class="session-item${pinned}" data-session-id="${esc(s.id)}">
          <div class="session-avatar">${esc(initial)}</div>
          <div class="session-info">
            <div class="session-name">${esc(char?.name ?? '(未知角色)')}</div>
            <div class="session-preview">${esc(preview)}</div>
          </div>
          <div class="session-time">${esc(timeText)}</div>
        </button>
      `);
    }
    body.innerHTML = `<div class="session-list">${rows.join('')}</div>`;
  }

  await renderList();

  function openNewChatModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">新建对话</div>
        <form class="new-chat-form" autocomplete="off">
          <label>
            <div class="label-text">角色名</div>
            <input name="name" required placeholder="比如:林夏">
          </label>
          <label>
            <div class="label-text">人设(背景 / 性格 / 说话风格)</div>
            <textarea name="persona" required rows="6" placeholder="比如:林夏,25岁,咖啡师,温和但有点话痨..."></textarea>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel">取消</button>
            <button type="submit" class="btn">创建并开聊</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    const form = modal.querySelector('form');
    setTimeout(() => modal.querySelector('input[name=name]')?.focus(), 0);
    modal.querySelector('.cancel').addEventListener('click', () => modal.remove());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim();
      const persona = String(fd.get('persona') || '').trim();
      if (!name || !persona) return;
      const now = Date.now();
      const charId = db.newId();
      const sessId = db.newId();
      await db.set('characters', {
        id: charId, name, persona, notes: '', createdAt: now, updatedAt: now,
      });
      await db.set('chatSessions', {
        id: sessId, characterId: charId, personaId: null,
        title: name, createdAt: now, lastMessageAt: now,
      });
      modal.remove();
      await router.navigate('chat', { sessionId: sessId });
    });
  }

  const onClick = (e) => {
    if (e.target.closest('.back')) {
      router.back();
    } else if (e.target.closest('.new-chat')) {
      openNewChatModal();
    } else {
      const item = e.target.closest('.session-item');
      if (item) router.navigate('chat', { sessionId: item.dataset.sessionId });
    }
  };
  container.addEventListener('click', onClick);

  return () => container.removeEventListener('click', onClick);
}

function previewOfMessage(msg) {
  const a = (msg.actions ?? [])[0];
  if (!a) return '';
  switch (a.type) {
    case 'text':   return a.content || '';
    case 'reply':  return a.content || '';
    case 'image':  return '[图片]';
    case 'voice':  return '[语音]';
    case 'recall': return '[消息已撤回]';
    default:       return `[${a.type}]`;
  }
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
