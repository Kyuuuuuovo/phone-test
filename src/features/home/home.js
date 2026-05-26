// Home: iOS-style multi-page main area + bottom dock.
// Pages scroll horizontally with snap; dock is fixed below.
// Single page hides the pager dots. Mouse drag-to-scroll supplied via Pointer Events.
//
// Edit mode (long-press on touch / right-click on desktop, see mountHome
// below): widgets jiggle, delete × and `+ 添加装饰` show, page horizontal
// scroll is disabled, and widgets can be dragged to reorder. Add/delete
// triggers a router.navigate('home') re-mount; preserveEditModeOnMount
// (module-level) keeps the user in edit mode across that remount so they
// can continue editing without re-entering.

import * as db from '../../core/db.js';
import { openConfirm } from '../../core/modal.js';

let preserveEditModeOnMount = false;

const SVG = {
  chat:      `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`,
  character: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
  book:      `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 16H8v-2h8v2zm0-4H8v-2h8v2zm0-4H8V8h8v2z"/></svg>`,
  persona:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5c1-2.4 3.2-3.5 5.5-3.5s4.5 1.1 5.5 3.5"/></svg>`,
  gear:      `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>`,
  diary:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5z"/><path d="M5 4v18"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>`,
  schedule:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/><circle cx="8.5" cy="14" r="0.8" fill="currentColor"/><circle cx="12" cy="14" r="0.8" fill="currentColor"/><circle cx="15.5" cy="14" r="0.8" fill="currentColor"/></svg>`,
  camera:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2z"/><circle cx="10" cy="12" r="2"/></svg>`,
  shop:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h16l-1.5 11a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/></svg>`,
  twitter:   `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3l7.5 10.2L3.5 21h2l6.2-6.9L17 21h4l-7.9-10.7L20.5 3h-2L13 8.9 8 3z"/></svg>`,
  forum:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4v-4H4a0 0 0 0 1 0 0V6a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 12h4"/></svg>`,
  bottle:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3h4v3.5a3 3 0 0 0 1 2.2l1.6 1.5a4 4 0 0 1 1.4 3v7.3a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 20.5v-7.3a4 4 0 0 1 1.4-3L9 8.7A3 3 0 0 0 10 6.5z"/><path d="M10 3h4"/><path d="M9 14c1.5-1 4.5-1 6 0"/></svg>`,
};

// Pages — page 1 keeps the main player tools tight + leaves vertical room
// for user-added decoration widgets above (homeWidgets store, see widget-row).
// Page 2 collects Phase 3+ placeholder apps. ids without a registered route
// fall through home.js's catch and show the "还没做完" alert.
const PAGES = [
  [
    { id: 'character-list', label: '角色',   icon: SVG.character },
    { id: 'worldbook-list', label: '世界书', icon: SVG.book },
    { id: 'persona-list',   label: '人设',   icon: SVG.persona },
    { id: 'schedule',       label: '行程',   icon: SVG.schedule },
  ],
  [
    { id: 'diary',          label: '日记',   icon: SVG.diary },
    { id: 'twitter',        label: '推特',   icon: SVG.twitter },
    { id: 'forum',          label: '论坛',   icon: SVG.forum },
    { id: 'shop',           label: '商城',   icon: SVG.shop },
    { id: 'monitor',        label: '监控',   icon: SVG.camera },
    { id: 'bottle',         label: '漂流瓶', icon: SVG.bottle },
  ],
];

// Dock — frequently-used, always visible.
const DOCK = [
  { id: 'messaging', label: '微信', icon: SVG.chat },
  { id: 'settings',  label: '设置', icon: SVG.gear },
];

// Built-in widgets shown above the app grid. User-added widgets from
// homeWidgets store are appended after these.
const BUILTIN_WIDGETS = [
  { type: 'favorites' },
];

async function renderFavoritesWidget() {
  const favs = await db.getAll('favorites');
  if (favs.length === 0) {
    return `
      <div class="widget widget-empty" data-target="favorites-list">
        <div class="widget-title">收藏</div>
        <div class="widget-empty-msg">还没有收藏 — 长按消息添加</div>
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
    <div class="widget widget-favorites" data-target="favorites-list">
      <div class="widget-head">
        <span class="widget-title">收藏</span>
        <span class="widget-count">${favs.length}</span>
      </div>
      <div class="widget-quote">${escHtml(text)}</div>
      <div class="widget-from">— ${escHtml(character?.name || '(未知)')}</div>
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

async function renderWidget(w) {
  if (w.type === 'favorites') return await renderFavoritesWidget();
  if (w.type === 'image')     return renderImageWidget(w);
  if (w.type === 'note')      return renderNoteWidget(w);
  return '';
}

function renderImageWidget(w) {
  const size = w.size || 'medium';
  return `
    <div class="widget widget-image user-widget size-${size}" data-widget-id="${escHtml(w.id)}">
      <img src="${escHtml(w.data || '')}" alt="">
      <button class="widget-del" title="删除">×</button>
    </div>
  `;
}
function renderNoteWidget(w) {
  const size = w.size || 'medium';
  return `
    <div class="widget widget-note user-widget size-${size}" data-widget-id="${escHtml(w.id)}">
      <div class="widget-note-text">${escHtml(w.data || '')}</div>
      <button class="widget-del" title="删除">×</button>
    </div>
  `;
}

function escHtml(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}

function tileHtml(t) {
  return `
    <button class="app-icon" data-target="${t.id}" data-label="${t.label}">
      <div class="icon">${t.icon}</div>
      <div class="label">${t.label}</div>
    </button>
  `;
}

function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Two-step add-widget modal: pick type → fill content. Saves to homeWidgets
// store and re-navigates to home to refresh.
async function openAddWidgetModal(container, router) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">添加桌面装饰</div>
      <div class="widget-type-picker">
        <button type="button" class="widget-type-btn" data-type="image">
          <div class="type-icon">🖼</div>
          <div>图片</div>
          <div class="type-hint">上传一张图片贴到桌面</div>
        </button>
        <button type="button" class="widget-type-btn" data-type="note">
          <div class="type-icon">📝</div>
          <div>便签</div>
          <div class="type-hint">写几个字贴到桌面</div>
        </button>
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
      if (type === 'image') {
        modal.remove();
        await pickImageAndSave(container, router);
      } else if (type === 'note') {
        renderNoteEditor(modal, container, router);
      }
    });
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
    alert(`图片太大(${(file.size/1024/1024).toFixed(1)} MB),建议 < 4 MB`);
    return;
  }
  const data = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  // After loading image, ask user for size + placement
  const opts = await askSizeAndPlacement(container);
  if (!opts) return;
  await db.set('homeWidgets', {
    id: db.newId(),
    type: 'image',
    data,
    size: opts.size,
    placement: opts.placement,
    createdAt: Date.now(),
  });
  await router.navigate('home');
}

function renderNoteEditor(modal, container, router) {
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">便签</div>
      <form class="note-form">
        <label>
          <div class="label-text">内容</div>
          <textarea name="text" rows="4" required placeholder="写点什么..."></textarea>
        </label>
        <label>
          <div class="label-text">大小</div>
          <select name="size">
            <option value="small">小(半行)</option>
            <option value="medium" selected>中(整行)</option>
            <option value="large">大(整行,高些)</option>
          </select>
        </label>
        <label>
          <div class="label-text">位置</div>
          <select name="placement">
            <option value="above" selected>app 上方</option>
            <option value="below">app 下方</option>
          </select>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
          <button type="submit" class="btn">添加</button>
        </div>
      </form>
    </div>
  `;
  modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
  modal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(modal.querySelector('form'));
    const text = String(fd.get('text') || '').trim();
    if (!text) return;
    await db.set('homeWidgets', {
      id: db.newId(),
      type: 'note',
      data: text,
      size: String(fd.get('size') || 'medium'),
      placement: String(fd.get('placement') || 'above'),
      createdAt: Date.now(),
    });
    modal.remove();
    await router.navigate('home');
  });
}

// Mini-modal to ask size + placement after a file is already picked.
// Resolves to { size, placement } or null.
function askSizeAndPlacement(container) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">大小和位置</div>
        <form class="size-form">
          <label>
            <div class="label-text">大小</div>
            <select name="size">
              <option value="small">小(半行)</option>
              <option value="medium" selected>中(整行)</option>
              <option value="large">大(整行,高些)</option>
            </select>
          </label>
          <label>
            <div class="label-text">位置</div>
            <select name="placement">
              <option value="above" selected>app 上方</option>
              <option value="below">app 下方</option>
            </select>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">添加</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.cancel-btn').addEventListener('click', () => { close(); resolve(null); });
    modal.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      close();
      resolve({
        size: String(fd.get('size') || 'medium'),
        placement: String(fd.get('placement') || 'above'),
      });
    });
  });
}

export async function mountHome(container, params, router) {
  const showPager = PAGES.length > 1;
  // Read wallpaper from settings. We mount it on .phone-frame (not on
  // .page.home) so it extends *behind* the status bar and the dock — the
  // status bar is already transparent and the dock is translucent + blurred,
  // so both naturally show the wallpaper through. base64 lives on
  // settings.wallpaper. Cleanup on unmount clears the frame style so leaving
  // home (to chat-list / settings / etc.) hides the wallpaper.
  const settings = await db.get('settings', 'default');
  const wallpaper = settings?.wallpaper || null;
  const phoneFrame = container.closest('.phone-frame');
  if (phoneFrame) {
    if (wallpaper) {
      phoneFrame.style.backgroundImage = `url("${wallpaper}")`;
      phoneFrame.style.backgroundSize = 'cover';
      phoneFrame.style.backgroundPosition = 'center';
    } else {
      phoneFrame.style.backgroundImage = '';
      phoneFrame.style.backgroundSize = '';
      phoneFrame.style.backgroundPosition = '';
    }
  }
  const userWidgets = await db.getAll('homeWidgets');
  // Order by explicit `order` if set (assigned during edit-mode drag);
  // fallback to createdAt for widgets that have never been reordered.
  userWidgets.sort((a, b) => {
    const ao = a.order ?? a.createdAt ?? 0;
    const bo = b.order ?? b.createdAt ?? 0;
    return ao - bo;
  });
  // Split user widgets by placement; builtin favorites always stays above.
  const above = [...BUILTIN_WIDGETS, ...userWidgets.filter(w => (w.placement || 'above') === 'above')];
  const below = userWidgets.filter(w => w.placement === 'below');
  const aboveHtmls = (await Promise.all(above.map(renderWidget))).filter(Boolean).join('');
  const belowHtmls = (await Promise.all(below.map(renderWidget))).filter(Boolean).join('');
  // The add button always sits at the end of the "above" row so users
  // can summon the picker without scrolling.
  const aboveBlock = aboveHtmls + `<button class="widget-add" type="button" title="添加桌面装饰">＋ 添加装饰</button>`;
  // When the user has zero decoration widgets, leave the "+ 添加装饰" button
  // visible in normal mode so they always have a way in. Once any user
  // widget exists, the button hides outside edit mode (right-click / long-press
  // to enter).
  const hasNoUserWidgets = userWidgets.length === 0;
  container.innerHTML = `
    <div class="page home${hasNoUserWidgets ? ' no-user-widgets' : ''}">
      <button class="edit-done" type="button">完成</button>
      <div class="home-pages">
        ${PAGES.map((page, i) => `
          <div class="home-page">
            ${i === 0 ? `<div class="widget-row above-row">${aboveBlock}</div>` : ''}
            <div class="app-grid">${page.map(tileHtml).join('')}</div>
            ${i === 0 && belowHtmls ? `<div class="widget-row below-row">${belowHtmls}</div>` : ''}
          </div>
        `).join('')}
      </div>
      <div class="home-pager${showPager ? '' : ' single'}">
        ${PAGES.map((_, i) => `<button class="dot${i === 0 ? ' active' : ''}" data-page="${i}" aria-label="第 ${i+1} 页"></button>`).join('')}
      </div>
      <div class="home-dock">
        <div class="app-grid dock-grid">${DOCK.map(tileHtml).join('')}</div>
      </div>
    </div>
  `;

  const pagesEl = container.querySelector('.home-pages');
  const dots    = Array.from(container.querySelectorAll('.home-pager .dot'));
  const homeEl  = container.querySelector('.page.home');

  // ── Edit mode state ───────────────────────────────────────────
  let editMode = false;
  function setEditMode(on) {
    editMode = !!on;
    homeEl.classList.toggle('editing', editMode);
    if (!editMode) cancelDrag();
  }

  // Long-press timer (touch only — desktop uses right-click). pressStart
  // tracks start coords so we can cancel the timer when the pointer wanders
  // (user is scrolling, not pressing-and-holding).
  let pressTimer = null;
  let pressStart = null;
  function clearPressTimer() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressStart = null;
  }

  // Drag state for editing-mode widget reorder. We lift the widget out of
  // the grid with position:fixed (so it follows the pointer pixel-for-pixel),
  // and drop a placeholder of the same size into the grid where it used to
  // sit. As the pointer hovers over other widgets in the same row, the
  // placeholder slides to a new spot. Release puts the widget where the
  // placeholder ended up. pointer-events:none on the lifted widget lets
  // elementsFromPoint "see through" it to find what's underneath.
  let dragging = null;
  function cancelDrag() {
    if (!dragging) return;
    const { el, placeholder, pointerId } = dragging;
    el.classList.remove('dragging');
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
    el.style.width = '';
    el.style.height = '';
    el.style.zIndex = '';
    el.style.pointerEvents = '';
    el.style.transform = '';
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(el, placeholder);
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

  // Pointer events handle three things on one stream, in priority order:
  //   1. Edit-mode widget drag-to-reorder.
  //   2. Long-press to enter edit mode (touch / pen only).
  //   3. Mouse drag-to-scroll between home pages (default in normal mode).
  let drag = null;
  const onPointerDown = (e) => {
    // 1. Edit mode: pressing on a user-widget begins a drag.
    if (editMode) {
      const widgetEl = e.target.closest('.user-widget');
      if (widgetEl && !e.target.closest('.widget-del')) {
        e.preventDefault();
        const rect = widgetEl.getBoundingClientRect();
        // Drop a same-size placeholder where the widget sat. Copy the grid
        // sizing class so it occupies the right number of columns.
        const placeholder = document.createElement('div');
        placeholder.className = 'widget-placeholder';
        const sizeClass = [...widgetEl.classList].find(c => c.startsWith('size-')) || 'size-medium';
        placeholder.classList.add(sizeClass);
        placeholder.style.height = rect.height + 'px';
        widgetEl.parentNode.insertBefore(placeholder, widgetEl);
        // Lift the widget out of the grid.
        widgetEl.style.position = 'fixed';
        widgetEl.style.left = rect.left + 'px';
        widgetEl.style.top  = rect.top + 'px';
        widgetEl.style.width  = rect.width + 'px';
        widgetEl.style.height = rect.height + 'px';
        widgetEl.style.zIndex = '100';
        widgetEl.style.pointerEvents = 'none';
        widgetEl.classList.add('dragging');
        dragging = {
          el: widgetEl,
          pointerId: e.pointerId,
          offsetX: e.clientX - rect.left,
          offsetY: e.clientY - rect.top,
          placeholder,
        };
        try { widgetEl.setPointerCapture(e.pointerId); } catch (_) {}
      }
      return;  // no page scroll while editing
    }
    // 2. Touch / pen long-press → enter edit mode.
    if ((e.pointerType === 'touch' || e.pointerType === 'pen')
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

  const onPointerMove = (e) => {
    // Cancel long-press if the pointer drifted (it's a scroll, not a press).
    if (pressTimer && pressStart) {
      const dx = e.clientX - pressStart.x;
      const dy = e.clientY - pressStart.y;
      if (dx * dx + dy * dy > 64) clearPressTimer();
    }
    // Edit-mode drag: widget follows the pointer (position:fixed + left/top).
    // For the placeholder, we *don't* require the pointer to land exactly on
    // another widget — we look at the pointer's Y and find the right slot
    // among the row's remaining widgets. This way the placeholder follows
    // smoothly even when the pointer is in a gap or off the widgets.
    if (dragging && e.pointerId === dragging.pointerId) {
      e.preventDefault();
      dragging.el.style.left = (e.clientX - dragging.offsetX) + 'px';
      dragging.el.style.top  = (e.clientY - dragging.offsetY) + 'px';
      const row = dragging.placeholder.parentNode;
      const siblings = [...row.querySelectorAll('.user-widget')].filter(el => el !== dragging.el);
      let insertBefore = null;
      for (const sib of siblings) {
        const r = sib.getBoundingClientRect();
        // Pointer above the vertical midpoint of this sibling → insert here.
        if (e.clientY < r.top + r.height / 2) {
          insertBefore = sib;
          break;
        }
      }
      if (insertBefore) {
        if (dragging.placeholder.nextSibling !== insertBefore) {
          row.insertBefore(dragging.placeholder, insertBefore);
        }
      } else {
        // Pointer below all siblings → end of the widget area, but stay
        // before the add-widget button if it's in this row.
        const addBtn = row.querySelector('.widget-add');
        const endTarget = addBtn || null;
        if (dragging.placeholder.nextSibling !== endTarget) {
          row.insertBefore(dragging.placeholder, endTarget);
        }
      }
      return;
    }
    // Mouse page-scroll drag.
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
    // Edit-mode drag finish: snap widget back into the grid at the
    // placeholder's final position, then persist new row order.
    if (dragging && e.pointerId === dragging.pointerId) {
      const row = dragging.placeholder.parentNode;
      // cancelDrag re-inserts dragging.el before the placeholder, so the
      // widget lands wherever the placeholder ended up.
      cancelDrag();
      // Renumber the row 1..N. Above and below stay independent
      // (placement field still splits them); builtin widgets without a
      // widgetId are skipped, keeping them at the start of the above row.
      const ids = [...row.querySelectorAll('.user-widget')].map(el => el.dataset.widgetId).filter(Boolean);
      for (let i = 0; i < ids.length; i++) {
        const w = await db.get('homeWidgets', ids[i]);
        if (w) {
          w.order = i + 1;
          await db.set('homeWidgets', w);
        }
      }
      return;
    }
    // Mouse page-scroll drag finish.
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

  // Click handlers — tile launches, dot navigation, widget add/delete, edit-mode exit.
  const onClick = async (e) => {
    // Done — exit edit mode.
    if (e.target.closest('.edit-done')) {
      setEditMode(false);
      return;
    }
    // Delete (× on widget). In edit mode no confirm — the user explicitly
    // entered the edit gesture so tapping × clearly means delete.
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
    // Add (＋) — only visible in edit mode; stay in edit mode after.
    if (e.target.closest('.widget-add')) {
      preserveEditModeOnMount = true;
      await openAddWidgetModal(container, router);
      return;
    }
    // In edit mode: app-icon clicks and empty-area clicks just exit edit
    // mode — don't launch apps or change pages.
    if (editMode) {
      if (e.target.closest('.app-icon')
          || (!e.target.closest('.user-widget')
              && !e.target.closest('.dot'))) {
        setEditMode(false);
      }
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
        alert(`「${btn.dataset.label}」还没做完`);
      } else {
        throw err;
      }
    }
  };
  container.addEventListener('click', onClick);

  // Restore edit mode if we were re-mounted by an add/delete while editing.
  if (preserveEditModeOnMount) {
    preserveEditModeOnMount = false;
    setEditMode(true);
  }

  return () => {
    clearPressTimer();
    cancelDrag();
    pagesEl.removeEventListener('scroll', onScroll);
    pagesEl.removeEventListener('pointerdown', onPointerDown);
    pagesEl.removeEventListener('pointermove', onPointerMove);
    pagesEl.removeEventListener('pointerup', onPointerEnd);
    pagesEl.removeEventListener('pointercancel', onPointerEnd);
    homeEl.removeEventListener('contextmenu', onContextMenu);
    container.removeEventListener('click', onClick);
    if (phoneFrame) {
      phoneFrame.style.backgroundImage = '';
      phoneFrame.style.backgroundSize = '';
      phoneFrame.style.backgroundPosition = '';
    }
  };
}
