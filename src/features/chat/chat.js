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
  redpacket: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12a2 2 0 0 1 2 2v3H4V5a2 2 0 0 1 2-2zm-2 7h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9zm8 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>`,
  transfer:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5h.01M18 14.5h.01"/></svg>`,
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

  const isBlocked = !!character?.blocked;

  container.innerHTML = `
    <div class="page chat-page">
      <header class="page-header">
        <button class="back">‹</button>
        <div class="title">${esc(character?.name ?? '聊天')}${isBlocked ? ' <span class="blocked-badge">已拉黑</span>' : ''}</div>
        <button class="icon-btn more-btn" title="更多">${SVG.more}</button>
      </header>
      ${isBlocked ? `<div class="blocked-banner">这个角色已被你拉黑。AI 知情,会按角色人设决定怎么反应。解除拉黑的权利只在你手里。</div>` : ''}
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
        <button class="attach-item" data-kind="red_packet">
          <div class="icon-bg redpacket-bg">${SVG.redpacket}</div>
          <div class="label">红包</div>
        </button>
        <button class="attach-item" data-kind="transfer">
          <div class="icon-bg transfer-bg">${SVG.transfer}</div>
          <div class="label">转账</div>
        </button>
        <button class="attach-item" data-kind="location">
          <div class="icon-bg location-bg">${SVG.pin}</div>
          <div class="label">位置</div>
        </button>
      </div>
      <div class="bubble-menu" hidden>
        <button data-action="quote">引用</button>
        <button data-action="copy">复制</button>
        <button data-action="favorite">收藏</button>
        <button data-action="edit" class="only-user">编辑</button>
        <button data-action="regenerate">重新生成</button>
        <button data-action="delete" class="danger">删除</button>
      </div>
    </div>
  `;

  const stream      = container.querySelector('.chat-stream');

  // Per-character chat appearance overrides — read once on mount. Edits to the
  // character require navigating back into chat (chat-info → 聊天美化 → 保存),
  // which re-mounts this page, so we don't need live-watch here.
  if (character?.chatBackground) {
    // Layer a flat color overlay on top of the image so 「聊天背景遮罩」
    // (settings → 外观 → 透明度) can dim the wallpaper for legibility.
    const overlayPct = await readOverlayPct();
    const rgba = await readBgRgba(overlayPct);
    stream.style.backgroundImage = `linear-gradient(${rgba}, ${rgba}), url(${cssUrl(character.chatBackground)})`;
    stream.style.backgroundSize = 'cover, cover';
    stream.style.backgroundPosition = 'center, center';
    // 'scroll' (default) keeps the wallpaper anchored to the visible area
    // rather than scrolling with messages.
    stream.style.backgroundRepeat = 'no-repeat, no-repeat';
  }
  if (character?.chatFontSize) {
    stream.style.fontSize = `${character.chatFontSize}px`;
  }
  const input       = container.querySelector('.text-input');
  const sendBtn     = container.querySelector('.send-btn');
  const aiBtn       = container.querySelector('.ai-btn');
  const plusBtn     = container.querySelector('.plus-btn');
  const moreBtn     = container.querySelector('.more-btn');
  const panel       = container.querySelector('.attach-panel');
  const bubbleMenu  = container.querySelector('.bubble-menu');
  const replyBar    = container.querySelector('.reply-preview');
  const replyText   = container.querySelector('.reply-preview-text');
  const replyCancel = container.querySelector('.reply-cancel');
  const backBtn     = container.querySelector('.back');
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
    // Re-read character + session every refresh — pin / read receipt / blocked
    // can change behind the scenes.
    const cur     = await db.get('characters', session.characterId);
    const freshS  = await db.get('chatSessions', sessionId) || session;
    const persona = freshS.personaId ? await db.get('personas', freshS.personaId) : null;
    Object.assign(session, freshS);

    const showReceipts = freshS.showReadReceipts !== false;  // default on
    const showAvatars  = freshS.showAvatars       !== false;  // default on
    const readUpTo     = Number(freshS.readReceiptUpToTs || 0);

    const ctx = { previewMap, character: cur, persona, showReceipts, showAvatars, readUpTo };

    const parts = [];
    let prevTs = null;
    for (const m of msgs) {
      const sep = timeSeparator(m.createdAt, prevTs);
      if (sep) parts.push(`<div class="time-separator">${esc(sep)}</div>`);
      parts.push(renderMessageRow(m, ctx));
      prevTs = m.createdAt;
    }
    stream.innerHTML = parts.join('');
    stream.scrollTop = stream.scrollHeight;
  }
  await refresh();

  // Wallet helpers — gate user-initiated transfers/red_packets on balance.
  // tryDeductWallet returns false if balance insufficient (user notified).
  async function tryDeductWallet(amount, kindLabel) {
    const w = (await db.get('wallet', 'default')) || { id: 'default', balance: 0 };
    const balance = Number(w.balance || 0);
    if (balance < amount) {
      alert(`余额不足 — 当前 ¥${balance.toFixed(2)},${kindLabel}需 ¥${amount.toFixed(2)}。去「我 → 钱包」充值。`);
      return false;
    }
    w.balance = Number((balance - amount).toFixed(2));
    await db.set('wallet', w);
    console.log(`[wallet] -${amount} (${kindLabel}); balance: ${w.balance}`);
    return true;
  }
  async function creditWallet(amount, kindType) {
    const w = (await db.get('wallet', 'default')) || { id: 'default', balance: 0 };
    w.balance = Number((Number(w.balance || 0) + amount).toFixed(2));
    await db.set('wallet', w);
    console.log(`[wallet] +${amount} (${kindType}); balance: ${w.balance}`);
  }

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
    // Side-specific entries: user msgs show 编辑 (not 重新生成),
    // character msgs show 重新生成 (not 编辑). Driven by class on the menu,
    // hidden in CSS per .only-user / .only-char.
    const row = bubble.closest('.msg-row');
    const isUser = !!row?.classList.contains('user');
    bubbleMenu.classList.toggle('for-user',  isUser);
    bubbleMenu.classList.toggle('for-char', !isUser);
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
    closeBubbleMenu();
    const action = quoteId
      ? { type: 'reply', content: text, quoteMsgId: quoteId }
      : { type: 'text',  content: text };
    if (quoteId) clearReply();
    await appendUserMessage([action]);
  };

  const onAI = async () => {
    closePanel();
    closeBubbleMenu();
    aiBtn.disabled = true;
    sendBtn.disabled = true;
    aiBtn.classList.add('loading');
    try {
      const result = await ai.requestReply(sessionId);
      // After AI replies, all preceding user messages count as 已读.
      await markReadUpToLatestUserMsg();
      await refresh();
      // Reveal the new character bubbles one by one so multi-action replies
      // (which currently arrive as one DB write with N actions) don't dump
      // all bubbles into the stream at the same instant. Pacing is rough —
      // length-based, capped 2s — but it's enough to feel like the other
      // side is typing rather than flooding.
      await streamingReveal(result?.messageId);
    } catch (e) {
      alert(`AI 回复失败:${String(e).slice(0, 300)}`);
    } finally {
      aiBtn.disabled = false;
      sendBtn.disabled = false;
      aiBtn.classList.remove('loading');
    }
  };

  async function streamingReveal(msgId) {
    if (!msgId) return;
    const items = stream.querySelectorAll(`[data-msg-id="${cssEscape(msgId)}"]`);
    if (items.length === 0) return;
    for (const el of items) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      el.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
    }
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      const text = (el.textContent || '').trim();
      const delay = i === 0 ? 150 : Math.min(2000, 250 + text.length * 35);
      await new Promise(r => setTimeout(r, delay));
      el.style.opacity = '';
      el.style.transform = '';
      stream.scrollTop = stream.scrollHeight;
    }
  }

  async function markReadUpToLatestUserMsg() {
    const all = await db.query('chatMessages', 'sessionId', sessionId);
    const userMsgs = all.filter(m => m.role === 'user');
    if (userMsgs.length === 0) return;
    const latestTs = Math.max(...userMsgs.map(m => m.createdAt));
    const s = await db.get('chatSessions', sessionId);
    if (!s) return;
    if ((s.readReceiptUpToTs || 0) >= latestTs) return;
    s.readReceiptUpToTs = latestTs;
    await db.set('chatSessions', s);
    Object.assign(session, s);
  }

  const onPlusToggle = (e) => {
    e.stopPropagation();
    closeBubbleMenu();
    if (panel.hidden) openPanel(); else closePanel();
  };

  const onPanelClick = async (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn || btn.disabled) return;
    closePanel();
    if (btn.dataset.kind === 'voice') {
      const v = await openAttachModal(container, {
        title: '发送语音',
        fields: [{ name: 'content', label: '语音内容(会以语音条形式显示)', kind: 'textarea', required: true }],
        submitLabel: '发送',
      });
      if (!v) return;
      await appendUserMessage([{
        type: 'voice',
        content: v.content.trim(),
        duration: Math.max(1, Math.round(v.content.length / 4)),
      }]);
    } else if (btn.dataset.kind === 'image') {
      const v = await openAttachModal(container, {
        title: '发送图片',
        fields: [{ name: 'description', label: '图片描述(MVP 阶段用文字代替)', kind: 'textarea', required: true }],
        submitLabel: '发送',
      });
      if (!v) return;
      await appendUserMessage([{ type: 'image', description: v.description.trim() }]);
    } else if (btn.dataset.kind === 'red_packet') {
      const v = await openAttachModal(container, {
        title: '发红包',
        fields: [
          { name: 'amount',  label: '金额 (¥)', kind: 'number', defaultValue: '5.20', required: true, min: 0.01, step: 0.01 },
          { name: 'message', label: '封皮祝福语(可选)', kind: 'text', defaultValue: '恭喜发财' },
        ],
        submitLabel: '塞进红包',
      });
      if (!v) return;
      const amount = parseFloat(v.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const rounded = Number(amount.toFixed(2));
      if (!(await tryDeductWallet(rounded, '红包'))) return;
      await appendUserMessage([{
        type: 'red_packet',
        amount: rounded,
        message: String(v.message || '').trim(),
      }]);
    } else if (btn.dataset.kind === 'location') {
      const v = await openAttachModal(container, {
        title: '发送位置',
        fields: [
          { name: 'name', label: '地点名', kind: 'text', required: true, defaultValue: '', placeholder: '比如:外滩 / 某某咖啡馆' },
          { name: 'desc', label: '描述(可选)', kind: 'text' },
        ],
        submitLabel: '发送',
      });
      if (!v) return;
      await appendUserMessage([{
        type: 'location',
        name: String(v.name || '').trim(),
        desc: String(v.desc || '').trim(),
      }]);
    } else if (btn.dataset.kind === 'transfer') {
      const v = await openAttachModal(container, {
        title: '转账',
        fields: [
          { name: 'amount',  label: '金额 (¥)', kind: 'number', defaultValue: '100', required: true, min: 0.01, step: 0.01 },
          { name: 'message', label: '转账说明(可选)', kind: 'text' },
        ],
        submitLabel: '确认转账',
      });
      if (!v) return;
      const amount = parseFloat(v.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const rounded = Number(amount.toFixed(2));
      if (!(await tryDeductWallet(rounded, '转账'))) return;
      await appendUserMessage([{
        type: 'transfer',
        amount: rounded,
        message: String(v.message || '').trim(),
      }]);
    }
  };

  const onMoreToggle = (e) => {
    e.stopPropagation();
    closePanel();
    closeBubbleMenu();
    router.navigate('chat-info', { sessionId });
  };

  // Bubble context-menu open: long-press (touch) + right-click (desktop)
  let longPressTimer = null;
  let touchStartXY = null;

  const onStreamClick = async (e) => {
    // Voice bubbles used to need a click to reveal the transcript; that
    // mechanic is gone (transcript is now inline). Whole-bubble click is
    // a no-op now.

    // Claim a red_packet / transfer bubble — the whole .claimable card is the
    // hit target (WeChat-style: tap anywhere on the envelope to open).
    const claimable = e.target.closest('.bubble-money.claimable');
    if (claimable) {
      const msgId = claimable.dataset.msgId;
      const idx = Number(claimable.dataset.actionIdx);
      const msg = await db.get('chatMessages', msgId);
      if (!msg || !Array.isArray(msg.actions) || !msg.actions[idx]) return;
      if (msg.actions[idx].claimed) return;
      msg.actions[idx] = { ...msg.actions[idx], claimed: true, claimedAt: Date.now() };
      await db.set('chatMessages', msg);
      // Credit the user's wallet with the claimed amount.
      const amt = Number(msg.actions[idx].amount || 0);
      if (amt > 0) await creditWallet(amt, msg.actions[idx].type);
      await refresh();
      return;
    }

    // Unblock request
    const ub = e.target.closest('.unblock-btn');
    if (!ub || ub.disabled) return;
    const fresh = await db.get('characters', session.characterId);
    if (!fresh?.blocked) {
      // already unblocked elsewhere — just refresh the view
      await refresh();
      return;
    }
    if (!confirm(`解除对「${fresh.name || '这个角色'}」的拉黑?`)) return;
    fresh.blocked = false;
    fresh.updatedAt = Date.now();
    await db.set('characters', fresh);
    await router.navigate('chat', { sessionId });
  };

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
    const bubble = stream.querySelector(`.bubble[data-msg-id="${cssEscape(msgId)}"]`);
    const actionIdx = bubble ? Number(bubble.dataset.actionIdx || 0) : 0;
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
    } else if (btn.dataset.action === 'favorite') {
      // De-dup: if this exact (msgId, actionIdx) is already favorited, skip.
      const existing = await db.query('favorites', 'sessionId', sessionId);
      const dupe = existing.find(f => f.msgId === msgId && (f.actionIdx ?? 0) === actionIdx);
      if (dupe) {
        alert('已经在收藏里了');
      } else {
        await db.set('favorites', {
          id: db.newId(),
          sessionId,
          msgId,
          actionIdx,
          savedAt: Date.now(),
        });
        // Subtle toast: reuse alert for now, polished UI later.
        // alert('已加入收藏');
      }
    } else if (btn.dataset.action === 'edit') {
      // In-place edit: find the action by idx, prompt for the editable field
      // based on its type, write back. Only the *text-bearing* fields are
      // editable (content / message / description / etc.) — structural fields
      // like amount or recall target stay untouched here to keep the action
      // protocol intact. recall actions can't be edited (no content to change).
      const msg = await db.get('chatMessages', msgId);
      if (!msg || !Array.isArray(msg.actions)) return;
      const a = msg.actions[actionIdx];
      if (!a) return;
      const editTarget = pickEditField(a);
      if (!editTarget) { alert('这种消息没法编辑'); return; }
      // Long-form fields → textarea; short single-line fields → text input.
      const longForm = editTarget.field === 'content'
        || editTarget.field === 'description'
        || editTarget.field === 'message';
      const v = await openAttachModal(container, {
        title: editTarget.label,
        fields: [{
          name: 'value',
          label: editTarget.label,
          kind: longForm ? 'textarea' : 'text',
          defaultValue: editTarget.value,
          required: true,
        }],
        submitLabel: '保存',
      });
      if (!v) return;
      msg.actions = msg.actions.map((x, i) => i === actionIdx ? { ...x, [editTarget.field]: v.value } : x);
      await db.set('chatMessages', msg);
      await refresh();

    } else if (btn.dataset.action === 'regenerate') {
      // Regenerate from this point: works on both user and character msgs.
      // - On a user msg: delete every AI reply that came after, then ask the
      //   AI to reply again (now seeing history up to this user msg).
      // - On a character msg: also delete this msg itself, then regenerate
      //   (so the result replaces it).
      // We don't touch user messages other than the target — the user wrote
      // them and probably wants them preserved.
      const target = await db.get('chatMessages', msgId);
      if (!target) return;
      const all = await db.query('chatMessages', 'sessionId', sessionId);
      all.sort((a, b) => a.createdAt - b.createdAt);
      const targetIdx = all.findIndex(m => m.id === msgId);
      const toDelete = [];
      if (target.role === 'character') toDelete.push(target);
      for (let i = targetIdx + 1; i < all.length; i++) {
        if (all[i].role === 'character') toDelete.push(all[i]);
      }
      const promptText = toDelete.length === 0
        ? '让 AI 基于当前对话再生成一条新回复,确定吗?'
        : `重新生成会删除这条之后的 ${toDelete.length} 条 AI 回复,然后让 AI 重新回复。确定吗?`;
      if (!confirm(promptText)) return;
      for (const m of toDelete) await db.del('chatMessages', m.id);
      await refresh();
      aiBtn.disabled = true;
      sendBtn.disabled = true;
      aiBtn.classList.add('loading');
      try {
        const result = await ai.requestReply(sessionId);
        await markReadUpToLatestUserMsg();
        await refresh();
        await streamingReveal(result?.messageId);
      } catch (e) {
        alert(`重新生成失败:${String(e).slice(0, 300)}`);
      } finally {
        aiBtn.disabled = false;
        sendBtn.disabled = false;
        aiBtn.classList.remove('loading');
      }

    } else if (btn.dataset.action === 'delete') {
      if (!confirm('删除这一条消息?(只删本条,前后消息保留)')) return;
      await db.del('chatMessages', msgId);
      if (replyingTo === msgId) clearReply();
      await refresh();
    }
  };

  // Return { field, value, label } for the editable text on an action, or
  // null if the action has nothing reasonable to edit (recall, etc).
  function pickEditField(a) {
    switch (a.type) {
      case 'text':            return { field: 'content',     value: a.content     || '', label: '编辑文字' };
      case 'reply':           return { field: 'content',     value: a.content     || '', label: '编辑回复内容' };
      case 'voice':           return { field: 'content',     value: a.content     || '', label: '编辑语音文字' };
      case 'image':           return { field: 'description', value: a.description || '', label: '编辑图片描述' };
      case 'unblock_request': return { field: 'content',     value: a.content     || '', label: '编辑请求说明' };
      case 'red_packet':      return { field: 'message',     value: a.message     || '', label: '编辑红包祝福语' };
      case 'transfer':        return { field: 'message',     value: a.message     || '', label: '编辑转账说明' };
      case 'location':        return { field: 'name',        value: a.name        || '', label: '编辑地点名' };
      default: return null;
    }
  }

  const onReplyCancel = () => clearReply();

  const onKey = (e) => {
    if (e.key === 'Escape') {
      closePanel();
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
  bubbleMenu.addEventListener('click', onBubbleMenuAction);
  replyCancel.addEventListener('click', onReplyCancel);
  input.addEventListener('keydown', onKey);
  input.addEventListener('input', autosize);
  stream.addEventListener('click', onStreamClick);
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
    bubbleMenu.removeEventListener('click', onBubbleMenuAction);
    replyCancel.removeEventListener('click', onReplyCancel);
    input.removeEventListener('keydown', onKey);
    input.removeEventListener('input', autosize);
    stream.removeEventListener('click', onStreamClick);
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
    case 'unblock_request': return `[请求解除拉黑] ${a.content || ''}`;
    case 'red_packet': return `[红包 ¥${Number(a.amount).toFixed(2)}] ${a.message || ''}`;
    case 'transfer':   return `[转账 ¥${Number(a.amount).toFixed(2)}] ${a.message || ''}`;
    case 'location':   return `[位置] ${a.name || ''}${a.desc ? ' · ' + a.desc : ''}`;
    default:       return `[${a.type}]`;
  }
}

function renderMessageRow(msg, ctx) {
  const side = msg.role === 'user' ? 'user' : 'char';
  // Recall actions render centered; treat them as standalone separator-style rows.
  const isOnlyRecall = (msg.actions ?? []).every(a => a.type === 'recall');
  if (isOnlyRecall) {
    return (msg.actions ?? []).map((a, i) => renderAction(a, side, msg.id, i, ctx.previewMap, ctx.character)).join('');
  }
  const bubbles = (msg.actions ?? [])
    .map((a, i) => renderAction(a, side, msg.id, i, ctx.previewMap, ctx.character))
    .join('');
  const who = side === 'user' ? ctx.persona : ctx.character;
  const avatar = ctx.showAvatars ? renderRowAvatar(who, side) : '';
  const showRead = ctx.showReceipts && side === 'user' && msg.createdAt <= ctx.readUpTo;
  const readMark = showRead ? `<div class="read-mark">已读</div>` : '';
  // Archived messages (compressed into a memory summary) are dimmed so the
  // user can see "this part has been summarized; the AI now reads the
  // summary instead of the originals", while still being able to scroll
  // through the actual history.
  const clsList = ['msg-row', side];
  if (!ctx.showAvatars) clsList.push('no-avatar');
  if (msg.archived) clsList.push('archived');
  return `<div class="${clsList.join(' ')}">${avatar}<div class="msg-actions">${bubbles}${readMark}</div></div>`;
}

function renderRowAvatar(who, side) {
  if (who?.avatar) {
    return `<div class="msg-avatar ${side}"><img src="${esc(who.avatar)}" alt=""></div>`;
  }
  const initial = (who?.name ?? (side === 'user' ? '我' : '?')).slice(0, 1);
  return `<div class="msg-avatar ${side}">${esc(initial)}</div>`;
}

// Returns a header string if a separator should be inserted, else null.
// Rule: first message always; otherwise gap >= 5 minutes.
function timeSeparator(ts, prevTs) {
  if (prevTs && (ts - prevTs) < 5 * 60 * 1000) return null;
  return formatChatTime(ts);
}

function formatChatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const hhmm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  if (sameDay)      return hhmm;
  if (isYesterday)  return `昨天 ${hhmm}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear)     return `${d.getMonth()+1}月${d.getDate()}日 ${hhmm}`;
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${hhmm}`;
}

function renderAction(a, side, msgId, idx, previewMap, character) {
  const attrs = `data-msg-id="${esc(msgId)}" data-action-idx="${idx}"`;
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
    case 'voice': {
      // Inline voice bubble: a small "▶ N″" prefix tag + the transcript right
      // after it, so the bubble width follows content length (just like a
      // text bubble) and the transcript is visible without an extra tap —
      // the old click-to-reveal mechanic was unreliable on desktop and the
      // fixed 220px voice-bar looked oversized next to one-line text bubbles.
      const dur = Number(a.duration) || Math.max(1, Math.round((a.content || '').length / 4));
      return `<div class="bubble ${side} bubble-voice" ${attrs}><span class="voice-meta">▶ ${dur}″</span>${esc(a.content || '')}</div>`;
    }
    case 'recall':
      return `<div class="bubble-recall">[消息已撤回]</div>`;
    case 'unblock_request': {
      const stillBlocked = !!character?.blocked;
      const label = stillBlocked ? '解除拉黑(同意 TA 重新联系你)' : '已解除';
      const dis   = stillBlocked ? '' : ' disabled';
      return `<div class="bubble ${side} bubble-unblock-request" ${attrs}>
        <div class="ur-label">解除拉黑请求</div>
        <div class="ur-content">${esc(a.content || '')}</div>
        <button class="btn unblock-btn"${dis}>${label}</button>
      </div>`;
    }
    case 'red_packet':
      return renderMoneyBubble({ kind: 'red_packet', a, side, attrs, label: '红包', verb: '领取', verbDone: '已领取' });
    case 'transfer':
      return renderMoneyBubble({ kind: 'transfer', a, side, attrs, label: '转账', verb: '接收', verbDone: '已接收' });
    case 'location':
      return `<div class="bubble ${side} bubble-location" ${attrs}>
        <div class="location-icon">${SVG.pin}</div>
        <div class="location-body">
          <div class="location-name">${esc(a.name || '(未指明)')}</div>
          ${a.desc ? `<div class="location-desc">${esc(a.desc)}</div>` : ''}
        </div>
      </div>`;
    default:
      return `<div class="bubble ${side} bubble-unknown" ${attrs}>[${esc(a.type)}]</div>`;
  }
}

// Shared rendering for red_packet + transfer cards. Wide-and-short WeChat
// style: icon on the left, label + message in the middle, amount on the right;
// state hint (领取/已领取/等待对方领取) on a thin footer strip.
//
// The whole card is the clickable target when the user can claim — no nested
// button, simpler hit area and matches WeChat's actual interaction.
function renderMoneyBubble({ kind, a, side, attrs, label, verb, verbDone }) {
  const claimed = !!a.claimed;
  const amount = Number(a.amount || 0).toFixed(2);
  const userIsReceiver = side === 'char';
  const claimable = !claimed && userIsReceiver;
  const stateLabel = claimed ? verbDone
    : claimable ? `点击${verb}`
    : `等待对方${verb}`;
  const icon = kind === 'red_packet' ? SVG.redpacket : SVG.transfer;
  const claimAttr = claimable ? ' data-claim-kind="' + kind + '"' : '';
  return `<div class="bubble ${side} bubble-money bubble-${kind}${claimed ? ' claimed' : ''}${claimable ? ' claimable' : ''}" ${attrs}${claimAttr}>
    <div class="money-top">
      <div class="money-icon">${icon}</div>
      <div class="money-body">
        <div class="money-title">${label}${a.message ? '<span class="money-msg">' + esc(a.message) + '</span>' : ''}</div>
        <div class="money-amount">¥${amount}</div>
      </div>
    </div>
    <div class="money-state">${stateLabel}</div>
  </div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}

// Escape a URL for use inside CSS url(...). Wrap in quotes and escape inner quotes.
function cssUrl(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

async function readOverlayPct() {
  const settings = await db.get('settings', 'default');
  const t = settings?.theme?.effects;
  const v = Number(t?.transparency ?? 0);
  return Math.max(0, Math.min(100, v));
}

async function readBgRgba(overlayPct) {
  const settings = await db.get('settings', 'default');
  const bgHex = settings?.theme?.bg || '#f5f5f7';
  const { r, g, b } = hexToRgb(bgHex);
  const a = overlayPct / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

// In-frame attach modal — replaces window.prompt() for voice / image / red_packet
// / transfer inputs. Returns a Promise<object|null>: keys map to field.name,
// values are strings. Null = user cancelled.
function openAttachModal(container, { title, fields, submitLabel = '确认' }) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop attach-modal-backdrop';
    modal.innerHTML = `
      <div class="modal attach-modal">
        <div class="modal-header">${esc(title)}</div>
        <form class="attach-modal-form" autocomplete="off">
          ${fields.map(f => renderAttachField(f)).join('')}
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">${esc(submitLabel)}</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);

    const form = modal.querySelector('form');
    const firstInput = form.querySelector('input, textarea');
    setTimeout(() => firstInput?.focus(), 0);

    const cleanup = () => modal.remove();

    modal.querySelector('.cancel-btn').addEventListener('click', () => {
      cleanup();
      resolve(null);
    });
    modal.addEventListener('click', (e) => {
      // Click outside the .modal box but inside the backdrop — dismiss.
      if (e.target === modal) {
        cleanup();
        resolve(null);
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.querySelector(`[name="${cssEscape(f.name)}"]`);
        out[f.name] = el?.value ?? '';
      }
      // Light validation: required fields must be non-empty.
      for (const f of fields) {
        if (f.required && !String(out[f.name] ?? '').trim()) {
          form.querySelector(`[name="${cssEscape(f.name)}"]`)?.focus();
          return;
        }
      }
      cleanup();
      resolve(out);
    });
  });
}

function renderAttachField(f) {
  const id   = `attach-${f.name}`;
  const def  = f.defaultValue ?? '';
  if (f.kind === 'textarea') {
    return `
      <label for="${id}">
        <div class="label-text">${esc(f.label)}</div>
        <textarea id="${id}" name="${esc(f.name)}" rows="4"${f.required ? ' required' : ''}>${esc(def)}</textarea>
      </label>
    `;
  }
  const type = f.kind === 'number' ? 'number' : 'text';
  const extra = [];
  if (f.required) extra.push('required');
  if (f.min != null)  extra.push(`min="${f.min}"`);
  if (f.step != null) extra.push(`step="${f.step}"`);
  return `
    <label for="${id}">
      <div class="label-text">${esc(f.label)}</div>
      <input id="${id}" type="${type}" name="${esc(f.name)}" value="${esc(def)}" ${extra.join(' ')}>
    </label>
  `;
}

// Wrap CSS.escape so attribute-value selectors like [data-msg-id="..."]
// stay safe regardless of what the id contains (`]` / `\` / newline / etc.).
// CSS.escape returns numeric escapes for special chars, legal inside a
// "..."-wrapped attribute value.
function cssEscape(s) { return CSS.escape(String(s)); }
