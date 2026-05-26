// Home: iOS-style multi-page main area + bottom dock.
//
// Layout (post-unifiedGridV1): each page is a single 4-column grid (.app-grid)
// where apps AND user widgets coexist. Each item gets an inline
// `grid-column: <col+1> / span <colSpan>; grid-row: <row+1> / span <rowSpan>`
// style — the grid auto-rows is fixed at 90px (in base.css) so a widget that
// spans 2 rows is ~190px tall, 3 rows ~290px. Empty cells = no element
// renders there (iPhone-style sparse layout).
//
// Edit mode (long-press on touch / right-click on desktop): items jiggle,
// delete × shows, page horizontal scroll pauses, items can be dragged to any
// empty (row,col) slot OR swapped with another item of the same size. The
// `+ 添加装饰` button appears below the grid (or always when no user
// widgets exist).

import * as db from '../../core/db.js';
import { openConfirm, openAlert } from '../../core/modal.js';

let preserveEditModeOnMount = false;

// Cross-page drag (B#5) reinstated: after a drop that landed on a different
// page, persistMove writes to that page's tileOrder and router.navigate('home')
// re-mounts the page with .home-pages.scrollLeft = 0 (so user visually sees
// "弹回 page 0"). Fix: stash the destination page index here before navigate,
// read it in mountHome after re-render and scrollTo there.
let _restoreScrollToPage = null;

// Music widget lyric-cycle timers. One interval per music widget; cleared
// on every re-render and on home teardown so old timers don't keep firing
// against dead DOM nodes.
const _musicTimers = new Map();  // widgetId -> intervalId

const SVG = {
  chat:      `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`,
  character: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
  book:      `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 16H8v-2h8v2zm0-4H8v-2h8v2zm0-4H8V8h8v2z"/></svg>`,
  persona:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5c1-2.4 3.2-3.5 5.5-3.5s4.5 1.1 5.5 3.5"/></svg>`,
  gear:      `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg>`,
  diary:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5z"/><path d="M5 4v18"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>`,
  schedule:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/><circle cx="8.5" cy="14" r="0.8" fill="currentColor"/><circle cx="12" cy="14" r="0.8" fill="currentColor"/><circle cx="15.5" cy="14" r="0.8" fill="currentColor"/></svg>`,
  camera:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2z"/><circle cx="10" cy="12" r="2"/></svg>`,
  shop:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h16l-1.5 11a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/></svg>`,
  twitter:   `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3l7.5 10.2L3.5 21h2l6.2-6.9L17 21h4l-7.9-10.7L20.5 3h-2L13 8.9 8 3z"/></svg>`,
  forum:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4v-4H4a0 0 0 0 1 0 0V6a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 12h4"/></svg>`,
  bottle:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3h4v3.5a3 3 0 0 0 1 2.2l1.6 1.5a4 4 0 0 1 1.4 3v7.3a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 20.5v-7.3a4 4 0 0 1 1.4-3L9 8.7A3 3 0 0 0 10 6.5z"/><path d="M10 3h4"/><path d="M9 14c1.5-1 4.5-1 6 0"/></svg>`,
  memory:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/><circle cx="9" cy="13" r="1.2" fill="currentColor"/><circle cx="13" cy="13" r="1.2" fill="currentColor"/><circle cx="17" cy="13" r="1.2" fill="currentColor"/><circle cx="9" cy="17" r="1.2" fill="currentColor"/></svg>`,
};

// Pages — page 1 holds the main builder tools (character / worldbook /
// persona / memory). Page 2 collects Phase 3+ placeholder apps. Default
// positions are computed at migration time (or for fresh users on first
// mount) — each tile gets (row, col) coords that home.js renders via
// `grid-column / grid-row` inline styles.
const PAGES = [
  [
    { id: 'character-list', label: '角色',   icon: SVG.character },
    { id: 'worldbook-list', label: '世界书', icon: SVG.book },
    { id: 'persona-list',   label: '人设',   icon: SVG.persona },
    { id: 'memory',         label: '记忆',   icon: SVG.memory },
  ],
  [
    { id: 'schedule',       label: '行程',   icon: SVG.schedule },
    { id: 'diary',          label: '日记',   icon: SVG.diary },
    { id: 'twitter',        label: '推特',   icon: SVG.twitter },
    { id: 'forum',          label: '论坛',   icon: SVG.forum },
    { id: 'shop',           label: '商城',   icon: SVG.shop },
    { id: 'monitor',        label: '监控',   icon: SVG.camera },
    { id: 'bottle',         label: '漂流瓶', icon: SVG.bottle },
  ],
];

// Dock — 4-slot grid at the bottom. apps in dock are the "always visible"
// shortcuts. settings.dockOrder = [appId|null, appId|null, appId|null, appId|null]
// holds which app is in which slot;default centers 微信/设置 at slots 1,2.
// Apps in the dock are taken from a global registry (DOCK_CATALOG + PAGES
// flat) so the user can swap a page app into the dock and vice versa.
const DOCK_CATALOG = [
  { id: 'messaging', label: '微信', icon: SVG.chat },
  { id: 'settings',  label: '设置', icon: SVG.gear },
];
const DOCK_DEFAULT = [null, 'messaging', 'settings', null];

const COLS = 4;  // home grid has 4 columns (dock also 4)
const DOCK_SLOTS = 4;

// (col-span, row-span) for each widget. New data layout: widgets store
// colSpan/rowSpan directly (1..4 / 1..5), letting the user pick any combo
// from the editor. We still honor the legacy `size` field so existing
// users' widgets keep their shape after the v2 upgrade.
function widgetSpan(w) {
  // Explicit colSpan/rowSpan wins (new format).
  if (Number.isFinite(w.colSpan) && Number.isFinite(w.rowSpan)) {
    return { colSpan: w.colSpan, rowSpan: w.rowSpan };
  }
  // Legacy size mapping — kept for backwards-compat with rows saved before
  // the colSpan/rowSpan refactor.
  if (w.type === 'music')       return { colSpan: 2, rowSpan: 2 };
  if (w.type === 'polaroid')    return { colSpan: 2, rowSpan: 2 };
  if (w.type === 'anniversary') return { colSpan: 2, rowSpan: 1 };
  if (w.type === 'favorites') {
    return w.size === 'small' ? { colSpan: 2, rowSpan: 1 } : { colSpan: 4, rowSpan: 1 };
  }
  if (w.size === 'small') return { colSpan: 2, rowSpan: 1 };
  if (w.size === 'large') return { colSpan: 4, rowSpan: 3 };
  return { colSpan: 4, rowSpan: 2 };  // medium default
}

// Available size presets shown in the widget editor's 大小 dropdown.
// Order matters — narrower → wider/taller. Stored on the widget as
// colSpan/rowSpan integers; the dropdown just provides nice labels.
const SIZE_PRESETS = [
  { label: '小  (2×1)', col: 2, row: 1 },
  { label: '标准(2×2)', col: 2, row: 2 },
  { label: '宽  (4×1)', col: 4, row: 1 },
  { label: '大  (4×2)', col: 4, row: 2 },
  { label: '巨  (4×3)', col: 4, row: 3 },
];

function gridStyle(row, col, colSpan, rowSpan, transparency) {
  // transparency is 0..100 (default 100 = opaque). Mapped to CSS var
  // --widget-alpha (0..1) which the .widget.user-widget rule reads as
  // opacity. Polaroid is exempt from opacity in CSS (its photos shouldn't
  // fade), so this still applies to polaroid containers (no visible bg)
  // but doesn't affect the photo cards visually except via the wrapper.
  const alpha = Number.isFinite(transparency)
    ? Math.max(0, Math.min(100, transparency)) / 100
    : 1;
  return `grid-column: ${col + 1} / span ${colSpan}; grid-row: ${row + 1} / span ${rowSpan}; --widget-alpha: ${alpha};`;
}

// ── Widget rendering ─────────────────────────────────────────────────────
// Each renderXxxWidget(w, gs) returns the widget's HTML with the inline
// grid-placement style spliced into the root <div>. The `gs` string comes
// from gridStyle(row, col, colSpan, rowSpan).

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

async function renderWidget(w, gs) {
  if (w.type === 'favorites')   return await renderFavoritesWidget(w, gs);
  if (w.type === 'image')       return renderImageWidget(w, gs);
  if (w.type === 'note')        return renderNoteWidget(w, gs);
  if (w.type === 'polaroid')    return renderPolaroidWidget(w, gs);
  if (w.type === 'anniversary') return await renderAnniversaryWidget(w, gs);
  if (w.type === 'music')       return await renderMusicWidget(w, gs);
  return '';
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
  return `
    <div class="widget widget-note user-widget size-${size}" style="${gs}" data-widget-id="${escHtml(w.id)}">
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

function escHtml(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}

function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function tileHtml(t, row, col) {
  // Pass null row/col for items in a non-positioned grid (rare now that even
  // the dock uses positioned cells). When provided, place via inline grid
  // coords as 1×1.
  const style = (Number.isFinite(row) && Number.isFinite(col))
    ? ` style="${gridStyle(row, col, 1, 1)}"`
    : '';
  return `
    <button class="app-icon" data-target="${t.id}" data-label="${t.label}"${style}>
      <div class="icon">${t.icon}</div>
      <div class="label">${t.label}</div>
    </button>
  `;
}

// Resolve any app id back to its {id, label, icon} entry. Apps live in
// either PAGES (per-page) or DOCK_CATALOG (dock-only by default). Drag
// between dock ↔ pages requires both registries to be searchable by id.
function resolveTile(id) {
  for (const page of PAGES) {
    const t = page.find(x => x.id === id);
    if (t) return t;
  }
  return DOCK_CATALOG.find(x => x.id === id) || null;
}

// ── Add-widget modal ─────────────────────────────────────────────────────
// Text-only picker — emojis + hints were removed because 6 buttons in a
// flex row overflowed in narrow viewports. Now a 3×2 grid (see
// .widget-type-picker in base.css).
async function openAddWidgetModal(container, router) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">添加桌面装饰</div>
      <div class="widget-type-picker">
        <button type="button" class="widget-type-btn" data-type="favorites">收藏</button>
        <button type="button" class="widget-type-btn" data-type="image">图片</button>
        <button type="button" class="widget-type-btn" data-type="note">便签</button>
        <button type="button" class="widget-type-btn" data-type="polaroid">拍立得</button>
        <button type="button" class="widget-type-btn" data-type="anniversary">纪念日</button>
        <button type="button" class="widget-type-btn" data-type="music">音乐</button>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary cancel-btn">取消</button>
      </div>
    </div>
  `;
  container.appendChild(modal);
  modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  modal.querySelectorAll('[data-type]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.type;
      if (type === 'favorites') {
        modal.remove();
        const opts = await askSizeAndTransparency(container, '4x1');
        if (!opts) return;
        await saveNewWidget({
          type: 'favorites',
          ...opts.span,
          transparency: opts.transparency,
        }, router);
      } else if (type === 'image') {
        modal.remove();
        await pickImageAndSave(container, router);
      } else if (type === 'note') {
        renderNoteEditor(modal, container, router);
      } else if (type === 'polaroid') {
        modal.remove();
        await pickPolaroidPhotosAndSave(container, router);
      } else if (type === 'anniversary') {
        renderAnniversaryEditor(modal, container, router);
      } else if (type === 'music') {
        renderMusicEditor(modal, container, router);
      }
    });
  });
}

// ── Size + transparency form helpers ─────────────────────────────────────
// Used by every "add widget" / "edit widget" modal so the user can pick a
// (colSpan × rowSpan) preset + dial the widget's opacity without each
// editor implementing the same controls.

function sizeSelectHtml(currentColSpan, currentRowSpan, defaultPreset) {
  // defaultPreset = '2x2' or '4x1' etc. — used when no current value.
  const def = defaultPreset || '2x2';
  return `
    <label>
      <div class="label-text">大小</div>
      <select name="sizePreset">
        ${SIZE_PRESETS.map(p => {
          const isCurrent = (Number.isFinite(currentColSpan) && Number.isFinite(currentRowSpan))
            ? (p.col === currentColSpan && p.row === currentRowSpan)
            : (`${p.col}x${p.row}` === def);
          return `<option value="${p.col}x${p.row}"${isCurrent ? ' selected' : ''}>${p.label}</option>`;
        }).join('')}
      </select>
    </label>
  `;
}

function transparencyFieldHtml(current) {
  const val = Number.isFinite(current) ? Math.max(0, Math.min(100, current)) : 100;
  return `
    <label>
      <div class="label-text">不透明度:<span class="transp-readout">${val}</span>%(100 = 完全不透明、0 = 完全透明)</div>
      <input type="range" min="0" max="100" step="5" name="transparency" value="${val}">
    </label>
  `;
}

// Wire up the transparency slider's live readout. Call after inserting the
// field into a modal.
function wireTransparencyReadout(modal) {
  const slider = modal.querySelector('input[name="transparency"]');
  if (!slider) return;
  const readout = modal.querySelector('.transp-readout');
  slider.addEventListener('input', () => { if (readout) readout.textContent = slider.value; });
}

function parseSizePreset(sizeStr) {
  const m = /^(\d+)x(\d+)$/.exec(String(sizeStr || ''));
  if (!m) return null;
  return { colSpan: Number(m[1]), rowSpan: Number(m[2]) };
}

const ROWS = 5;  // 4 cols × 5 rows;一度试过 6 行,手机底部装不下被截,回退

// Build a 4×ROWS boolean occupancy grid from page-0 items (widgets + apps).
// Out-of-bounds cells are treated as occupied so placement clamps inside the
// visible grid.
function buildOccupancy(widgets, page0AppEntries) {
  const occ = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  const mark = (r, c, w, h) => {
    for (let rr = r; rr < r + h; rr++) {
      for (let cc = c; cc < c + w; cc++) {
        if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) occ[rr][cc] = true;
      }
    }
  };
  for (const w of widgets) {
    const sp = widgetSpan(w);
    mark(Number(w.row) || 0, Number(w.col) || 0, sp.colSpan, sp.rowSpan);
  }
  for (const e of page0AppEntries) {
    if (typeof e === 'object' && Number.isFinite(e?.row) && Number.isFinite(e?.col)) {
      mark(e.row, e.col, 1, 1);
    }
  }
  return occ;
}

// Scan the 4×ROWS grid top-to-bottom, left-to-right for the first cell where
// a (w × h) widget fits entirely inside both the grid bounds and unoccupied
// cells. Returns { row, col } or null when nothing fits.
function findFirstFreeCell(occ, w, h) {
  for (let r = 0; r <= ROWS - h; r++) {
    for (let c = 0; c <= COLS - w; c++) {
      let ok = true;
      for (let rr = r; rr < r + h && ok; rr++) {
        for (let cc = c; cc < c + w && ok; cc++) {
          if (occ[rr][cc]) ok = false;
        }
      }
      if (ok) return { row: r, col: c };
    }
  }
  return null;
}

// Find a free slot for a new widget. Falls back to alert if 4×ROWS is full so
// we never silently overflow — overflow either compresses every cell
// (when grid-auto-rows kicks in) or hides the widget under home-page's
// overflow:hidden. Both bugs were trivially repro'd on mobile.
async function saveNewWidget(partial, router) {
  const widgets = await db.getAll('homeWidgets');
  const settings = await db.get('settings', 'default');
  const page0Entries = Array.isArray(settings?.tileOrder?.[0]) ? settings.tileOrder[0] : [];
  const occ = buildOccupancy(widgets, page0Entries);

  // partial usually carries colSpan/rowSpan from the editor — fall back to
  // widgetSpan for safety (e.g. a future caller that forgets to include them).
  const span = (Number.isFinite(partial.colSpan) && Number.isFinite(partial.rowSpan))
    ? { colSpan: partial.colSpan, rowSpan: partial.rowSpan }
    : widgetSpan(partial);
  const slot = findFirstFreeCell(occ, span.colSpan, span.rowSpan);
  if (!slot) {
    await openAlert(document.body, {
      title: '桌面已满',
      message: `没找到 ${span.colSpan}×${span.rowSpan} 的空格。先删一个 widget,或把现有的拖到一块腾位置。`,
      danger: true,
    });
    return;
  }
  await db.set('homeWidgets', {
    id: db.newId(),
    row: slot.row,
    col: slot.col,
    createdAt: Date.now(),
    ...partial,
  });
  await router.navigate('home');
}

// Patch an existing widget — preserves row/col/createdAt/id and updates only
// the user-changeable fields (size, transparency, content). Used by the
// edit-widget modal in edit mode.
async function updateWidget(id, patch, router) {
  const w = await db.get('homeWidgets', id);
  if (!w) return;
  Object.assign(w, patch);
  await db.set('homeWidgets', w);
  await router.navigate('home');
}

// Helpers — extracted so renderImageEditor / renderPolaroidEditor can pick a
// new file in-place without going through the add-flow (which writes a new
// widget row instead of patching the existing one).
async function pickImageFile(maxMB = 4) {
  const file = await new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
  if (!file) return null;
  if (file.size > maxMB * 1024 * 1024) {
    await openAlert(document.body, { title: '图片太大', message: `${(file.size/1024/1024).toFixed(1)} MB,建议 < ${maxMB} MB,IndexedDB 容易满。`, danger: true });
    return null;
  }
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

async function pickImageAndSave(container, router) {
  const file = await new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    await openAlert(document.body, { title: '图片太大', message: `${(file.size/1024/1024).toFixed(1)} MB,建议 < 4 MB,IndexedDB 容易满。`, danger: true });
    return;
  }
  const data = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  const opts = await askSizeAndTransparency(container, '4x2');
  if (!opts) return;
  await saveNewWidget({ type: 'image', data, ...opts.span, transparency: opts.transparency }, router);
}

function renderNoteEditor(modal, container, router, existing) {
  const initText  = existing?.data ?? '';
  const initSpan  = existing ? widgetSpan(existing) : null;
  const initAlpha = existing?.transparency;
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${existing ? '编辑便签' : '便签'}</div>
      <form class="note-form">
        <label>
          <div class="label-text">写点什么</div>
          <textarea name="text" rows="4" required placeholder="写点什么...">${escHtml(initText)}</textarea>
        </label>
        ${sizeSelectHtml(initSpan?.colSpan, initSpan?.rowSpan, '4x2')}
        ${transparencyFieldHtml(initAlpha)}
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
          <button type="submit" class="btn">${existing ? '保存' : '添加'}</button>
        </div>
      </form>
    </div>
  `;
  wireTransparencyReadout(modal);
  modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
  modal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(modal.querySelector('form'));
    const text = String(fd.get('text') || '').trim();
    if (!text) return;
    const span = parseSizePreset(fd.get('sizePreset')) || { colSpan: 4, rowSpan: 2 };
    const transparency = Number(fd.get('transparency')) || 100;
    modal.remove();
    if (existing) {
      await updateWidget(existing.id, { data: text, ...span, transparency }, router);
    } else {
      await saveNewWidget({ type: 'note', data: text, ...span, transparency }, router);
    }
  });
}

async function pickPolaroidPhotosAndSave(container, router) {
  const files = await new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => resolve([...(input.files || [])]);
    input.click();
  });
  if (!files || files.length === 0) return;
  if (files.length > 3) files.length = 3;
  for (const f of files) {
    if (f.size > 4 * 1024 * 1024) {
      await openAlert(document.body, { title: '图片太大', message: `${f.name}: ${(f.size/1024/1024).toFixed(1)} MB,建议每张 < 4 MB。`, danger: true });
      return;
    }
  }
  const photos = await Promise.all(files.map(f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  })));
  const opts = await askSizeAndTransparency(container, '2x2');
  if (!opts) return;
  await saveNewWidget({
    type: 'polaroid',
    data: { photos, stackOrder: photos.map((_, i) => i) },
    ...opts.span,
    transparency: opts.transparency,
  }, router);
}

// Editor for an existing image widget — shows current pic + "换图" button +
// size/transparency. New image is loaded into a closure variable; not
// persisted until submit (so cancelling cleanly throws away the picked file).
async function renderImageEditor(modal, container, router, existing) {
  let imageData = existing?.data || null;
  const initSpan = existing ? widgetSpan(existing) : null;
  const initAlpha = existing?.transparency;

  function render() {
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">编辑图片</div>
        <form class="image-form">
          <label>
            <div class="label-text">图片</div>
            <div class="image-edit-preview">
              ${imageData ? `<img src="${escAttr(imageData)}" alt="">` : '<div class="image-edit-empty">(空)</div>'}
            </div>
            <div class="image-edit-controls">
              <button type="button" class="btn secondary swap-image">换图</button>
            </div>
          </label>
          ${sizeSelectHtml(initSpan?.colSpan, initSpan?.rowSpan, '4x2')}
          ${transparencyFieldHtml(initAlpha)}
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">保存</button>
          </div>
        </form>
      </div>
    `;
    wireTransparencyReadout(modal);
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('.swap-image').addEventListener('click', async () => {
      const data = await pickImageFile();
      if (data) { imageData = data; render(); }
    });
    modal.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      const span = parseSizePreset(fd.get('sizePreset')) || { colSpan: 4, rowSpan: 2 };
      const transparency = Number(fd.get('transparency')) || 100;
      modal.remove();
      await updateWidget(existing.id, { data: imageData, ...span, transparency }, router);
    });
  }
  render();
}

// Editor for an existing polaroid widget — 3 photo slots, each with 换/删
// buttons; empty slots get "+ 加". Photos stored in `pendingPhotos` closure,
// only persisted on submit. stackOrder is recalculated to match the new
// photo array.
async function renderPolaroidEditor(modal, container, router, existing) {
  let pendingPhotos = Array.isArray(existing?.data?.photos) ? [...existing.data.photos].slice(0, 3) : [];
  const initSpan = existing ? widgetSpan(existing) : null;
  const initAlpha = existing?.transparency;

  function render() {
    const slots = Array.from({ length: 3 }, (_, i) => pendingPhotos[i] || null);
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">编辑拍立得</div>
        <form class="polaroid-form">
          <label>
            <div class="label-text">三张照片(最多 3 张)</div>
            <div class="polaroid-edit-slots">
              ${slots.map((p, i) => `
                <div class="polaroid-edit-slot${p ? '' : ' empty'}" data-slot-idx="${i}">
                  ${p ? `<img src="${escAttr(p)}" alt="">` : '<div class="polaroid-edit-plus">+</div>'}
                  <div class="polaroid-edit-slot-btns">
                    ${p
                      ? `<button type="button" class="btn-mini swap" data-slot-idx="${i}">换</button>
                         <button type="button" class="btn-mini del" data-slot-idx="${i}">删</button>`
                      : `<button type="button" class="btn-mini add" data-slot-idx="${i}">加</button>`}
                  </div>
                </div>
              `).join('')}
            </div>
          </label>
          ${sizeSelectHtml(initSpan?.colSpan, initSpan?.rowSpan, '2x2')}
          ${transparencyFieldHtml(initAlpha)}
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">保存</button>
          </div>
        </form>
      </div>
    `;
    wireTransparencyReadout(modal);
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());

    // 槽位按钮 — swap/del/add 都改 pendingPhotos 再 re-render。
    modal.querySelectorAll('.polaroid-edit-slot-btns button').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.slotIdx);
        if (btn.classList.contains('del')) {
          pendingPhotos.splice(idx, 1);
          render();
        } else if (btn.classList.contains('swap') || btn.classList.contains('add')) {
          const data = await pickImageFile();
          if (!data) return;
          if (btn.classList.contains('swap')) {
            pendingPhotos[idx] = data;
          } else {
            pendingPhotos.push(data);
          }
          render();
        }
      });
    });

    modal.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      const span = parseSizePreset(fd.get('sizePreset')) || { colSpan: 2, rowSpan: 2 };
      const transparency = Number(fd.get('transparency')) || 100;
      modal.remove();
      // stackOrder 重置成 [0..n-1] —— 改照片后老的 stackOrder 索引可能指向
      // 不存在的位置。点击交互重新累积 stackOrder。
      const photos = pendingPhotos.filter(Boolean);
      await updateWidget(existing.id, {
        data: { photos, stackOrder: photos.map((_, i) => i) },
        ...span,
        transparency,
      }, router);
    });
  }
  render();
}

async function renderAnniversaryEditor(modal, container, router, existing) {
  const chars = (await db.getAll('characters')).filter(c => c.id !== '__bear__');
  const milestones = await db.getAll('milestones');
  milestones.sort((a, b) => String(a.dayKey || '').localeCompare(String(b.dayKey || '')));
  const today = new Date();
  const defaultDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  // Pre-fill from existing widget if editing.
  const initMilestoneId = existing?.data?.milestoneId || '';
  const initStartTs   = existing?.data?.startTs;
  const initDateStr   = Number.isFinite(initStartTs)
    ? new Date(initStartTs).toISOString().slice(0, 10)
    : defaultDate;
  const initChar      = existing?.data?.characterId || '';
  const initName      = existing?.data?.name || '';
  // Mode 优先级:milestoneId > characterId > 有自定义名 > fallback
  // (默认 character 当有角色,否则 custom — milestone 必须 user 主动切换才用,
  // 因为创建顺序通常是先有角色 / 先想个名字)
  let initMode = 'custom';
  if (initMilestoneId)      initMode = 'milestone';
  else if (initChar)        initMode = 'character';
  else if (initName)        initMode = 'custom';
  else if (chars.length > 0) initMode = 'character';
  const initSpan      = existing ? widgetSpan(existing) : null;
  const initAlpha     = existing?.transparency;

  function milestoneLabel(m) {
    const title = String(m.title || '(未命名)').trim();
    const tag = m.recurring ? ' · 每年' : '';
    return `${title} (${m.dayKey})${tag}`;
  }

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${existing ? '编辑纪念日' : '纪念日'}</div>
      <form class="anniv-form">
        <label>
          <div class="label-text">类型</div>
          <div class="anniv-mode-row">
            <label class="radio-inline">
              <input type="radio" name="mode" value="character"${initMode === 'character' ? ' checked' : ''}${chars.length === 0 ? ' disabled' : ''}>
              <span>角色</span>
            </label>
            <label class="radio-inline">
              <input type="radio" name="mode" value="custom"${initMode === 'custom' ? ' checked' : ''}>
              <span>自定义</span>
            </label>
            <label class="radio-inline">
              <input type="radio" name="mode" value="milestone"${initMode === 'milestone' ? ' checked' : ''}${milestones.length === 0 ? ' disabled' : ''}>
              <span>关联纪念日</span>
            </label>
          </div>
          ${chars.length === 0 ? `<div class="muted-hint">(还没有角色,先去角色管理创建一个就能选)</div>` : ''}
          ${milestones.length === 0 ? `<div class="muted-hint">(还没有纪念日,先去记忆 app → 纪念日 加一个就能挂在桌面)</div>` : ''}
        </label>
        <label class="anniv-char-block"${initMode === 'character' ? '' : ' hidden'}>
          <div class="label-text">选哪个角色</div>
          <select name="characterId">
            ${chars.map(c => `<option value="${escHtml(c.id)}"${c.id === initChar ? ' selected' : ''}>${escHtml(c.name || '(未命名)')}</option>`).join('')}
          </select>
        </label>
        <label class="anniv-custom-block"${initMode === 'custom' ? '' : ' hidden'}>
          <div class="label-text">叫 ta 什么(比如:小猫 / 阿七)</div>
          <input type="text" name="name" maxlength="20" placeholder="名字 / 昵称" value="${escAttr(initName)}">
        </label>
        <label class="anniv-milestone-block"${initMode === 'milestone' ? '' : ' hidden'}>
          <div class="label-text">选一个纪念日</div>
          <select name="milestoneId">
            ${milestones.map(m => `<option value="${escHtml(m.id)}"${m.id === initMilestoneId ? ' selected' : ''}>${escHtml(milestoneLabel(m))}</option>`).join('')}
          </select>
        </label>
        <label class="anniv-date-block"${initMode === 'milestone' ? ' hidden' : ''}>
          <div class="label-text">从哪天开始算</div>
          <input type="date" name="startDate" value="${initDateStr}">
        </label>
        ${sizeSelectHtml(initSpan?.colSpan, initSpan?.rowSpan, '2x1')}
        ${transparencyFieldHtml(initAlpha)}
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
          <button type="submit" class="btn">${existing ? '保存' : '添加'}</button>
        </div>
      </form>
    </div>
  `;
  wireTransparencyReadout(modal);
  modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
  modal.querySelectorAll('input[name="mode"]').forEach(r => {
    r.addEventListener('change', () => {
      const mode = modal.querySelector('input[name="mode"]:checked').value;
      modal.querySelector('.anniv-char-block').hidden      = (mode !== 'character');
      modal.querySelector('.anniv-custom-block').hidden    = (mode !== 'custom');
      modal.querySelector('.anniv-milestone-block').hidden = (mode !== 'milestone');
      // milestone 模式不需要起始日期(用 milestone 自己的 dayKey)
      modal.querySelector('.anniv-date-block').hidden      = (mode === 'milestone');
    });
  });
  modal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(modal.querySelector('form'));
    const mode = String(fd.get('mode') || 'custom');
    const data = {};
    if (mode === 'milestone') {
      const mid = String(fd.get('milestoneId') || '');
      if (!mid) return;
      data.milestoneId = mid;
    } else {
      const startDateStr = String(fd.get('startDate') || '').trim();
      if (!startDateStr) return;
      const startTs = new Date(`${startDateStr}T12:00:00`).getTime();
      if (!Number.isFinite(startTs)) return;
      data.startTs = startTs;
      if (mode === 'character') {
        const cid = String(fd.get('characterId') || '');
        if (!cid) return;
        data.characterId = cid;
      } else {
        const name = String(fd.get('name') || '').trim();
        if (!name) return;
        data.name = name;
      }
    }
    const span = parseSizePreset(fd.get('sizePreset')) || { colSpan: 2, rowSpan: 1 };
    const transparency = Number(fd.get('transparency')) || 100;
    modal.remove();
    if (existing) {
      await updateWidget(existing.id, { data, ...span, transparency }, router);
    } else {
      await saveNewWidget({ type: 'anniversary', data, ...span, transparency }, router);
    }
  });
}

// Music editor — picks a character (whose avatar lights the right earbud)
// + song / artist / multiline lyrics. The active persona's avatar is used
// for the left earbud automatically (no separate picker needed — there's
// always exactly one active persona via settings.activePersonaId).
async function renderMusicEditor(modal, container, router, existing) {
  const chars = (await db.getAll('characters')).filter(c => c.id !== '__bear__');
  const personas = await db.getAll('personas');
  const initSong    = existing?.data?.song    ?? '';
  const initArtist  = existing?.data?.artist  ?? '';
  const initLyrics  = existing?.data?.lyrics  ?? '';
  const initPlaying = existing ? (existing.data?.playing !== false) : true;
  const initSpan    = existing ? widgetSpan(existing) : null;
  const initAlpha   = existing?.transparency;
  // Subjects can be persona OR character; encoded as "kind:id" in the select
  // value. Legacy widgets had `characterId` only on the right earbud.
  function subjectValue(subj) {
    if (subj?.kind && subj?.id) return `${subj.kind}:${subj.id}`;
    return '';
  }
  const initLeft  = subjectValue(existing?.data?.leftSubject);
  const initRight = existing?.data?.rightSubject
    ? subjectValue(existing.data.rightSubject)
    : (existing?.data?.characterId ? `character:${existing.data.characterId}` : '');
  const initCoverImage = existing?.data?.coverImage || null;

  function subjectOptionsHtml(selectedValue) {
    return `
      <option value=""${selectedValue === '' ? ' selected' : ''}>(留空 — 默认渐变圆)</option>
      ${personas.length > 0 ? `
        <optgroup label="人设">
          ${personas.map(p => {
            const v = `persona:${p.id}`;
            return `<option value="${escAttr(v)}"${v === selectedValue ? ' selected' : ''}>${escHtml(p.name || '(未命名)')}</option>`;
          }).join('')}
        </optgroup>
      ` : ''}
      ${chars.length > 0 ? `
        <optgroup label="角色">
          ${chars.map(c => {
            const v = `character:${c.id}`;
            return `<option value="${escAttr(v)}"${v === selectedValue ? ' selected' : ''}>${escHtml(c.name || '(未命名)')}</option>`;
          }).join('')}
        </optgroup>
      ` : ''}
    `;
  }
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${existing ? '编辑音乐' : '音乐'}</div>
      <form class="music-form">
        <label>
          <div class="label-text">左边耳塞</div>
          <select name="leftSubject">${subjectOptionsHtml(initLeft)}</select>
        </label>
        <label>
          <div class="label-text">右边耳塞</div>
          <select name="rightSubject">${subjectOptionsHtml(initRight)}</select>
        </label>
        <label>
          <div class="label-text">歌名</div>
          <input type="text" name="song" required placeholder="夜曲" value="${escAttr(initSong)}">
        </label>
        <label>
          <div class="label-text">歌手</div>
          <input type="text" name="artist" placeholder="周杰伦" value="${escAttr(initArtist)}">
        </label>
        <label>
          <div class="label-text">歌词(一行一句,每 4 秒切下一句)</div>
          <textarea name="lyrics" rows="4" placeholder="一群嗜血的蚂蚁&#10;被腐肉所吸引&#10;我面无表情&#10;看孤独的风景">${escHtml(initLyrics)}</textarea>
        </label>
        <label class="cover-uploader-label">
          <div class="label-text">专辑封面(留空就用默认音符图标)</div>
          <div class="cover-uploader">
            <div class="cover-preview${initCoverImage ? '' : ' placeholder'}">
              ${initCoverImage ? `<img src="${escAttr(initCoverImage)}" alt="">` : '♪'}
            </div>
            <div class="cover-controls">
              <button type="button" class="btn secondary upload-cover">上传</button>
              <button type="button" class="btn secondary clear-cover"${initCoverImage ? '' : ' disabled'}>清除</button>
              <input type="file" accept="image/*" class="cover-file" hidden>
            </div>
          </div>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" name="playing"${initPlaying ? ' checked' : ''}>
          <span>"播放中"状态(封面慢转 · 歌词循环切换)</span>
        </label>
        ${sizeSelectHtml(initSpan?.colSpan, initSpan?.rowSpan, '2x2')}
        ${transparencyFieldHtml(initAlpha)}
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
          <button type="submit" class="btn">${existing ? '保存' : '添加'}</button>
        </div>
      </form>
    </div>
  `;
  wireTransparencyReadout(modal);
  // Cover upload wiring — captures base64 into a closure var, written on submit.
  let coverImageData = initCoverImage;
  const coverPreview = modal.querySelector('.cover-preview');
  const coverFile    = modal.querySelector('.cover-file');
  const coverClearBtn = modal.querySelector('.clear-cover');
  function refreshCoverPreview() {
    if (coverImageData) {
      coverPreview.classList.remove('placeholder');
      coverPreview.innerHTML = `<img src="${escAttr(coverImageData)}" alt="">`;
      coverClearBtn.disabled = false;
    } else {
      coverPreview.classList.add('placeholder');
      coverPreview.innerHTML = '♪';
      coverClearBtn.disabled = true;
    }
  }
  modal.querySelector('.upload-cover').addEventListener('click', () => coverFile.click());
  coverFile.addEventListener('change', () => {
    const file = coverFile.files?.[0];
    coverFile.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      // 2MB cap matches avatar uploads; the cover only displays in a ~36px
      // circle so larger files are pure IndexedDB waste.
      openAlert(document.body, { title: '图片太大', message: `${(file.size/1024/1024).toFixed(1)} MB,建议 < 2 MB`, danger: true });
      return;
    }
    const r = new FileReader();
    r.onload = () => { coverImageData = r.result; refreshCoverPreview(); };
    r.readAsDataURL(file);
  });
  coverClearBtn.addEventListener('click', () => { coverImageData = null; refreshCoverPreview(); });

  modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
  modal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(modal.querySelector('form'));
    const song = String(fd.get('song') || '').trim();
    if (!song) return;
    const parseSubject = (s) => {
      if (!s) return undefined;
      const [kind, ...rest] = String(s).split(':');
      const id = rest.join(':');
      if (!kind || !id) return undefined;
      return { kind, id };
    };
    const leftSubject  = parseSubject(fd.get('leftSubject'));
    const rightSubject = parseSubject(fd.get('rightSubject'));
    const artist  = String(fd.get('artist')  || '').trim();
    const lyrics  = String(fd.get('lyrics')  || '');
    const playing = fd.get('playing') === 'on';
    const span = parseSizePreset(fd.get('sizePreset')) || { colSpan: 2, rowSpan: 2 };
    const transparency = Number(fd.get('transparency')) || 100;
    const data = {
      song, artist, lyrics, playing,
      leftSubject, rightSubject,
      coverImage: coverImageData || undefined,
    };
    modal.remove();
    if (existing) {
      await updateWidget(existing.id, { data, ...span, transparency }, router);
    } else {
      await saveNewWidget({ type: 'music', data, ...span, transparency }, router);
    }
  });
}

// Size + transparency modal — used by widget types that have no other
// content fields (image after file picked, polaroid after photos picked,
// favorites). Resolves to { span: { colSpan, rowSpan }, transparency } or null.
function askSizeAndTransparency(container, defaultPreset, existingSpan, existingAlpha) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">大小 / 不透明度</div>
        <form class="size-form">
          ${sizeSelectHtml(existingSpan?.colSpan, existingSpan?.rowSpan, defaultPreset)}
          ${transparencyFieldHtml(existingAlpha)}
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">${existingSpan ? '保存' : '添加'}</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    wireTransparencyReadout(modal);
    const close = () => modal.remove();
    modal.querySelector('.cancel-btn').addEventListener('click', () => { close(); resolve(null); });
    modal.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      const span = parseSizePreset(fd.get('sizePreset')) || { colSpan: 2, rowSpan: 2 };
      const transparency = Number(fd.get('transparency')) || 100;
      close();
      resolve({ span, transparency });
    });
  });
}

// Open the appropriate editor for an existing widget. Routes by widget.type
// to the same editor function used for new-widget creation (each one accepts
// an optional `existing` parameter and pre-fills its fields).
async function openEditWidgetModal(container, router, widget) {
  // favorites widget 没有可编辑 content(数据是来自 favorites store 的活的
  // 引用),所以只给 size + transparency。其他 widget 类型都有专属编辑器:
  //  - image / polaroid: 换图 / 换照片(本批新加)
  //  - note / anniversary / music: 内容编辑
  if (widget.type === 'favorites') {
    const span = widgetSpan(widget);
    const opts = await askSizeAndTransparency(container, null, span, widget.transparency);
    if (!opts) return;
    await updateWidget(widget.id, { ...opts.span, transparency: opts.transparency }, router);
    return;
  }
  // For widgets with content editors, open the existing editor pre-filled.
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  container.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  if (widget.type === 'image')       await renderImageEditor(modal, container, router, widget);
  if (widget.type === 'polaroid')    await renderPolaroidEditor(modal, container, router, widget);
  if (widget.type === 'note')        renderNoteEditor(modal, container, router, widget);
  if (widget.type === 'anniversary') await renderAnniversaryEditor(modal, container, router, widget);
  if (widget.type === 'music')       await renderMusicEditor(modal, container, router, widget);
}

// ── Item resolution (apps + widgets) per page ────────────────────────────
// settings.tileOrder[pageIdx] = [{ id, row, col }, ...] in the unified-grid
// world. We also accept the legacy `[[id, id, ...]]` shape — if a page's
// entries are strings, treat them as a flat list at row 0 cols 0..n.
function resolveTilesForPage(pageIdx, tileOrder) {
  const basePage = PAGES[pageIdx] || [];
  const userOrder = tileOrder?.[pageIdx];
  const byId = new Map(basePage.map(t => [t.id, t]));
  const out = [];
  const used = new Set();
  if (Array.isArray(userOrder)) {
    for (const entry of userOrder) {
      if (!entry) continue;
      // Legacy: entry might be a string id (pre-unifiedGridV1 data).
      const id = typeof entry === 'string' ? entry : entry.id;
      const t = byId.get(id);
      if (!t) continue;
      const row = typeof entry === 'object' && Number.isFinite(entry.row) ? entry.row : Math.floor(out.length / COLS);
      const col = typeof entry === 'object' && Number.isFinite(entry.col) ? entry.col : (out.length % COLS);
      out.push({ ...t, row, col });
      used.add(id);
    }
  }
  // Tiles in PAGES not yet placed (new entries added by an update) — append
  // at next available cell so they're never lost when the data shape changes.
  const remaining = basePage.filter(t => !used.has(t.id));
  if (remaining.length > 0) {
    let nextRow = out.length > 0 ? Math.max(...out.map(x => x.row)) + 1 : 0;
    let nextCol = 0;
    for (const t of remaining) {
      out.push({ ...t, row: nextRow, col: nextCol });
      nextCol++;
      if (nextCol >= COLS) { nextCol = 0; nextRow++; }
    }
  }
  return out;
}

// One-time migration to the unified grid format. Old shape:
//   - homeWidgets: { placement: 'above'|'below', order, size }
//   - settings.tileOrder: [[id, id, ...], ...]
// New shape:
//   - homeWidgets: { row, col }  (placement/order dropped)
//   - settings.tileOrder: [[{ id, row, col }, ...], ...]
// We do this lazily on first home mount so users keep their existing
// layout — above widgets stack above the apps, apps in their saved order,
// below widgets stack below. Page 1+ are app-only (no widgets) so they
// just get straightforward (row, col) assignments.
async function migrateUnifiedGridV1(settings, widgets) {
  if (settings?.unifiedGridV1) return widgets;

  // Sort widgets by their existing order (placement-grouped).
  const byOrder = (a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0);
  const above = widgets.filter(w => (w.placement || 'above') === 'above').sort(byOrder);
  const below = widgets.filter(w => w.placement === 'below').sort(byOrder);

  let row = 0;
  for (const w of above) {
    const { rowSpan } = widgetSpan(w);
    w.row = row;
    w.col = 0;
    delete w.placement;
    delete w.order;
    await db.set('homeWidgets', w);
    row += rowSpan;
  }

  // Resolve page-0 apps in their saved string order then assign coords below
  // the above-widgets.
  const newTileOrder = [];
  for (let p = 0; p < PAGES.length; p++) {
    const legacyEntries = settings?.tileOrder?.[p];
    const ids = Array.isArray(legacyEntries)
      ? legacyEntries.map(e => (typeof e === 'string' ? e : e?.id)).filter(Boolean)
      : PAGES[p].map(t => t.id);
    const startRow = p === 0 ? row : 0;
    const page = [];
    let nextRow = startRow;
    let nextCol = 0;
    const inPages = new Set(PAGES[p].map(t => t.id));
    for (const id of ids) {
      if (!inPages.has(id)) continue;
      page.push({ id, row: nextRow, col: nextCol });
      nextCol++;
      if (nextCol >= COLS) { nextCol = 0; nextRow++; }
    }
    // Tiles in PAGES but not in saved order
    for (const t of PAGES[p]) {
      if (!ids.includes(t.id)) {
        page.push({ id: t.id, row: nextRow, col: nextCol });
        nextCol++;
        if (nextCol >= COLS) { nextCol = 0; nextRow++; }
      }
    }
    newTileOrder.push(page);
    if (p === 0) row = nextRow + (nextCol > 0 ? 1 : 0);
  }

  // Below widgets continue past the page-0 app rows.
  for (const w of below) {
    const { rowSpan } = widgetSpan(w);
    w.row = row;
    w.col = 0;
    delete w.placement;
    delete w.order;
    await db.set('homeWidgets', w);
    row += rowSpan;
  }

  await db.updateSettings(s => {
    s.tileOrder = newTileOrder;
    s.unifiedGridV1 = true;
  });
  // Re-fetch widgets so subsequent code sees the migrated rows.
  return await db.getAll('homeWidgets');
}

// 一次性 migration: 把任何 row > ROWS - rowSpan 的 widget / app 钉回最后一
// 行。背景:之前我们一度试过 6 行布局,用户在那时拖了几个 item 到 row 5。
// 后来回退 5 行,这些 item 的 row 字段仍是 5,grid-template-rows 只有 5 行
// (row 0-4),所以 row=5 触发 grid-auto-rows 加新行,grid 总高被 6+ 行
// 平分 → cells 缩水 → 用户报"图标小、布局错乱"。修法:扫一遍 widgets +
// settings.tileOrder,把溢出行的 item 全部 clamp。一次性,标 rowsClampV1。
async function migrateClampRowsV1(settings, widgets) {
  if (settings?.rowsClampV1) return widgets;
  for (const w of widgets) {
    const span = widgetSpan(w);
    const maxRow = Math.max(0, ROWS - span.rowSpan);
    if (Number(w.row) > maxRow) {
      w.row = maxRow;
      await db.set('homeWidgets', w);
    }
  }
  await db.updateSettings(s => {
    if (Array.isArray(s.tileOrder)) {
      for (const page of s.tileOrder) {
        if (!Array.isArray(page)) continue;
        for (const e of page) {
          if (typeof e === 'object' && Number(e.row) > ROWS - 1) {
            e.row = ROWS - 1;
          }
        }
      }
    }
    s.rowsClampV1 = true;
  });
  return await db.getAll('homeWidgets');
}

// ── Music timer wiring ───────────────────────────────────────────────────
function stopAllMusicTimers() {
  for (const id of _musicTimers.values()) clearInterval(id);
  _musicTimers.clear();
}

function startMusicTimers(container) {
  stopAllMusicTimers();
  container.querySelectorAll('.widget.widget-music.is-playing').forEach(el => {
    const widgetId = el.dataset.widgetId;
    let lyrics = [];
    try { lyrics = JSON.parse(el.dataset.lyrics || '[]'); } catch (_) {}
    if (lyrics.length === 0) return;
    const lyricEl = el.querySelector('.mp-lyric');
    if (!lyricEl) return;
    let idx = 0;
    const tid = setInterval(() => {
      idx = (idx + 1) % lyrics.length;
      lyricEl.classList.add('fade');
      setTimeout(() => {
        lyricEl.textContent = '♪ ' + lyrics[idx];
        lyricEl.classList.remove('fade');
      }, 220);
    }, 4000);
    _musicTimers.set(widgetId, tid);
  });
}

// ── Drag helpers ─────────────────────────────────────────────────────────
// Snapshot the grid's pixel geometry so we can convert pointer → cell and
// cell → pixel coords without re-querying the DOM. These values are stable
// for the duration of a drag (grid doesn't reflow mid-drag), so a single
// `gridGeometry(gridEl)` at dragstart feeds every pointermove tick.
// Previously each pointermove ran getComputedStyle + getBoundingClientRect
// at ~60Hz — the visible "drag stutter" on mobile was largely from that.
function gridGeometry(gridEl) {
  const rect = gridEl.getBoundingClientRect();
  const cs = getComputedStyle(gridEl);
  const gap = parseFloat(cs.rowGap || cs.gap) || 10;
  // `gridTemplateRows` resolved value 是浏览器算出来的实际行高(像素),
  // 比如 "92.5px 92.5px 92.5px 92.5px 92.5px"。第一个 track 的像素值就是
  // row height(所有行 1fr 等分,值一样)。如果 grid 还没 laid out,fallback
  // 到 col width(cells 大约正方形)。
  const rowTracks = cs.gridTemplateRows.split(' ').map(s => parseFloat(s)).filter(Number.isFinite);
  const colTracks = cs.gridTemplateColumns.split(' ').map(s => parseFloat(s)).filter(Number.isFinite);
  const colW = colTracks[0] || ((rect.width - gap * (COLS - 1)) / COLS);
  const rowH = rowTracks[0] || colW || 90;
  return { rect, gap, colW, rowH };
}

// Translate a pointer position into a (row, col) cell. Accepts either a
// grid element (re-snapshots geometry — used outside drag) or a pre-cached
// geometry object (used inside the hot pointermove loop).
function pointerToCell(gridOrGeom, clientX, clientY) {
  const geom = gridOrGeom.rect ? gridOrGeom : gridGeometry(gridOrGeom);
  const { rect, gap, colW, rowH } = geom;
  const x = Math.max(0, clientX - rect.left);
  const y = Math.max(0, clientY - rect.top);
  const col = Math.max(0, Math.min(COLS - 1, Math.floor(x / (colW + gap))));
  const row = Math.max(0, Math.floor(y / (rowH + gap)));
  return { row, col };
}

// Find an existing grid item covering (row, col), excluding `excludeEl`.
// `items` is an array of { el, row, col, colSpan, rowSpan }.
function itemAtCell(items, row, col, excludeEl) {
  return items.find(it => {
    if (it.el === excludeEl) return false;
    return row >= it.row && row < it.row + it.rowSpan
        && col >= it.col && col < it.col + it.colSpan;
  });
}

// ── Mount ────────────────────────────────────────────────────────────────
export async function mountHome(container, params, router) {
  const showPager = PAGES.length > 1;

  let settings = await db.get('settings', 'default');
  // First-mount migration: favorites used to be a permanent builtin pinned
  // above the apps. Seed a user-owned favorites widget so existing users
  // don't suddenly find theirs gone. Idempotent — runs once per profile.
  if (!settings?.favoritesMigratedV1) {
    const allWidgets = await db.getAll('homeWidgets');
    if (!allWidgets.some(w => w.type === 'favorites')) {
      await db.set('homeWidgets', {
        id: db.newId(),
        type: 'favorites',
        placement: 'above',  // gets converted to (row, col) by next migration
        size: 'medium',
        order: 1,
        createdAt: Date.now(),
      });
    }
    await db.updateSettings(s => { s.favoritesMigratedV1 = true; });
    settings = await db.get('settings', 'default');
  }
  // Unified-grid migration: convert placement/order to (row, col).
  let userWidgets = await db.getAll('homeWidgets');
  userWidgets = await migrateUnifiedGridV1(settings, userWidgets);
  settings = await db.get('settings', 'default');  // re-read after migration

  // Clamp stale rows from the brief 6-row experiment (see migrateClampRowsV1).
  userWidgets = await migrateClampRowsV1(settings, userWidgets);
  settings = await db.get('settings', 'default');

  const tileOrder = Array.isArray(settings?.tileOrder) ? settings.tileOrder : [];

  // Dock — first-mount init. Defaults centers 微信/设置 at slots 1/2;the
  // outer slots 0/3 stay empty so user can drag an app in. After init, dock
  // contents are user-controllable like any other surface (B#6 dock 可拖).
  if (!Array.isArray(settings?.dockOrder)) {
    await db.updateSettings(s => { s.dockOrder = [...DOCK_DEFAULT]; });
    settings = await db.get('settings', 'default');
  }
  const dockOrder = (settings.dockOrder || [...DOCK_DEFAULT]).slice(0, DOCK_SLOTS);
  while (dockOrder.length < DOCK_SLOTS) dockOrder.push(null);
  const dockIds = new Set(dockOrder.filter(Boolean));

  // Build dock items list (col index = slot).
  const dockItems = dockOrder.map((id, col) => {
    if (!id) return null;
    const tile = resolveTile(id);
    if (!tile) return null;
    return { kind: 'app', tile, row: 0, col, colSpan: 1, rowSpan: 1 };
  }).filter(Boolean);

  // Build a flat list of items per page: apps + widgets (widgets only on
  // page 0). Each item has { kind, row, col, colSpan, rowSpan, ...data }.
  // Apps currently in the dock are excluded from page rendering so they
  // don't show in two places at once.
  const pageItemsList = [];
  for (let p = 0; p < PAGES.length; p++) {
    const apps = resolveTilesForPage(p, tileOrder).filter(a => !dockIds.has(a.id));
    const appItems = apps.map(a => ({
      kind: 'app', tile: a, row: a.row, col: a.col, colSpan: 1, rowSpan: 1,
    }));
    let widgetItems = [];
    if (p === 0) {
      widgetItems = userWidgets.map(w => {
        const span = widgetSpan(w);
        return {
          kind: 'widget', widget: w,
          row: Number(w.row) || 0,
          col: Number(w.col) || 0,
          ...span,
        };
      });
    }
    pageItemsList.push([...appItems, ...widgetItems]);
  }

  // Render HTML per page — each item carries its inline grid coords.
  // We also render ROWS*COLS empty .grid-slot divs into every page so the
  // user can see the cell outlines in edit mode and know how big a widget
  // would be. CSS shows the outlines only when .editing is on
  // (.grid-slot is transparent otherwise).
  const slotHtmls = Array.from({ length: ROWS * COLS }, (_, i) => {
    const r = Math.floor(i / COLS);
    const c = i % COLS;
    return `<div class="grid-slot" style="grid-column: ${c + 1}; grid-row: ${r + 1};" aria-hidden="true"></div>`;
  }).join('');
  const pagesHtml = await Promise.all(pageItemsList.map(async (items, pageIdx) => {
    const itemHtmls = await Promise.all(items.map(async (it) => {
      if (it.kind === 'app') return tileHtml(it.tile, it.row, it.col);
      const gs = gridStyle(it.row, it.col, it.colSpan, it.rowSpan, it.widget.transparency);
      return await renderWidget(it.widget, gs);
    }));
    return `
      <div class="home-page" data-page-idx="${pageIdx}">
        <div class="app-grid unified-grid" data-grid-page="${pageIdx}">${slotHtmls}${itemHtmls.join('')}</div>
      </div>
    `;
  }));

  // Edit toolbar — only visible in editing mode. 左 + 添加装饰, 右 完成。
  // 之前 add-widget 按钮挂在每个 page 底部占 0.5 行,完成按钮在右上角
  // 跟 row 0 widget 的 × 重叠(B#3)。统一移到顶部一条 toolbar 里解决两
  // 个事 + 把 add-widget 暴露到所有页(B#4)。toolbar 是 flex 0 0 auto,
  // 只在 .editing 时占空间,平时高度 0。
  container.innerHTML = `
    <div class="page home">
      <div class="home-edit-toolbar">
        <button class="widget-add" type="button" title="添加桌面装饰">＋ 添加装饰</button>
        <button class="edit-done" type="button">完成</button>
      </div>
      <div class="home-pages">${pagesHtml.join('')}</div>
      <div class="home-pager${showPager ? '' : ' single'}">
        ${PAGES.map((_, i) => `<button class="dot${i === 0 ? ' active' : ''}" data-page="${i}" aria-label="第 ${i+1} 页"></button>`).join('')}
      </div>
      <div class="home-dock">
        <div class="app-grid dock-grid" data-grid-page="dock">${
          Array.from({ length: DOCK_SLOTS }, (_, c) =>
            `<div class="grid-slot" style="grid-column: ${c + 1}; grid-row: 1;" aria-hidden="true"></div>`
          ).join('')
        }${dockItems.map(it => tileHtml(it.tile, it.row, it.col)).join('')}</div>
      </div>
    </div>
  `;

  // Start lyric cycles for any visible music widgets.
  startMusicTimers(container);

  const pagesEl = container.querySelector('.home-pages');
  const dots    = Array.from(container.querySelectorAll('.home-pager .dot'));
  const homeEl  = container.querySelector('.page.home');

  // Grid 现在用 `repeat(ROWS, minmax(0, 1fr))` 撑满 home-page,行/列大小由
  // CSS Grid 自动算,不再需要 JS 计算 --cell-size 同步。pointerToCell 和
  // 拖拽 snap 直接读 getComputedStyle 的 gridTemplateRows 拿实际像素值。

  // ── Edit-mode state ─────────────────────────────────────────────────
  let editMode = false;
  function setEditMode(on) {
    editMode = !!on;
    homeEl.classList.toggle('editing', editMode);
    if (!editMode) cancelDrag();
  }

  let pressTimer = null;
  let pressStart = null;
  function clearPressTimer() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressStart = null;
  }

  // ── Grid-aware drag state ───────────────────────────────────────────
  // Lift the dragged element with position:fixed and follow the pointer.
  // The placeholder sits in the original grid cell and tracks the
  // pointer to show where the drop will land. `dragging.items` is a
  // snapshot of the page's items (so we don't re-query the DOM each move).
  let dragging = null;
  function cancelDrag() {
    if (!dragging) return;
    const { el, placeholder, pointerId, origStyle } = dragging;
    el.classList.remove('dragging');
    el.style.cssText = origStyle;
    if (placeholder && placeholder.parentNode) {
      placeholder.remove();
    }
    try { el.releasePointerCapture(pointerId); } catch (_) {}
    dragging = null;
  }

  function setActiveDot() {
    const w = pagesEl.clientWidth;
    if (!w) return;
    const idx = Math.round(pagesEl.scrollLeft / w);
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  }
  const onScroll = () => setActiveDot();
  pagesEl.addEventListener('scroll', onScroll, { passive: true });

  // Build an items snapshot for the given grid by joining its DOM children
  // to the page's pageItemsList — the in-memory model already has every
  // item's (row, col, colSpan, rowSpan) from when we rendered, so we don't
  // need to read the DOM back via getComputedStyle / inline-style regex.
  // The DOM is purely a result of the data; treating it as the source of
  // truth (the previous impl) broke any time inline style format shifted.
  function snapshotItems(gridEl) {
    const key = gridEl.dataset.gridPage;
    // 'dock' surface uses the separate dockItems list; numbered pages use
    // pageItemsList[idx]. Either way it's just a Map-like lookup.
    const items = key === 'dock' ? dockItems : (pageItemsList[Number(key)] || []);
    const out = [];
    for (const it of items) {
      const el = it.kind === 'widget'
        ? gridEl.querySelector(`[data-widget-id="${CSS.escape(it.widget.id)}"]`)
        : gridEl.querySelector(`[data-target="${CSS.escape(it.tile.id)}"]`);
      if (!el) continue;
      out.push({ el, row: it.row, col: it.col, colSpan: it.colSpan, rowSpan: it.rowSpan });
    }
    return out;
  }

  const onPointerDown = (e) => {
    // 1. Edit-mode drag start. Pressing on a user-widget or .app-icon
    //    (within a page grid, NOT the dock) starts a drag.
    if (editMode) {
      const widgetEl = e.target.closest('.user-widget');
      // B#6: dock app-icon 也允许起拖(之前 :not(.dock-grid) 排除了)。
      // dock 不接 widget(widgets 在 dock 没意义),所以 widget closest 优先。
      const tileEl = !widgetEl
        ? e.target.closest('.app-grid .app-icon')
        : null;
      const targetEl = widgetEl || tileEl;
      // 排除 ⚙ / × 两个按钮 —— 这俩点击要触发它们自己的 handler(打开编辑 modal /
       // 删除),pointerdown 抢去当 drag 起手了,后续 click 就不来了。之前只排了
       // × 没排 ⚙,所以编辑模式下点 ⚙ 完全无响应(bug #2)。
      if (targetEl
          && !e.target.closest('.widget-del')
          && !e.target.closest('.widget-edit')) {
        e.preventDefault();
        const gridEl = targetEl.closest('.unified-grid');
        if (!gridEl) return;
        const originPage = gridEl.dataset.gridPage === 'dock'
          ? 'dock'
          : Number(gridEl.dataset.gridPage ?? 0);
        // 全 surface 预 snap:numbered pages + dock。跨页拖(B#5)重新启用 —
        // pointermove 会根据 scrollLeft / pointer Y 切 dragging.gridPage 到
        // 对应 snapshot。drop 后 persistMove 写 destPage 的 tileOrder;
        // navigate 前 _restoreScrollToPage = destPage,re-mount 后 scrollTo
        // 回到目标页,user 视觉上 app 「留在 page 2」不再弹回。
        const widgetBeingDragged = !!widgetEl;
        const pageSnapshots = {};
        for (const g of container.querySelectorAll('.app-grid[data-grid-page]')) {
          const key = g.dataset.gridPage === 'dock' ? 'dock' : Number(g.dataset.gridPage);
          // widget 不能进 dock(只装 apps),所以拖 widget 时跳过 dock snapshot
          if (widgetBeingDragged && key === 'dock') continue;
          pageSnapshots[key] = { gridEl: g, items: snapshotItems(g) };
        }
        const items = pageSnapshots[originPage].items;
        const meEntry = items.find(it => it.el === targetEl);
        if (!meEntry) return;
        const rect = targetEl.getBoundingClientRect();
        // Snapshot grid geometry once — these values don't change mid-drag,
        // so re-running getComputedStyle on every pointermove tick is pure
        // overhead. Cached colW/rowH/gap feed snap math at ~60Hz.
        const geom = gridGeometry(gridEl);
        // Placeholder — same dimensions/grid placement as the dragged item.
        const placeholder = document.createElement('div');
        placeholder.className = 'grid-placeholder';
        placeholder.style.cssText = gridStyle(meEntry.row, meEntry.col, meEntry.colSpan, meEntry.rowSpan);
        gridEl.appendChild(placeholder);
        // Lift the element out of the grid flow.
        const origStyle = targetEl.getAttribute('style') || '';
        targetEl.style.position = 'fixed';
        targetEl.style.left   = rect.left + 'px';
        targetEl.style.top    = rect.top  + 'px';
        targetEl.style.width  = rect.width + 'px';
        targetEl.style.height = rect.height + 'px';
        targetEl.style.zIndex = '100';
        targetEl.style.pointerEvents = 'none';
        targetEl.classList.add('dragging');
        dragging = {
          el: targetEl, gridEl, items, me: meEntry, geom,
          pageSnapshots, gridPage: originPage, originPage,
          lastScrollLeft: pagesEl.scrollLeft,
          lastAutoScrollAt: 0,
          pointerId: e.pointerId,
          offsetX: e.clientX - rect.left,
          offsetY: e.clientY - rect.top,
          placeholder,
          targetCell: { row: meEntry.row, col: meEntry.col },
          swapTarget: null,  // set when hovering a same-sized item
          origStyle,
        };
        try { targetEl.setPointerCapture(e.pointerId); } catch (_) {}
      }
      return;
    }
    // 2. 长按进入编辑模式 —— touch / pen / mouse 都支持。位移阈值在下方
    // onPointerMove 里 clearPressTimer:总位移 > 20px 或者水平占主导(swipe
    // 翻页手势)立刻取消,这样用户在 home 上拖动翻页不会误触发 edit。Dock
    // 区域排除,免得点 dock 按钮也长按。Mouse left-button only(button: 0)。
    const isLeftClick = e.pointerType !== 'mouse' || e.button === 0;
    if (isLeftClick
        && !e.target.closest('.home-dock')
        && !e.target.closest('.widget-del')) {
      pressStart = { x: e.clientX, y: e.clientY };
      pressTimer = setTimeout(() => {
        setEditMode(true);
        pressTimer = null;
      }, 600);
    }
    // 3. Mouse left-click on empty area → start page-scroll drag.
    if (e.pointerType !== 'mouse') return;
    if (e.target.closest('button')) return;
    if (e.button !== 0) return;
    drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScroll: pagesEl.scrollLeft,
      moved: false,
    };
    pagesEl.style.scrollBehavior = 'auto';
  };

  let drag = null;
  const onPointerMove = (e) => {
    if (pressTimer && pressStart) {
      const dx = e.clientX - pressStart.x;
      const dy = e.clientY - pressStart.y;
      // B4: drag-cancel threshold for long-press arming. 8px was too tight —
      // a finger naturally drifts that much in the 600ms hold, especially on
      // a phone held in one hand, so users hit edit mode by accident. Two
      // changes: (a) bump radius to 20px so small finger jitter is tolerated,
      // (b) if the motion is dominantly horizontal (page-swipe gesture),
      // cancel the long-press immediately even before 20px — that swipe is
      // never intended as a long-press.
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (dx * dx + dy * dy > 400) clearPressTimer();           // 20² = 400
      else if (absX > 5 && absX > absY * 1.5) clearPressTimer(); // clear scroll
    }
    if (dragging && e.pointerId === dragging.pointerId) {
      e.preventDefault();

      // B#5 + B#6: cross-surface drag (page ↔ page, page ↔ dock).
      // 1) pointer 在 dock 区域 → 切到 dock surface
      // 2) 否则 pointer 在 pages — 用 .home-pages scrollLeft 算当前是哪页
      // 3) Recompute geom if scrollLeft / surface 变了(viewport-relative
      //    bbox 跟 .home-pages scrollLeft 走)
      // 4) pointer 靠近 pages 左右 40px 边缘 → smooth scroll 到邻页(throttled
      //    ≥ 600ms)
      const sl = pagesEl.scrollLeft;
      const w = pagesEl.clientWidth;
      const dockSnap = dragging.pageSnapshots.dock;
      const dockRect = dockSnap?.gridEl.getBoundingClientRect();
      const overDock = dockRect && e.clientY >= dockRect.top && e.clientY <= dockRect.bottom;
      const currentSurface = overDock
        ? 'dock'
        : (w > 0 ? Math.round(sl / w) : dragging.gridPage);
      let needGeomRefresh = false;
      if (currentSurface !== dragging.gridPage && dragging.pageSnapshots[currentSurface]) {
        // Hop to new surface
        const snap = dragging.pageSnapshots[currentSurface];
        dragging.gridEl = snap.gridEl;
        dragging.items  = snap.items;
        dragging.gridPage = currentSurface;
        if (dragging.placeholder && dragging.placeholder.parentNode !== snap.gridEl) {
          snap.gridEl.appendChild(dragging.placeholder);
        }
        needGeomRefresh = true;
      }
      if (sl !== dragging.lastScrollLeft) {
        needGeomRefresh = true;
        dragging.lastScrollLeft = sl;
      }
      if (needGeomRefresh) dragging.geom = gridGeometry(dragging.gridEl);

      // Edge auto-scroll: pointer 在 .home-pages 内且靠近左/右 40px → scroll
      // 邻页。dock 区域不触发(已经离开 .home-pages 垂直范围)。≥ 600ms throttle
      // 防止飞速翻页。
      const pagesRect = pagesEl.getBoundingClientRect();
      const edge = 40;
      const now = Date.now();
      const inPagesV = e.clientY >= pagesRect.top && e.clientY <= pagesRect.bottom;
      if (inPagesV && currentSurface !== 'dock' && now - dragging.lastAutoScrollAt > 600) {
        if (e.clientX < pagesRect.left + edge && currentSurface > 0) {
          pagesEl.scrollTo({ left: (currentSurface - 1) * w, behavior: 'smooth' });
          dragging.lastAutoScrollAt = now;
        } else if (e.clientX > pagesRect.right - edge && currentSurface < PAGES.length - 1) {
          pagesEl.scrollTo({ left: (currentSurface + 1) * w, behavior: 'smooth' });
          dragging.lastAutoScrollAt = now;
        }
      }

      // Compute target cell from pointer position — we snap the dragging
      // item TO that cell (not to the pointer), so user sees the item lock
      // into grid positions instead of freely floating. CSS transition on
      // .dragging gives a 120ms ease so the snap looks smooth rather than
      // teleport-jumpy.
      const geom = dragging.geom;
      const cell = pointerToCell(geom, e.clientX, e.clientY);
      const cs = dragging.me.colSpan;
      const rs = dragging.me.rowSpan;
      const surfaceRows = dragging.gridPage === 'dock' ? 1 : ROWS;
      const targetCol = Math.max(0, Math.min(COLS - cs, cell.col));
      // Clamp targetRow to keep item inside the surface's row count.
      // (pages = 6 rows, dock = 1 row). Otherwise placeholder lands beyond
      // the grid and CSS grid-auto-rows kicks in, compressing every cell
      // → "越往下拖,上面越扁" bug。
      const targetRow = Math.max(0, Math.min(surfaceRows - rs, cell.row));

      // Snap dragging item to the target cell's top-left using cached geom.
      const snappedX = geom.rect.left + targetCol * (geom.colW + geom.gap);
      const snappedY = geom.rect.top  + targetRow * (geom.rowH + geom.gap);
      dragging.el.style.left = snappedX + 'px';
      dragging.el.style.top  = snappedY + 'px';
      // Check what's at the target. If the target area only contains the
      // dragged item itself (or nothing), placement is valid. If it
      // contains exactly one other item of the same size, mark it as a
      // swap candidate. Anything else = invalid drop.
      // 跨 surface 约束:
      //  - widget 只能落在 page 0(数据模型决定 — widgets store 没 page 字段)
      //  - widget 不能进 dock(dock 只装 apps)
      //  - 多 cell widget(colSpan*rowSpan>1)不能进 dock(dock 槽都是 1×1)
      const isWidgetDrag = dragging.el.classList.contains('user-widget');
      const onDock = dragging.gridPage === 'dock';
      const widgetCrossingNonZero = isWidgetDrag && !onDock && dragging.gridPage !== 0;
      const widgetOnDock = isWidgetDrag && onDock;
      const oversizeOnDock = onDock && (cs > 1 || rs > 1);
      const dragSpan = { colSpan: dragging.me.colSpan, rowSpan: dragging.me.rowSpan };
      const occupants = new Set();
      for (let r = targetRow; r < targetRow + dragSpan.rowSpan; r++) {
        for (let c = targetCol; c < targetCol + dragSpan.colSpan; c++) {
          const o = itemAtCell(dragging.items, r, c, dragging.el);
          if (o) occupants.add(o);
        }
      }
      let valid = false;
      let swapTarget = null;
      if (widgetCrossingNonZero || widgetOnDock || oversizeOnDock) {
        valid = false;
      } else if (occupants.size === 0) {
        valid = true;
      } else if (occupants.size === 1) {
        const o = [...occupants][0];
        if (o.colSpan === dragSpan.colSpan && o.rowSpan === dragSpan.rowSpan) {
          // Swap only when sizes match exactly. Otherwise the move would
          // leave the displaced item in a weirdly-shaped slot.
          valid = true;
          swapTarget = o;
        }
      }
      // Reposition placeholder to the target cell.
      dragging.placeholder.style.cssText = gridStyle(targetRow, targetCol, dragSpan.colSpan, dragSpan.rowSpan);
      dragging.placeholder.classList.toggle('invalid', !valid);
      dragging.targetCell = { row: targetRow, col: targetCol };
      dragging.swapTarget = valid ? swapTarget : null;
      dragging.validDrop = valid;
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) > 4) {
      drag.moved = true;
      try { pagesEl.setPointerCapture(drag.pointerId); } catch (_) {}
    }
    if (drag.moved) {
      pagesEl.scrollLeft = drag.startScroll - dx;
    }
  };

  const onPointerEnd = async (e) => {
    clearPressTimer();
    if (dragging && e.pointerId === dragging.pointerId) {
      const { el, me, gridEl, targetCell, swapTarget, validDrop, origStyle, originPage } = dragging;
      // Restore base styles regardless of outcome — successful drop will
      // get its new grid placement written below.
      el.style.cssText = origStyle;
      el.classList.remove('dragging');
      if (dragging.placeholder?.parentNode) dragging.placeholder.remove();
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      const destPage = gridEl.dataset.gridPage === 'dock'
        ? 'dock'
        : Number(gridEl.dataset.gridPage ?? 0);
      const pageChanged = destPage !== originPage;
      const acted = validDrop && (pageChanged || targetCell.row !== me.row || targetCell.col !== me.col);
      dragging = null;
      if (acted) {
        // 跨页时 originPage ≠ destPage,persistMove 会负责从 origin 的
        // tileOrder 摘掉原条目(避免一个 app 同时在两页里出现)。
        // _restoreScrollToPage:re-mount 时 mountHome 末尾会 scrollTo 这一页,
        // 否则 router.navigate 默认让 .home-pages 复位 page 0,user 看到
        // app「弹回」原页(实际数据没问题)。dock 不算 page,跳过。
        if (typeof destPage === 'number') _restoreScrollToPage = destPage;
        await persistMove({
          movedEl: el,
          movedFrom: { row: me.row, col: me.col },
          movedTo:   { row: targetCell.row, col: targetCell.col },
          swapTargetEl: swapTarget?.el || null,
          originPage,
          destPage,
        });
        await router.navigate('home');
      }
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    pagesEl.style.scrollBehavior = '';
    if (drag.moved) {
      const w = pagesEl.clientWidth;
      const target = Math.round(pagesEl.scrollLeft / w) * w;
      pagesEl.scrollTo({ left: target, behavior: 'smooth' });
    }
    try { pagesEl.releasePointerCapture(drag.pointerId); } catch (_) {}
    drag = null;
  };
  pagesEl.addEventListener('pointerdown', onPointerDown);
  pagesEl.addEventListener('pointermove', onPointerMove);
  pagesEl.addEventListener('pointerup', onPointerEnd);
  pagesEl.addEventListener('pointercancel', onPointerEnd);

  // Right-click home area (except dock/dot) → enter edit mode.
  const onContextMenu = (e) => {
    if (e.target.closest('.home-dock')) return;
    if (e.target.closest('.dot')) return;
    e.preventDefault();
    setEditMode(true);
  };
  homeEl.addEventListener('contextmenu', onContextMenu);

  const onClick = async (e) => {
    if (e.target.closest('.edit-done')) {
      setEditMode(false);
      return;
    }
    const delBtn = e.target.closest('.widget-del');
    if (delBtn) {
      e.stopPropagation();
      const w = delBtn.closest('[data-widget-id]');
      if (!w) return;
      if (!editMode && !await openConfirm(container, {
        title: '删除装饰',
        message: '删除这个装饰?',
        confirmLabel: '删除',
        danger: true,
      })) return;
      preserveEditModeOnMount = editMode;
      await db.del('homeWidgets', w.dataset.widgetId);
      await router.navigate('home');
      return;
    }
    if (e.target.closest('.widget-add')) {
      preserveEditModeOnMount = true;
      await openAddWidgetModal(container, router);
      return;
    }
    // ⚙ 编辑按钮 —— 无论 edit mode 与否都响应。之前放在 editMode 块内,导致:
    // (a) 非 edit mode 时 hover 显示 ⚙ 点击没人接,
    // (b) favorites widget 上 ⚙ 点击被后面 data-target 分支拦截跳到收藏页。
    const editBtn = e.target.closest('.widget-edit');
    if (editBtn) {
      e.stopPropagation();
      const wrap = editBtn.closest('[data-widget-id]');
      const w = wrap ? await db.get('homeWidgets', wrap.dataset.widgetId) : null;
      if (w) {
        preserveEditModeOnMount = editMode;
        await openEditWidgetModal(container, router, w);
      }
      return;
    }
    const polaroid = e.target.closest('.polaroid-photo');
    if (polaroid && !editMode) {
      e.stopPropagation();
      const wrap = polaroid.closest('[data-widget-id]');
      if (!wrap) return;
      const clickedIdx = Number(polaroid.dataset.polaroidIdx);
      const w = await db.get('homeWidgets', wrap.dataset.widgetId);
      if (!w || w.type !== 'polaroid') return;
      const photoCount = Array.isArray(w.data?.photos) ? w.data.photos.length : 0;
      let order = Array.isArray(w.data?.stackOrder)
        ? w.data.stackOrder.filter(i => Number.isInteger(i) && i >= 0 && i < photoCount)
        : Array.from({ length: photoCount }, (_, i) => i);
      order = order.filter(i => i !== clickedIdx);
      order.push(clickedIdx);
      w.data = { ...w.data, stackOrder: order };
      await db.set('homeWidgets', w);
      await router.navigate('home');
      return;
    }
    if (editMode) {
      // Modal clicks don't touch edit-mode state.
      if (e.target.closest('.modal-backdrop')) return;
      // 完成按钮:退出 edit mode(由前面 .edit-done 分支处理)。.widget-edit
      // / .widget-del / .widget-add 也都在 editMode 块之前处理。其他所有
      // click(app-icon / widget body / 空白 / dot)在 edit mode 一律
      // swallow,user 必须点「完成」才出去 —— 跟 iOS 桌面 edit mode 一致。
      return;
    }
    const dot = e.target.closest('.dot');
    if (dot) {
      const idx = parseInt(dot.dataset.page, 10) || 0;
      pagesEl.scrollTo({ left: idx * pagesEl.clientWidth, behavior: 'smooth' });
      return;
    }
    const btn = e.target.closest('[data-target]');
    if (!btn) return;
    if (drag) return;
    try {
      await router.navigate(btn.dataset.target);
    } catch (err) {
      if (String(err).includes('unknown page')) {
        await openAlert(container, { title: '还没做完', message: `「${btn.dataset.label}」这一项还在路线图上。` });
      } else {
        throw err;
      }
    }
  };
  container.addEventListener('click', onClick);

  if (preserveEditModeOnMount) {
    preserveEditModeOnMount = false;
    setEditMode(true);
  }

  // Cross-page drag scroll restore (B#5 reinstated). 上一次 drop 跨到了
  // page N → onPointerEnd 在 navigate 前 _restoreScrollToPage = N → 这里
  // mount 后 scroll 回去。`behavior: 'auto'` 直接跳不要动画(scroll-snap
  // 会让 smooth 动画看起来怪),requestAnimationFrame 等 .home-pages 真的
  // 拿到 clientWidth(home-page 第一次 layout 还没完成时 clientWidth 是 0)。
  if (_restoreScrollToPage !== null) {
    const target = _restoreScrollToPage;
    _restoreScrollToPage = null;
    requestAnimationFrame(() => {
      const w = pagesEl.clientWidth;
      if (w > 0) pagesEl.scrollTo({ left: target * w, behavior: 'auto' });
    });
  }

  return () => {
    // 离开 home 时把 preserveEditModeOnMount 清零 —— 这个 flag 是给「add /
    // edit / delete widget 后再次 mount」用的(让 user 留在 edit mode 继续
    // 改),但如果 user 取消 add modal 离开 home 进了别的 app,这个 flag
    // 还残留着 true,下次回到 home 就会莫名其妙自动进入 edit mode。
    preserveEditModeOnMount = false;
    stopAllMusicTimers();
    clearPressTimer();
    cancelDrag();
    pagesEl.removeEventListener('scroll', onScroll);
    pagesEl.removeEventListener('pointerdown', onPointerDown);
    pagesEl.removeEventListener('pointermove', onPointerMove);
    pagesEl.removeEventListener('pointerup', onPointerEnd);
    pagesEl.removeEventListener('pointercancel', onPointerEnd);
    homeEl.removeEventListener('contextmenu', onContextMenu);
    container.removeEventListener('click', onClick);
  };
}

// Persist a grid move. Resolves whether the moved element is an app
// (settings.tileOrder[pageIdx]) or a widget (homeWidgets row) and applies
// the position change, including any same-size swap.
async function persistMove({ movedEl, movedFrom, movedTo, swapTargetEl, originPage, destPage }) {
  const isWidget = movedEl.classList.contains('user-widget');
  const isApp    = !isWidget && movedEl.classList.contains('app-icon');
  const swapIsWidget = swapTargetEl?.classList.contains('user-widget');
  const swapIsApp    = swapTargetEl?.classList.contains('app-icon');

  // Helper: update an app's position in settings.tileOrder[pageIdx]. Caller
  // controls which page — for cross-page moves we'll first remove from origin
  // then setAppPos on destination.
  async function setAppPos(appId, pageIdx, row, col) {
    await db.updateSettings(s => {
      if (!Array.isArray(s.tileOrder)) s.tileOrder = [];
      if (!Array.isArray(s.tileOrder[pageIdx])) s.tileOrder[pageIdx] = [];
      const arr = s.tileOrder[pageIdx];
      const existing = arr.find(e => e && (typeof e === 'string' ? e === appId : e.id === appId));
      if (existing && typeof existing === 'object') {
        existing.row = row;
        existing.col = col;
      } else {
        // Legacy string entry — replace with object form.
        const idx = arr.findIndex(e => (typeof e === 'string' ? e === appId : e?.id === appId));
        if (idx >= 0) arr[idx] = { id: appId, row, col };
        else arr.push({ id: appId, row, col });
      }
    });
  }

  // Helper: drop an app from a page's tileOrder. Used when an app crosses
  // pages — without this the app would appear in BOTH origin and destination
  // tileOrder lists (resolveTilesForPage would render duplicates).
  async function removeAppFromPage(appId, pageIdx) {
    await db.updateSettings(s => {
      const arr = s.tileOrder?.[pageIdx];
      if (!Array.isArray(arr)) return;
      const i = arr.findIndex(e => (typeof e === 'string' ? e === appId : e?.id === appId));
      if (i >= 0) arr.splice(i, 1);
    });
  }

  // Helpers for dock: it's a 4-slot row in settings.dockOrder. col → slot.
  async function setDockSlot(appId, col) {
    await db.updateSettings(s => {
      if (!Array.isArray(s.dockOrder)) s.dockOrder = [null, null, null, null];
      // Remove appId from any other slot first (defensive — same app twice in dock would dup).
      for (let i = 0; i < s.dockOrder.length; i++) {
        if (s.dockOrder[i] === appId) s.dockOrder[i] = null;
      }
      s.dockOrder[col] = appId;
    });
  }
  async function removeAppFromDock(appId) {
    await db.updateSettings(s => {
      if (!Array.isArray(s.dockOrder)) return;
      for (let i = 0; i < s.dockOrder.length; i++) {
        if (s.dockOrder[i] === appId) s.dockOrder[i] = null;
      }
    });
  }

  // Helper: update a widget's position in homeWidgets.
  async function setWidgetPos(widgetId, row, col) {
    const w = await db.get('homeWidgets', widgetId);
    if (!w) return;
    w.row = row;
    w.col = col;
    await db.set('homeWidgets', w);
  }

  const isCrossSurface = originPage !== destPage;

  // 1. Move the dragged item to its new (row, col). For cross-surface apps,
  //    drop from origin first. Widgets are page-0 only by design (no page
  //    field on widget row) and excluded from dock (1×1 only), so they only
  //    move within page 0.
  const movedId = isWidget ? movedEl.dataset.widgetId : movedEl.dataset.target;
  if (isWidget) {
    await setWidgetPos(movedId, movedTo.row, movedTo.col);
  } else if (isApp) {
    if (isCrossSurface) {
      if (originPage === 'dock')      await removeAppFromDock(movedId);
      else if (typeof originPage === 'number') await removeAppFromPage(movedId, originPage);
    }
    if (destPage === 'dock')          await setDockSlot(movedId, movedTo.col);
    else if (typeof destPage === 'number') await setAppPos(movedId, destPage, movedTo.row, movedTo.col);
  }

  // 2. If swapping with another item, move it to the dragged item's old slot
  //    on the origin surface (same-size constraint in onPointerMove means
  //    swap target lives on the same grid). swap can happen within page or
  //    within dock — never cross-surface.
  if (swapTargetEl) {
    const swapId = swapIsWidget ? swapTargetEl.dataset.widgetId : swapTargetEl.dataset.target;
    if (swapIsWidget) {
      await setWidgetPos(swapId, movedFrom.row, movedFrom.col);
    } else if (swapIsApp) {
      if (destPage === 'dock')        await setDockSlot(swapId, movedFrom.col);
      else if (typeof destPage === 'number') await setAppPos(swapId, destPage, movedFrom.row, movedFrom.col);
    }
  }
}
