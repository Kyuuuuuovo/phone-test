// Chat list. Sessions sorted by lastMessageAt desc, pinned first.
// Each row supports horizontal swipe-to-reveal (置顶 / 删除).
// "+" opens a 2-stage modal: pick existing character OR create a new one.

import * as db from '../../core/db.js';

const ACTION_WIDTH = 144;  // 2 buttons × 72px — kept in sync with CSS

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

  // ── Render ───────────────────────────────────────────────────────────
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
      const pinned = s.isPinned ? ' pinned' : '';
      const blocked = char?.blocked ? ' blocked' : '';
      rows.push(`
        <div class="session-row${pinned}${blocked}" data-session-id="${esc(s.id)}">
          <div class="session-actions">
            <button class="action-btn action-pin" data-action="pin">${s.isPinned ? '取消置顶' : '置顶'}</button>
            <button class="action-btn action-delete" data-action="delete">删除</button>
          </div>
          <button class="session-item" data-session-id="${esc(s.id)}">
            ${renderAvatar(char)}
            <div class="session-info">
              <div class="session-name">${esc(char?.name ?? '(未知角色)')}${char?.blocked ? ' <span class="blocked-badge">已拉黑</span>' : ''}</div>
              <div class="session-preview">${esc(preview)}</div>
            </div>
            <div class="session-time">${esc(timeText)}</div>
          </button>
        </div>
      `);
    }
    body.innerHTML = `<div class="session-list">${rows.join('')}</div>`;
  }

  await renderList();

  // ── Swipe state ──────────────────────────────────────────────────────
  let revealed = null;       // the .session-row element currently revealed
  let drag = null;           // active drag: { row, item, startX, startY, dx, swiping, pointerId }
  let suppressClickUntil = 0;

  function closeRevealed() {
    if (revealed) {
      const item = revealed.querySelector('.session-item');
      item.style.transform = '';
      revealed.classList.remove('revealed');
      revealed = null;
    }
  }

  function setRevealed(row) {
    if (revealed && revealed !== row) closeRevealed();
    const item = row.querySelector('.session-item');
    item.style.transform = `translateX(-${ACTION_WIDTH}px)`;
    row.classList.add('revealed');
    revealed = row;
  }

  // ── Pointer handlers (swipe) ─────────────────────────────────────────
  const onPointerDown = (e) => {
    // Skip non-left mouse (right click = context menu, middle = paste).
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Don't start a drag when grabbing an action button — those should click.
    if (e.target.closest('.action-btn')) return;
    const row = e.target.closest('.session-row');
    if (!row) return;
    drag = {
      row,
      item: row.querySelector('.session-item'),
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      swiping: false,
      pointerId: e.pointerId,
      revealedAtStart: row === revealed,
    };
  };

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.swiping) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;  // wait for direction
      drag.swiping = true;
      drag.item.style.transition = 'none';
      // Lock the row's pointer capture so move events keep coming
      try { drag.row.setPointerCapture(drag.pointerId); } catch (_) {}
    }
    drag.dx = dx;
    const base = drag.revealedAtStart ? -ACTION_WIDTH : 0;
    let x = base + dx;
    if (x > 0) x = 0;
    if (x < -ACTION_WIDTH * 1.2) x = -ACTION_WIDTH * 1.2;
    drag.item.style.transform = `translateX(${x}px)`;
  };

  const onPointerEnd = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const wasSwiping = drag.swiping;
    if (wasSwiping) {
      drag.item.style.transition = '';
      const base = drag.revealedAtStart ? -ACTION_WIDTH : 0;
      const finalX = base + drag.dx;
      // Snap: if more than halfway revealed → reveal; else close.
      if (finalX < -ACTION_WIDTH / 2) {
        setRevealed(drag.row);
      } else {
        if (revealed === drag.row) closeRevealed();
        drag.item.style.transform = '';
      }
      suppressClickUntil = Date.now() + 300;  // swallow the synthetic click
    }
    try { drag.row.releasePointerCapture(drag.pointerId); } catch (_) {}
    drag = null;
  };

  // ── Click handlers ───────────────────────────────────────────────────
  const onClick = async (e) => {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.target.closest('.back')) return router.back();
    if (e.target.closest('.new-chat')) return openNewChatModal();

    const actionBtn = e.target.closest('.action-btn');
    if (actionBtn) {
      const row = actionBtn.closest('.session-row');
      const id = row.dataset.sessionId;
      const action = actionBtn.dataset.action;
      if (action === 'pin') {
        const s = await db.get('chatSessions', id);
        s.isPinned = !s.isPinned;
        await db.set('chatSessions', s);
        closeRevealed();
        await renderList();
      } else if (action === 'delete') {
        if (!confirm('删除这个对话?消息和记忆会一起删,角色和世界书保留。')) {
          closeRevealed();
          return;
        }
        // Cascade: messages + memories + the session itself
        const msgs = await db.query('chatMessages', 'sessionId', id);
        for (const m of msgs) await db.del('chatMessages', m.id);
        const mems = await db.query('memories', 'sessionId', id);
        for (const m of mems) await db.del('memories', m.id);
        await db.del('chatSessions', id);
        revealed = null;
        await renderList();
      }
      return;
    }

    // If something is revealed and user taps the item body → close, don't navigate.
    const item = e.target.closest('.session-item');
    if (item) {
      const row = item.closest('.session-row');
      if (revealed && row === revealed) {
        closeRevealed();
        return;
      }
      if (revealed) {
        closeRevealed();
        return;
      }
      router.navigate('chat', { sessionId: item.dataset.sessionId });
    }
  };

  // Click outside → close revealed row.
  const onDocClick = (e) => {
    if (revealed && !e.target.closest('.session-row')) {
      closeRevealed();
    }
  };

  // ── New-chat modal ───────────────────────────────────────────────────
  async function openNewChatModal() {
    closeRevealed();
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    container.appendChild(modal);

    async function renderPickStage() {
      const allChars = await db.getAll('characters');
      // Blocked characters can't start new conversations — they don't show up here.
      const chars = allChars.filter(c => !c.blocked);
      chars.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      modal.innerHTML = `
        <div class="modal">
          <div class="modal-header">新建对话</div>
          ${chars.length > 0 ? `
            <div class="label-text">选已有角色</div>
            <div class="character-pick-list">
              ${chars.map(c => `
                <button class="character-pick-row" data-char-id="${esc(c.id)}">
                  ${renderAvatar(c)}
                  <div class="session-info">
                    <div class="session-name">${esc(c.name || '(未命名)')}</div>
                    <div class="session-preview">${esc((c.persona || '').slice(0, 60))}</div>
                  </div>
                </button>
              `).join('')}
            </div>
          ` : `
            <p class="hint">${allChars.length > 0 ? '没有可用角色(被拉黑的不显示)' : '还没有角色,新建一个开始。'}</p>
          `}
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel">取消</button>
            <button type="button" class="btn new-char">+ 新建角色</button>
          </div>
        </div>
      `;
      modal.querySelector('.cancel').addEventListener('click', () => modal.remove());
      modal.querySelector('.new-char').addEventListener('click', renderCreateStage);
      modal.querySelectorAll('[data-char-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await createSessionForCharacter(btn.dataset.charId);
        });
      });
    }

    function renderCreateStage(initial = {}) {
      modal.innerHTML = `
        <div class="modal">
          <div class="modal-header">新建角色 + 对话</div>
          <form class="new-chat-form" autocomplete="off">
            <label>
              <div class="label-text">角色名</div>
              <input name="name" required placeholder="比如:林夏" value="${esc(initial.name || '')}">
            </label>
            <label>
              <div class="label-text">人设(背景 / 性格 / 说话风格)</div>
              <textarea name="persona" required rows="6" placeholder="比如:林夏,25岁,咖啡师,温和但有点话痨...">${esc(initial.persona || '')}</textarea>
            </label>
            <div class="modal-actions">
              <button type="button" class="btn secondary back-pick">‹ 返回选择</button>
              <button type="submit" class="btn">创建并开聊</button>
            </div>
          </form>
        </div>
      `;
      const form = modal.querySelector('form');
      setTimeout(() => modal.querySelector('input[name=name]')?.focus(), 0);
      modal.querySelector('.back-pick').addEventListener('click', renderPickStage);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get('name') || '').trim();
        const persona = String(fd.get('persona') || '').trim();
        if (!name || !persona) return;
        const all = await db.getAll('characters');
        const dupes = all.filter(c => (c.name || '').trim() === name && !c.blocked);
        if (dupes.length > 0) {
          renderDupeStage({ name, persona, dupes });
          return;
        }
        await createNewCharacterAndSession(name, persona);
      });
    }

    function renderDupeStage({ name, persona, dupes }) {
      modal.innerHTML = `
        <div class="modal">
          <div class="modal-header">同名角色已存在</div>
          <p class="hint">系统里已经有 <b>${dupes.length}</b> 个叫「${esc(name)}」的角色。用现有的开新对话,还是再创建一个同名新角色?</p>
          <div class="character-pick-list">
            ${dupes.map(c => `
              <button class="character-pick-row" data-char-id="${esc(c.id)}">
                ${renderAvatar(c)}
                <div class="session-info">
                  <div class="session-name">${esc(c.name || '(未命名)')}</div>
                  <div class="session-preview">${esc((c.persona || '').slice(0, 80) || '(没有人设)')}</div>
                </div>
              </button>
            `).join('')}
          </div>
          <div class="modal-actions">
            <button type="button" class="btn secondary back-form">‹ 改个名字</button>
            <button type="button" class="btn create-anyway">还是创建新的</button>
          </div>
        </div>
      `;
      modal.querySelector('.back-form').addEventListener('click', () => {
        renderCreateStage({ name, persona });
      });
      modal.querySelector('.create-anyway').addEventListener('click', async () => {
        await createNewCharacterAndSession(name, persona);
      });
      modal.querySelectorAll('[data-char-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await createSessionForCharacter(btn.dataset.charId);
        });
      });
    }

    async function createNewCharacterAndSession(name, persona) {
      const now = Date.now();
      const charId = db.newId();
      await db.set('characters', {
        id: charId, name, persona, notes: '', avatar: null,
        blocked: false, createdAt: now, updatedAt: now,
      });
      await createSessionForCharacter(charId);
    }

    async function createSessionForCharacter(characterId) {
      const now = Date.now();
      const sessId = db.newId();
      const char = await db.get('characters', characterId);
      await db.set('chatSessions', {
        id: sessId,
        characterId,
        personaId: null,
        title: char?.name || '',
        createdAt: now,
        lastMessageAt: now,
        isPinned: false,
      });
      modal.remove();
      await router.navigate('chat', { sessionId: sessId });
    }

    // Start on pick stage if there are any characters; else jump straight to create.
    const chars = await db.getAll('characters');
    if (chars.length > 0) renderPickStage();
    else renderCreateStage();
  }

  // ── Wire up ──────────────────────────────────────────────────────────
  body.addEventListener('pointerdown', onPointerDown);
  body.addEventListener('pointermove', onPointerMove);
  body.addEventListener('pointerup', onPointerEnd);
  body.addEventListener('pointercancel', onPointerEnd);
  container.addEventListener('click', onClick, true);  // capture to honor suppressClickUntil
  document.addEventListener('click', onDocClick);

  return () => {
    body.removeEventListener('pointerdown', onPointerDown);
    body.removeEventListener('pointermove', onPointerMove);
    body.removeEventListener('pointerup', onPointerEnd);
    body.removeEventListener('pointercancel', onPointerEnd);
    container.removeEventListener('click', onClick, true);
    document.removeEventListener('click', onDocClick);
  };
}

function renderAvatar(c) {
  if (c?.avatar) {
    return `<div class="session-avatar"><img src="${esc(c.avatar)}" alt=""></div>`;
  }
  const initial = (c?.name ?? '?').slice(0, 1);
  return `<div class="session-avatar">${esc(initial)}</div>`;
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
    case 'unblock_request': return '[请求解除拉黑]';
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
