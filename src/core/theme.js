// Theme model — a single active theme stored in settings.theme.
// Live preview works by writing CSS variables onto document.documentElement
// (cascades to every component) and setting data-* attributes on body for
// the gate-style effects (glass / gradient / texture).
//
// Legacy: settings.theme was a string ('default' / 'notch'). normalizeTheme()
// upgrades it to the object shape on read; the editor writes objects back.

// 字体库。每条带可选 importUrl(Google Fonts CSS2 endpoint),applyTheme 会
// 自动 reconcile <link> 元素,user 选到这条字体就懒加载,不选不下载。
// 系统已有的字体(serif / rounded / kaiti)不需要 importUrl。custom 用户自填。
export const FONT_OPTIONS = [
  { id: 'system',  label: '系统默认',  stack: `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif` },
  { id: 'serif',   label: '宋体 / 衬线', stack: `"Songti SC", "SimSun", "Noto Serif SC", Georgia, serif` },
  { id: 'crimson', label: 'Crimson × 思源宋体', stack: `"Crimson Pro", "Noto Serif SC", "Songti SC", Georgia, serif`,
    importUrl: 'https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;1,400;1,600&family=Noto+Serif+SC:wght@400;600&display=swap' },
  { id: 'rounded', label: '圆体',       stack: `"Hiragino Sans GB", "PingFang SC", "Microsoft YaHei", "Source Han Sans CN", system-ui, sans-serif` },
  { id: 'kaiti',   label: '楷体',       stack: `"Kaiti SC", "STKaiti", "KaiTi", serif` },
  { id: 'mono',    label: '等宽',       stack: `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`,
    importUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap' },
  // 萌系中文 — Google Fonts 提供,系统不一定装。importUrl 自动拉。
  { id: 'zcool-kuaile', label: '站酷快乐体(萌系)', stack: `"ZCOOL KuaiLe", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif`,
    importUrl: 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap' },
  { id: 'ma-shan-zheng', label: '马善政(手写)', stack: `"Ma Shan Zheng", "Kaiti SC", "STKaiti", cursive`,
    importUrl: 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap' },
  { id: 'long-cang', label: '龙藏(行书)', stack: `"Long Cang", "Kaiti SC", "STKaiti", cursive`,
    importUrl: 'https://fonts.googleapis.com/css2?family=Long+Cang&display=swap' },
  // 花体英文 — 西文专用,中文会 fallback 到系统字体(stack 末尾)
  { id: 'dancing-script', label: 'Dancing Script(花体英)', stack: `"Dancing Script", "PingFang SC", "Microsoft YaHei", cursive`,
    importUrl: 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;600&display=swap' },
  { id: 'great-vibes', label: 'Great Vibes(优雅花体)', stack: `"Great Vibes", "PingFang SC", "Microsoft YaHei", cursive`,
    importUrl: 'https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap' },
  { id: 'caveat', label: 'Caveat(随性手写)', stack: `"Caveat", "PingFang SC", "Microsoft YaHei", cursive`,
    importUrl: 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;600&display=swap' },
  { id: 'custom',  label: '自定义(中英双导)', stack: null },  // 用 customFontFamilyCn/En + URL
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

// T5: 默认主题从 iOS 蓝调成黑白灰 — 跟「黑白灰」preset 同一组色 + glass: none。
// 旧用户的 settings.theme 已经写到 IDB,不会被改;只影响新用户 / clear-data 后。
export const DEFAULT_THEME = Object.freeze({
  notch: false,
  bg:           '#F4F4F5',
  fg:           '#1A1A1A',
  surface:      '#FFFFFF',
  accent:       '#3A3A3A',
  muted:        '#8A8A8A',
  border:       '#D6D6D6',
  bubbleUser:   '#2C2C2C',
  bubbleUserFg: '#F5F5F5',
  bubbleChar:   '#ECECEC',
  bubbleCharFg: '#1A1A1A',
  outsideBg:    '#D6D6D6',
  bgPinned:     '#EDEDED',
  fontFamily:   'system',
  fontSize:     15,
  // 自定义字体:fontFamily === 'custom' 时生效,中文 / 英文各一对(family +
  // import URL)。stack 拼 `En, Cn, system-fallback` — 英文字体优先匹配 ASCII,
  // 中文字符 fallback 到中文字体。两边 URL 各自一个 <link>。
  customFontFamilyCn:    '',
  customFontImportUrlCn: '',
  customFontFamilyEn:    '',
  customFontImportUrlEn: '',
  // Legacy(旧版只支持一种自定义)— normalizeTheme 会把它迁移到 Cn 字段。
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
  // Legacy 单字段 → 中文字段(老用户改了 customFontFamily 不能丢)。仅在 Cn
  // 字段为空时迁,避免覆盖已经填好的新字段。
  if (!merged.customFontFamilyCn && merged.customFontFamily) {
    merged.customFontFamilyCn = merged.customFontFamily;
  }
  if (!merged.customFontImportUrlCn && merged.customFontImportUrl) {
    merged.customFontImportUrlCn = merged.customFontImportUrl;
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
// 12 套预设。原 13 → 12:删「默认 iOS 蓝」(跟黑白灰逐字节重复)+ 删
// 「黑白灰」(并进素白)。名字全两字。3 套改色(夜紫→浅紫、深青→荷紫、
// 暖琥珀→琥珀),1 套新增(浅荷)。配色对照 docs / presets-all.html demo。
//
// id 命名:历史 id 保留不动(向后兼容,user 自定义 preset 不会撞);改色的
// 套也保留旧 id(night-violet / deep-teal / warm-amber)避免老 settings 引用
// 失效。新增"浅荷"用 light-mint。
export const THEME_PRESETS = [
  // 素白 — 灰白通透玻璃,鼓励 user 自配浅色壁纸,白瓷玻璃浮在风景上的感觉。
  //   原黑白灰 preset 已经并进来(配色范围一致),mono 删了。
  {
    id: 'misty-white',
    label: '素白',
    theme: {
      notch: false,
      bg:           '#F4F4F2',
      fg:           '#3A3A38',
      surface:      '#FFFFFF',
      accent:       '#6B6B68',
      muted:        '#9A9A95',
      border:       '#E0DFDB',
      bubbleUser:   '#3A3A38',
      bubbleUserFg: '#F4F4F2',
      bubbleChar:   'rgba(255,255,255,0.55)',
      bubbleCharFg: '#3A3A38',
      outsideBg:    '#D8D8D4',
      bgPinned:     '#EFEEEB',
      fontFamily:   'rounded',
      fontSize:     15,
      radius:       22,
      effects: {
        glass:          'liquid',
        glassIntensity: 90,
        gradient:       false,
        gradientTo:     '#EFEEEB',
        texture:        'none',
        transparency:   0,
        surfaceAlpha:   75,
      },
    },
  },
  // 墨黑 — 唯一暗色中性预设。原 "黑色" 改名;surface 从 #1C1C1E 调到
  //   demo 的卡色 #2C2C2E 让对方气泡跟 card 同色。
  {
    id: 'dark',
    label: '墨黑',
    theme: {
      notch: false,
      bg:           '#0F0F12',
      fg:           '#F5F5F7',
      surface:      '#2C2C2E',
      accent:       '#0A84FF',
      muted:        '#98989D',
      border:       '#38383A',
      bubbleUser:   '#0A84FF',
      bubbleUserFg: '#FFFFFF',
      bubbleChar:   'rgba(44,44,46,0.6)',
      bubbleCharFg: '#F5F5F7',
      outsideBg:    '#000000',
      bgPinned:     '#2C2C2E',
      fontFamily: 'system',
      fontSize:   15,
      radius:     12,
      effects: { glass: 'liquid', glassIntensity: 80, gradient: false, gradientTo: '#1C1C1E', texture: 'none', transparency: 0, surfaceAlpha: 0 },
    },
  },
  // 黛蓝 — 原 "蓝灰衬线",label 两字化。bubbleChar 改 rgba(255,255,255,0.62)
  //   匹配 demo 玻璃感。
  {
    id: 'blue-grey-serif',
    label: '黛蓝',
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
      bubbleChar:   'rgba(255,255,255,0.62)',
      bubbleCharFg: '#171A21',
      outsideBg:    '#E0E6EE',
      bgPinned:     '#F5F8FC',
      fontFamily:   'crimson',
      fontSize:     18,
      radius:       4,
      effects: { glass: 'frosted', gradient: false, gradientTo: '#cce4ff', texture: 'none', transparency: 0 },
    },
  },
  // 嫩粉 — 原 "嫩粉液态金属",label 两字化。配色不变(玫瑰金液态金属)。
  {
    id: 'pink-metal',
    label: '嫩粉',
    theme: {
      notch: false,
      ...PINK_PALETTE,
      fontFamily: 'rounded',
      fontSize:   15,
      radius:     18,
      effects: { glass: 'metal', gradient: true, gradientTo: '#FCE6EE', texture: 'none', transparency: 0 },
    },
  },
  // ────────────────────────────────────────────────────────────────────
  // 雾屿系列(Glass · Ink)— 玻璃感对方气泡 + 墨蓝用户。雪夜深 / 晨雾浅
  // 两个变体共用同一气泡逻辑,壁纸由 character.chatBackground 决定,主题
  // 本身只负责气泡和文字反差关系。
  //
  // ⚠ caveat:bubbleChar 用 rgba(...) 字符串。CSS 端 var(--bubble-char)
  // 完全 OK,但设置 → 外观 → 颜色 tab 的 `<input type="color">` 读 rgba
  // 时会退化成近似 hex(浏览器实现限制),用户去看一眼就"丢透明",改完
  // 保存就真丢。未来 polish:把 bubble alpha 抽成单独 effects.bubbleCharAlpha
  // 滑条,跟现有 surfaceAlpha 同模式,色 picker 仍存 hex。
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'glass-ink-night',
    label: '雪夜',
    theme: {
      notch: false,
      bg:           '#1A1A1F',
      fg:           '#ECECEC',
      surface:      '#16161A',
      accent:       '#3A4A6E',          // 比 user 气泡稍亮一档,做按钮/链接
      muted:        '#888890',
      border:       '#2A2A30',
      bubbleUser:   '#1F2A44',          // 墨蓝
      bubbleUserFg: '#E8EBF2',
      bubbleChar:   'rgba(40,40,46,0.55)',
      bubbleCharFg: '#ECECEC',
      outsideBg:    '#0B0B0E',
      bgPinned:     '#22222A',
      fontFamily:   'system',
      fontSize:     15,
      radius:       18,
      effects: {
        glass:          'liquid',
        glassIntensity: 85,              // backdrop blur 强一点
        gradient:       false,
        gradientTo:     '#0E0E12',
        texture:        'none',
        transparency:   0,
        surfaceAlpha:   70,              // 壁纸透出,让玻璃站得住
      },
    },
  },
  {
    id: 'glass-ink-dawn',
    label: '晨雾',
    theme: {
      notch: false,
      bg:           '#E8E6E2',
      fg:           '#1A1A1F',
      surface:      '#F5F3EE',
      accent:       '#1F2A44',
      muted:        '#7A7A7E',
      border:       '#D0CEC8',
      bubbleUser:   '#1F2A44',          // 墨蓝继承(主体不变)
      bubbleUserFg: '#E8EBF2',
      bubbleChar:   'rgba(255,255,255,0.55)',
      bubbleCharFg: '#1A1A1F',
      outsideBg:    '#C4C2BC',
      bgPinned:     '#EFEDE8',
      fontFamily:   'system',
      fontSize:     15,
      radius:       18,
      effects: {
        glass:          'liquid',
        glassIntensity: 75,
        gradient:       false,
        gradientTo:     '#F0EEE8',
        texture:        'none',
        transparency:   0,
        surfaceAlpha:   60,
      },
    },
  },
  // ────────────────────────────────────────────────────────────────────
  // 缄默系列(Script · Mono)— 花体衬线 + 黑白灰。Cormorant Garamond
  // italic 西文 + 真宋体中文 fallback(系统不会伪斜)。旧信亮 / 夜读暗
  // 两个变体,夜读把 user 气泡反成米白(身份反转,"我在深夜读 ta 的信")。
  //
  // 字体加载:fontFamily: 'custom' 触发 theme.js 的 applyCustomFontImport
  // 写一个 <link>。Google Fonts 首次 200-500ms FOUT,index.html 已有
  // preconnect to fonts.gstatic.com 不需要再加。
  //
  // 中文伪斜兜底:base.css 已加 `.bubble :lang(zh) { font-style: normal }`
  // 防个别浏览器对中文 fallback 强加 italic。
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'script-letter',
    label: '旧信',
    theme: {
      notch: false,
      bg:           '#ECE9E2',
      fg:           '#1A1A1A',
      surface:      '#F6F4ED',
      accent:       '#2C2C2C',
      muted:        '#8A8A85',
      border:       '#D6D2C8',
      bubbleUser:   '#2A2A2A',
      bubbleUserFg: '#F5F2EA',
      bubbleChar:   '#F0EDE4',
      bubbleCharFg: '#1A1A1A',
      outsideBg:    '#BFBAAE',
      bgPinned:     '#E5E0D2',
      fontFamily:   'custom',
      customFontFamily:    `"Cormorant Garamond", "Songti SC", "Noto Serif SC", "SimSun", Georgia, serif`,
      customFontImportUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&display=swap',
      fontSize:     16,
      radius:       6,                   // 小圆角 — 像信纸折角
      effects: {
        glass:          'none',
        glassIntensity: 100,
        gradient:       false,
        gradientTo:     '#E5E0D2',
        texture:        'none',          // 想要纸纹的话改成 'dots',强度低
        transparency:   0,
        surfaceAlpha:   0,
      },
    },
  },
  {
    id: 'script-night',
    label: '夜读',
    theme: {
      notch: false,
      bg:           '#15130F',
      fg:           '#E8E2D2',
      surface:      '#1E1B16',
      accent:       '#D4B98C',           // 老纸黄,做按钮/链接/标题
      muted:        '#7A7468',
      border:       '#2A2620',
      bubbleUser:   '#E8E2D2',           // 反转 — user 是亮的
      bubbleUserFg: '#15130F',
      bubbleChar:   '#28231C',           // 深褐墨
      bubbleCharFg: '#D4B98C',           // 老纸黄字 — 比白文字更有"读旧信"的暖
      outsideBg:    '#08070A',
      bgPinned:     '#22201A',
      fontFamily:   'custom',
      customFontFamily:    `"Cormorant Garamond", "Songti SC", "Noto Serif SC", "SimSun", Georgia, serif`,
      customFontImportUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&display=swap',
      fontSize:     16,
      radius:       6,
      effects: {
        glass:          'none',
        glassIntensity: 100,
        gradient:       false,
        gradientTo:     '#1E1B16',
        texture:        'none',
        transparency:   0,
        surfaceAlpha:   0,
      },
    },
  },
  // ────────────────────────────────────────────────────────────────────
  // 浅色三套 + 荷紫渐变 — demo 重做后的轻盈版本。
  //   浅荷:新增,light mint。
  //   浅紫:由原"夜紫"改色 — 去荧光 / 转浅柔(底色从深紫黑变浅紫白)。
  //   荷紫:由原"深青"改色 — 薄荷→紫渐变气泡,主屏渐变 bg。
  //   琥珀:由原"暖琥珀"调通透 — 底色更亮,主色降饱和。
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'light-mint',
    label: '浅荷',
    theme: {
      notch: false,
      bg:           '#E9F5F2',
      fg:           '#243634',
      surface:      '#FFFFFF',
      accent:       '#84B8B1',
      muted:        '#7FA7A1',
      border:       '#B4DED6',
      bubbleUser:   '#84B8B1',
      bubbleUserFg: '#F5FBFA',
      bubbleChar:   'rgba(255,255,255,0.6)',
      bubbleCharFg: '#243634',
      outsideBg:    '#C8E8E0',
      bgPinned:     '#DCEFEA',
      fontFamily:   'system',
      fontSize:     15,
      radius:       16,
      effects: {
        glass:          'liquid',
        glassIntensity: 75,
        gradient:       false,
        gradientTo:     '#DCEFEA',
        texture:        'none',
        transparency:   0,
        surfaceAlpha:   60,
      },
    },
  },
  // 浅紫 — 原 night-violet 改色。从深紫黑改成浅紫白系,去荧光紫,转浅柔
  //   (#A6A3C7 取代 #9A86D6,底色从 #1A1232 变 #F0EEF8)。id 不动向后兼容。
  {
    id: 'night-violet',
    label: '浅紫',
    theme: {
      notch: false,
      bg:           '#F0EEF8',
      fg:           '#2F2C3E',
      surface:      '#FFFFFF',
      accent:       '#A6A3C7',
      muted:        '#9A97B2',
      border:       '#D2CEEA',
      bubbleUser:   '#A6A3C7',
      bubbleUserFg: '#FBFAFF',
      bubbleChar:   'rgba(255,255,255,0.6)',
      bubbleCharFg: '#2F2C3E',
      outsideBg:    '#D2CEEA',
      bgPinned:     '#E7E4F3',
      fontFamily:   'system',
      fontSize:     15,
      radius:       16,
      effects: {
        glass:          'liquid',
        glassIntensity: 75,
        gradient:       false,
        gradientTo:     '#E7E4F3',
        texture:        'none',
        transparency:   0,
        surfaceAlpha:   60,
      },
    },
  },
  // 荷紫 — 原 deep-teal 改色。从深青墨绿改成薄荷→紫渐变系。气泡用渐变是
  //   demo 的精髓 — bubbleUser 是 linear-gradient CSS 字符串(base.css 用
  //   `background: var(--bubble-user)` shorthand 接 gradient,渲染没问题)。
  //   主屏 bg 也设 gradient(effects.gradient=true + gradientTo 紫端)。
  {
    id: 'deep-teal',
    label: '荷紫',
    theme: {
      notch: false,
      bg:           '#E7F4F0',
      fg:           '#2B3340',
      surface:      '#FFFFFF',
      accent:       '#8FA6C8',
      muted:        '#8B96A4',
      border:       '#C6D4E4',
      bubbleUser:   'linear-gradient(135deg,#8EC6BD 0%,#A6A3C7 100%)',
      bubbleUserFg: '#FCFCFF',
      bubbleChar:   'rgba(255,255,255,0.58)',
      bubbleCharFg: '#2B3340',
      outsideBg:    '#C8DBD6',
      bgPinned:     '#ECEDF6',
      fontFamily:   'system',
      fontSize:     15,
      radius:       14,
      effects: {
        glass:          'liquid',
        glassIntensity: 75,
        gradient:       true,
        gradientTo:     '#ECE8F6',           // 屏底紫端,跟气泡渐变同源
        texture:        'none',
        transparency:   0,
        surfaceAlpha:   58,
      },
    },
  },
  // 琥珀 — 原 warm-amber 调通透。底/卡都调到 demo 给的更亮档(#FFF8EC /
  //   #FFF7E6),accent 从 #E89A38 降饱和到 #DDA863(更耐看),border 同步
  //   #F0E0BE。改用 liquid 玻璃 + 60% surfaceAlpha 让光透感出来(原 'none'
  //   纯色看着闷),保留 rounded font + 22 radius 复古海报糖块感。
  {
    id: 'warm-amber',
    label: '琥珀',
    theme: {
      notch: false,
      bg:           '#FFF8EC',
      fg:           '#3A2A18',
      surface:      '#FFF7E6',
      accent:       '#DDA863',
      muted:        '#A8927A',
      border:       '#F0E0BE',
      bubbleUser:   '#DDA863',
      bubbleUserFg: '#FFFCF4',
      bubbleChar:   'rgba(255,247,230,0.66)',
      bubbleCharFg: '#3A2A18',
      outsideBg:    '#E8D8B0',
      bgPinned:     '#FFF0CC',
      fontFamily:   'rounded',
      fontSize:     15,
      radius:       22,
      effects: {
        glass:          'liquid',
        glassIntensity: 70,
        gradient:       false,
        gradientTo:     '#FBEED0',
        texture:        'none',
        transparency:   0,
        surfaceAlpha:   60,
      },
    },
  },
];

export function applyTheme(theme) {
  const t = normalizeTheme(theme);
  reconcileFontImports(t);
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
  // 单色主题检测 — accent RGB 三通道差 < 24 时算"灰系",CSS 可用
  // `body[data-mono="1"]` 关掉 / 灰化那些硬编码鲜艳颜色(tag chip / planner
  // 纸胶带 等),避免在 黑白灰 / 素白 这种主题上违和。
  if (isMonochromeColor(t.accent)) {
    body.dataset.mono = '1';
  } else {
    delete body.dataset.mono;
  }
}

function isMonochromeColor(hex) {
  const m = String(hex || '').match(/^#([0-9a-f]{6})$/i);
  if (!m) return false;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return (Math.max(r, g, b) - Math.min(r, g, b)) < 24;
}

function resolveFontStack(t) {
  if (t.fontFamily === 'custom') {
    // 拼 stack:英文字体优先(ASCII 匹配),中文 fallback(浏览器 unicode-range
    // 自动从 En 跳到 Cn),最后兜底系统中文。两侧家族名要加引号防"My Font"
    // 这种带空格的拆掉。
    // T34: user 可能把整段 stack 贴进单字段(`"MaoKen (beta)", sans-serif`),
    //   只取第一个 family — hint 已写"单个,不要逗号"但 user 误填很常见,
    //   sanitize 比报错友好。
    const en = sanitizeFamilyInput(t.customFontFamilyEn);
    const cn = sanitizeFamilyInput(t.customFontFamilyCn);
    // Legacy 单字段:如果用户老配置只填了 customFontFamily,normalizeTheme 已
    // 把它迁进 Cn,所以这里不重复处理。
    const parts = [];
    if (en) parts.push(quoteIfNeeded(en));
    if (cn) parts.push(quoteIfNeeded(cn));
    parts.push('-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif');
    return parts.length > 6 ? parts.join(', ') : FONT_OPTIONS[0].stack;
  }
  const found = FONT_OPTIONS.find(f => f.id === t.fontFamily);
  return found?.stack || FONT_OPTIONS[0].stack;
}

// T34: 容错处理 user 在 family 字段贴整段 stack 的情况。规范是单 family,
//   但 user 经常误填 `"MaoKen (beta)", sans-serif` 这种把 fallback 一起贴进来。
//   按逗号切,只取第一个 token,strip 首尾引号供下游处理。
function sanitizeFamilyInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const first = s.split(',')[0].trim();
  // 去外层引号(quoteIfNeeded 会按需重新加)
  if (/^["'].*["']$/.test(first)) return first.slice(1, -1).trim();
  return first;
}

// 给可能带空格的 family name 加引号(`My Font` → `"My Font"`)。如果已带
// 引号或本身就一个单词,原样返回。CSS font-family 标识符规则:不带引号的
// 必须是 ident,带空格 / 数字开头 / 包含 ! 等都要引号。
function quoteIfNeeded(name) {
  const trimmed = name.trim();
  if (!trimmed) return '';
  // 已经带引号
  if (/^["'].*["']$/.test(trimmed)) return trimmed;
  // 多 token / 含非 ident 字符 → 引号包
  if (/[^A-Za-z0-9_\-一-鿿]/.test(trimmed) || /^[0-9]/.test(trimmed)) {
    return `"${trimmed.replace(/"/g, '\\"')}"`;
  }
  return trimmed;
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

// 字体 <link> 多元素 reconciler。每个 import URL 一个 <link>,id 是 prefix +
// key,用 key 标识来源(`preset-zcool-kuaile`、`custom-cn`、`custom-en`)。
// reconcile 时:把当前主题需要的 URL 集合算出来 → 加缺的 <link>,删多的。
// 这样切预设字体 → 老 link 自动清掉,不会污染 head。
const FONT_LINK_PREFIX = 'font-import-';
function ensureFontLink(key, url) {
  const id = `${FONT_LINK_PREFIX}${key}`;
  const existing = document.getElementById(id);
  const trimmed = String(url || '').trim();
  if (!trimmed) {
    if (existing) existing.remove();
    return;
  }
  if (existing) {
    if (existing.href !== trimmed) existing.href = trimmed;
    return;
  }
  const link = document.createElement('link');
  link.id   = id;
  link.rel  = 'stylesheet';
  link.href = trimmed;
  // T34: 删 crossOrigin='anonymous' — 第三方字体 CDN(zeoseven 等)不一定
  //   配 CORS,加这个 attr 浏览器会要求 Access-Control-Allow-Origin header
  //   不通过就拒绝整个 stylesheet,字体直接不显示。stylesheet `<link>` 加载
  //   字体根本不需要 anonymous CORS — Google Fonts 没这个 attr 也能正常工作。
  //   原因:user 反馈"字体自定义无效"的回归就是这个 attr 阻止加载。
  document.head.appendChild(link);
}
function reconcileFontImports(t) {
  const keep = new Set();
  if (t.fontFamily === 'custom') {
    if (t.customFontImportUrlCn) { ensureFontLink('custom-cn', t.customFontImportUrlCn); keep.add('custom-cn'); }
    if (t.customFontImportUrlEn) { ensureFontLink('custom-en', t.customFontImportUrlEn); keep.add('custom-en'); }
  } else {
    const opt = FONT_OPTIONS.find(f => f.id === t.fontFamily);
    if (opt?.importUrl) { ensureFontLink(`preset-${opt.id}`, opt.importUrl); keep.add(`preset-${opt.id}`); }
  }
  // 清掉不在 keep 集合里的(切了字体 / 关了 custom 留下的 stale link)
  document.querySelectorAll(`link[id^="${FONT_LINK_PREFIX}"]`).forEach(el => {
    const key = el.id.slice(FONT_LINK_PREFIX.length);
    if (!keep.has(key)) el.remove();
  });
}
