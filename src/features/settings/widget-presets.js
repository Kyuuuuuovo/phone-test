// Widget 全局风格 preset — 一键覆盖所有 home widget 的色 / 圆角 / 透明度 /
// 倾斜。preset 数据是常量,user 选一个 → confirm → batch update IDB
// homeWidgets。已 customize 的 widget 也会被覆盖(reset 到 preset 值);要
// 局部不一样的 widget,user 单独走 widget editor 改。
//
// schema:每个 preset = { id, label, hint, sample: {bg, radius}, override }
//   - sample: 在 UI 上画一个小方块预览的颜色 / 圆角(纯展示)
//   - override: 真的写入 widget 的字段 — bgColor (CSS hsl string | null) /
//               radius (px) / transparency (0-100) / tilt (deg)
//
// 「默认」preset 的 bgColor 是 null = 走主题默认(--surface),其它字段也
// 用主题 default(radius var(--radius-lg)、transparency 100、tilt 0)。
// 设置一个 widget.bgColor=null 等同清掉 inline --widget-bg。

import * as db from '../../core/db.js';
import { openConfirm, openAlert } from '../../core/modal.js';

const PRESETS = [
  {
    id: 'default',
    label: '默认',
    hint: '清掉自定义,跟着主题走',
    sample: { bg: 'var(--surface)', radius: 16 },
    override: { bgColor: null, radius: 16, transparency: 100, tilt: 0 },
  },
  {
    id: 'minimal',
    label: '极简',
    hint: '透明感强,小圆角',
    sample: { bg: 'rgba(255,255,255,0.4)', radius: 8 },
    override: { bgColor: null, radius: 8, transparency: 78, tilt: 0 },
  },
  {
    id: 'skeuomorph',
    label: '拟物',
    hint: '暖白卡片,大圆角,完全不透明',
    sample: { bg: 'hsl(38, 25%, 96%)', radius: 22 },
    override: { bgColor: 'hsl(38, 25%, 96%)', radius: 22, transparency: 100, tilt: 0 },
  },
  {
    id: 'soft-pink',
    label: '柔和粉',
    hint: '浅粉色背景,圆角适中',
    sample: { bg: 'hsl(340, 55%, 92%)', radius: 18 },
    override: { bgColor: 'hsl(340, 55%, 92%)', radius: 18, transparency: 96, tilt: 0 },
  },
  {
    id: 'dark-glass',
    label: '深色玻璃',
    hint: '深色半透,中圆角',
    sample: { bg: 'hsl(220, 18%, 18%)', radius: 14 },
    override: { bgColor: 'hsl(220, 18%, 18%)', radius: 14, transparency: 80, tilt: 0 },
  },
  {
    id: 'y2k',
    label: 'Y2K 蓝',
    hint: '复古蓝,小圆角,微微歪',
    sample: { bg: 'hsl(220, 75%, 78%)', radius: 6 },
    override: { bgColor: 'hsl(220, 75%, 78%)', radius: 6, transparency: 92, tilt: -3 },
  },
];

function escHtml(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}

export async function mountWidgetPresets(container, params, router) {
  function render() {
    container.innerHTML = `
      <div class="page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">widget 风格</div>
        </header>
        <div class="page-body">
          <div class="settings-hint">点一个风格 → 确认 → 套用到所有桌面装饰。已经手动改过的 widget 也会被覆盖。想给单个 widget 不一样,套完之后单独走 widget 编辑器调。</div>
          <div class="widget-preset-grid">
            ${PRESETS.map(p => `
              <button class="widget-preset-card" data-preset-id="${escHtml(p.id)}">
                <div class="widget-preset-swatch" style="background: ${p.sample.bg}; border-radius: ${p.sample.radius}px;"></div>
                <div class="widget-preset-label">${escHtml(p.label)}</div>
                <div class="widget-preset-hint">${escHtml(p.hint)}</div>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  render();

  async function applyPreset(presetId) {
    const preset = PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    const widgets = await db.getAll('homeWidgets');
    if (widgets.length === 0) {
      await openAlert(container, { title: '桌面还没装饰', message: '先加几个 widget,再来套风格。' });
      return;
    }
    const ok = await openConfirm(container, {
      title: `套用「${preset.label}」`,
      message: `会覆盖现有 ${widgets.length} 个 widget 的颜色 / 圆角 / 透明度 / 倾斜。继续?`,
      confirmLabel: '套用',
    });
    if (!ok) return;
    // Batch update — 写入 preset.override 的字段。bgColor 为 null 时显式
    // delete 字段而不是写 null(null 跟 undefined 在 home.js gridStyle 检查
    // 时行为一样,但 IDB 里少存一个 key 干净)。
    for (const w of widgets) {
      const ov = preset.override;
      if (ov.bgColor === null) delete w.bgColor;
      else w.bgColor = ov.bgColor;
      w.radius = ov.radius;
      w.transparency = ov.transparency;
      if (ov.tilt === 0) delete w.tilt;
      else w.tilt = ov.tilt;
      await db.set('homeWidgets', w);
    }
    await openAlert(container, {
      title: '套用完成',
      message: `${widgets.length} 个 widget 都套上了「${preset.label}」。回桌面看效果。`,
    });
  }

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    const card = e.target.closest('.widget-preset-card');
    if (!card) return;
    await applyPreset(card.dataset.presetId);
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}
