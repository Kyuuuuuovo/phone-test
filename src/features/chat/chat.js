// Chat page. Bubbles, input, AI trigger, push-up attach panel,
// header "more" menu, bubble context menu (long-press / right-click), reply preview.

import * as db from '../../core/db.js';
import * as ai from '../../core/ai.js';
import * as context from '../../core/context.js';
import * as notify from '../../core/notify.js';
import { openConfirm, openAlert, openModal } from '../../core/modal.js';
import { esc } from '../../core/util.js';

const SVG = {
  plus:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`,
  send:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
  ai:    `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 3l1.5 4.5L17 9l-4.5 1.5L11 15l-1.5-4.5L5 9l4.5-1.5L11 3zM18 13l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5z"/></svg>`,
  more:  `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
  voice: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1-3.29-2.5-4.03v8.06c1.5-.74 2.5-2.26 2.5-4.03z"/></svg>`,
  gear:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h5L15 6h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  pin:   `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>`,
  redpacket: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12a2 2 0 0 1 2 2v3H4V5a2 2 0 0 1 2-2zm-2 7h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9zm8 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>`,
  transfer:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5h.01M18 14.5h.01"/></svg>`,
  thought: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10c0-2.2 2.2-4 5-4s5 1.8 5 4-2.2 4-5 4c-.5 0-1 0-1.4-.1L7 16l.6-2.7C7.2 12.5 7 11.3 7 10z"/><circle cx="5" cy="19" r="1"/><circle cx="3" cy="21.5" r="0.6"/></svg>`,
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
  // devMode gates the gear icon (prompt inspector). Author-only — kept off
  // for end users so they don't see / fiddle with raw prompt sections.
  const settingsRow = (await db.get('settings', 'default')) || {};
  const devMode = settingsRow.devMode === true;

  container.innerHTML = `
    <div class="page chat-page">
      <header class="page-header">
        <button class="back">‹</button>
        <div class="title">${esc(character?.name ?? '聊天')}${isBlocked ? ' <span class="blocked-badge">已拉黑</span>' : ''}</div>
        <div class="header-actions">
          ${devMode ? `<span class="token-badge" title="下次发送的 tokens 预估(系统提示 + 历史)">…</span>` : ''}
          ${devMode ? `<button class="icon-btn inspector-btn" title="提示词调试">${SVG.gear}</button>` : ''}
          <button class="icon-btn more-btn" title="更多">${SVG.more}</button>
        </div>
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
      <div class="inner-voice-row" hidden>
        <textarea class="inner-voice-input" rows="1" placeholder="心声(角色感知到但不复述)..."></textarea>
      </div>
      <div class="chat-input">
        <button class="icon-btn plus-btn" title="附件">${SVG.plus}</button>
        <button class="icon-btn iv-btn" title="心声(给角色看真实情绪,角色不复述)">${SVG.thought}</button>
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
        <button class="attach-item" data-kind="camera">
          <div class="icon-bg">${SVG.camera}</div>
          <div class="label">拍照</div>
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
        <button data-action="resummarize" class="only-user">从这里重新总结</button>
        <button data-action="inner-voice" class="only-char">心声</button>
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
  const ivBtn       = container.querySelector('.iv-btn');
  const ivRow       = container.querySelector('.inner-voice-row');
  const ivInput     = container.querySelector('.inner-voice-input');
  const sendBtn     = container.querySelector('.send-btn');
  const aiBtn       = container.querySelector('.ai-btn');
  const plusBtn     = container.querySelector('.plus-btn');
  const moreBtn     = container.querySelector('.more-btn');
  const inspectorBtn = container.querySelector('.inspector-btn');
  const tokenBadge   = container.querySelector('.token-badge');
  const panel       = container.querySelector('.attach-panel');
  const bubbleMenu  = container.querySelector('.bubble-menu');
  const replyBar    = container.querySelector('.reply-preview');
  const replyText   = container.querySelector('.reply-preview-text');
  const replyCancel = container.querySelector('.reply-cancel');
  const backBtn     = container.querySelector('.back');
  const chatPage    = container.querySelector('.chat-page');

  // T25: per-character 气泡样式 — 4 路 apply,base.css 有 6 preset 兜底:
  //   (a) preset → `.chat-page[data-bubble-preset="ios"]` attr
  //   (b) 字段微调 → CSS var on .chat-page(覆盖 preset 默认)
  //   (c) 自由 CSS → inject `<style>` 到 .chat-page 末尾
  // 字段值留空 / null = preset 默认。preset='' = 没选 preset,全走 base.css 默认。
  if (chatPage && character?.chatBubbleStyle) {
    const cb = character.chatBubbleStyle;
    if (cb.preset) chatPage.dataset.bubblePreset = cb.preset;
    if (Number.isFinite(cb.bubbleRadius)) chatPage.style.setProperty('--chat-bubble-radius', `${cb.bubbleRadius}px`);
    if (cb.bubblePadding) chatPage.style.setProperty('--chat-bubble-padding', cb.bubblePadding);
    if (cb.userBubbleColor) chatPage.style.setProperty('--chat-bubble-user-bg', cb.userBubbleColor);
    if (cb.charBubbleColor) chatPage.style.setProperty('--chat-bubble-char-bg', cb.charBubbleColor);
    if (cb.customCss && cb.customCss.trim()) {
      const styleEl = document.createElement('style');
      styleEl.className = 'chat-custom-css';
      // user 自己负责 scope —— UI hint 已经写「自己用 .chat-page 前缀」
      styleEl.textContent = cb.customCss;
      chatPage.appendChild(styleEl);
    }
  }

  // Per-render preview map: msgId -> first-action text (for inline quote rendering)
  let previewMap = new Map();
  // State
  let replyingTo = null;        // { msgId, actionIdx } currently being quoted
  let activeBubbleMsgId = null;     // msgId the bubble-menu was opened for
  let activeBubbleActionIdx = 0;    // 同 msg row 里第几个 bubble(action 数组下标)。
                                    // 之前 handler 用 querySelector 拿同 msgId 的第一个 .bubble
                                    // → actionIdx 永远 0,user 点第 3 个气泡复制/删除都作用在第 1 个。
  // Which archive groups are currently expanded. Keyed by archivedIntoMemoryId
  // (or '_unknown' for orphan archived rows). Reset is per-mount, not per-refresh,
  // so toggling expand survives re-renders triggered by reply / send / edit.
  const expandedArchiveGroups = new Set();

  // 红包 / 转账详情 modal — 点击非 claimable 的卡片时弹出,显示 from /
  // 时间 / 金额 / 留言 / 状态。modal 自己创建,不用 openModal helper(那
  // 个是 form 输入用的)。
  async function openMoneyDetail(msg, action) {
    const isUserSent = msg.role === 'user';
    const persona = session.personaId ? await db.get('personas', session.personaId) : null;
    const fromName = isUserSent ? (persona?.name || '我') : (character?.name || '(未知角色)');
    const kindLabel = action.type === 'red_packet' ? '红包' : '转账';
    const amount = Number(action.amount || 0).toFixed(2);
    const fmtFull = (ts) => {
      const d = new Date(ts);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    let stateLine;
    if (action.returned) {
      stateLine = `已退回 · ${action.returnedAt ? fmtFull(action.returnedAt) : '未知时间'}(对方 24 小时未领取,金额已退回钱包)`;
    } else if (action.claimed) {
      stateLine = `${action.type === 'red_packet' ? '已领取' : '已接收'} · ${action.claimedAt ? fmtFull(action.claimedAt) : '未知时间'}`;
    } else {
      stateLine = `等待对方${action.type === 'red_packet' ? '领取' : '接收'}`;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal money-detail-modal">
        <div class="modal-header">${kindLabel}详情</div>
        <div class="money-detail-body">
          <div class="money-detail-amount">¥${amount}</div>
          ${action.message ? `<div class="money-detail-msg">${esc(action.message)}</div>` : ''}
          <div class="money-detail-rows">
            <div class="md-row"><span class="md-label">来自</span><span class="md-value">${esc(fromName)}</span></div>
            <div class="md-row"><span class="md-label">发送时间</span><span class="md-value">${esc(fmtFull(msg.createdAt))}</span></div>
            <div class="md-row"><span class="md-label">状态</span><span class="md-value">${esc(stateLine)}</span></div>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn close-btn">关闭</button>
        </div>
      </div>
    `;
    container.appendChild(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('.close-btn').addEventListener('click', close);
  }

  // 24h 拒收退回扫描:user 发的红包 / 转账,超 24h 仍未领取 → mark returned
  // + 退还金额到 user wallet。在 refresh 顶部跑,所以每次刷新 chat 都自动
  // 处理过期的。仅 user 发的(role=user),AI 发的不退(逻辑上 AI 是 sender,
  // user 收的不存在"对方不领"问题)。
  const RETURN_AFTER_MS = 24 * 60 * 60 * 1000;
  async function expireOldMoneyActions(msgs) {
    const now = Date.now();
    let changed = false;
    for (const msg of msgs) {
      if (msg.role !== 'user' || msg.archived) continue;
      if (!Array.isArray(msg.actions)) continue;
      const age = now - (msg.createdAt || 0);
      if (age < RETURN_AFTER_MS) continue;
      let dirty = false;
      for (let i = 0; i < msg.actions.length; i++) {
        const a = msg.actions[i];
        if (a.type !== 'red_packet' && a.type !== 'transfer') continue;
        if (a.claimed || a.returned) continue;
        // 退还金额到 user wallet
        const amt = Number(a.amount || 0);
        if (amt > 0) await creditWallet(amt, a.type);
        msg.actions[i] = { ...a, returned: true, returnedAt: now };
        dirty = true;
      }
      if (dirty) {
        await db.set('chatMessages', msg);
        changed = true;
      }
    }
    return changed;
  }

  async function refresh() {
    const msgs = await db.query('chatMessages', 'sessionId', sessionId);
    msgs.sort((a, b) => a.createdAt - b.createdAt);
    // 先 expire 过期红包,再渲染 — refresh 内只跑一次扫描,完事就 redo query
    // (一些 row 被 mutate 写回了)。fire-and-forget 不行因为渲染要看到新状态。
    if (await expireOldMoneyActions(msgs)) {
      // 重新 query 拿到 fresh 数据
      const freshMsgs = await db.query('chatMessages', 'sessionId', sessionId);
      freshMsgs.sort((a, b) => a.createdAt - b.createdAt);
      msgs.length = 0;
      msgs.push(...freshMsgs);
    }
    // T3: previewMap 以 `${msgId}:${idx}` 为 key,记每条 action 自己的预览文本。
    // 旧版只存 msgId → firstActionText,导致 reply 引用第 2/3 气泡时永远显示
    // 第 1 个 action 的内容。同时保留 `${msgId}:0` 兼容老 reply action 没存
    // quoteActionIdx 的情况(渲染时按 quoteActionIdx ?? 0 查)。
    previewMap = new Map();
    for (const m of msgs) {
      const actions = m.actions || [];
      if (actions.length === 0) {
        previewMap.set(`${m.id}:0`, '');
        continue;
      }
      for (let i = 0; i < actions.length; i++) {
        previewMap.set(`${m.id}:${i}`, actionTextOf(actions[i]));
      }
    }
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
    // Group consecutive archived msgs (by archivedIntoMemoryId) into a single
    // collapsible banner. Default = collapsed; only render the inner msg-row
    // HTML when the group's key is in expandedArchiveGroups. Saves a ton of
    // DOM nodes on long conversations and lets the user see "this part was
    // summarized" without the visual noise of dim grey rows.
    let archiveGroup = null;  // { key, msgs: [] }
    const flushGroup = () => {
      if (archiveGroup) {
        parts.push(renderArchiveBanner(archiveGroup, expandedArchiveGroups, ctx));
        archiveGroup = null;
      }
    };
    for (const m of msgs) {
      if (m.archived) {
        const groupKey = m.archivedIntoMemoryId || '_orphan';
        if (!archiveGroup || archiveGroup.key !== groupKey) {
          flushGroup();
          archiveGroup = { key: groupKey, msgs: [m] };
        } else {
          archiveGroup.msgs.push(m);
        }
        // Keep prevTs advancing so a time separator can appear right AFTER
        // an archive banner if there's a real gap.
        prevTs = m.createdAt;
        continue;
      }
      flushGroup();
      const sep = timeSeparator(m.createdAt, prevTs);
      if (sep) parts.push(`<div class="time-separator">${esc(sep)}</div>`);
      parts.push(renderMessageRow(m, ctx));
      prevTs = m.createdAt;
    }
    flushGroup();
    stream.innerHTML = parts.join('');
    stream.scrollTop = stream.scrollHeight;
    // C2: devMode 下顺手算下次发送的 tokens 估算。中文 ≈ 1.5 token/字、ASCII
    // ≈ 0.3 token/char(粗略 — 真值要 tiktoken,这里只是 ballpark 给 user 心
    // 里有数)。fire-and-forget,失败显示 '?' 不打断 chat。
    if (tokenBadge) refreshTokenBadge();
  }

  function estimateTokens(str) {
    if (!str) return 0;
    let ascii = 0, other = 0;
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) < 128) ascii++; else other++;
    }
    return Math.round(ascii * 0.3 + other * 1.5);
  }

  async function refreshTokenBadge() {
    if (!tokenBadge) return;
    try {
      const sysText = await context.buildSystemPrompt(sessionId);
      const history = await context.buildMessageHistory(sessionId);
      const historyText = history.map(m => typeof m.content === 'string' ? m.content : '').join('\n');
      const total = estimateTokens(sysText) + estimateTokens(historyText);
      tokenBadge.textContent = `~${total.toLocaleString()} t`;
    } catch (_) {
      tokenBadge.textContent = '?';
    }
  }
  await refresh();

  // Wallet helpers — gate user-initiated transfers/red_packets on balance.
  // tryDeductWallet returns false if balance insufficient (user notified).
  async function tryDeductWallet(amount, kindLabel) {
    const w = (await db.get('wallet', 'default')) || { id: 'default', balance: 0 };
    const balance = Number(w.balance || 0);
    if (balance < amount) {
      await openAlert(container, {
        title: '余额不足',
        message: `当前 ¥${balance.toFixed(2)},${kindLabel}需 ¥${amount.toFixed(2)}。去「我 → 钱包」充值。`,
        danger: true,
      });
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

  async function appendUserMessage(actions, innerVoice) {
    const id = db.newId();
    const now = Date.now();
    const row = { id, sessionId, role: 'user', actions, createdAt: now };
    // 心声(可选)— 跟 msg 一起存,渲染时在 user 气泡下方浅色斜体显示,
    // prompt 注入时拼成「正文[心声:xxx]」给 AI 看到真实情绪。
    const iv = String(innerVoice || '').trim();
    if (iv) row.innerVoice = iv;
    await db.set('chatMessages', row);
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
  function closeBubbleMenu() { bubbleMenu.hidden = true; activeBubbleMsgId = null; activeBubbleActionIdx = 0; }

  function setReplyTo(msgId, actionIdx = 0) {
    replyingTo = { msgId, actionIdx };
    const preview = previewMap.get(`${msgId}:${actionIdx}`) ?? previewMap.get(`${msgId}:0`) ?? '(已删除的消息)';
    replyText.textContent = String(preview).slice(0, 80);
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
    // bubble 的 data-actionIdx 是 renderAction 时塞的索引,记录用户点的是这条
    // msg row 的第几个 action(对话气泡)。handler 里要按这个 idx 操作,别用
    // querySelector 找第一个匹配的 bubble。
    activeBubbleActionIdx = Number(bubble.dataset.actionIdx || 0);
    // Side-specific entries: user msgs show 编辑 (not 重新生成),
    // character msgs show 重新生成 (not 编辑). Driven by class on the menu,
    // hidden in CSS per .only-user / .only-char.
    const row = bubble.closest('.msg-row');
    const isUser = !!row?.classList.contains('user');
    bubbleMenu.classList.toggle('for-user',  isUser);
    bubbleMenu.classList.toggle('for-char', !isUser);
    // Pre-measure pattern: reveal the menu invisibly so the browser lays it
    // out (getBoundingClientRect would otherwise return zero on the same
    // frame the element transitions out of display:none). Anchor to the
    // bubble rect itself rather than touch coords — touch positions can lag
    // behind the bubble on iOS while it's still tracking scroll inertia.
    bubbleMenu.style.visibility = 'hidden';
    bubbleMenu.hidden = false;
    const pageRect = chatPage.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const menuRect = bubbleMenu.getBoundingClientRect();
    let left = bubbleRect.left - pageRect.left + bubbleRect.width / 2 - menuRect.width / 2;
    let top  = bubbleRect.top  - pageRect.top  - menuRect.height - 8;
    if (left < 8) left = 8;
    if (left + menuRect.width > pageRect.width - 8) left = pageRect.width - menuRect.width - 8;
    // Not enough room above the bubble — drop below instead.
    if (top < 8) top = bubbleRect.bottom - pageRect.top + 8;
    bubbleMenu.style.left = left + 'px';
    bubbleMenu.style.top  = top  + 'px';
    bubbleMenu.style.visibility = '';
  }

  // ---- Handlers ----

  const onBack = () => router.back();

  const onSend = async () => {
    const text = input.value.trim();
    if (!text) return;
    const quote = replyingTo;
    const innerVoice = (ivInput?.value || '').trim();
    input.value = '';
    if (ivInput) ivInput.value = '';
    if (ivRow) ivRow.hidden = true;
    if (ivBtn) ivBtn.classList.remove('active');
    autosize();
    closePanel();
    closeBubbleMenu();
    const action = quote
      ? { type: 'reply', content: text, quoteMsgId: quote.msgId, quoteActionIdx: quote.actionIdx }
      : { type: 'text',  content: text };
    if (quote) clearReply();
    await appendUserMessage([action], innerVoice);
  };

  // 心声 toggle button — 点击 显示/隐藏 .inner-voice-row。row 可见时
  // textarea 自动 focus,让 user 直接输入。
  const onInnerVoiceToggle = () => {
    if (!ivRow) return;
    const wasHidden = ivRow.hidden;
    ivRow.hidden = !wasHidden;
    if (ivBtn) ivBtn.classList.toggle('active', wasHidden);
    if (wasHidden && ivInput) ivInput.focus();
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
      // If the user has navigated away (different tab, minimized browser),
      // raise a system notification so they can come back. No-op when the
      // tab is visible or permission/setting is off. Fired before reveal
      // because reveal awaits (up to a few seconds for multi-bubble
      // replies) and we want the alert to land as early as possible.
      notify.notifyAIReply(sessionId, result?.messageId).catch(() => {});
      // Reveal the new character bubbles one by one so multi-action replies
      // (which currently arrive as one DB write with N actions) don't dump
      // all bubbles into the stream at the same instant. Pacing is rough —
      // length-based, capped 3s — but it's enough to feel like the other
      // side is typing rather than flooding.
      await streamingReveal(result?.messageId);
    } catch (e) {
      await openAlert(container, { title: 'AI 回复失败', message: String(e).slice(0, 300), danger: true });
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
    // display:none so unrevealed bubbles don't occupy layout (the bug
    // where the user could see "empty frames" below the visible reply).
    // We then flip back to '' + fade-in on each tick.
    for (const el of items) {
      el.style.display = 'none';
    }
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      const text = (el.textContent || '').trim();
      // First bubble: deliberate pause to feel like "typing started".
      // Later bubbles: length-based, slower than before (felt like a dump).
      const delay = i === 0 ? 500 : Math.min(3000, 500 + text.length * 50);
      await new Promise(r => setTimeout(r, delay));
      el.style.display = '';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      el.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
      // RAF so the browser commits display:'' before starting the transition,
      // otherwise opacity 0→1 collapses into the same frame as the layout.
      await new Promise(r => requestAnimationFrame(r));
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
      // C1: 真实图片上传 — file picker → base64 → actions[].src。
      // 4MB cap 跟 widget 图片一致(IDB 容易爆,大图片用 widget cover 那种
      // 也是 2-4MB 限)。AI history 里只塞占位文字(见 context.renderActionsAsText)。
      const file = await new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => resolve(input.files?.[0] || null);
        input.click();
      });
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) {
        await openAlert(container, {
          title: '图片太大',
          message: `${(file.size/1024/1024).toFixed(1)} MB,建议 < 4 MB,IndexedDB 容易满。`,
          danger: true,
        });
        return;
      }
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      await appendUserMessage([{ type: 'image', src: dataUrl }]);
    } else if (btn.dataset.kind === 'camera') {
      // C1: 拍照模式 — 走原来 image 的描述行为,模型按描述脑补内容。
      // 跟「图片」分开,user 心智更接近真机:相册=真传,相机=描述拍了啥。
      const v = await openAttachModal(container, {
        title: '拍照(描述)',
        fields: [{ name: 'description', label: '描述你拍到的东西(角色会按描述脑补)', kind: 'textarea', required: true, placeholder: '比如:窗外的雨景 / 我刚煮好的咖啡' }],
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

  const onInspector = (e) => {
    e.stopPropagation();
    closePanel();
    closeBubbleMenu();
    router.navigate('prompt-inspector', { sessionId });
  };

  // Bubble context-menu open: long-press (touch) + right-click (desktop)
  let longPressTimer = null;
  let touchStartXY = null;

  const onStreamClick = async (e) => {
    // Archive banner: toggle the group's expanded state, then re-render.
    const banner = e.target.closest('.archive-banner');
    if (banner) {
      const key = banner.dataset.groupKey;
      if (expandedArchiveGroups.has(key)) expandedArchiveGroups.delete(key);
      else                                  expandedArchiveGroups.add(key);
      await refresh();
      return;
    }

    // Voice bubble: tap toggles transcript visibility. Default = capsule
    // (▶ N″). Click adds .expanded → CSS reveals the inline voice-text.
    const voice = e.target.closest('.bubble-voice');
    if (voice) {
      voice.classList.toggle('expanded');
      return;
    }
    // 翻译气泡:点击 toggle 显示下方中文翻译(同 voice 模式)。
    const translate = e.target.closest('.bubble-translate');
    if (translate) {
      translate.classList.toggle('expanded');
      return;
    }

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

    // 详情 modal — 红包 / 转账非 claimable 状态(已领 / 已退 / user 自己发
    // 未领)点击 → 弹详情:from / when / amount / message + 状态。
    const detailEl = e.target.closest('.bubble-money[data-money-detail]');
    if (detailEl) {
      const msgId = detailEl.dataset.msgId;
      const idx = Number(detailEl.dataset.actionIdx);
      const msg = await db.get('chatMessages', msgId);
      if (!msg || !Array.isArray(msg.actions) || !msg.actions[idx]) return;
      await openMoneyDetail(msg, msg.actions[idx]);
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
    if (!await openConfirm(container, {
      title: '解除拉黑',
      message: `解除对「${fresh.name || '这个角色'}」的拉黑?`,
      confirmLabel: '解除',
    })) return;
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

  // M4: regenerate helper extracted so 长按 (open hint modal) 和 短按
  // (直接重新生成)都能复用。hint 为空就走默认流程,有 hint 就 inject 到
  // # 本次重新生成的要求 段(context.js #11b)。整套 toDelete / confirm /
  // requestReply / refresh 跟原 inline 实现一致。
  async function doRegenerate(msgId, hint) {
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
    if (!await openConfirm(container, {
      title: hint ? '重新生成(带要求)' : '重新生成',
      message: promptText,
      confirmLabel: '重新生成',
      danger: toDelete.length > 0,
    })) return;
    for (const m of toDelete) await db.del('chatMessages', m.id);
    await refresh();
    aiBtn.disabled = true;
    sendBtn.disabled = true;
    aiBtn.classList.add('loading');
    try {
      const result = await ai.requestReply(sessionId, hint ? { regenHint: hint } : undefined);
      await markReadUpToLatestUserMsg();
      await refresh();
      await streamingReveal(result?.messageId);
    } catch (e) {
      await openAlert(container, { title: '重新生成失败', message: String(e).slice(0, 300), danger: true });
    } finally {
      aiBtn.disabled = false;
      sendBtn.disabled = false;
      aiBtn.classList.remove('loading');
    }
  }

  // 长按 regenerate 检测 — 600ms 触发就开 hint modal、短按走 onBubbleMenuAction
  // 默认路径。timer 600ms 后 fire,flag set 让 click handler 跳过自己的处理。
  let regenLongPressTimer = null;
  let regenLongPressFired = false;
  const onMenuPointerDown = (e) => {
    const btn = e.target.closest('[data-action="regenerate"]');
    if (!btn) return;
    regenLongPressFired = false;
    const msgIdLocal = activeBubbleMsgId;
    regenLongPressTimer = setTimeout(async () => {
      regenLongPressFired = true;
      regenLongPressTimer = null;
      closeBubbleMenu();
      if (!msgIdLocal) return;
      const v = await openModal(container, {
        title: '重新生成 — 这次的要求',
        fields: [{
          name: 'hint',
          label: '想让 AI 这次怎么回(留空就默认重新来一次)',
          kind: 'textarea',
          defaultValue: '',
          required: false,
        }],
        submitLabel: '生成',
      });
      if (v === null) return;
      await doRegenerate(msgIdLocal, (v.hint || '').trim());
    }, 600);
  };
  const onMenuPointerUp = () => {
    if (regenLongPressTimer) {
      clearTimeout(regenLongPressTimer);
      regenLongPressTimer = null;
    }
  };
  bubbleMenu.addEventListener('pointerdown', onMenuPointerDown);
  bubbleMenu.addEventListener('pointerup', onMenuPointerUp);
  bubbleMenu.addEventListener('pointercancel', onMenuPointerUp);

  const onBubbleMenuAction = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !activeBubbleMsgId) return;
    const msgId = activeBubbleMsgId;
    // 用 showBubbleMenu 时记下的 actionIdx,不要再 querySelector 拿同 msgId 的
    // 第一个 .bubble(那永远是 idx 0,所以用户点第 3 个气泡 → 操作第 1 个 bug)。
    const actionIdx = activeBubbleActionIdx;
    closeBubbleMenu();
    if (btn.dataset.action === 'quote') {
      setReplyTo(msgId, actionIdx);
    } else if (btn.dataset.action === 'copy') {
      // M2: 复制按 action 粒度,不是整条消息。previewMap 是整 msg 的所有
      // action 拼起来的预览,user 看 bubble menu 想复制的是 ta 点的那个
      // 气泡的文字,不是整组。读取实际 action 拿 content / description /
      // name 等 "main text"。
      const msg = await db.get('chatMessages', msgId);
      const a = msg?.actions?.[actionIdx];
      const text = a
        ? String(a.content || a.description || a.name || a.message || '')
        : '';
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
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
        await openAlert(container, { title: '已收藏', message: '这条已经在收藏里了。' });
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
      if (!editTarget) { await openAlert(container, { title: '没法编辑', message: '这种类型的消息没有可编辑的文字字段。' }); return; }
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

    } else if (btn.dataset.action === 'inner-voice') {
      // 角色心声 — 点击生成 / 显示。已 archived 不让生(被压缩后 history 改
      // 了,事后再补"当时在想啥"准确度低)。msg.aiInnerVoice 已存 = toggle
      // 显示,不再调 API(一锤定音)。
      const msg = await db.get('chatMessages', msgId);
      if (!msg) return;
      if (msg.archived) {
        await openAlert(container, { title: '已总结', message: '这条已经被压缩进记忆,无法查看心声了。' });
        return;
      }
      if (msg.aiInnerVoice) {
        // 已生成 → 找气泡 toggle 展开 / 收起
        const row = stream.querySelector(`[data-msg-id="${msgId}"]`)?.closest('.msg-row');
        const existing = row?.querySelector('.ai-inner-voice-display');
        if (existing) {
          existing.remove();
        } else if (row) {
          const div = document.createElement('div');
          div.className = 'ai-inner-voice-display';
          div.textContent = `心声:${msg.aiInnerVoice}`;
          row.querySelector('.msg-actions')?.appendChild(div);
        }
        return;
      }
      // 第一次生成 — 调 ai 让模型回想"当时在想啥"
      try {
        const allMsgs = (await db.query('chatMessages', 'sessionId', sessionId))
          .filter(m => !m.archived)
          .sort((a, b) => a.createdAt - b.createdAt);
        const idxInAll = allMsgs.findIndex(m => m.id === msgId);
        const historySlice = allMsgs.slice(Math.max(0, idxInAll - 8), idxInAll + 1);
        const cur = await db.get('characters', session.characterId);
        const sys = `你是【${cur?.name || '角色'}】。下面给你看你跟用户最近的几条对话(最后一条是你刚发的)。请用第一人称简短写出**你发出最后一条回复那一刻**内心的真实想法 — 嘴上说着什么,内心可能在想完全不一样的事。只输出这一句话,不超过 40 字,不带任何前后缀、引号或解释。\n\n你的人设:\n${cur?.persona || ''}`;
        const hist = historySlice.map(m => {
          const who = m.role === 'user' ? '用户' : '你';
          const texts = (m.actions || []).map(a => a.content || a.description || a.name || '').filter(Boolean).join(' ');
          return `${who}:${texts}`;
        }).join('\n');
        const result = await ai.callAI({
          systemPrompt: sys,
          messages: [{ role: 'user', content: hist }],
          temperature: 0.7,
        });
        const voice = String(result || '').trim().slice(0, 100);
        if (!voice) {
          await openAlert(container, { title: '生成失败', message: '模型没返回内容。' });
          return;
        }
        msg.aiInnerVoice = voice;
        await db.set('chatMessages', msg);
        await refresh();
      } catch (err) {
        await openAlert(container, { title: '心声生成失败', message: String(err).slice(0, 300), danger: true });
      }

    } else if (btn.dataset.action === 'regenerate') {
      // M4: 短按 = 直接重新生成;长按 = 长按 handler 已经处理(开 hint modal
      // 然后调 doRegenerate with hint),这里跳过避免双跑。flag 在 600ms
      // timer 里 set,onBubbleMenuAction 处理时检 + reset。
      if (regenLongPressFired) { regenLongPressFired = false; return; }
      await doRegenerate(msgId, '');

    } else if (btn.dataset.action === 'resummarize') {
      // Wipes overlapping memories + unarchives msgs at-or-after this msg's
      // createdAt, then re-runs the compression. The redo can be expensive
      // (an L1 + possibly an L2 round-trip) — show a confirm with the count.
      const target = await db.get('chatMessages', msgId);
      if (!target) return;
      const T = target.createdAt;
      const allMsgs = await db.query('chatMessages', 'sessionId', sessionId);
      const affectedMsgs = allMsgs.filter(m => m.archived && m.createdAt >= T);
      const allMems = await db.query('memories', 'sessionId', sessionId);
      const tsOf = new Map(allMsgs.map(m => [m.id, m.createdAt]));
      const affectedMems = allMems.filter(mem => {
        const toTs = tsOf.get(mem.toMsgId);
        return toTs == null || toTs >= T;
      });
      if (affectedMems.length === 0 && affectedMsgs.length === 0) {
        await openAlert(container, { title: '无需重新总结', message: '这条消息之后没有已总结的内容。' });
        return;
      }
      if (!await openConfirm(container, {
        title: '从这里重新总结',
        message: `会清掉这条之后已覆盖的 ${affectedMems.length} 条记忆,把 ${affectedMsgs.length} 条已归档消息恢复成活跃,然后让 AI 重新压缩一次。`,
        confirmLabel: '重新总结',
        danger: true,
      })) return;
      try {
        await context.resummarizeFrom(sessionId, msgId);
        await refresh();
      } catch (e) {
        await openAlert(container, { title: '重新总结失败', message: String(e).slice(0, 300), danger: true });
      }
    } else if (btn.dataset.action === 'delete') {
      // M2: 删除按 action 粒度。msg.actions 可能有 1-5 条(AI 一轮回复多
      // 气泡 / 用户连发),user 点 bubble menu 删的是这一个气泡,不是整条。
      // splice 掉该 action,数组空了再删 row。favorites 引用同步清理:只
      // 清指向被删 action 的 fav;别的 fav 的 actionIdx > 删点的要 -1
      // (因为数组前移),小于的不动。
      const msg = await db.get('chatMessages', msgId);
      if (!msg) { await refresh(); return; }
      const actions = Array.isArray(msg.actions) ? [...msg.actions] : [];
      const isLastBubble = actions.length <= 1;
      const confirmMsg = isLastBubble
        ? '删除这一条消息?(整条只剩这一个气泡,会一并删掉整条)'
        : `删除这一个气泡?(本条消息还有其他气泡,只删这一个)`;
      if (!await openConfirm(container, {
        title: '删除',
        message: confirmMsg,
        confirmLabel: '删除',
        danger: true,
      })) return;
      const favs = await db.query('favorites', 'sessionId', sessionId);
      const favsForMsg = favs.filter(f => f.msgId === msgId);
      if (isLastBubble) {
        // 同步清 favorites + 删 row + 取消可能正在引用本 row 的 reply
        for (const f of favsForMsg) await db.del('favorites', f.id);
        await db.del('chatMessages', msgId);
        if (replyingTo?.msgId === msgId) clearReply();
      } else {
        actions.splice(actionIdx, 1);
        msg.actions = actions;
        await db.set('chatMessages', msg);
        // Fix-up favorites:被删的 actionIdx 直接干掉,后面的 -1
        for (const f of favsForMsg) {
          const fi = Number(f.actionIdx ?? 0);
          if (fi === actionIdx) {
            await db.del('favorites', f.id);
          } else if (fi > actionIdx) {
            f.actionIdx = fi - 1;
            await db.set('favorites', f);
          }
        }
      }
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
  if (ivBtn) ivBtn.addEventListener('click', onInnerVoiceToggle);
  panel.addEventListener('click', onPanelClick);
  moreBtn.addEventListener('click', onMoreToggle);
  if (inspectorBtn) inspectorBtn.addEventListener('click', onInspector);
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
    if (ivBtn) ivBtn.removeEventListener('click', onInnerVoiceToggle);
    panel.removeEventListener('click', onPanelClick);
    moreBtn.removeEventListener('click', onMoreToggle);
    if (inspectorBtn) inspectorBtn.removeEventListener('click', onInspector);
    bubbleMenu.removeEventListener('click', onBubbleMenuAction);
    bubbleMenu.removeEventListener('pointerdown', onMenuPointerDown);
    bubbleMenu.removeEventListener('pointerup', onMenuPointerUp);
    bubbleMenu.removeEventListener('pointercancel', onMenuPointerUp);
    if (regenLongPressTimer) { clearTimeout(regenLongPressTimer); regenLongPressTimer = null; }
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

// T3: 单 action → 预览文本。previewMap 现在按 (msgId, actionIdx) 索引,所以
// 不能再只看 actions[0],引用 / 复制 / 收藏每个气泡时各自查自己的那条。
function actionTextOf(a) {
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
function firstActionText(msg) {
  return actionTextOf((msg.actions ?? [])[0]);
}

// Banner that stands in for a run of consecutive archived messages with the
// same archivedIntoMemoryId. Collapsed by default — click toggles into a
// container with the inner rendered msg-rows. The count gives the user a
// sense of how much got compressed without rendering all the rows.
function renderArchiveBanner(group, expandedSet, ctx) {
  const expanded = expandedSet.has(group.key);
  const count = group.msgs.length;
  // The msg-rows render only when expanded to keep DOM cost down on long
  // conversations (the original perf gripe in the second review).
  const inner = expanded
    ? group.msgs.map(m => renderMessageRow(m, ctx)).join('')
    : '';
  // T13: 视觉强化 — 之前 banner 透明灰底太弱,user 不知道这是可点的。改成
  // 显式 dashed 边框 + 居中 label + chevron 旋转动画。文案改成「点开看 N 条
  // 被总结的聊天」的 CTA 形式,而不是中性的「已归档 X 条」。
  const cta = expanded
    ? `收起这 ${count} 条`
    : `点开看被总结的 ${count} 条聊天`;
  return `
    <div class="archive-banner ${expanded ? 'expanded' : ''}" data-group-key="${esc(group.key)}">
      <div class="archive-banner-bar">
        <span class="archive-banner-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
        <span class="archive-banner-label">${esc(cta)}</span>
      </div>
      ${expanded ? `<div class="archive-banner-content">${inner}</div>` : ''}
    </div>
  `;
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
  // 已读 标 — 用户气泡的左侧(挂在 msg-row 上,跟 msg-actions 同级 flex 兄弟,
  // user row 是 row-reverse 所以 DOM 末尾的 readMark 视觉上在 actions 左边)。
  const readMark = showRead ? `<div class="read-mark">已读</div>` : '';
  // Archived messages (compressed into a memory summary) are dimmed so the
  // user can see "this part has been summarized; the AI now reads the
  // summary instead of the originals", while still being able to scroll
  // through the actual history.
  const clsList = ['msg-row', side];
  if (!ctx.showAvatars) clsList.push('no-avatar');
  if (msg.archived) clsList.push('archived');
  // 用户心声(只在 user 消息 + msg.innerVoice 存在时显示)/ 角色心声
  // (character + msg.aiInnerVoice)— 浅色斜体小字在气泡下方。前者发消息
  // 时一起存,后者 user 在 bubble menu 点击「心声」 → ai 生成 → 写回 cache。
  let voiceDiv = '';
  if (side === 'user' && msg.innerVoice) {
    voiceDiv = `<div class="inner-voice-display">心声:${esc(msg.innerVoice)}</div>`;
  } else if (side === 'char' && msg.aiInnerVoice) {
    voiceDiv = `<div class="ai-inner-voice-display">心声:${esc(msg.aiInnerVoice)}</div>`;
  }
  return `<div class="${clsList.join(' ')}">${avatar}<div class="msg-actions">${bubbles}${voiceDiv}</div>${readMark}</div>`;
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
    case 'text': {
      // 翻译模式:action 带 translation 字段时,气泡渲染成原文 + 收起的翻译,
      // 点击 → toggle .expanded 展开下方翻译(跟 voice 气泡同套机制)。
      if (a.translation) {
        return `<div class="bubble ${side} bubble-translate" ${attrs}>
          <span class="trans-original">${esc(a.content || '')}</span>
          <span class="trans-translation">${esc(a.translation)}</span>
        </div>`;
      }
      return `<div class="bubble ${side}" ${attrs}>${esc(a.content || '')}</div>`;
    }
    case 'reply': {
      // T3: 老数据没 quoteActionIdx,fallback 到 0(等同旧行为)。新数据查
      // `${msgId}:${idx}` 精确定位被引用那条 action 的预览。
      const qIdx = Number.isFinite(a.quoteActionIdx) ? a.quoteActionIdx : 0;
      const quoted = previewMap?.get(`${a.quoteMsgId}:${qIdx}`) ?? previewMap?.get(`${a.quoteMsgId}:0`) ?? '(已删除的消息)';
      if (a.translation) {
        return `<div class="bubble ${side} bubble-reply bubble-translate" ${attrs}>
          <div class="reply-quote">${esc(quoted.slice(0, 60))}</div>
          <span class="trans-original">${esc(a.content || '')}</span>
          <span class="trans-translation">${esc(a.translation)}</span>
        </div>`;
      }
      return `<div class="bubble ${side} bubble-reply" ${attrs}>
        <div class="reply-quote">${esc(quoted.slice(0, 60))}</div>
        <div class="reply-content">${esc(a.content || '')}</div>
      </div>`;
    }
    case 'image': {
      // C1: src 是真图(用户走「图片」上传的 base64 / URL),render 成
      // <img>。没 src 走描述模式(走「拍照」或 AI 模型主动 image action)。
      const isRealImage = !!a.src && /^(data:image|https?:|blob:)/i.test(a.src);
      if (isRealImage) {
        return `<div class="bubble ${side} bubble-image-real" ${attrs}><img src="${esc(a.src)}" alt="${esc(a.description || '')}"></div>`;
      }
      return `<div class="bubble ${side} bubble-image" ${attrs}>[图片] ${esc(a.description || a.src || '')}</div>`;
    }
    case 'voice': {
      // Collapsed by default: bubble shows only "▶ N″" so it reads as a voice
      // capsule (matches the WeChat / iMessage convention — tap to play /
      // expand). One tap on the bubble toggles .expanded and the transcript
      // appears inline. The transcript stays in the DOM but hidden via CSS
      // so existing selectors that look for the text (preview / search) work.
      const dur = Number(a.duration) || Math.max(1, Math.round((a.content || '').length / 4));
      return `<div class="bubble ${side} bubble-voice" ${attrs}><span class="voice-meta">▶ ${dur}″</span><span class="voice-text">${esc(a.content || '')}</span></div>`;
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
    case 'add_schedule_entry': {
      // AI 自动加行程的卡片。startTs 是 ISO 字符串,parse 失败显示原始字符串。
      let timeStr = String(a.startTs || '');
      const ts = a.startTs != null ? new Date(String(a.startTs)).getTime() : NaN;
      if (Number.isFinite(ts)) {
        timeStr = formatChatTime(ts);
      }
      return `<div class="bubble ${side} bubble-schedule-add" ${attrs}>
        <span class="sa-icon">📅</span>
        <div class="sa-body">
          <div class="sa-label">已添加到行程</div>
          <div class="sa-title">${esc(a.title || '(无标题)')}</div>
          <div class="sa-time">${esc(timeStr)}</div>
        </div>
      </div>`;
    }
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
  const returned = !!a.returned;
  const amount = Number(a.amount || 0).toFixed(2);
  const userIsReceiver = side === 'char';
  // claimable: AI 发 + 未领 + 未退 + user 是 receiver
  const claimable = !claimed && !returned && userIsReceiver;
  // 24h 退回:已退回时显示「已退回」灰显;其他状态走原 logic。
  const stateLabel = returned ? '已退回(对方 24 小时未领取)'
    : claimed ? verbDone
    : claimable ? `点击${verb}`
    : `等待对方${verb}`;
  const icon = kind === 'red_packet' ? SVG.redpacket : SVG.transfer;
  const claimAttr = claimable ? ' data-claim-kind="' + kind + '"' : '';
  // 非 claimable 状态(claimed / returned / user 自己发的未领)→ 点击看详情
  const detailAttr = !claimable ? ' data-money-detail="1"' : '';
  return `<div class="bubble ${side} bubble-money bubble-${kind}${claimed ? ' claimed' : ''}${returned ? ' returned' : ''}${claimable ? ' claimable' : ''}" ${attrs}${claimAttr}${detailAttr}>
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
