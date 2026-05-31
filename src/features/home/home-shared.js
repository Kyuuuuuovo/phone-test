// Home 共享底层 helper —— home.js / home-editors.js / settings/widget-presets.js
// 三方都要用,单独抽一层打破 home.js ↔ home-editors.js 的循环依赖。
// 内容:网格常量(COLS/ROWS)、widgetSpan(legacy size → colSpan/rowSpan 兜底)、
// 以及 widget editor 的「外观」字段 helper(倾斜 / 不透明度 / HSV 背景色 + 圆角)。
// 这层不 import 任何 home 模块,保持叶子节点(widget-presets.js 也从这里 import 字段 helper)。

export const COLS = 4;  // home grid has 4 columns (dock also 4)
export const ROWS = 5;  // 4 cols × 5 rows;一度试过 6 行,手机底部装不下被截,回退

// (col-span, row-span) for each widget. New data layout: widgets store
// colSpan/rowSpan directly (1..4 / 1..5), letting the user pick any combo
// from the editor. We still honor the legacy `size` field so existing
// users' widgets keep their shape after the v2 upgrade.
export function widgetSpan(w) {
  // Explicit colSpan/rowSpan wins (new format).
  if (Number.isFinite(w.colSpan) && Number.isFinite(w.rowSpan)) {
    return { colSpan: w.colSpan, rowSpan: w.rowSpan };
  }
  // Legacy size mapping — kept for backwards-compat with rows saved before
  // the colSpan/rowSpan refactor.
  if (w.type === 'music')       return { colSpan: 2, rowSpan: 2 };
  if (w.type === 'polaroid')    return { colSpan: 2, rowSpan: 2 };
  if (w.type === 'gameboy')     return { colSpan: 2, rowSpan: 2 };
  if (w.type === 'mp3')         return { colSpan: 2, rowSpan: 2 };
  if (w.type === 'schedule')    return { colSpan: 4, rowSpan: 2 };
  if (w.type === 'recent-chat') return { colSpan: 4, rowSpan: 3 };
  if (w.type === 'anniversary') return { colSpan: 2, rowSpan: 1 };
  if (w.type === 'favorites') {
    return w.size === 'small' ? { colSpan: 2, rowSpan: 1 } : { colSpan: 4, rowSpan: 1 };
  }
  if (w.size === 'small') return { colSpan: 2, rowSpan: 1 };
  if (w.size === 'large') return { colSpan: 4, rowSpan: 3 };
  return { colSpan: 4, rowSpan: 2 };  // medium default
}

// 倾斜角度 slider helper — 跟 transparency / radius 同款。范围 -30~30 度,
// 步进 1。0 表示不倾斜。inline live readout 用 wireTiltReadout 绑事件。
export function tiltFieldHtml(current) {
  const val = Number.isFinite(current) ? Math.max(-30, Math.min(30, current)) : 0;
  return `
    <label>
      <div class="label-text">倾斜:<span class="tilt-readout">${val}</span>°(-30 = 左倾,+30 = 右倾,0 = 不倾斜)</div>
      <input type="range" min="-30" max="30" step="1" name="tilt" value="${val}">
    </label>
  `;
}
export function wireTiltReadout(modal) {
  const slider = modal.querySelector('input[name="tilt"]');
  if (!slider) return;
  const readout = modal.querySelector('.tilt-readout');
  slider.addEventListener('input', () => { if (readout) readout.textContent = slider.value; });
}
export function parseTilt(fd) {
  const t = Number(fd.get('tilt'));
  if (!Number.isFinite(t)) return 0;
  return Math.max(-30, Math.min(30, Math.round(t)));
}

// 透明度 0-100,0 = 全透明。不能用 `Number(x) || 100` —— 选 0 会被 falsy 吞成
// 100(用户永远存不进"全透明")。只有空 / 非数字才回落 100。
export function parseTransparency(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
}

export function transparencyFieldHtml(current) {
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
export function wireTransparencyReadout(modal) {
  const slider = modal.querySelector('input[name="transparency"]');
  if (!slider) return;
  const readout = modal.querySelector('.transp-readout');
  slider.addEventListener('input', () => { if (readout) readout.textContent = slider.value; });
}

// ── Phase B: 颜色 (HSV) + 圆角 widget 自定义 ──────────────────────────────
// 给每个 widget editor 用的 HSV 色调 + 圆角 字段块。HSV 比 HSL 更符合直觉
// (V = 亮度;HSL 的 L 是亮度+黑白混合,饱满色调难调)。CSS 只支持 hsl(),
// 所以保存时 HSV→HSL 转一次。bgColor 字符串形如 "hsl(180, 50%, 75%)",直接
// 用作 CSS 值塞 --widget-bg。radius 是像素数。
// 默认值:null → 用主题默认色 + 默认圆角(--radius-lg)。重置按钮把两个都
// 清回 null,widget 回到主题默认。
function hsvToHsl(h, s, v) {
  // h: 0-360, s/v: 0-100
  const sN = s / 100, vN = v / 100;
  const l = vN * (1 - sN / 2);
  const sl = (l === 0 || l === 1) ? 0 : (vN - l) / Math.min(l, 1 - l);
  return { h: Math.round(h), s: Math.round(sl * 100), l: Math.round(l * 100) };
}
function hsvToCssHsl(h, s, v) {
  const { h: hh, s: ss, l: ll } = hsvToHsl(h, s, v);
  return `hsl(${hh}, ${ss}%, ${ll}%)`;
}

export function bgColorAndRadiusFieldsHtml(currentHsv, currentRadius) {
  // currentHsv: {h, s, v} | null;currentRadius: number | null
  const h = currentHsv?.h ?? 0;
  const s = currentHsv?.s ?? 0;       // 默认 0 = 灰色,user 调 H 后调 S 出彩
  const v = currentHsv?.v ?? 100;
  const enabled = !!currentHsv;
  const r = Number.isFinite(currentRadius) ? currentRadius : 16;
  const previewBg = enabled ? hsvToCssHsl(h, s, v) : 'transparent';
  return `
    <label>
      <div class="label-text">
        背景色
        <label class="bg-color-toggle">
          <input type="checkbox" name="bgColorEnabled"${enabled ? ' checked' : ''}>
          <span>自定义</span>
        </label>
      </div>
      <div class="bg-color-block"${enabled ? '' : ' data-disabled="true"'}>
        <div class="bg-color-preview" style="background: ${previewBg};"></div>
        <div class="bg-color-sliders">
          <div class="bg-slider-row"><span class="bg-slider-label">色相 H</span><input type="range" min="0"   max="360" step="1"  name="bgH" value="${h}"><span class="bg-slider-readout" data-readout="bgH">${h}</span></div>
          <div class="bg-slider-row"><span class="bg-slider-label">饱和 S</span><input type="range" min="0"   max="100" step="1"  name="bgS" value="${s}"><span class="bg-slider-readout" data-readout="bgS">${s}</span></div>
          <div class="bg-slider-row"><span class="bg-slider-label">亮度 V</span><input type="range" min="0"   max="100" step="1"  name="bgV" value="${v}"><span class="bg-slider-readout" data-readout="bgV">${v}</span></div>
        </div>
      </div>
    </label>
    <label>
      <div class="label-text">圆角:<span class="radius-readout">${r}</span>px</div>
      <input type="range" min="0" max="30" step="1" name="bgRadius" value="${r}">
    </label>
  `;
}

// Wire HSV sliders + checkbox + preview live update. Call after the form is in DOM.
export function wireBgColorReadout(modal) {
  const block = modal.querySelector('.bg-color-block');
  const toggle = modal.querySelector('input[name="bgColorEnabled"]');
  const preview = modal.querySelector('.bg-color-preview');
  const hI = modal.querySelector('input[name="bgH"]');
  const sI = modal.querySelector('input[name="bgS"]');
  const vI = modal.querySelector('input[name="bgV"]');
  const radiusI = modal.querySelector('input[name="bgRadius"]');
  const radiusReadout = modal.querySelector('.radius-readout');
  function refresh() {
    if (!block) return;
    block.dataset.disabled = toggle?.checked ? 'false' : 'true';
    if (preview) {
      preview.style.background = toggle?.checked
        ? hsvToCssHsl(Number(hI.value), Number(sI.value), Number(vI.value))
        : 'transparent';
    }
    if (hI) modal.querySelector('[data-readout="bgH"]').textContent = hI.value;
    if (sI) modal.querySelector('[data-readout="bgS"]').textContent = sI.value;
    if (vI) modal.querySelector('[data-readout="bgV"]').textContent = vI.value;
    if (radiusI && radiusReadout) radiusReadout.textContent = radiusI.value;
  }
  [toggle, hI, sI, vI, radiusI].forEach(el => el?.addEventListener('input', refresh));
  refresh();
}

// Parse HSV + radius out of FormData → { bgColor: string|null, radius: number }
export function parseBgColorAndRadius(fd) {
  const enabled = fd.get('bgColorEnabled') === 'on';
  const radius = Number(fd.get('bgRadius'));
  const r = Number.isFinite(radius) ? Math.max(0, Math.min(30, radius)) : 16;
  if (!enabled) return { bgColor: null, radius: r };
  const h = Number(fd.get('bgH')) || 0;
  const s = Number(fd.get('bgS')) || 0;
  const v = Number(fd.get('bgV')) || 100;
  return { bgColor: hsvToCssHsl(h, s, v), radius: r };
}

