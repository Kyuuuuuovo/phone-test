// Theme model — a single active theme stored in settings.theme.
// Live preview works by writing CSS variables onto document.documentElement
// (cascades to every component) and setting data-* attributes on body for
// the gate-style effects (glass / gradient / texture).
//
// Legacy: settings.theme was a string ('default' / 'notch'). normalizeTheme()
// upgrades it to the object shape on read; the editor writes objects back.

export const FONT_OPTIONS = [
  { id: 'system',  label: '系统默认',  stack: `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif` },
  { id: 'serif',   label: '宋体 / 衬线', stack: `"Songti SC", "SimSun", "Noto Serif SC", Georgia, serif` },
  { id: 'crimson', label: 'Crimson Pro × 思源宋体', stack: `"Crimson Pro", "Noto Serif SC", "Songti SC", Georgia, serif` },
  { id: 'rounded', label: '圆体',       stack: `"Hiragino Sans GB", "PingFang SC", "Microsoft YaHei", "Source Han Sans CN", system-ui, sans-serif` },
  { id: 'kaiti',   label: '楷体',       stack: `"Kaiti SC", "STKaiti", "KaiTi", serif` },
  { id: 'mono',    label: '等宽',       stack: `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` },
  { id: 'custom',  label: '自定义',     stack: null },  // uses theme.customFontFamily + theme.customFontImportUrl
];

export const TEXTURE_OPTIONS = [
  { id: 'none',  label: '无' },
  { id: 'dots',  label: '点阵' },
  { id: 'grid',  label: '网格' },
  { id: 'lines', label: '斜纹' },
  { id: 'noise', label: '噪点' },
];

// Glass tier: 'none' | 'frosted' | 'liquid'
//   frosted — classic frosted glass: blur + semi-transparent surfaces
//   liquid  — Apple-style liquid glass: stronger blur, color-shifting saturate,
//             gradient sheen on the top edge of surfaces
export const GLASS_OPTIONS = [
  { id: 'none',    label: '无' },
  { id: 'frosted', label: '毛玻璃' },
  { id: 'liquid',  label: '液态玻璃' },
];

export const DEFAULT_THEME = Object.freeze({
  notch: false,
  bg:           '#f5f5f7',
  fg:           '#1d1d1f',
  surface:      '#ffffff',
  accent:       '#007aff',
  muted:        '#86868b',
  border:       '#d2d2d7',
  bubbleUser:   '#007aff',
  bubbleUserFg: '#ffffff',
  bubbleChar:   '#e9e9eb',
  bubbleCharFg: '#1d1d1f',
  outsideBg:    '#c7c7cc',
  bgPinned:     '#ebebef',
  fontFamily:   'system',
  fontSize:     15,
  // Used when fontFamily === 'custom'. customFontImportUrl is loaded as a
  // <link rel=stylesheet> (Google Fonts / fonts.bunny.net / etc.).
  customFontFamily:    '',
  customFontImportUrl: '',
  radius:       10,   // border-radius for cards/bubbles in px
  effects: {
    glass:        'none',
    gradient:     false,
    gradientTo:   '#cce4ff',
    texture:      'none',
    transparency: 0,
  },
});

// Returns a normalized theme object. Accepts: undefined, string (legacy),
// or partial object. Missing fields are filled from DEFAULT_THEME.
export function normalizeTheme(stored) {
  if (!stored) return { ...DEFAULT_THEME, effects: { ...DEFAULT_THEME.effects } };
  if (typeof stored === 'string') {
    const base = { ...DEFAULT_THEME, effects: { ...DEFAULT_THEME.effects } };
    if (stored === 'notch') base.notch = true;
    return base;
  }
  const merged = {
    ...DEFAULT_THEME,
    ...stored,
    effects: { ...DEFAULT_THEME.effects, ...(stored.effects || {}) },
  };
  // Migrate legacy effects.glass: true → 'frosted', false → 'none'
  if (typeof merged.effects.glass === 'boolean') {
    merged.effects.glass = merged.effects.glass ? 'frosted' : 'none';
  }
  if (!GLASS_OPTIONS.some(g => g.id === merged.effects.glass)) {
    merged.effects.glass = 'none';
  }
  return merged;
}

// One-click presets — the editor renders a row of chips at the top that copies
// the preset's values into the draft. Users can still tweak after applying.
export const THEME_PRESETS = [
  {
    id: 'default',
    label: '默认 iOS 蓝',
    theme: { ...DEFAULT_THEME, effects: { ...DEFAULT_THEME.effects } },
  },
  {
    id: 'blue-grey-serif',
    label: '蓝灰衬线',
    theme: {
      notch: false,
      bg:           '#EEF1F5',
      fg:           '#171A21',
      surface:      '#FFFFFF',
      accent:       '#7E9AB5',
      muted:        '#8895A5',
      border:       '#E0E6EE',
      bubbleUser:   '#7E9AB5',
      bubbleUserFg: '#FFFFFF',
      bubbleChar:   '#FFFFFF',
      bubbleCharFg: '#171A21',
      outsideBg:    '#E0E6EE',
      bgPinned:     '#F5F8FC',
      fontFamily:   'crimson',
      fontSize:     18,
      radius:       4,
      effects: { glass: 'frosted', gradient: false, gradientTo: '#cce4ff', texture: 'none', transparency: 0 },
    },
  },
];

export function applyTheme(theme) {
  const t = normalizeTheme(theme);
  applyCustomFontImport(t.fontFamily === 'custom' ? t.customFontImportUrl : '');
  const r = document.documentElement;
  const fontStack = resolveFontStack(t);
  const map = {
    '--bg':            t.bg,
    '--fg':            t.fg,
    '--surface':       t.surface,
    '--accent':        t.accent,
    '--muted':         t.muted,
    '--border':        t.border,
    '--bubble-user':    t.bubbleUser,
    '--bubble-user-fg': t.bubbleUserFg,
    '--bubble-char':    t.bubbleChar,
    '--bubble-char-fg': t.bubbleCharFg,
    '--outside-bg':    t.outsideBg,
    '--bg-pinned':     t.bgPinned,
    '--font-family':   fontStack,
    '--font-size':     `${t.fontSize}px`,
    '--radius-md':     `${t.radius}px`,
    '--radius-lg':     `${Math.round(t.radius * 1.6)}px`,
    // Chat-bg overlay strength: 0 = no overlay (chatBackground fully visible),
    // 1 = full bg-color overlay (image hidden). transparency 0..100 maps directly.
    '--chat-bg-overlay': String((t.effects.transparency || 0) / 100),
    '--gradient-from': t.bg,
    '--gradient-to':   t.effects.gradientTo,
  };
  for (const [k, v] of Object.entries(map)) r.style.setProperty(k, v);

  // Gate-style attributes for effect rules. Empty string removes the attribute.
  const body = document.body;
  body.dataset.notch        = t.notch ? 'on' : 'off';
  body.dataset.fxGlass      = t.effects.glass || 'none';
  body.dataset.fxGradient   = t.effects.gradient ? 'on' : 'off';
  body.dataset.fxTexture    = t.effects.texture || 'none';
  body.dataset.fxTransparent = (t.effects.transparency || 0) > 0 ? 'on' : 'off';
  // Keep the old "theme" attribute around for any legacy CSS rules.
  body.dataset.theme = t.notch ? 'notch' : 'default';
}

function resolveFontStack(t) {
  if (t.fontFamily === 'custom') {
    const fam = (t.customFontFamily || '').trim();
    if (fam) return fam;  // user-supplied raw CSS font-family value
  }
  const found = FONT_OPTIONS.find(f => f.id === t.fontFamily);
  return found?.stack || FONT_OPTIONS[0].stack;
}

// Add or replace the <link> that loads the user's custom font import URL.
// Removes the link when URL is empty. Safe to call repeatedly.
const CUSTOM_FONT_LINK_ID = 'custom-font-import';
function applyCustomFontImport(url) {
  const existing = document.getElementById(CUSTOM_FONT_LINK_ID);
  const trimmed = String(url || '').trim();
  if (!trimmed) {
    if (existing) existing.remove();
    return;
  }
  if (existing && existing.href === trimmed) return;  // already set
  if (existing) {
    existing.href = trimmed;
    return;
  }
  const link = document.createElement('link');
  link.id   = CUSTOM_FONT_LINK_ID;
  link.rel  = 'stylesheet';
  link.href = trimmed;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}
