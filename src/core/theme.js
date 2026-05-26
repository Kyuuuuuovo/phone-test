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

// Glass tier: 'none' | 'frosted' | 'liquid' | 'metal'
//   frosted — classic frosted glass: blur + semi-transparent surfaces
//   liquid  — Apple-style liquid glass: stronger blur, color-shifting saturate,
//             gradient sheen on the top edge of surfaces
//   metal   — liquid + a polished/specular feel: sharper top highlight, deeper
//             sheen, brighter saturate. Pairs well with rose-gold / chrome
//             palettes (the pink-metal preset uses it).
export const GLASS_OPTIONS = [
  { id: 'none',    label: '无' },
  { id: 'frosted', label: '毛玻璃' },
  { id: 'liquid',  label: '液态玻璃' },
  { id: 'metal',   label: '液态金属' },
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
    glass:         'none',
    glassIntensity: 100,  // 0-100, multiplies blur/saturate/brightness of the chosen tier
    gradient:      false,
    gradientTo:    '#cce4ff',
    texture:       'none',
    transparency:  0,
    surfaceAlpha:  0,     // 0-100, fade .page bg toward transparent → wallpaper shows through
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

// Color palettes for the two new presets. Kept as labeled objects rather
// than inline literals so the values stay easy to tune in one place.
//
// Dark — full iOS-style dark inversion. Surfaces get the iOS dark-gray
// stack (#1c1c1e / #2c2c2e) so secondary surfaces (bubble.char, pinned
// rows) read distinct from primary surface.
//
// Pink — soft 嫩粉 palette tuned for the 液态金属 glass tier. The metal
// effect lifts a sharp specular highlight off the surface; with a pink
// palette behind it the result reads as rose-gold chrome (which is what
// "嫩粉液态金属" maps to in real-world aesthetic terms — pink iPhones,
// rose-gold MacBooks).
const DARK_PALETTE = {
  bg:           '#0F0F12',
  fg:           '#F5F5F7',
  surface:      '#1C1C1E',
  accent:       '#0A84FF',
  muted:        '#98989D',
  border:       '#38383A',
  bubbleUser:   '#0A84FF',
  bubbleUserFg: '#FFFFFF',
  bubbleChar:   '#2C2C2E',
  bubbleCharFg: '#F5F5F7',
  outsideBg:    '#000000',
  bgPinned:     '#2C2C2E',
};

// Tender pink palette tuned down from the first pass — that version had
// FF6699 accents + saturated #FFE9F0 surfaces and the user found it
// "太粉" (overwhelmingly pink). This version moves surfaces close to
// off-white with a barely-pink wash and shifts the accent to a softer
// rose-gold (#E08AA0). The metal glass tier still adds the specular
// highlight, which now reads as polished rose-gold on near-white rather
// than chrome on hot pink.
const PINK_PALETTE = {
  bg:           '#FFF5F8',
  fg:           '#3D2530',
  surface:      '#FFFAFB',
  accent:       '#E08AA0',
  muted:        '#B89AA3',
  border:       '#F5DEE5',
  bubbleUser:   '#E08AA0',
  bubbleUserFg: '#FFFFFF',
  bubbleChar:   '#FFF1F5',
  bubbleCharFg: '#3D2530',
  outsideBg:    '#F0D7DF',
  bgPinned:     '#FFEEF4',
};

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
  {
    id: 'dark',
    label: '黑色',
    theme: {
      notch: false,
      ...DARK_PALETTE,
      fontFamily: 'system',
      fontSize:   15,
      radius:     12,
      effects: { glass: 'liquid', gradient: false, gradientTo: '#1C1C1E', texture: 'none', transparency: 0 },
    },
  },
  {
    id: 'pink-metal',
    label: '嫩粉液态金属',
    theme: {
      notch: false,
      ...PINK_PALETTE,
      fontFamily: 'rounded',
      fontSize:   15,
      radius:     18,  // softer corners for rose-gold device feel
      // Subtler gradient — fade to a barely-pinker tone rather than the
      // pronounced FFD3E0 of the first pass. Keeps the "rose-gold device"
      // mood without making the page wash visibly pink.
      effects: { glass: 'metal', gradient: true, gradientTo: '#FCE6EE', texture: 'none', transparency: 0 },
    },
  },
];

export function applyTheme(theme) {
  const t = normalizeTheme(theme);
  applyCustomFontImport(t.fontFamily === 'custom' ? t.customFontImportUrl : '');
  const r = document.documentElement;
  const fontStack = resolveFontStack(t);
  // Glass intensity defaults to 100 if missing — keeps old themes / presets
  // looking identical to before this slider existed. Normalize to 0..1 so
  // CSS rules can multiply blur/saturate/brightness by var(--glass-strength).
  const glassStrength = Math.max(0, Math.min(100, t.effects.glassIntensity ?? 100)) / 100;
  // surfaceAlpha defaults to 0 (no transparency) — same reason as above.
  // 0..1 scales how transparent .page becomes so wallpaper bleeds through.
  const surfaceAlpha   = Math.max(0, Math.min(100, t.effects.surfaceAlpha ?? 0)) / 100;
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
    '--glass-strength':       String(glassStrength),
    '--surface-alpha-shift':  String(surfaceAlpha),
  };
  for (const [k, v] of Object.entries(map)) r.style.setProperty(k, v);

  // Gate-style attributes for effect rules. Empty string removes the attribute.
  const body = document.body;
  body.dataset.notch        = t.notch ? 'on' : 'off';
  body.dataset.fxGlass      = t.effects.glass || 'none';
  // Gradient is suppressed when a wallpaper is set — they fight for the same
  // visual slot (.page background) and stacking them either hides the
  // wallpaper or muddies it. The CSS rule already requires
  // [data-fx-wallpaper="off"]; this just keeps the body attr coherent so the
  // theme editor's "is gradient currently visible" check sees the right state.
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

// Apply a wallpaper image to the .phone-frame so it shows through any
// transparent surfaces (when effects.surfaceAlpha > 0 in particular).
// Called once at boot from main.js and again whenever the user uploads
// or clears the wallpaper from the theme editor. Idempotent — passing
// null / falsy clears the wallpaper. Kept here (not in home.js) so the
// wallpaper persists across router.navigate() — previously home.js owned
// the wallpaper and cleared it on teardown, which meant non-home pages
// never showed it through.
export function applyWallpaper(url) {
  const frame = document.querySelector('.phone-frame');
  if (!frame) return;
  if (url) {
    frame.style.backgroundImage    = `url("${url}")`;
    frame.style.backgroundSize     = 'cover';
    frame.style.backgroundPosition = 'center';
  } else {
    frame.style.backgroundImage    = '';
    frame.style.backgroundSize     = '';
    frame.style.backgroundPosition = '';
  }
  // Body data attr so CSS can mutex gradient-vs-wallpaper. Gradient targets
  // .page and would otherwise cover the wallpaper (set on .phone-frame).
  document.body.dataset.fxWallpaper = url ? 'on' : 'off';
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
