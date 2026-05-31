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
import { openIconPicker } from '../settings/app-icons.js';
import { renderWidget, escHtml, escAttr } from './home-widgets.js';
import { COLS, ROWS, widgetSpan } from './home-shared.js';
import { openAddWidgetModal, openEditWidgetModal } from './home-editors.js';

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
  // 月相 — 阴晴圆缺意象,跟"周期"主题贴近;比起"月经"通用 emoji,更含蓄
  cycle:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18 6 6 0 1 1 0-12 3 3 0 0 0 0-6z" fill="currentColor" stroke="none"/></svg>`,
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
    { id: 'keepsake',       label: '千纸鹤', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12 L21 5 L12 14 L8 12 L21 5"/><path d="M12 14 L13 21 L10 17"/></svg>` },
    { id: 'cycle',          label: '周期',   icon: SVG.cycle },
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

// 给 settings → app 图标 列表页用的扁平 registry(去重)。包含所有 app:
// 各 page 的 default app + DOCK_CATALOG。同一 id 重复只取第一个。
export const APP_REGISTRY = (() => {
  const seen = new Set();
  const list = [];
  for (const page of PAGES) for (const t of page) {
    if (!seen.has(t.id)) { seen.add(t.id); list.push(t); }
  }
  for (const t of DOCK_CATALOG) {
    if (!seen.has(t.id)) { seen.add(t.id); list.push(t); }
  }
  return list;
})();

const DOCK_SLOTS = 4;

function gridStyle(row, col, colSpan, rowSpan, transparency, custom) {
  // transparency is 0..100 (default 100 = opaque). Mapped to CSS var
  // --widget-alpha (0..1). Polaroid is exempt from opacity in CSS.
  // Phase B: custom = { bgColor, radius, tilt } 也通过 CSS var 注入。CSS
  // 默认值(color-mix / var(--radius-lg) / 0deg)在 var() fallback 里,
  // user 没 set 就走主题默认。
  const alpha = Number.isFinite(transparency)
    ? Math.max(0, Math.min(100, transparency)) / 100
    : 1;
  let css = `grid-column: ${col + 1} / span ${colSpan}; grid-row: ${row + 1} / span ${rowSpan}; --widget-alpha: ${alpha};`;
  if (custom?.bgColor)             css += ` --widget-bg: ${custom.bgColor};`;
  if (Number.isFinite(custom?.radius)) css += ` --widget-radius: ${custom.radius}px;`;
  if (Number.isFinite(custom?.tilt) && custom.tilt !== 0) {
    // tilt 用 CSS var,这样 :active 时 transform: rotate() scale() 可以叠加
    // (没 var 单独写 inline transform 会跟 active scale 互相覆盖)。
    css += ` --widget-tilt: ${custom.tilt}deg;`;
  }
  return css;
}

function tileHtml(t, row, col, iconOverride) {
  // Pass null row/col for items in a non-positioned grid (rare now that even
  // the dock uses positioned cells). When provided, place via inline grid
  // coords as 1×1.
  //
  // D1: iconOverride 是 settings.appIconOverrides[appId],4 种 kind:
  //   - emoji:  { kind: 'emoji', value: '🐱' }
  //   - text:   { kind: 'text',  value: '角色' }(≤4 字)
  //   - image:  { kind: 'image', value: 'data:image/...' }(本地上传 base64)
  //   - url:    { kind: 'url',   value: 'https://...' }(图床外链)
  // image / url 渲染都用 <img>,只是 value 来源不同。找不到时 fallback 默认 SVG。
  let iconHtml = t.icon;
  if (iconOverride?.kind === 'emoji') {
    iconHtml = `<span class="icon-emoji">${escHtml(iconOverride.value || '')}</span>`;
  } else if (iconOverride?.kind === 'text') {
    iconHtml = `<span class="icon-text">${escHtml(iconOverride.value || '')}</span>`;
  } else if ((iconOverride?.kind === 'image' || iconOverride?.kind === 'url') && iconOverride.value) {
    iconHtml = `<img class="icon-img" src="${escAttr(iconOverride.value)}" alt="">`;
  }
  const style = (Number.isFinite(row) && Number.isFinite(col))
    ? ` style="${gridStyle(row, col, 1, 1)}"`
    : '';
  // D1: icon-edit 用 <span role="button"> 因为 HTML 禁止 button 嵌 button
  // (浏览器会把内层 button 提到外面)。click 走 e.target.closest('.icon-edit')
  // 不需要 native button 也能 work。
  return `
    <button class="app-icon" data-target="${t.id}" data-label="${t.label}"${style}>
      <div class="icon">${iconHtml}</div>
      <div class="label">${t.label}</div>
      <span class="icon-edit" role="button" tabindex="0" title="改图标" aria-label="改图标"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg></span>
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

// ── Item resolution (apps + widgets) per page ────────────────────────────
// settings.tileOrder[pageIdx] = [{ id, row, col }, ...] in the unified-grid
// world. We also accept the legacy `[[id, id, ...]]` shape — if a page's
// entries are strings, treat them as a flat list at row 0 cols 0..n.
function resolveTilesForPage(pageIdx, tileOrder) {
  const basePage = PAGES[pageIdx] || [];
  const userOrder = tileOrder?.[pageIdx];
  // B3: byId 必须涵盖所有已知 app(跨页拖动后 destPage 的 tileOrder 可能含
  // 来自其他 default page 的 app)。之前 byId 只装 basePage,跨页拖过来的
  // app 被静默 skip,user 看到 app "消失"。也包含 DOCK_CATALOG 让 dock 的
  // app 能被拖回 page。
  const byId = new Map();
  for (const page of PAGES) for (const t of page) byId.set(t.id, t);
  for (const t of DOCK_CATALOG) byId.set(t.id, t);
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
  // basePage 中没出现在自己 tileOrder 的 app 补回(新加到 PAGES const 的 app
  // 第一次 mount 自动出现)。但要排除已经被搬到其他 page / dock 的 app —
  // 否则跨页搬走的 app 在原 page 被自动补回,变成 duplicate。
  const usedAcrossAll = new Set();
  if (Array.isArray(tileOrder)) {
    for (const arr of tileOrder) {
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        if (!e) continue;
        const id = typeof e === 'string' ? e : e?.id;
        if (id) usedAcrossAll.add(id);
      }
    }
  }
  const remaining = basePage.filter(t => !used.has(t.id) && !usedAcrossAll.has(t.id));
  if (remaining.length > 0) {
    // page 0 默认从 row 5 起(跟 migration 同步,见 migrateUnifiedGridV1 注释)。
    // 这样 PAGES 后续加新 app,首次 mount 也排在底部一行而非顶部。
    let nextRow = out.length > 0
      ? Math.max(...out.map(x => x.row)) + 1
      : (pageIdx === 0 ? 5 : 0);
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
  //
  // 默认布局:page 0 的 4 个 builder app(角色 / 世界书 / 人设 / 记忆)放底部
  // 行(row 5,0-indexed,最后一行),上方 rows 0-4 留给 user 加 widget。
  // 之前是紧贴 above-widget 之下(row=1 if favorites),那样底部留空看着浪费。
  // page 1+ 仍从 row 0 开始(8 个 app 顺序占两行)。
  const newTileOrder = [];
  for (let p = 0; p < PAGES.length; p++) {
    const legacyEntries = settings?.tileOrder?.[p];
    const ids = Array.isArray(legacyEntries)
      ? legacyEntries.map(e => (typeof e === 'string' ? e : e?.id)).filter(Boolean)
      : PAGES[p].map(t => t.id);
    const startRow = p === 0 ? Math.max(5, row) : 0;
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

  // 越界防御 — 每次 mount idempotent re-clamp。原 migrateClampRowsV1 跑过
  // 一次 flag 就停,中间任何漏 clamp 的写入(比如 updateWidget 改大 rowSpan
  // 但 row 没动 → grid 越界)都会让 grid 长出第 6 行 1fr 等分,挤扁所有
  // cell。这里 O(N) 扫一遍,只有真越界才写 IDB。
  {
    let anyChanged = false;
    for (const w of userWidgets) {
      const span = widgetSpan(w);
      const maxRow = Math.max(0, ROWS - span.rowSpan);
      const maxCol = Math.max(0, COLS - span.colSpan);
      const curRow = Number(w.row) || 0;
      const curCol = Number(w.col) || 0;
      if (curRow > maxRow || curCol > maxCol || curRow < 0 || curCol < 0) {
        w.row = Math.max(0, Math.min(curRow, maxRow));
        w.col = Math.max(0, Math.min(curCol, maxCol));
        await db.set('homeWidgets', w);
        anyChanged = true;
      }
    }
    if (anyChanged) userWidgets = await db.getAll('homeWidgets');
  }

  // B3: 动态页数 — tileOrder 可以比 PAGES.length 长(用户加了新页)。空页
  // 保留(user 主动新建,prune 太激进会让"+ 新页"看着没反应 —— 刚 push 的
  // 空页立刻被砍掉)。删页 UI 以后再加。
  let effectivePageCount = Math.max(PAGES.length, Array.isArray(settings?.tileOrder) ? settings.tileOrder.length : 0);
  // 空页自动回收:**非 editing 模式 mount 时**才 prune 尾部空页(超过
  // PAGES.length 的部分)。editing 模式不动 — user 可能刚 push 一页正在
  // 拖东西,prune 会让"+ 新页"看着没反应。预测当前 mount 会不会进 editing
  // 用 preserveEditModeOnMount(read but not clear,mount 末尾的 read-and-
  // clear 还要照常 consume 这个 flag)。
  const willEnterEdit = preserveEditModeOnMount === true;
  if (!willEnterEdit && effectivePageCount > PAGES.length) {
    let pruned = effectivePageCount;
    while (pruned > PAGES.length) {
      const last = settings?.tileOrder?.[pruned - 1];
      const isEmpty = Array.isArray(last) && last.length === 0;
      if (!isEmpty) break;
      pruned--;
    }
    if (pruned !== effectivePageCount) {
      await db.updateSettings(s => {
        if (Array.isArray(s.tileOrder)) s.tileOrder.length = pruned;
      });
      settings = await db.get('settings', 'default');
      effectivePageCount = pruned;
    }
  }
  const showPager = effectivePageCount > 1;

  const tileOrder = Array.isArray(settings?.tileOrder) ? settings.tileOrder : [];

  // Dock — first-mount init. Defaults centers 微信/设置 at slots 1/2;the
  // outer slots 0/3 stay empty so user can drag an app in. After init, dock
  // contents are user-controllable like any other surface (B#6 dock 可拖).
  if (!Array.isArray(settings?.dockOrder)) {
    await db.updateSettings(s => { s.dockOrder = [...DOCK_DEFAULT]; });
    settings = await db.get('settings', 'default');
  }
  // D1: app 图标 override 表(emoji 或上传图片代替默认 SVG)。tileHtml 接受
  // 这个 override,dock 和 page 渲染都查同一个 map。
  const iconOverrides = (settings && typeof settings.appIconOverrides === 'object' && settings.appIconOverrides) || {};

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
  for (let p = 0; p < effectivePageCount; p++) {
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
      if (it.kind === 'app') return tileHtml(it.tile, it.row, it.col, iconOverrides[it.tile.id]);
      const gs = gridStyle(it.row, it.col, it.colSpan, it.rowSpan, it.widget.transparency, {
        bgColor: it.widget.bgColor,
        radius: it.widget.radius,
        tilt: it.widget.tilt,
      });
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
        <button class="page-add" type="button" title="新建一页">＋ 新页</button>
        <button class="edit-done" type="button">完成</button>
      </div>
      <div class="home-pages">${pagesHtml.join('')}</div>
      <div class="home-pager${showPager ? '' : ' single'}">
        ${Array.from({ length: effectivePageCount }, (_, i) => `<button class="dot${i === 0 ? ' active' : ''}" data-page="${i}" aria-label="第 ${i+1} 页"></button>`).join('')}
      </div>
      <div class="home-dock">
        <div class="app-grid dock-grid" data-grid-page="dock">${
          Array.from({ length: DOCK_SLOTS }, (_, c) =>
            `<div class="grid-slot" style="grid-column: ${c + 1}; grid-row: 1;" aria-hidden="true"></div>`
          ).join('')
        }${dockItems.map(it => tileHtml(it.tile, it.row, it.col, iconOverrides[it.tile.id])).join('')}</div>
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
          && !e.target.closest('.widget-edit')
          && !e.target.closest('.icon-edit')) {
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
        } else if (e.clientX > pagesRect.right - edge && currentSurface < effectivePageCount - 1) {
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
        // Swap 只在「同一 surface 内」允许。跨页 / 跨 dock 落在已占格不能换位 ——
        // persistMove 的 swap 分支会用 origin 页的 (row,col) 把被挤走的图标写到
        // 目标页,落到目标页一个可能已占用的格子 → 重叠 / 丢位。所以跨 surface
        // 撞到占用格 = invalid(红框,drop 弹回),只接受空格的纯移动。
        const sameSurface = dragging.gridPage === dragging.originPage;
        if (sameSurface && o.colSpan === dragSpan.colSpan && o.rowSpan === dragSpan.rowSpan) {
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
    // B3: + 新页 按钮 — 在 settings.tileOrder 末尾 push 空数组,re-render 多
    // 一页。bug 修:
    //   - 之前 mountHome 会 prune 尾部空页,刚 push 的空页立刻被砍 → user
    //     看着"没反应"。取消 prune 后空页留住,等 user 拖东西进去。
    //   - _restoreScrollToPage 之前设在 router.navigate 之后,re-mount 已
    //     经读完 null。提到 navigate 之前。
    //   - 新页的 index 是当前 effectivePageCount(因为 push 之前末尾是
    //     effectivePageCount-1)。
    if (e.target.closest('.page-add')) {
      preserveEditModeOnMount = true;
      const newPageIdx = effectivePageCount;
      _restoreScrollToPage = newPageIdx;
      await db.updateSettings(s => {
        if (!Array.isArray(s.tileOrder)) s.tileOrder = [];
        // 扩展到 newPageIdx + 1 长度,中间稀疏位补 [](避免 sparse hole)
        while (s.tileOrder.length <= newPageIdx) s.tileOrder.push([]);
      });
      await router.navigate('home');
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
    // D1: app icon ⚙ — 打开 icon picker。跟 widget-edit 同思路:任何模式
    // 都响应,但 CSS 只在 editing 显示(@media hover 设备 hover 也显示)。
    // 嵌套 button 那个 issue 用 <span role="button"> 解决了,所以 click 能
    // 正常冒泡到这。
    const iconEditEl = e.target.closest('.icon-edit');
    if (iconEditEl) {
      e.stopPropagation();
      e.preventDefault();
      const tileEl = iconEditEl.closest('.app-icon');
      const appId = tileEl?.dataset.target;
      if (appId) {
        preserveEditModeOnMount = editMode;
        await openIconPicker(container, appId, async () => {
          await router.navigate('home');
        });
      }
      return;
    }
    // 最近聊天 widget — 点单行进对应 chat。必须早于下面通用 [data-target]
    // 处理(widget 父级 data-target 是 messaging,会跳错地方)。editing 模
    // 式不响应 — 编辑模式所有 widget 内部点击 swallow。
    const rcRow = e.target.closest('.rc-row[data-session-id]');
    if (rcRow && !editMode) {
      e.stopPropagation();
      const sid = rcRow.dataset.sessionId;
      if (sid) await router.navigate('chat', { sessionId: sid });
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
    // preserveEditModeOnMount 不在这里清 —— 之前清了导致 navigate('home')
    // 链(handler set true → router.navigate → teardown 同步清 → mountHome
    // 读到 false → 没进 edit)永远丢 flag,user 报「+ 新页」/「加 widget」
    // 后退出了 edit mode。改成 mountHome 头部 read-and-clear,见检查块。
    // 副作用:user cancel modal 后离开 home 进别 app,flag 残留;下次回
    // home 会自动进 edit mode。这其实是 "上次在 edit 回来还在 edit",可
    // 接受。
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

