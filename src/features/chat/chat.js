// Chat page. Bubbles, input, AI trigger, push-up attach panel,
// header "more" menu, bubble context menu (long-press / right-click), reply preview.

import * as db from '../../core/db.js';
import * as ai from '../../core/ai.js';

const SVG = {
  plus:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`,
  send:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
  ai:    `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 3l1.5 4.5L17 9l-4.5 1.5L11 15l-1.5-4.5L5 9l4.5-1.5L11 3zM18 13l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5z"/></svg>`,
  more:  `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
  voice: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1-3.29-2.5-4.03v8.06c1.5-.74 2.5-2.26 2.5-4.03z"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg>`,
  pin:   `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>`,
  file:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20a2 2 0 0 0 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>`,
};

export async function mountChat(container, params, router) {
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

  container.innerHTML = `
    <div class="page chat-page">
      <header class="page-header">
        <button class="back">‹</button>
        <div class="title">${esc(character?.name ?? '聊天')}</div>
        <button class="icon-btn more-btn" title="更多">${SVG.more}</button>
      </header>
      <div class="more-menu" hidden>
        <button data-action="pin"   class="pin-item">${session.isPinned ? '取消置顶' : '置顶聊天'}</button>
        <button data-action="clear">清空聊天记录</button>
        <button data-action="block" class="danger">加入黑名单</button>
      </div>
      <div class="chat-stream"></div>
      <div class="reply-preview" hidden>
        <div class="reply-preview-content">
          <span class="reply-preview-label">引用</span>
          <span class="reply-preview-text"></span>
        </div>
        <button class="reply-cancel" title="取消引用">×</button>
      </div>
      <div class="chat-input">
        <button class="icon-btn plus-btn" title="附件">${SVG.plus}</button>
        <textarea class="text-input" rows="1" placeholder="说点什么..."></textarea>
        <button class="icon-btn send-btn" title="发送">${SVG.send}</button>
        <button class="icon-btn ai-btn"   title="让 AI 回复">${SVG.ai}</button>
      </div>
      <div class="attach-panel" hidden>
        <button class="attach-item" data-kind="voice">
          <div class="icon-bg">${SVG.voice}</div>
          <div class="label">语音</div>
        </button>
        <button class="attach-item" data-kind="image">
          <div class="icon-bg">${SVG.image}</div>
          <div class="label">图片</div>
        </button>
        <button class="attach-item disabled" data-kind="location" disabled>
          <div class="icon-bg">${SVG.pin}</div>
          <div class="label">位置</div>
        </button>
        <button class="attach-item disabled" data-kind="file" disabled>
          <div class="icon-bg">${SVG.file}</div>
          <div class="label">文件</div>
        </button>
      </div>
      <div class="bubble-menu" hidden>
        <button data-action="quote">引用</button>
        <button data-action="copy">复制</button>
        <button data-action="delete" class="danger">删除</button>
      </div>
    </div>
  `;

  const stream      = container.querySelector('.chat-stream');
  const input       = container.querySelector('.text-input');
  const sendBtn     = container.querySelector('.send-btn');
  const aiBtn       = container.querySelector('.ai-btn');
  const plusBtn     = container.querySelector('.plus-btn');
  const moreBtn     = container.querySelector('.more-btn');
  const panel       = container.querySelector('.attach-panel');
  const moreMenu    = container.querySelector('.more-menu');
  const bubbleMenu  = container.querySelector('.bubble-menu');
  const replyBar    = container.querySelector('.reply-preview');
  const replyText   = container.querySelector('.reply-preview-text');
  const replyCancel = container.querySelector('.reply-cancel');
  const backBtn     = container.querySelector('.back');
  const pinItem     = container.querySelector('.pin-item');
  const chatPage    = container.querySelector('.chat-page');

  // Per-render preview map: msgId -> first-action text (for inline quote rendering)
  let previewMap = new Map();
  // State
  let replyingTo = null;        // msgId currently being quoted
  let activeBubbleMsgId = null; // msgId the bubble-menu was opened for

  async function refresh() {
    const msgs = await db.query('chatMessages', 'sessionId', sessionId);
    msgs.sort((a, b) => a.createdAt - b.createdAt);
    previewMap = new Map(msgs.map(m => [m.id, firstActionText(m)]));
    stream.innerHTML = msgs.map(m => renderMessage(m, previewMap)).join('');
    stream.scrollTop = stream.scrollHeight;
  }
  await refresh();

  async function appendUserMessage(actions) {
    const id = db.newId();
    const now = Date.now();
    await db.set('chatMessages', {
      id, sessionId, role: 'user', actions, createdAt: now,
    });
    session.lastMessageAt = now;
    await db.set('chatSessions', session);
    await refresh();
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(120, input.scrollHeight) + 'px';
  }

  function closePanel()    { panel.hidden    = true;  plusBtn.classList.remove('active'); }
  function openPanel()     { panel.hidden    = false; plusBtn.classList.add('active'); }
  function closeMoreMenu() { moreMenu.hidden = true; }
  function openMoreMenu()  { moreMenu.hidden = false; }
  function closeBubbleMenu() { bubbleMenu.hidden = true; activeBubbleMsgId = null; }

  function setReplyTo(msgId) {
    replyingTo = msgId;
    replyText.textContent = (previewMap.get(msgId) || '(已删除的消息)').slice(0, 80);
    replyBar.hidden = false;
    input.focus();
  }
  function clearReply() {
    replyingTo = null;
    replyBar.hidden = true;
  }

  function showBubbleMenu(bubble, x, y) {
    const msgId = bubble.dataset.msgId;
    if (!msgId) return;
    activeBubbleMsgId = msgId;
    bubbleMenu.hidden = false;
    // Position the menu: place above the bubble, clamp to viewport (page).
    const pageRect = chatPage.getBoundingClientRect();
    const menuRect = bubbleMenu.getBoundingClientRect();
    let left = x - pageRect.left - menuRect.width / 2;
    let top  = y - pageRect.top  - menuRect.height - 8;
    if (left < 8) left = 8;
    if (left + menuRect.width > pageRect.width - 8) left = pageRect.width - menuRect.width - 8;
    if (top < 8) top = y - pageRect.top + 12;  // not enough room above, drop below
    bubbleMenu.style.left = left + 'px';
    bubbleMenu.style.top  = top  + 'px';
  }

  // ---- Handlers ----

  const onBack = () => router.back();

  const onSend = async () => {
    const text = input.value.trim();
    if (!text) return;
    const quoteId = replyingTo;
    input.value = '';
    autosize();
    closePanel();
    closeMoreMenu();
    closeBubbleMenu();
    const action = quoteId
      ? { type: 'reply', content: text, quoteMsgId: quoteId }
      : { type: 'text',  content: text };
    if (quoteId) clearReply();
    await appendUserMessage([action]);
  };

  const onAI = async () => {
    closePanel();
    closeMoreMenu();
    closeBubbleMenu();
    aiBtn.disabled = true;
    sendBtn.disabled = true;
    aiBtn.classList.add('loading');
    try {
      await ai.requestReply(sessionId);
      await refresh();
    } catch (e) {
      alert(`AI 回复失败:${String(e).slice(0, 300)}`);
    } finally {
      aiBtn.disabled = false;
      sendBtn.disabled = false;
      aiBtn.classList.remove('loading');
    }
  };

  const onPlusToggle = (e) => {
    e.stopPropagation();
    closeMoreMenu();
    closeBubbleMenu();
    if (panel.hidden) openPanel(); else closePanel();
  };

  const onPanelClick = async (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn || btn.disabled) return;
    if (btn.dataset.kind === 'voice') {
      const content = prompt('输入语音内容(以语音条形式显示):');
      if (!content) return;
      closePanel();
      await appendUserMessage([{
        type: 'voice',
        content: content.trim(),
        duration: Math.max(1, Math.round(content.length / 4)),
      }]);
    } else if (btn.dataset.kind === 'image') {
      const desc = prompt('图片描述(MVP 阶段用文字代替):');
      if (!desc) return;
      closePanel();
      await appendUserMessage([{ type: 'image', description: desc.trim() }]);
    }
  };

  const onMoreToggle = (e) => {
    e.stopPropagation();
    closePanel();
    closeBubbleMenu();
    if (moreMenu.hidden) openMoreMenu(); else closeMoreMenu();
  };

  const onMoreAction = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    closeMoreMenu();
    if (btn.dataset.action === 'pin') {
      session.isPinned = !session.isPinned;
      await db.set('chatSessions', session);
      pinItem.textContent = session.isPinned ? '取消置顶' : '置顶聊天';
    } else if (btn.dataset.action === 'clear') {
      if (!confirm('清空这个对话的所有消息和记忆?角色保留。')) return;
      const msgs = await db.query('chatMessages', 'sessionId', sessionId);
      for (const m of msgs) await db.del('chatMessages', m.id);
      const mems = await db.query('memories', 'sessionId', sessionId);
      for (const m of mems) await db.del('memories', m.id);
      clearReply();
      await refresh();
    } else if (btn.dataset.action === 'block') {
      if (!confirm('加入黑名单会删掉这个对话(消息 + 记忆),角色本身保留。继续?')) return;
      const msgs = await db.query('chatMessages', 'sessionId', sessionId);
      for (const m of msgs) await db.del('chatMessages', m.id);
      const mems = await db.query('memories', 'sessionId', sessionId);
      for (const m of mems) await db.del('memories', m.id);
      await db.del('chatSessions', sessionId);
      await router.navigate('chat-list');
    }
  };

  // Bubble context-menu open: long-press (touch) + right-click (desktop)
  let longPressTimer = null;
  let touchStartXY = null;

  const onStreamContextMenu = (e) => {
    const bubble = e.target.closest('.bubble');
    if (!bubble || !bubble.dataset.msgId) return;
    e.preventDefault();
    showBubbleMenu(bubble, e.clientX, e.clientY);
  };

  const onStreamTouchStart = (e) => {
    const bubble = e.target.closest('.bubble');
    if (!bubble || !bubble.dataset.msgId) return;
    const t = e.touches[0];
    touchStartXY = { x: t.clientX, y: t.clientY };
    longPressTimer = setTimeout(() => {
      if (touchStartXY) showBubbleMenu(bubble, touchStartXY.x, touchStartXY.y);
      longPressTimer = null;
    }, 500);
  };
  const onStreamTouchMove = (e) => {
    if (!longPressTimer || !touchStartXY) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartXY.x;
    const dy = t.clientY - touchStartXY.y;
    if (Math.hypot(dx, dy) > 10) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };
  const onStreamTouchEnd = () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    touchStartXY = null;
  };

  const onBubbleMenuAction = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !activeBubbleMsgId) return;
    const msgId = activeBubbleMsgId;
    closeBubbleMenu();
    if (btn.dataset.action === 'quote') {
      setReplyTo(msgId);
    } else if (btn.dataset.action === 'copy') {
      const text = previewMap.get(msgId) || '';
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        // fallback: select-copy via a temp textarea
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
      }
    } else if (btn.dataset.action === 'delete') {
      if (!confirm('删除这条消息?')) return;
      await db.del('chatMessages', msgId);
      if (replyingTo === msgId) clearReply();
      await refresh();
    }
  };

  const onReplyCancel = () => clearReply();

  const onKey = (e) => {
    if (e.key === 'Escape') {
      closePanel();
      closeMoreMenu();
      closeBubbleMenu();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Click outside any popup → close them.
  const onDocClick = (e) => {
    if (!moreMenu.hidden && !e.target.closest('.more-menu') && !e.target.closest('.more-btn')) {
      closeMoreMenu();
    }
    if (!bubbleMenu.hidden && !e.target.closest('.bubble-menu') && !e.target.closest('.bubble')) {
      closeBubbleMenu();
    }
  };

  backBtn.addEventListener('click', onBack);
  sendBtn.addEventListener('click', onSend);
  aiBtn.addEventListener('click', onAI);
  plusBtn.addEventListener('click', onPlusToggle);
  panel.addEventListener('click', onPanelClick);
  moreBtn.addEventListener('click', onMoreToggle);
  moreMenu.addEventListener('click', onMoreAction);
  bubbleMenu.addEventListener('click', onBubbleMenuAction);
  replyCancel.addEventListener('click', onReplyCancel);
  input.addEventListener('keydown', onKey);
  input.addEventListener('input', autosize);
  stream.addEventListener('contextmenu', onStreamContextMenu);
  stream.addEventListener('touchstart', onStreamTouchStart, { passive: true });
  stream.addEventListener('touchmove',  onStreamTouchMove,  { passive: true });
  stream.addEventListener('touchend',   onStreamTouchEnd);
  document.addEventListener('click', onDocClick);

  return () => {
    backBtn.removeEventListener('click', onBack);
    sendBtn.removeEventListener('click', onSend);
    aiBtn.removeEventListener('click', onAI);
    plusBtn.removeEventListener('click', onPlusToggle);
    panel.removeEventListener('click', onPanelClick);
    moreBtn.removeEventListener('click', onMoreToggle);
    moreMenu.removeEventListener('click', onMoreAction);
    bubbleMenu.removeEventListener('click', onBubbleMenuAction);
    replyCancel.removeEventListener('click', onReplyCancel);
    input.removeEventListener('keydown', onKey);
    input.removeEventListener('input', autosize);
    stream.removeEventListener('contextmenu', onStreamContextMenu);
    stream.removeEventListener('touchstart', onStreamTouchStart);
    stream.removeEventListener('touchmove',  onStreamTouchMove);
    stream.removeEventListener('touchend',   onStreamTouchEnd);
    document.removeEventListener('click', onDocClick);
    if (longPressTimer) clearTimeout(longPressTimer);
  };
}

function firstActionText(msg) {
  const a = (msg.actions ?? [])[0];
  if (!a) return '';
  switch (a.type) {
    case 'text':   return a.content || '';
    case 'reply':  return a.content || '';
    case 'image':  return `[图片] ${a.description || ''}`;
    case 'voice':  return `[语音] ${a.content || ''}`;
    case 'recall': return '[消息已撤回]';
    default:       return `[${a.type}]`;
  }
}

function renderMessage(msg, previewMap) {
  const side = msg.role === 'user' ? 'user' : 'char';
  return (msg.actions ?? []).map(a => renderAction(a, side, msg.id, previewMap)).join('');
}

function renderAction(a, side, msgId, previewMap) {
  const attrs = `data-msg-id="${esc(msgId)}"`;
  switch (a.type) {
    case 'text':
      return `<div class="bubble ${side}" ${attrs}>${esc(a.content || '')}</div>`;
    case 'reply': {
      const quoted = previewMap?.get(a.quoteMsgId) || '(已删除的消息)';
      return `<div class="bubble ${side} bubble-reply" ${attrs}>
        <div class="reply-quote">${esc(quoted.slice(0, 60))}</div>
        <div class="reply-content">${esc(a.content || '')}</div>
      </div>`;
    }
    case 'image':
      return `<div class="bubble ${side} bubble-image" ${attrs}>[图片] ${esc(a.description || a.src || '')}</div>`;
    case 'voice':
      return `<div class="bubble ${side} bubble-voice" ${attrs}>▶ ${esc(a.content || '')} · ${Number(a.duration) || 0}″</div>`;
    case 'recall':
      return `<div class="bubble-recall">[消息已撤回]</div>`;
    default:
      return `<div class="bubble ${side} bubble-unknown" ${attrs}>[${esc(a.type)}]</div>`;
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
