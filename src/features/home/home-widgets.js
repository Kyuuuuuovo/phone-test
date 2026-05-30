// Home widget rendering -- the renderXxxWidget family split out of home.js (it
// had grown past 3000 lines). renderWidget(w, gs) dispatches by w.type; each
// renderer takes the widget row + a pre-computed grid-style string (gs) and
// returns HTML. escHtml/escAttr live here too (widgets use them most) and are
// re-exported for home.js tile/editor code. One-way dep: never imports home.js.

import * as db from '../../core/db.js';

async function renderFavoritesWidget(w, gs) {
  const id = w?.id || '';
  const size = w.size === 'small' ? 'small' : 'medium';
  const favs = await db.getAll('favorites');
  if (favs.length === 0) {
    return `
      <div class="widget widget-favorites user-widget size-${size} empty" style="${gs}" data-widget-id="${escHtml(id)}" data-target="favorites-list">
        <div class="widget-empty-msg">收藏 · 还没有收藏 — 长按消息添加</div>
        <button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>
        <button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>
      </div>
    `;
  }
  favs.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  const pick = favs[Math.floor(Math.random() * Math.min(favs.length, 5))];  // random of latest 5
  const msg = await db.get('chatMessages', pick.msgId);
  const action = msg?.actions?.[pick.actionIdx ?? 0];
  const session = msg ? await db.get('chatSessions', msg.sessionId) : null;
  const character = session ? await db.get('characters', session.characterId) : null;
  const text = action ? actionPreviewForWidget(action) : '(原消息已删除)';
  return `
    <div class="widget widget-favorites user-widget size-${size}" style="${gs}" data-widget-id="${escHtml(id)}" data-target="favorites-list">
      <div class="widget-quote">${escHtml(text)}</div>
      <div class="widget-from">— ${escHtml(character?.name || '(未知)')}</div>
      <button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>
      <button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>
    </div>
  `;
}

function actionPreviewForWidget(a) {
  switch (a.type) {
    case 'text':   return a.content || '';
    case 'reply':  return a.content || '';
    case 'image':  return `[图片] ${a.description || ''}`;
    case 'voice':  return `[语音] ${a.content || ''}`;
    case 'red_packet': return `[红包 ¥${Number(a.amount || 0).toFixed(2)}] ${a.message || ''}`;
    case 'transfer':   return `[转账 ¥${Number(a.amount || 0).toFixed(2)}] ${a.message || ''}`;
    default: return `[${a.type}]`;
  }
}

export async function renderWidget(w, gs) {
  if (w.type === 'favorites')   return await renderFavoritesWidget(w, gs);
  if (w.type === 'image')       return renderImageWidget(w, gs);
  if (w.type === 'note')        return renderNoteWidget(w, gs);
  if (w.type === 'polaroid')    return renderPolaroidWidget(w, gs);
  if (w.type === 'anniversary') return await renderAnniversaryWidget(w, gs);
  if (w.type === 'music')       return await renderMusicWidget(w, gs);
  if (w.type === 'gameboy')     return renderGameboyWidget(w, gs);
  if (w.type === 'mp3')         return renderMp3Widget(w, gs);
  if (w.type === 'schedule')    return await renderScheduleWidget(w, gs);
  if (w.type === 'recent-chat') return await renderRecentChatWidget(w, gs);
  return '';
}

// 最近聊天大 widget(默认 4×3)— 显示最近 3 个会话:头像 + 角色名 + 最后
// 一条消息预览 + 相对时间。点单行 → 进对应 chat;点空白区域 → 进微信主页。
// 数据源:chatSessions 按 lastMessageAt 排序,排除 bear / 拉黑角色 / 不存在
// 角色的 orphan session。
async function renderRecentChatWidget(w, gs) {
  const sessions = (await db.getAll('chatSessions'))
    .filter(s => s.characterId && s.characterId !== '__bear__')
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  const rows = [];
  for (const s of sessions) {
    if (rows.length >= 3) break;
    const c = await db.get('characters', s.characterId);
    if (!c || c.blocked) continue;
    const msgs = await db.query('chatMessages', 'sessionId', s.id);
    const active = msgs.filter(m => !m.archived).sort((a, b) => a.createdAt - b.createdAt);
    const last = active[active.length - 1] || null;
    rows.push({ session: s, character: c, lastMsg: last });
  }

  const editBtn = `<button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>`;
  const delBtn = `<button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>`;

  if (rows.length === 0) {
    return `
      <div class="widget widget-recent-chat user-widget empty" style="${gs}" data-widget-id="${escHtml(w.id)}" data-target="messaging">
        <div class="rc-head">最近聊天</div>
        <div class="rc-empty">还没在聊 — 先去角色管理加一个</div>
        ${editBtn}${delBtn}
      </div>
    `;
  }

  const today = new Date();
  const fmtTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const sameDay = d.toDateString() === today.toDateString();
    if (sameDay) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return '昨天';
    const sameYear = d.getFullYear() === today.getFullYear();
    return sameYear ? `${d.getMonth()+1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
  };
  const previewLast = (m) => {
    if (!m) return '(暂无消息)';
    const a = (m.actions ?? [])[0];
    if (!a) return '';
    switch (a.type) {
      case 'text':   return a.content || '';
      case 'reply':  return a.content || '';
      case 'image':  return '[图片]';
      case 'voice':  return '[语音]';
      case 'recall': return '[已撤回]';
      case 'red_packet': return `[红包] ¥${Number(a.amount || 0).toFixed(2)}`;
      case 'transfer':   return `[转账] ¥${Number(a.amount || 0).toFixed(2)}`;
      case 'location':   return `[位置] ${a.name || ''}`;
      default: return `[${a.type}]`;
    }
  };
  const avatarHtml = (c) => {
    if (c?.avatar) return `<img class="rc-avatar" src="${escAttr(c.avatar)}" alt="">`;
    const initial = (c?.name ?? '?').slice(0, 1);
    return `<div class="rc-avatar rc-avatar-letter">${escHtml(initial)}</div>`;
  };

  const rowsHtml = rows.map(r => `
    <div class="rc-row" data-session-id="${escHtml(r.session.id)}">
      ${avatarHtml(r.character)}
      <div class="rc-text">
        <div class="rc-row-top">
          <span class="rc-name">${escHtml(r.character.name || '(未命名)')}</span>
          <span class="rc-time">${escHtml(fmtTime(r.session.lastMessageAt || r.lastMsg?.createdAt))}</span>
        </div>
        <div class="rc-preview">${escHtml(previewLast(r.lastMsg))}</div>
      </div>
    </div>
  `).join('');

  return `
    <div class="widget widget-recent-chat user-widget" style="${gs}" data-widget-id="${escHtml(w.id)}">
      <div class="rc-head">最近聊天</div>
      <div class="rc-list">${rowsHtml}</div>
      ${editBtn}${delBtn}
    </div>
  `;
}

// MP3 widget(装饰类,无功能)— iPod 致敬。viewBox 5:7 让小屏 + click wheel
// 在任意 widget cell 里居中且不变形。颜色锁死成经典白机身,user 想换色
// 调 widget bgColor 改外框就行。
function renderMp3Widget(w, gs) {
  return `
    <div class="widget widget-mp3 user-widget" style="${gs}" data-widget-id="${escHtml(w.id)}">
      <svg viewBox="0 0 100 140" class="mp3-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <linearGradient id="mp3-body-${escAttr(w.id)}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"  stop-color="#f4f4f7"/>
            <stop offset="45%" stop-color="#dedee2"/>
            <stop offset="100%" stop-color="#b8b8be"/>
          </linearGradient>
          <linearGradient id="mp3-screen-${escAttr(w.id)}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"  stop-color="#cfdce8"/>
            <stop offset="100%" stop-color="#8aa0b8"/>
          </linearGradient>
          <radialGradient id="mp3-wheel-${escAttr(w.id)}" cx="50%" cy="35%" r="65%">
            <stop offset="0%"  stop-color="#fafafd"/>
            <stop offset="60%" stop-color="#d2d2d8"/>
            <stop offset="100%" stop-color="#9a9aa0"/>
          </radialGradient>
          <radialGradient id="mp3-center-${escAttr(w.id)}" cx="40%" cy="35%" r="70%">
            <stop offset="0%"  stop-color="#ffffff"/>
            <stop offset="100%" stop-color="#c4c4c8"/>
          </radialGradient>
        </defs>
        <!-- 机身银白 metallic — 顶亮底暗 gradient + 微 inset 高光 -->
        <rect x="4" y="4" width="92" height="132" rx="12" ry="12" fill="url(#mp3-body-${escAttr(w.id)})" stroke="#909094" stroke-width="0.6"/>
        <rect x="6" y="6" width="88" height="4" rx="2" fill="#ffffff" opacity="0.4"/>
        <!-- 屏幕 — 浅蓝白色玻璃感 -->
        <rect x="14" y="14" width="72" height="44" rx="3" ry="3" fill="url(#mp3-screen-${escAttr(w.id)})" stroke="#5a708a" stroke-width="0.4"/>
        <rect x="14" y="14" width="72" height="6" rx="3" fill="#ffffff" opacity="0.25"/>
        <text x="20" y="24" font-size="3.5" fill="#1f3050" font-family="sans-serif" font-weight="600">Now Playing</text>
        <line x1="20" y1="28" x2="80" y2="28" stroke="#5a708a" stroke-width="0.35" opacity="0.6"/>
        <rect x="20" y="32" width="34" height="3.5" fill="#1f3050" opacity="0.85"/>
        <rect x="20" y="38" width="22" height="2.5" fill="#1f3050" opacity="0.55"/>
        <rect x="20" y="46" width="60" height="2.2" rx="1.1" fill="#aebcd0"/>
        <rect x="20" y="46" width="22" height="2.2" rx="1.1" fill="#1f3050"/>
        <text x="20" y="54" font-size="2.6" fill="#1f3050" opacity="0.7">1:23</text>
        <text x="80" y="54" font-size="2.6" fill="#1f3050" opacity="0.7" text-anchor="end">3:45</text>
        <!-- 滚轮 — 银白 metallic radial + 中央按钮 -->
        <circle cx="50" cy="96" r="28" fill="url(#mp3-wheel-${escAttr(w.id)})" stroke="#909094" stroke-width="0.5"/>
        <circle cx="50" cy="96" r="10" fill="url(#mp3-center-${escAttr(w.id)})" stroke="#b0b0b6" stroke-width="0.4"/>
        <text x="50" y="74" font-size="3.5" fill="#4a4a50" text-anchor="middle" font-weight="600">MENU</text>
        <path d="M 35 96 L 41 92 L 41 100 Z" fill="#4a4a50"/>
        <path d="M 65 96 L 59 92 L 59 100 Z" fill="#4a4a50"/>
        <g transform="translate(50 116)" fill="#4a4a50">
          <path d="M -4 -3 L 0 0 L -4 3 Z"/>
          <path d="M 0 -3 L 4 0 L 0 3 Z"/>
          <rect x="5" y="-3" width="1.5" height="6"/>
        </g>
      </svg>
      <button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>
      <button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>
    </div>
  `;
}

// A1: 行程 widget — 显示未来 24 小时内的行程预览(user 自己 + 所有角色的)。
// 点击整张卡片走 data-target="schedule" 跳到行程页编辑。空状态显示"没什么
// 安排"提示,避免 widget 永远是个空白方块。窗口 [now-30min, now+24h]:
// -30min 让"刚开始的"行程还显示,跟 buildScheduleLines 用的 -6h 不同 —
// widget 是用户视角看接下来要干啥,过去的事不必占位。
async function renderScheduleWidget(w, gs) {
  const all = await db.getAll('schedule');
  const now = Date.now();
  const winStart = now - 30 * 60 * 1000;
  const winEnd   = now + 24 * 60 * 60 * 1000;
  const upcoming = all
    .filter(e => e.startTs >= winStart && e.startTs <= winEnd)
    .sort((a, b) => a.startTs - b.startTs)
    .slice(0, 5);
  const charNames = new Map();
  for (const e of upcoming) {
    if (e.who === 'character' && e.characterId && !charNames.has(e.characterId)) {
      const c = await db.get('characters', e.characterId);
      charNames.set(e.characterId, c?.name || '?');
    }
  }
  const today = new Date();
  const fmtTime = (ts) => {
    const d = new Date(ts);
    const hhmm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    if (d.toDateString() === today.toDateString()) return `今天 ${hhmm}`;
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return `明天 ${hhmm}`;
    return `${d.getMonth()+1}/${d.getDate()} ${hhmm}`;
  };
  const editBtn = `<button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>`;
  const delBtn = `<button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>`;
  if (upcoming.length === 0) {
    return `
      <div class="widget widget-schedule user-widget empty" style="${gs}" data-widget-id="${escHtml(w.id)}" data-target="schedule">
        <div class="ws-head">行程</div>
        <div class="ws-empty">未来 24 小时没什么安排</div>
        ${editBtn}${delBtn}
      </div>
    `;
  }
  const rows = upcoming.map(e => {
    const who = e.who === 'user' ? '我' : (charNames.get(e.characterId) || '?');
    const isPast = e.startTs < now;
    return `
      <div class="ws-row${isPast ? ' past' : ''}">
        <div class="ws-time">${escHtml(fmtTime(e.startTs))}</div>
        <div class="ws-title">${escHtml(e.title || '(无标题)')}</div>
        <div class="ws-who">${escHtml(who)}</div>
      </div>
    `;
  }).join('');
  return `
    <div class="widget widget-schedule user-widget" style="${gs}" data-widget-id="${escHtml(w.id)}" data-target="schedule">
      <div class="ws-head">未来 24 小时 · ${upcoming.length}</div>
      <div class="ws-list">${rows}</div>
      ${editBtn}${delBtn}
    </div>
  `;
}

// 游戏机 widget(装饰类,无功能)— 致敬 Game Boy 的 SVG 卡片。viewBox 5:7
// 接近原机比例,容器自适应 widget cell 大小;preserveAspectRatio 'xMidYMid
// meet' 居中且不变形。颜色锁死成原版米黄 + 绿屏经典配色,user 想换色直接
// 调 widget bgColor 改外框就够了。
function renderGameboyWidget(w, gs) {
  return `
    <div class="widget widget-gameboy user-widget" style="${gs}" data-widget-id="${escHtml(w.id)}">
      <svg viewBox="0 0 100 140" class="gameboy-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <linearGradient id="gb-body-${escAttr(w.id)}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"  stop-color="#eaeaed"/>
            <stop offset="50%" stop-color="#d4d4d8"/>
            <stop offset="100%" stop-color="#b0b0b6"/>
          </linearGradient>
          <linearGradient id="gb-bottom-${escAttr(w.id)}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"  stop-color="#c8c8cc"/>
            <stop offset="100%" stop-color="#9a9aa0"/>
          </linearGradient>
        </defs>
        <!-- 外壳银白 metallic + 顶部 4px 高光条 -->
        <rect x="4" y="4" width="92" height="132" rx="8" ry="8" fill="url(#gb-body-${escAttr(w.id)})" stroke="#80808a" stroke-width="0.8"/>
        <rect x="6" y="6" width="88" height="4" rx="2" fill="#ffffff" opacity="0.45"/>
        <!-- 底部曲线圆弧加深一档(银白也分上下面) -->
        <path d="M4 116 L96 116 L96 128 Q96 136 88 136 L12 136 Q4 136 4 128 Z" fill="url(#gb-bottom-${escAttr(w.id)})"/>
        <!-- 屏幕外框深灰 + 经典绿屏(致敬) -->
        <rect x="14" y="18" width="72" height="58" rx="3" ry="3" fill="#2a2a2e"/>
        <rect x="20" y="26" width="60" height="42" fill="#9bbc0f"/>
        <circle cx="20" cy="58" r="1.4" fill="#dc1414"/>
        <text x="50" y="84" font-size="4" fill="#3a3a40" font-family="serif" text-anchor="middle" font-style="italic" font-weight="bold">Nintendo GAME BOY</text>
        <!-- 十字键 + AB 按钮:深灰 -->
        <rect x="13" y="92" width="20" height="6" fill="#3a3a3e" rx="1"/>
        <rect x="20" y="85" width="6" height="20" fill="#3a3a3e" rx="1"/>
        <circle cx="68" cy="98" r="4.5" fill="#5a5a60"/>
        <text x="68" y="100" font-size="3.5" fill="#fff" text-anchor="middle" font-weight="bold">B</text>
        <circle cx="80" cy="92" r="4.5" fill="#5a5a60"/>
        <text x="80" y="94" font-size="3.5" fill="#fff" text-anchor="middle" font-weight="bold">A</text>
        <g transform="translate(38 110) rotate(-20)">
          <rect width="11" height="3" rx="1.5" fill="#6a6a70"/>
        </g>
        <g transform="translate(53 110) rotate(-20)">
          <rect width="11" height="3" rx="1.5" fill="#6a6a70"/>
        </g>
        <text x="42" y="124" font-size="2.2" fill="#5a5a60" text-anchor="middle">SELECT</text>
        <text x="60" y="124" font-size="2.2" fill="#5a5a60" text-anchor="middle">START</text>
        <line x1="68" y1="124" x2="86" y2="118" stroke="#80808a" stroke-width="0.6"/>
        <line x1="68" y1="128" x2="86" y2="122" stroke="#80808a" stroke-width="0.6"/>
        <line x1="68" y1="132" x2="86" y2="126" stroke="#80808a" stroke-width="0.6"/>
      </svg>
      <button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>
      <button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>
    </div>
  `;
}

function renderImageWidget(w, gs) {
  const size = w.size || 'medium';
  return `
    <div class="widget widget-image user-widget size-${size}" style="${gs}" data-widget-id="${escHtml(w.id)}">
      <img src="${escHtml(w.data || '')}" alt="">
      <button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>
      <button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>
    </div>
  `;
}
function renderNoteWidget(w, gs) {
  const size = w.size || 'medium';
  const verticalClass = w.vertical ? ' vertical' : '';
  return `
    <div class="widget widget-note user-widget size-${size}${verticalClass}" style="${gs}" data-widget-id="${escHtml(w.id)}">
      <div class="widget-note-text">${escHtml(w.data || '')}</div>
      <button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>
      <button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>
    </div>
  `;
}

// Polaroid stack — 3 user-uploaded photos rendered as overlapping polaroid
// cards. Click any photo to bring it to the front; the click handler in
// mountHome reads data-polaroid-idx and rewrites w.data.stackOrder. data:
//   { photos: [base64, ...], stackOrder: [<bottom>, <mid>, <top>] }
function renderPolaroidWidget(w, gs) {
  const photos = Array.isArray(w.data?.photos) ? w.data.photos.slice(0, 3) : [];
  let stackOrder = Array.isArray(w.data?.stackOrder) ? [...w.data.stackOrder] : [];
  stackOrder = stackOrder.filter(i => Number.isInteger(i) && i >= 0 && i < photos.length);
  for (let i = 0; i < photos.length; i++) {
    if (!stackOrder.includes(i)) stackOrder.push(i);
  }
  if (photos.length === 0) {
    return `
      <div class="widget widget-polaroid user-widget size-small empty" style="${gs}" data-widget-id="${escHtml(w.id)}">
        <div class="widget-polaroid-empty">未上传照片</div>
        <button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>
        <button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>
      </div>
    `;
  }
  const transforms = [
    { rot: -8, x: -14, y:  4 },
    { rot:  6, x:  10, y:  2 },
    { rot:  0, x:   0, y:  0 },
  ];
  const tStart = transforms.length - photos.length;
  return `
    <div class="widget widget-polaroid user-widget size-small" style="${gs}" data-widget-id="${escHtml(w.id)}">
      ${stackOrder.map((photoIdx, stackPos) => {
        const t = transforms[tStart + stackPos];
        return `
          <img class="polaroid-photo"
               data-polaroid-idx="${photoIdx}"
               src="${escHtml(photos[photoIdx] || '')}"
               style="transform: translate(${t.x}px, ${t.y}px) rotate(${t.rot}deg); z-index: ${stackPos + 1};"
               alt="">
        `;
      }).join('')}
      <button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>
      <button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>
    </div>
  `;
}

// Anniversary — "遇见 XXX 已经 N 天". data: { name?, characterId?, startTs }.
async function renderAnniversaryWidget(w, gs) {
  // 三种模式:
  //  1) custom    — data.name + data.startTs    → "遇见 X 已经 N 天"
  //  2) character — data.characterId + data.startTs → "遇见 [角色名] 已经 N 天"
  //  3) milestone — data.milestoneId            → 按 milestone.recurring / dayKey 算
  // 模式判定:有 milestoneId 走 milestone 分支(忽略 startTs),否则按之前
  // character/custom 走 startTs 起算。milestone 被删时显示 "[已删除]"。
  let label = '__', count = 0, unit = '天';

  if (w.data?.milestoneId) {
    const m = await db.get('milestones', w.data.milestoneId);
    if (!m) {
      label = '[纪念日已删除]'; count = 0; unit = '';
    } else {
      const view = computeMilestoneDisplay(m);
      label = view.label;
      count = view.count;
      unit  = view.unit;
    }
  } else {
    const startTs = Number(w.data?.startTs);
    const daysRaw = Number.isFinite(startTs)
      ? Math.max(0, Math.floor((Date.now() - startTs) / 86400000))
      : 0;
    const fmt = formatDaysWithYears(daysRaw);
    count = fmt.count;
    unit = fmt.unit;
    let displayName = String(w.data?.name || '').trim();
    if (w.data?.characterId) {
      const c = await db.get('characters', w.data.characterId);
      if (c?.name) displayName = c.name;
    }
    label = `遇见 ${displayName || '__'} 已经`;
  }

  return `
    <div class="widget widget-anniversary user-widget" style="${gs}" data-widget-id="${escHtml(w.id)}">
      <div class="anniv-label">${escHtml(label)}</div>
      <div class="anniv-days"><span class="anniv-count">${escHtml(String(count))}</span>${unit ? `<span class="anniv-unit">${escHtml(unit)}</span>` : ''}</div>
      <button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>
      <button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>
    </div>
  `;
}

// 把 milestone row 翻译成 widget 三段显示 { label, count, unit }。
// - 非 recurring + 过去: 距 [title] 已 N 天      → label='[title] 已', count=N, unit='天'
// - 非 recurring + 未来: 距 [title] 还有 N 天    → label='距 [title] 还有', count=N, unit='天'
// - 非 recurring + 今天: [title] 就是今天        → label='[title]',  count='今天', unit=''
// - recurring + 未来:    下次 [title] 还有 N 天  → label='下次 [title] 还有', count=N, unit='天'
// - recurring + 今天:    今天就是 [title]        → label='今天就是 [title]', count='', unit=''
function computeMilestoneDisplay(m) {
  const title = String(m.title || '').trim() || '未命名';
  const [y, mo, d] = String(m.dayKey || '').split('-').map(n => parseInt(n, 10));
  if (!y || !mo || !d) return { label: title, count: 0, unit: '天' };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const MS = 86400000;

  if (m.recurring) {
    let next = new Date(now.getFullYear(), mo - 1, d);
    if (next.getTime() < today.getTime()) next = new Date(now.getFullYear() + 1, mo - 1, d);
    const days = Math.round((next.getTime() - today.getTime()) / MS);
    if (days === 0) return { label: `今天就是 ${title}`, count: '', unit: '' };
    return { label: `下次 ${title} 还有`, count: days, unit: '天' };
  }

  const target = new Date(y, mo - 1, d);
  const diff = Math.round((target.getTime() - today.getTime()) / MS);
  if (diff > 0) {
    const fmt = formatDaysWithYears(diff);
    return { label: `距 ${title} 还有`, count: fmt.count, unit: fmt.unit };
  }
  if (diff === 0) return { label: title, count: '今天', unit: '' };
  const fmt = formatDaysWithYears(Math.abs(diff));
  return { label: `${title} 已`, count: fmt.count, unit: fmt.unit };
}

// Days → display { count, unit } with years collapsed when applicable.
// 365 day groupings are an approximation (no leap years tracked) — for
// "Y 年 N 天" countdowns this is OK; user-facing relative time, not legal
// date math. < 365 stays in days. exact multiples of 365 show as "Y 周年"
// (changes the unit too so the visual feels different from a day count).
function formatDaysWithYears(n) {
  if (!Number.isFinite(n) || n < 365) return { count: n, unit: '天' };
  const years = Math.floor(n / 365);
  const rest  = n % 365;
  if (rest === 0) return { count: years, unit: '周年' };
  return { count: `${years}年${rest}`, unit: '天' };
}

// Music widget — port of phone-app-demos/01-music-widget.html. Two avatar
// circles on the earbuds: left + right can each be a persona OR a character
// (user picks from the editor). data: {
//   leftSubject?:  { kind: 'persona'|'character', id },
//   rightSubject?: { kind: 'persona'|'character', id },
//   coverImage?:   base64,  // optional album cover for the mp-cover circle
//   song, artist, lyrics, playing,
//   // legacy: characterId — pre-leftSubject migration. Treated as the right
//   // earbud's character. Left earbud falls back to active persona for
//   // legacy widgets so they keep their old look.
// }
async function renderMusicWidget(w, gs) {
  const widgetId = w.id || '';
  const song    = String(w.data?.song    || '(未选歌)');
  const artist  = String(w.data?.artist  || '');
  const lyrics  = String(w.data?.lyrics  || '')
    .split('\n').map(l => l.trim()).filter(Boolean);
  const playing = w.data?.playing !== false;
  const coverImage = w.data?.coverImage || null;

  // Resolve left / right avatars. Both can be persona OR character; legacy
  // widgets only have `characterId`, treated as right + persona-default on left.
  async function resolveAvatar(subject) {
    if (!subject || !subject.kind || !subject.id) return null;
    const row = await db.get(subject.kind === 'persona' ? 'personas' : 'characters', subject.id);
    return row?.avatar || null;
  }
  let leftAvatarUrl  = await resolveAvatar(w.data?.leftSubject);
  let rightAvatarUrl = await resolveAvatar(w.data?.rightSubject);
  // Legacy fallback: pre-leftSubject music widgets had characterId on the right
  // and the active persona on the left.
  if (!w.data?.leftSubject && !w.data?.rightSubject && w.data?.characterId) {
    const c = await db.get('characters', w.data.characterId);
    rightAvatarUrl = c?.avatar || null;
    const settings = await db.get('settings', 'default');
    if (settings?.activePersonaId) {
      const p = await db.get('personas', settings.activePersonaId);
      leftAvatarUrl = p?.avatar || null;
    }
  }

  // SVG ids must be unique per widget instance — multiple music widgets on
  // the page would otherwise share defs and clip-paths.
  const uid = `m${widgetId.replace(/[^a-z0-9]/gi, '')}`;
  const lyricInit = lyrics.length > 0 ? `♪ ${lyrics[0]}` : '';

  // Avatar layer: either a clipped <image> (when we have an avatar URL) or
  // the demo's gradient circle + highlight ellipse. preserveAspectRatio
  // "xMidYMid slice" makes the image cover-crop into the circle, like
  // background-size:cover on a CSS bg.
  const leftAvatar = leftAvatarUrl
    ? `<image href="${escAttr(leftAvatarUrl)}" x="31" y="12" width="116" height="116" preserveAspectRatio="xMidYMid slice" clip-path="url(#${uid}-l)"/>`
    : `<circle cx="89" cy="70" r="58" fill="url(#${uid}-lg)"/><ellipse cx="74" cy="52" rx="14" ry="9" fill="rgba(255,255,255,0.35)"/>`;
  const rightAvatar = rightAvatarUrl
    ? `<image href="${escAttr(rightAvatarUrl)}" x="143" y="12" width="116" height="116" preserveAspectRatio="xMidYMid slice" clip-path="url(#${uid}-r)"/>`
    : `<circle cx="201" cy="70" r="58" fill="url(#${uid}-rg)"/><ellipse cx="186" cy="52" rx="14" ry="9" fill="rgba(255,255,255,0.35)"/>`;
  // mp-cover: either upload album cover, else default music-note icon on
  // the gradient circle. Cover uses inline style so the playing spin
  // animation still rotates the whole div including the cover bg.
  const coverContent = coverImage
    ? ''
    : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`;
  const coverStyle = coverImage
    ? `background-image: url('${escAttr(coverImage)}'); background-size: cover; background-position: center;`
    : '';

  // Lyrics are also stored as a data attr (JSON) so the timer-starter in
  // startMusicTimers can read them without re-fetching the widget row.
  const lyricsAttr = escAttr(JSON.stringify(lyrics));
  return `
    <div class="widget widget-music user-widget${playing ? ' is-playing' : ''}" style="${gs}"
         data-widget-id="${escHtml(widgetId)}" data-lyrics='${lyricsAttr}'>
      <svg class="widget-svg" viewBox="0 0 290 185" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="${uid}-lg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffd0dd"/>
            <stop offset="100%" stop-color="#ff7da6"/>
          </linearGradient>
          <linearGradient id="${uid}-rg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#c490e6"/>
            <stop offset="100%" stop-color="#6b8af2"/>
          </linearGradient>
          <filter id="${uid}-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4"/>
          </filter>
          <clipPath id="${uid}-l"><circle cx="89" cy="70" r="58"/></clipPath>
          <clipPath id="${uid}-r"><circle cx="201" cy="70" r="58"/></clipPath>
        </defs>
        <path d="M 21 75 Q 21 140, 145 160" stroke="var(--wire-color)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <path d="M 269 75 Q 269 140, 145 160" stroke="var(--wire-color)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <ellipse cx="89"  cy="74" rx="58" ry="58" fill="rgba(0,0,0,0.2)" filter="url(#${uid}-shadow)"/>
        <ellipse cx="201" cy="74" rx="58" ry="58" fill="rgba(0,0,0,0.2)" filter="url(#${uid}-shadow)"/>
        ${leftAvatar}
        ${rightAvatar}
        <circle cx="21"  cy="70" r="5" fill="var(--wire-color)"/>
        <circle cx="269" cy="70" r="5" fill="var(--wire-color)"/>
        <rect x="135" y="160" width="20" height="11" rx="3.5" fill="var(--wire-knot)"/>
        <line x1="145" y1="171" x2="145" y2="185" stroke="var(--wire-color)" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      <div class="mini-player">
        <div class="mp-cover${playing ? ' playing' : ''}" style="${coverStyle}">
          ${coverContent}
        </div>
        <div class="mp-info">
          <div class="mp-song">${escHtml(song)}</div>
          <div class="mp-artist">${escHtml(artist)}</div>
          <div class="mp-lyric">${escHtml(lyricInit)}</div>
          <div class="mp-progress"><div class="mp-progress-fill"></div></div>
        </div>
      </div>
      <button class="widget-edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></button>
      <button class="widget-del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>
    </div>
  `;
}

export function escHtml(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}

export function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
