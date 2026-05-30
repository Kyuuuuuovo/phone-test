// Chat page. Bubbles, input, AI trigger, push-up attach panel,
// header "more" menu, bubble context menu (long-press / right-click), reply preview.

import * as db from '../../core/db.js';
import * as ai from '../../core/ai.js';
import * as context from '../../core/context.js';
import * as notify from '../../core/notify.js';
import { openConfirm, openAlert, openModal } from '../../core/modal.js';
import { esc } from '../../core/util.js';
import { SVG } from './chat-icons.js';
import {
  actionTextOf, renderArchiveBanner, renderMessageRow, timeSeparator,
  cssUrl, readOverlayPct, readBgRgba, openAttachModal, cssEscape,
} from './chat-render.js';

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
  // 群聊:participantIds≥2。load 所有成员供渲染(每条消息按 fromCharacterId 显示对应头像/名)。
  const isGroup = Array.isArray(session.participantIds) && session.participantIds.length >= 2;
  let participantsById = new Map();
  if (isGroup) {
    const cs = (await Promise.all(session.participantIds.map(id => db.get('characters', id)))).filter(Boolean);
    participantsById = new Map(cs.map(c => [c.id, c]));
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
        <div class="title">${isGroup ? esc(session.title || '群聊') : `${esc(character?.name ?? '聊天')}${isBlocked ? ' <span class="blocked-badge">已拉黑</span>' : ''}`}</div>
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
        <button data-action="edit">编辑</button>
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
    const overlayPct = await readOverlayPct(character);
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
    // 气泡透明度 — 0-100,100 不透明(默认,不注入)。< 100 时 data-bubble-alpha-on
    //   触发 base.css 里的 color-mix override。CSS var 0-1。
    if (Number.isFinite(cb.bubbleAlpha) && cb.bubbleAlpha < 100) {
      chatPage.dataset.bubbleAlphaOn = '1';
      chatPage.style.setProperty('--chat-bubble-alpha', String(Math.max(0, cb.bubbleAlpha) / 100));
    }
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

  // opts.preserveScroll = true → 渲染完不强制滚到底(给 banner toggle 用 —
  //   user 在历史上方点 banner 展开,如果 refresh 强制 scrollTop=scrollHeight
  //   会直接跳到底,banner 展开内容跑出视区,体感就是"点不开")。
  async function refresh(opts = {}) {
    const preserveScroll = opts.preserveScroll === true;
    const prevScrollTop = preserveScroll ? stream.scrollTop : 0;
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

    const ctx = { previewMap, character: cur, persona, showReceipts, showAvatars, readUpTo, isGroup, participantsById };

    const parts = [];
    let prevTs = null;
    // 把所有连续的已归档消息折成 ONE 个隐藏块,不管它们属于哪次压缩 / 哪张
    // 故事卡(一次总结切成几张卡、或跨多次总结多天,都收进同一个折叠)。点开
    // = 展开这一整段被总结掉的原始对话。折叠纯粹是"看原文"的入口,跟记忆卡
    // 结构无关 —— 所以用常量 key,不再按 archivedIntoMemoryId 分组(那样每次
    // 压缩各自一条 banner 堆成一排)。归档消息永远是最旧的连续一段,所以结果
    // 就是顶部唯一一个折叠条。
    let archiveGroup = null;  // { key, msgs: [] }
    const flushGroup = () => {
      if (archiveGroup) {
        parts.push(renderArchiveBanner(archiveGroup, expandedArchiveGroups, ctx));
        archiveGroup = null;
      }
    };
    for (const m of msgs) {
      if (m.archived) {
        const groupKey = '_archived';
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
    if (preserveScroll) {
      stream.scrollTop = prevScrollTop;
    } else {
      stream.scrollTop = stream.scrollHeight;
    }
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
    // 在同一 IDB 事务里 读余额→判足→扣,避免 get/set 跨两事务时并发(领红包
    // 退回、多 tab、连点)各读到同一 pre-balance 后写覆盖,扣错钱。
    let res = { ok: true, balance: 0 };
    await db.updateRow('wallet', 'default', (w) => {
      const balance = Number(w.balance || 0);
      if (balance < amount) { res = { ok: false, balance }; return w; }
      w.balance = Number((balance - amount).toFixed(2));
      res = { ok: true, balance: w.balance };
      return w;
    }, { id: 'default', balance: 0 });
    if (!res.ok) {
      await openAlert(container, {
        title: '余额不足',
        message: `当前 ¥${res.balance.toFixed(2)},${kindLabel}需 ¥${amount.toFixed(2)}。去「我 → 钱包」充值。`,
        danger: true,
      });
      return false;
    }
    console.log(`[wallet] -${amount} (${kindLabel}); balance: ${res.balance}`);
    return true;
  }
  async function creditWallet(amount, kindType) {
    let newBalance = 0;
    await db.updateRow('wallet', 'default', (w) => {
      w.balance = Number((Number(w.balance || 0) + amount).toFixed(2));
      newBalance = w.balance;
      return w;
    }, { id: 'default', balance: 0 });
    console.log(`[wallet] +${amount} (${kindType}); balance: ${newBalance}`);
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

  // 生成中再按一下「让 AI 回复」= 停止(见 ai.abortReply)。生成期间 aiBtn
  // 不 disable(它变成「停止」键),只 disable sendBtn。
  let generating = false;
  // runReply: 实际跑一次回复。群聊传 speakerCharacterId 指明这一轮谁说话。
  const runReply = async (speakerCharacterId) => {
    closePanel();
    closeBubbleMenu();
    generating = true;
    sendBtn.disabled = true;
    aiBtn.classList.add('loading', 'generating');
    aiBtn.title = '停止生成';
    try {
      const result = await ai.requestReply(sessionId, speakerCharacterId ? { speakerCharacterId } : undefined);
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
      // 用户主动停止 → 不是错误,静默收尾(中断点在 fetch,之前没落库,无残留)。
      const aborted = e?.name === 'AbortError' || /abort/i.test(String(e?.message || e));
      if (!aborted) {
        await openAlert(container, { title: 'AI 回复失败', message: String(e).slice(0, 300), danger: true });
      }
    } finally {
      generating = false;
      sendBtn.disabled = false;
      aiBtn.classList.remove('loading', 'generating');
      aiBtn.title = '让 AI 回复';
    }
  };
  // 点「让 AI 回复」:生成中再按 = 停止;群聊先选这一轮谁说话(手动调度 Step 1);单聊直接回。
  const onAI = async () => {
    if (generating) { ai.abortReply(sessionId); return; }
    if (isGroup) {
      const picked = await openModal(container, {
        title: '让谁回复?',
        fields: [{ name: 'who', kind: 'select', label: '成员',
          options: [...participantsById.values()].map(c => ({ value: c.id, label: c.name || '(未命名)' })) }],
        submitLabel: '回复',
      });
      if (picked && picked.who) await runReply(picked.who);
      return;
    }
    await runReply();
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
    // preserveScroll:user 通常在视区中部 / 上方点 banner,如果 refresh 默认
    //   滚到底会让展开内容跑出视区,体感就是"点不开"。保留 scrollTop 即可。
    const banner = e.target.closest('.archive-banner');
    if (banner) {
      const key = banner.dataset.groupKey;
      if (expandedArchiveGroups.has(key)) expandedArchiveGroups.delete(key);
      else                                  expandedArchiveGroups.add(key);
      await refresh({ preserveScroll: true });
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
    const userBelow = [];  // 这条之后用户发的消息(可选一起删)
    for (let i = targetIdx + 1; i < all.length; i++) {
      if (all[i].role === 'character') toDelete.push(all[i]);
      else if (all[i].role === 'user') userBelow.push(all[i]);
    }
    const aiNote = toDelete.length === 0
      ? '让 AI 基于当前对话再生成一条新回复。'
      : `会删除这条之后的 ${toDelete.length} 条 AI 回复,然后让 AI 重新回复。`;
    if (userBelow.length > 0) {
      // 这条之后还有你发的消息 → 给个勾选框,默认不勾(删消息不可逆,要主动选)。
      const r = await openModal(container, {
        title: hint ? '重新生成(带要求)' : '重新生成',
        message: `${aiNote}下面还有你发的 ${userBelow.length} 条消息。`,
        fields: [{ name: 'delUser', kind: 'checkbox', label: `连同下面我发的 ${userBelow.length} 条一起删`, defaultValue: false }],
        submitLabel: '重新生成',
      });
      if (!r) return;
      if (r.delUser) toDelete.push(...userBelow);
    } else {
      if (!await openConfirm(container, {
        title: hint ? '重新生成(带要求)' : '重新生成',
        message: `${aiNote} 确定吗?`,
        confirmLabel: '重新生成',
        danger: toDelete.length > 0,
      })) return;
    }
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
