// Chat message rendering — view functions split out of chat.js (it had grown
// past 1700 lines). Action bubbles (text/reply/image/voice/money/location/...),
// message rows, the archive-banner stand-in, time separators, the attach-input
// modal, and small CSS/color helpers. mountChat (chat.js) imports the handful
// it calls directly; the rest are internal helpers these call each other
// through. SVG icons live in chat-icons.js so this module and chat.js can both
// use them without importing each other.

import * as db from '../../core/db.js';
import { esc } from '../../core/util.js';
import { SVG } from './chat-icons.js';

// T3: 单 action → 预览文本。previewMap 现在按 (msgId, actionIdx) 索引,所以
// 不能再只看 actions[0],引用 / 复制 / 收藏每个气泡时各自查自己的那条。
export function actionTextOf(a) {
  if (!a) return '';
  switch (a.type) {
    case 'text':   return a.content || '';
    case 'reply':  return a.content || '';
    case 'image':  return `[图片] ${a.description || ''}`;
    case 'voice':  return `[语音] ${a.content || ''}`;
    case 'recall': return '[消息已撤回]';
    case 'unblock_request': return `[请求解除拉黑] ${a.content || ''}`;
    case 'red_packet': return `[红包 ¥${Number(a.amount || 0).toFixed(2)}] ${a.message || ''}`;
    case 'transfer':   return `[转账 ¥${Number(a.amount || 0).toFixed(2)}] ${a.message || ''}`;
    case 'location':   return `[位置] ${a.name || ''}${a.desc ? ' · ' + a.desc : ''}`;
    default:       return `[${a.type}]`;
  }
}
export function firstActionText(msg) {
  return actionTextOf((msg.actions ?? [])[0]);
}

// Banner that stands in for a run of consecutive archived messages with the
// same archivedIntoMemoryId. Collapsed by default — click toggles into a
// container with the inner rendered msg-rows. The count gives the user a
// sense of how much got compressed without rendering all the rows.
export function renderArchiveBanner(group, expandedSet, ctx) {
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

export function renderMessageRow(msg, ctx) {
  const side = msg.role === 'user' ? 'user' : 'char';
  // Recall actions render centered; treat them as standalone separator-style rows.
  const isOnlyRecall = (msg.actions ?? []).every(a => a.type === 'recall');
  if (isOnlyRecall) {
    return (msg.actions ?? []).map((a, i) => renderAction(a, side, msg.id, i, ctx.previewMap, ctx.character)).join('');
  }
  const bubbles = (msg.actions ?? [])
    .map((a, i) => renderAction(a, side, msg.id, i, ctx.previewMap, ctx.character))
    .join('');
  const who = side === 'user'
    ? ctx.persona
    : (ctx.isGroup ? (ctx.participantsById?.get(msg.fromCharacterId) || ctx.character) : ctx.character);
  const avatar = ctx.showAvatars ? renderRowAvatar(who, side) : '';
  // 群聊:角色气泡上方标发言人名字(单聊只有一个角色,不需要)。
  const senderName = (ctx.isGroup && side === 'char' && who?.name)
    ? `<div class="msg-sender-name" style="font-size:11px;color:var(--muted,#999);margin:0 0 2px 2px">${esc(who.name)}</div>` : '';
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
  return `<div class="${clsList.join(' ')}">${avatar}<div class="msg-actions">${senderName}${bubbles}${voiceDiv}</div>${readMark}</div>`;
}

export function renderRowAvatar(who, side) {
  if (who?.avatar) {
    return `<div class="msg-avatar ${side}"><img src="${esc(who.avatar)}" alt=""></div>`;
  }
  const initial = (who?.name ?? (side === 'user' ? '我' : '?')).slice(0, 1);
  return `<div class="msg-avatar ${side}">${esc(initial)}</div>`;
}

// Returns a header string if a separator should be inserted, else null.
// Rule: first message always; otherwise gap >= 5 minutes.
export function timeSeparator(ts, prevTs) {
  if (prevTs && (ts - prevTs) < 5 * 60 * 1000) return null;
  return formatChatTime(ts);
}

export function formatChatTime(ts) {
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

export function renderAction(a, side, msgId, idx, previewMap, character) {
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
export function renderMoneyBubble({ kind, a, side, attrs, label, verb, verbDone }) {
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
export function cssUrl(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

export async function readOverlayPct(character) {
  // 优先 per-character chatBgOverlay(从聊天美化设置),fallback 全局
  //   settings.theme.effects.transparency(老用户兼容)。character 可空 —
  //   兜底退到全局。
  if (character && Number.isFinite(character.chatBgOverlay)) {
    return Math.max(0, Math.min(100, character.chatBgOverlay));
  }
  const settings = await db.get('settings', 'default');
  const t = settings?.theme?.effects;
  const v = Number(t?.transparency ?? 0);
  return Math.max(0, Math.min(100, v));
}

export async function readBgRgba(overlayPct) {
  const settings = await db.get('settings', 'default');
  const bgHex = settings?.theme?.bg || '#f5f5f7';
  const { r, g, b } = hexToRgb(bgHex);
  const a = overlayPct / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

// In-frame attach modal — replaces window.prompt() for voice / image / red_packet
// / transfer inputs. Returns a Promise<object|null>: keys map to field.name,
// values are strings. Null = user cancelled.
export function openAttachModal(container, { title, fields, submitLabel = '确认' }) {
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

export function renderAttachField(f) {
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
export function cssEscape(s) { return CSS.escape(String(s)); }
