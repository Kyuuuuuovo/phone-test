// Home widget 编辑器 —— 「添加装饰」/「编辑 widget」的所有 modal 与其私有 helper
//(各 renderXEditor、saveNewWidget/updateWidget、占位/找空位、尺寸表单解析、图片选择)。
// 2026-05 从 home.js 拆出(第三刀)。共享的字段 helper + 网格常量在 home-shared.js;
// escHtml/escAttr 来自 home-widgets.js。对外只暴露两个入口:openAddWidgetModal /
// openEditWidgetModal,由 home.js 调用。

import * as db from '../../core/db.js';
import { openAlert } from '../../core/modal.js';
import { escHtml, escAttr } from './home-widgets.js';
import {
  COLS, ROWS, widgetSpan,
  tiltFieldHtml, wireTiltReadout, parseTilt, parseTransparency,
  transparencyFieldHtml, wireTransparencyReadout,
  bgColorAndRadiusFieldsHtml, wireBgColorReadout, parseBgColorAndRadius,
} from './home-shared.js';

// ── Add-widget modal ─────────────────────────────────────────────────────
// Text-only picker — emojis + hints were removed because 6 buttons in a
// flex row overflowed in narrow viewports. Now a 3×2 grid (see
// .widget-type-picker in base.css).
export async function openAddWidgetModal(container, router) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">添加桌面装饰</div>
      <div class="widget-type-picker">
        <button type="button" class="widget-type-btn" data-type="favorites">收藏</button>
        <button type="button" class="widget-type-btn" data-type="photo">照片</button>
        <button type="button" class="widget-type-btn" data-type="note">便签</button>
        <button type="button" class="widget-type-btn" data-type="anniversary">纪念日</button>
        <button type="button" class="widget-type-btn" data-type="music">音乐</button>
        <button type="button" class="widget-type-btn" data-type="gameboy">游戏机</button>
        <button type="button" class="widget-type-btn" data-type="mp3">MP3</button>
        <button type="button" class="widget-type-btn" data-type="schedule">行程</button>
        <button type="button" class="widget-type-btn" data-type="recent-chat">最近聊天</button>
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
  // 两类 widget:有专属内容编辑器的(开对应 editor)vs 纯装饰的(只问外观再存)。
  // 原来是一长串 if/else,后 5 个分支几乎一模一样,收成两张表 + 一段通用逻辑。
  const CONTENT_EDITORS = {
    photo: renderPhotoEditor,            // 图片 / 拍立得合并入口(按张数决定 image/polaroid)
    note: renderNoteEditor,
    anniversary: renderAnniversaryEditor,
    music: renderMusicEditor,
  };
  const APPEARANCE_ONLY = {              // type → 默认尺寸串(无内容字段,只调外观)
    favorites: '4x1',
    gameboy: '2x2',
    mp3: '2x2',
    schedule: '4x2',
    'recent-chat': '4x3',
  };
  modal.querySelectorAll('[data-type]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.type;
      const editor = CONTENT_EDITORS[type];
      if (editor) { editor(modal, container, router); return; }
      const preset = APPEARANCE_ONLY[type];
      if (!preset) return;
      modal.remove();
      const opts = await askSizeAndTransparency(container, preset);
      if (!opts) return;
      await saveNewWidget({ type, ...opts }, router);
    });
  });
}

// ── 编辑器本地 form helper ─────────────────────────────────────────────────
// sizeSelectHtml(宽 × 高 dropdown)+ parseSizeFromForm(解析回 colSpan/rowSpan)
// + parseHslString(把存的 hsl() 串还原成 HSV 给编辑器预填)。这几个只有编辑器
// 用,所以留在本文件;「外观」字段 helper(倾斜 / 不透明度 / HSV 背景色)是三方
// 共享的,在 home-shared.js,这里 import 进来用。

function sizeSelectHtml(currentColSpan, currentRowSpan, defaultPreset) {
  // D: 改成"宽 × 高"两个独立 dropdown(宽 1-4 / 高 1-5),不再 fixed preset。
  // user 反馈想自由调任意组合,而不是预设几组。defaultPreset 参数保留向后
  // 兼容('WxH' string),从中解析出 default W/H。
  let dW = 2, dH = 2;
  if (defaultPreset) {
    const m = /^(\d+)x(\d+)$/.exec(defaultPreset);
    if (m) { dW = Number(m[1]); dH = Number(m[2]); }
  }
  const w = Number.isFinite(currentColSpan) ? currentColSpan : dW;
  const h = Number.isFinite(currentRowSpan) ? currentRowSpan : dH;
  const widths  = [1, 2, 3, 4];
  const heights = [1, 2, 3, 4, 5];
  return `
    <label>
      <div class="label-text">大小(宽 × 高 格子数)</div>
      <div class="size-wh-row">
        <select name="sizeW">${widths.map(n => `<option value="${n}"${n===w?' selected':''}>${n}</option>`).join('')}</select>
        <span class="size-x">×</span>
        <select name="sizeH">${heights.map(n => `<option value="${n}"${n===h?' selected':''}>${n}</option>`).join('')}</select>
      </div>
    </label>
  `;
}

// Extract { h, s, v } from a CSS hsl() string, for re-opening editor. Returns
// null if string doesn't parse — editor then shows "未自定义" defaults.
// Note: we do the *reverse* of hsvToHsl (in home-shared.js), recovering V from L and S.
function parseHslString(str) {
  const m = /^hsl\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/.exec(String(str || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const sl = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  // HSL → HSV
  const v = l + sl * Math.min(l, 1 - l);
  const sv = v === 0 ? 0 : 2 * (1 - l / v);
  return { h: Math.round(h), s: Math.round(sv * 100), v: Math.round(v * 100) };
}

// D: 新 sizeSelectHtml 的两 dropdown FormData 解析。fallback 给个安全默认。
function parseSizeFromForm(fd, fallback = { colSpan: 2, rowSpan: 2 }) {
  const w = Number(fd.get('sizeW'));
  const h = Number(fd.get('sizeH'));
  return {
    colSpan: (Number.isFinite(w) && w >= 1 && w <= 4) ? w : fallback.colSpan,
    rowSpan: (Number.isFinite(h) && h >= 1 && h <= 5) ? h : fallback.rowSpan,
  };
}

// 把「外观」表单字段一次性读成可直接 spread 进 widget 的扁平对象:
// { colSpan, rowSpan, transparency, tilt, bgColor, radius }。每个编辑器 submit
// 都要这一坨,抽出来免得六处重复。fallback 是 sizeW/sizeH 非法时的兜底尺寸。
function readAppearanceFields(fd, fallback = { colSpan: 2, rowSpan: 2 }) {
  const { bgColor, radius } = parseBgColorAndRadius(fd);
  return {
    ...parseSizeFromForm(fd, fallback),
    transparency: parseTransparency(fd.get('transparency')),
    tilt: parseTilt(fd),
    bgColor,
    radius,
  };
}

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
  // 改 rowSpan/colSpan 后 row/col 可能越界(比如 widget 在 row 4 占 1 行
  // 合法,user 把 rowSpan 改成 2 → grid-row 5 / span 2 跑出 5 行 grid →
  // grid-auto-rows 之前会接着开第 6 行挤扁全部 cell)。这里强制 clamp
  // 到合法范围;如果 clamped 位置跟其他 widget 重叠,findFirstFreeCell
  // 重找空位,实在没空就把 row/col 退回原状并 alert,让 user 自己处理。
  const span = widgetSpan(w);
  const maxRow = Math.max(0, ROWS - span.rowSpan);
  const maxCol = Math.max(0, COLS - span.colSpan);
  const desiredRow = Math.max(0, Math.min(Number(w.row) || 0, maxRow));
  const desiredCol = Math.max(0, Math.min(Number(w.col) || 0, maxCol));
  if (desiredRow !== w.row || desiredCol !== w.col) {
    // 看看 clamped 位置是否跟别的 widget / app 占位冲突
    const allWidgets = (await db.getAll('homeWidgets')).filter(x => x.id !== id);
    const settings = await db.get('settings', 'default');
    const page0 = Array.isArray(settings?.tileOrder?.[0]) ? settings.tileOrder[0] : [];
    const occ = buildOccupancy(allWidgets, page0);
    const fits = (r, c) => {
      for (let rr = r; rr < r + span.rowSpan; rr++) {
        for (let cc = c; cc < c + span.colSpan; cc++) {
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) return false;
          if (occ[rr][cc]) return false;
        }
      }
      return true;
    };
    if (fits(desiredRow, desiredCol)) {
      w.row = desiredRow; w.col = desiredCol;
    } else {
      const slot = findFirstFreeCell(occ, span.colSpan, span.rowSpan);
      if (slot) {
        w.row = slot.row; w.col = slot.col;
      } else {
        await openAlert(document.body, {
          title: '改尺寸放不下',
          message: '这个新尺寸在桌面上找不到合适位置,先删一个 widget 或缩小别的腾位置。',
          danger: true,
        });
        return;
      }
    }
  }
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

function renderNoteEditor(modal, container, router, existing) {
  const initText  = existing?.data ?? '';
  const initVertical = !!existing?.vertical;
  const initSpan  = existing ? widgetSpan(existing) : null;
  const initAlpha = existing?.transparency;
  const initHsv = existing?.bgColor ? parseHslString(existing.bgColor) : null;
  const initRadius = existing?.radius;
  const initTilt = existing?.tilt;
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${existing ? '编辑便签' : '便签'}</div>
      <form class="note-form">
        <label>
          <div class="label-text">写点什么</div>
          <textarea name="text" rows="4" required placeholder="写点什么...">${escHtml(initText)}</textarea>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" name="vertical"${initVertical ? ' checked' : ''}>
          <span>竖排(从右向左竖着写,适合诗歌 / 短句)</span>
        </label>
        ${sizeSelectHtml(initSpan?.colSpan, initSpan?.rowSpan, '4x2')}
        ${transparencyFieldHtml(initAlpha)}
        ${tiltFieldHtml(initTilt)}
        ${bgColorAndRadiusFieldsHtml(initHsv, initRadius)}
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
          <button type="submit" class="btn">${existing ? '保存' : '添加'}</button>
        </div>
      </form>
    </div>
  `;
  wireTransparencyReadout(modal);
  wireTiltReadout(modal);
  wireBgColorReadout(modal);
  modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
  modal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(modal.querySelector('form'));
    const text = String(fd.get('text') || '').trim();
    if (!text) return;
    const vertical = fd.get('vertical') === 'on';
    const appearance = readAppearanceFields(fd, { colSpan: 4, rowSpan: 2 });
    modal.remove();
    const patch = { data: text, vertical, ...appearance };
    if (existing) await updateWidget(existing.id, patch, router);
    else await saveNewWidget({ type: 'note', ...patch }, router);
  });
}

// A5: 统一「照片」editor — image (无边框平铺) 跟 polaroid (白边堆叠) 是两
// 种装饰形式,user 自己用 select 选,**不再按张数自动判断**(之前 1 张固
// 定 image、2-3 张固定 polaroid,导致 user 想"1 张拍立得"或"多张平铺"做
// 不到)。
//   - image 模式:槽位上限 1 张,data 是 base64 字符串(→ renderImageWidget)
//   - polaroid 模式:1-3 张,data 是 { photos, stackOrder }(→ polaroid)
// 切到 image 模式时,如果 pendingPhotos 已经多张,保留第一张(剩下要再传
// 一遍麻烦,告诉 user 切回 polaroid 还能用)。
function renderPhotoEditor(modal, container, router) {
  let pendingPhotos = [];
  let displayMode = 'polaroid';  // 默认拍立得 — 是这个入口的主要形式

  function render() {
    const maxSlots = displayMode === 'image' ? 1 : 3;
    // 切换模式时已超过新上限的 photo 自动截掉(image 模式只留第一张)
    if (pendingPhotos.length > maxSlots) {
      pendingPhotos = pendingPhotos.slice(0, maxSlots);
    }
    const slots = Array.from({ length: maxSlots }, (_, i) => pendingPhotos[i] || null);
    const hintText = displayMode === 'image'
      ? '照片 · 无边框直接平铺(只 1 张)'
      : '拍立得 · 白色边框堆叠(1-3 张)';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">添加照片</div>
        <form class="photo-form">
          <label>
            <div class="label-text">展示形式</div>
            <select name="displayMode">
              <option value="polaroid"${displayMode === 'polaroid' ? ' selected' : ''}>拍立得(白色边框,可堆叠)</option>
              <option value="image"${displayMode === 'image' ? ' selected' : ''}>照片(无边框,直接平铺)</option>
            </select>
            <div class="muted-hint">${escHtml(hintText)}</div>
          </label>
          <label>
            <div class="label-text">${displayMode === 'image' ? '选 1 张照片' : '选 1-3 张照片'}</div>
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
          ${sizeSelectHtml(null, null, '2x2')}
          ${transparencyFieldHtml(undefined)}
          ${tiltFieldHtml(undefined)}
          ${bgColorAndRadiusFieldsHtml(null, undefined)}
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">添加</button>
          </div>
        </form>
      </div>
    `;
    wireTransparencyReadout(modal);
    wireTiltReadout(modal);
    wireBgColorReadout(modal);
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('select[name="displayMode"]').addEventListener('change', (e) => {
      displayMode = e.target.value === 'image' ? 'image' : 'polaroid';
      render();
    });
    modal.querySelectorAll('.polaroid-edit-slot-btns button').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.slotIdx);
        if (btn.classList.contains('del')) {
          pendingPhotos.splice(idx, 1);
          render();
        } else if (btn.classList.contains('swap') || btn.classList.contains('add')) {
          const data = await pickImageFile();
          if (!data) return;
          if (btn.classList.contains('swap')) pendingPhotos[idx] = data;
          else if (pendingPhotos.length < maxSlots) pendingPhotos.push(data);
          render();
        }
      });
    });
    modal.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const photos = pendingPhotos.filter(Boolean);
      if (photos.length === 0) {
        await openAlert(document.body, { title: '至少加 1 张', message: '点 + 加一张照片再添加。' });
        return;
      }
      const fd = new FormData(modal.querySelector('form'));
      const appearance = readAppearanceFields(fd, { colSpan: 2, rowSpan: 2 });
      modal.remove();
      if (displayMode === 'image') {
        await saveNewWidget({ type: 'image', data: photos[0], ...appearance }, router);
      } else {
        await saveNewWidget({
          type: 'polaroid',
          data: { photos, stackOrder: photos.map((_, i) => i) },
          ...appearance,
        }, router);
      }
    });
  }
  render();
}

// Editor for an existing image widget — shows current pic + "换图" button +
// size/transparency. New image is loaded into a closure variable; not
// persisted until submit (so cancelling cleanly throws away the picked file).
async function renderImageEditor(modal, container, router, existing) {
  let imageData = existing?.data || null;
  const initSpan = existing ? widgetSpan(existing) : null;
  const initAlpha = existing?.transparency;
  const initHsv = existing?.bgColor ? parseHslString(existing.bgColor) : null;
  const initRadius = existing?.radius;
  const initTilt = existing?.tilt;

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
          ${tiltFieldHtml(initTilt)}
          ${bgColorAndRadiusFieldsHtml(initHsv, initRadius)}
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">保存</button>
          </div>
        </form>
      </div>
    `;
    wireTransparencyReadout(modal);
    wireTiltReadout(modal);
    wireBgColorReadout(modal);
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('.swap-image').addEventListener('click', async () => {
      const data = await pickImageFile();
      if (data) { imageData = data; render(); }
    });
    modal.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      const appearance = readAppearanceFields(fd, { colSpan: 4, rowSpan: 2 });
      modal.remove();
      await updateWidget(existing.id, { data: imageData, ...appearance }, router);
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
  const initHsv = existing?.bgColor ? parseHslString(existing.bgColor) : null;
  const initRadius = existing?.radius;
  const initTilt = existing?.tilt;

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
          ${tiltFieldHtml(initTilt)}
          ${bgColorAndRadiusFieldsHtml(initHsv, initRadius)}
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">保存</button>
          </div>
        </form>
      </div>
    `;
    wireTransparencyReadout(modal);
    wireTiltReadout(modal);
    wireBgColorReadout(modal);
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
      const appearance = readAppearanceFields(fd, { colSpan: 2, rowSpan: 2 });
      modal.remove();
      // stackOrder 重置成 [0..n-1] —— 改照片后老的 stackOrder 索引可能指向
      // 不存在的位置。点击交互重新累积 stackOrder。
      const photos = pendingPhotos.filter(Boolean);
      await updateWidget(existing.id, {
        data: { photos, stackOrder: photos.map((_, i) => i) },
        ...appearance,
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
  const initHsv       = existing?.bgColor ? parseHslString(existing.bgColor) : null;
  const initRadius    = existing?.radius;
  const initTilt      = existing?.tilt;

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
        ${tiltFieldHtml(initTilt)}
        ${bgColorAndRadiusFieldsHtml(initHsv, initRadius)}
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
          <button type="submit" class="btn">${existing ? '保存' : '添加'}</button>
        </div>
      </form>
    </div>
  `;
  wireTransparencyReadout(modal);
  wireTiltReadout(modal);
  wireBgColorReadout(modal);
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
    const appearance = readAppearanceFields(fd, { colSpan: 2, rowSpan: 1 });
    modal.remove();
    const patch = { data, ...appearance };
    if (existing) await updateWidget(existing.id, patch, router);
    else await saveNewWidget({ type: 'anniversary', ...patch }, router);
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
  const initHsv     = existing?.bgColor ? parseHslString(existing.bgColor) : null;
  const initRadius  = existing?.radius;
  const initTilt    = existing?.tilt;
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
        ${tiltFieldHtml(initTilt)}
        ${bgColorAndRadiusFieldsHtml(initHsv, initRadius)}
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
          <button type="submit" class="btn">${existing ? '保存' : '添加'}</button>
        </div>
      </form>
    </div>
  `;
  wireTransparencyReadout(modal);
  wireTiltReadout(modal);
  wireBgColorReadout(modal);
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
    const appearance = readAppearanceFields(fd, { colSpan: 2, rowSpan: 2 });
    const data = {
      song, artist, lyrics, playing,
      leftSubject, rightSubject,
      coverImage: coverImageData || undefined,
    };
    modal.remove();
    const patch = { data, ...appearance };
    if (existing) await updateWidget(existing.id, patch, router);
    else await saveNewWidget({ type: 'music', ...patch }, router);
  });
}

// 外观 modal — 给没有内容字段的纯装饰 widget(favorites / gameboy / mp3 /
// schedule / recent-chat)用,只问尺寸 + 外观。resolve 出一个可直接 spread 进
// widget 的扁平对象 { colSpan, rowSpan, transparency, tilt, bgColor, radius };取消则 null。
function askSizeAndTransparency(container, defaultPreset, existing) {
  // existing 可以是 widget 对象(edit flow)或 null/undefined (add flow)
  const existingSpan = existing ? widgetSpan(existing) : null;
  const existingAlpha = existing?.transparency;
  const existingHsv = existing?.bgColor ? parseHslString(existing.bgColor) : null;
  const existingRadius = existing?.radius;
  const existingTilt = existing?.tilt;
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">外观</div>
        <form class="size-form">
          ${sizeSelectHtml(existingSpan?.colSpan, existingSpan?.rowSpan, defaultPreset)}
          ${transparencyFieldHtml(existingAlpha)}
          ${tiltFieldHtml(existingTilt)}
          ${bgColorAndRadiusFieldsHtml(existingHsv, existingRadius)}
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">${existing ? '保存' : '添加'}</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    wireTransparencyReadout(modal);
    wireTiltReadout(modal);
    wireBgColorReadout(modal);
    const close = () => modal.remove();
    modal.querySelector('.cancel-btn').addEventListener('click', () => { close(); resolve(null); });
    modal.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      close();
      resolve(readAppearanceFields(fd, { colSpan: 2, rowSpan: 2 }));
    });
  });
}

// Open the appropriate editor for an existing widget. Routes by widget.type
// to the same editor function used for new-widget creation (each one accepts
// an optional `existing` parameter and pre-fills its fields).
export async function openEditWidgetModal(container, router, widget) {
  // favorites / gameboy / mp3 / schedule / recent-chat widget 没有可编辑
  // content(它们都从 store 读"活"的数据 / 是纯装饰),所以只给 size +
  // transparency 等外观参数。其他 widget 类型都有专属编辑器:
  //  - image / polaroid: 换图 / 换照片
  //  - note / anniversary / music: 内容编辑
  if (widget.type === 'favorites' || widget.type === 'gameboy' || widget.type === 'mp3' || widget.type === 'schedule' || widget.type === 'recent-chat') {
    const opts = await askSizeAndTransparency(container, null, widget);
    if (!opts) return;
    await updateWidget(widget.id, opts, router);
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
