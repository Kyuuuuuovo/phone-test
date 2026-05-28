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
export const THEME_PRESETS = [
  // 「素白」放最前 — 灰白通透玻璃,鼓励 user 自配浅色壁纸,呈现"白瓷玻璃
  // 浮在风景上"的感觉。bubbleChar 用 rgba 留 alpha(同雾屿系列的 caveat,
  // 色 picker 读 rgba 退化成 hex)。
  {
    id: 'misty-white',
    label: '素白',
    theme: {
      notch: false,
      bg:           '#F4F4F2',
      fg:           '#3A3A38',           // 中灰,不是纯黑 — 整体柔
      surface:      '#FFFFFF',
      accent:       '#6B6B68',           // 石墨灰,不抢色
      muted:        '#9A9A95',
      border:       '#E0DFDB',
      bubbleUser:   '#3A3A38',           // 用户气泡用 fg 色,深灰
      bubbleUserFg: '#F4F4F2',
      bubbleChar:   'rgba(255,255,255,0.5)',  // 半透明白,壁纸透出来
      bubbleCharFg: '#3A3A38',
      outsideBg:    '#D8D8D4',
      bgPinned:     '#EFEEEB',
      fontFamily:   'rounded',
      fontSize:     15,
      radius:       22,                  // 圆润,跟柔光感配
      effects: {
        glass:          'liquid',
        glassIntensity: 90,              // 强玻璃,反射 + 模糊明显
        gradient:       false,
        gradientTo:     '#EFEEEB',
        texture:        'none',
        transparency:   0,
        surfaceAlpha:   75,              // page 大幅透出 — 壁纸是这套的灵魂
      },
    },
  },
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
    id: 'mono',
    label: '黑白灰',
    theme: {
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
      radius:       10,
      // glass: 'none' 避免 frosted/liquid/metal 出彩色高光 — 黑白灰要纯粹。
      effects: { glass: 'none', gradient: false, gradientTo: '#E8E8E8', texture: 'none', transparency: 0 },
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
    label: '雾屿 · 雪夜',
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
    label: '雾屿 · 晨雾',
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
    label: '缄默 · 旧信',
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
    label: '缄默 · 夜读',
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
  // 三色补全(紫 / 青 / 黄)— user 反馈:仓库没有独立的紫青色调,黄色只有
  // 「缄默 · 夜读」的辅助老纸黄。每套自带不同 radius / glass / texture 气质,
  // 避免新预设视觉过于雷同。月相 v3 走 --accent 推导,这三套切到 cosmic
  // 风格会自然呈现紫月 / 青月 / 黄月。
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'night-violet',
    label: '夜紫',
    theme: {
      notch: false,
      bg:           '#1A1232',           // 深紫底,跟 cosmic 风格深紫黑同源
      fg:           '#ECE6D8',           // 米白文字
      surface:      '#2A1F4A',           // 深紫卡,比 bg 稍亮
      accent:       '#9A86D6',           // 柔紫(月光紫)— 不刺眼
      muted:        '#8C80A8',
      border:       '#38305A',
      bubbleUser:   '#9A86D6',
      bubbleUserFg: '#FFFFFF',
      bubbleChar:   'rgba(255,255,255,0.07)',
      bubbleCharFg: '#ECE6D8',
      outsideBg:    '#0D0A1E',
      bgPinned:     '#2F2655',
      fontFamily:   'system',
      fontSize:     15,
      radius:       16,                  // 柔圆 — 夜晚的圆润感
      effects: {
        glass:          'liquid',         // 紫底 + liquid 玻璃 = 夜色质感
        glassIntensity: 80,
        gradient:       false,
        gradientTo:     '#2F2655',
        texture:        'noise',           // 细微噪点 = 星空像素粒
        transparency:   0,
        surfaceAlpha:   65,
      },
    },
  },
  {
    id: 'deep-teal',
    label: '深青',
    theme: {
      notch: false,
      bg:           '#0E2A30',           // 深青墨绿
      fg:           '#D8E8E0',           // 柔白米绿
      surface:      '#143840',           // 深青卡
      accent:       '#6EE0C8',           // 明青绿(发光生物色)
      muted:        '#7A9890',
      border:       '#1F4A52',
      bubbleUser:   '#6EE0C8',
      bubbleUserFg: '#0E2A30',           // 深底深字反差 — 沉静感
      bubbleChar:   '#1B454D',
      bubbleCharFg: '#D8E8E0',
      outsideBg:    '#051A20',
      bgPinned:     '#1A4048',
      fontFamily:   'system',
      fontSize:     15,
      radius:       4,                   // 硬朗几何感(跟柔紫对比)
      effects: {
        glass:          'frosted',        // 毛玻璃 — 比 liquid 收敛
        glassIntensity: 70,
        gradient:       false,
        gradientTo:     '#1A4048',
        texture:        'lines',           // 斜纹 = 深海纹理
        transparency:   0,
        surfaceAlpha:   55,
      },
    },
  },
  {
    id: 'warm-amber',
    label: '暖琥珀',
    theme: {
      notch: false,
      bg:           '#FFF7E8',           // 柔奶黄
      fg:           '#3A2A18',           // 深咖文字
      surface:      '#FFFCF4',           // 米白卡
      accent:       '#E89A38',           // 温琥珀橙黄
      muted:        '#A8927A',
      border:       '#F0DBB0',
      bubbleUser:   '#E89A38',
      bubbleUserFg: '#FFFCF4',
      bubbleChar:   '#FFEFCC',
      bubbleCharFg: '#3A2A18',
      outsideBg:    '#E8D8B0',
      bgPinned:     '#FFF0CC',
      fontFamily:   'rounded',           // 圆体 + 大圆角 = 软糖暖意
      fontSize:     15,
      radius:       22,                  // 超圆 — 复古海报糖块感
      effects: {
        glass:          'none',           // 纯色不要玻璃,保留奶黄通透
        glassIntensity: 100,
        gradient:       false,
        gradientTo:     '#FFF0CC',
        texture:        'dots',           // 点阵 = 旧复古印刷感
        transparency:   0,
        surfaceAlpha:   0,
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
