// Widget 全局风格 preset — 一键覆盖所有 home widget 的色 / 圆角 / 透明度 /
// 倾斜。preset 数据分两段:BUILT_IN_PRESETS 是常量 6 个,user 自定义的存
// settings.widgetPresets[]。两段在渲染时合并,user 自定义的支持 × 删除。
//
// schema:每个 preset = { id, label, hint, sample: {bg, radius}, override }
//   - sample: 在 UI 上画一个小方块预览的颜色 / 圆角(纯展示)
//   - override: 真的写入 widget 的字段 — bgColor (CSS hsl string | null) /
//               radius (px) / transparency (0-100) / tilt (deg)
//
// 「默认」preset 的 bgColor 是 null = 走主题默认(--surface),其它字段也
// 用主题 default(radius var(--radius-lg)、transparency 100、tilt 0)。
// 设置一个 widget.bgColor=null 等同清掉 inline --widget-bg。
//
// 自定义入口:grid 最后一张「+ 自定义」卡片 → 弹 modal 让 user 调 HSV +
// 圆角 + 透明度 + 倾斜 + 起名,保存到 settings.widgetPresets。复用 home.js
// 里的 field helpers(bgColorAndRadiusFieldsHtml / transparencyFieldHtml /
// tiltFieldHtml),控件跟 widget editor 一致。

import * as db from '../../core/db.js';
import { openConfirm, openAlert } from '../../core/modal.js';
import {
  bgColorAndRadiusFieldsHtml,
  wireBgColorReadout,
  parseBgColorAndRadius,
  transparencyFieldHtml,
  wireTransparencyReadout,
  tiltFieldHtml,
  wireTiltReadout,
  parseTilt,
} from '../home/home.js';

const BUILT_IN_PRESETS = [
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

function presetCardHtml(p, isUser, selected) {
  return `
    <div class="widget-preset-card-wrap" data-preset-id="${escHtml(p.id)}">
      <button class="widget-preset-card${selected ? ' selected' : ''}" data-preset-id="${escHtml(p.id)}">
        <div class="widget-preset-swatch" style="background: ${p.sample.bg}; border-radius: ${p.sample.radius}px;"></div>
        <div class="widget-preset-label">${escHtml(p.label)}</div>
        <div class="widget-preset-hint">${escHtml(p.hint || '')}</div>
      </button>
      ${isUser ? `<button class="preset-delete" data-del-id="${escHtml(p.id)}" title="删除" aria-label="删除">×</button>` : ''}
    </div>
  `;
}

export async function mountWidgetPresets(container, params, router) {
  const settings = (await db.get('settings', 'default')) || {};
  let userPresets = Array.isArray(settings.widgetPresets) ? settings.widgetPresets : [];
  // 预览状态 — 点 preset card 后切换。null = 没选,显示默认 widget 样式。
  let previewPresetId = null;

  async function persistUserPresets() {
    await db.updateSettings(s => { s.widgetPresets = userPresets; });
  }

  function renderPreview() {
    const all = [...BUILT_IN_PRESETS, ...userPresets];
    const p = previewPresetId ? all.find(x => x.id === previewPresetId) : null;
    // 没选 → 用默认 widget 样式(走 --surface);选了 → 用 preset.override 各字段
    const bg = p?.override.bgColor || 'var(--surface)';
    const radius = (Number.isFinite(p?.override.radius) ? p.override.radius : 16) + 'px';
    const alpha = Number.isFinite(p?.override.transparency) ? p.override.transparency / 100 : 1;
    const tilt = (Number.isFinite(p?.override.tilt) ? p.override.tilt : 0) + 'deg';
    return `
      <div class="widget-preset-preview">
        <span class="preview-label">预览</span>
        <div class="preview-widget" style="background:${bg};border-radius:${radius};opacity:${alpha};transform:rotate(${tilt});">
          <div class="preview-widget-title">便签</div>
          <div class="preview-widget-body">奶茶七分糖<br>记得倒垃圾</div>
        </div>
        <div class="preview-caption">${p ? `预览「${escHtml(p.label)}」` : '当前默认样式'}</div>
      </div>
    `;
  }

  function render() {
    const allPresets = [
      ...BUILT_IN_PRESETS.map(p => ({ ...p, _isUser: false })),
      ...userPresets.map(p => ({ ...p, _isUser: true })),
    ];
    container.innerHTML = `
      <div class="page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">widget 风格</div>
        </header>
        <div class="page-body">
          <div class="settings-hint">点一个风格预览效果,再点底部「套用」覆盖所有桌面装饰。app 图标的透明度 / 圆角 / 倾斜在「设置 → app 图标」单独配。</div>
          ${renderPreview()}
          <div class="widget-preset-grid">
            ${allPresets.map(p => presetCardHtml(p, p._isUser, p.id === previewPresetId)).join('')}
            <button class="widget-preset-card widget-preset-add" type="button" title="新建自定义预设">
              <div class="widget-preset-add-glyph">+</div>
              <div class="widget-preset-label">自定义</div>
              <div class="widget-preset-hint">自己调一组色 / 圆角 / 倾斜,存起来一键复用</div>
            </button>
          </div>
          <div class="form-actions" style="margin-top: 16px;">
            <button type="button" class="btn apply-preset-btn"${previewPresetId ? '' : ' disabled'}>套用到所有 widget</button>
          </div>
        </div>
      </div>
    `;
  }

  render();

  async function applyPreset(presetId) {
    const preset = [...BUILT_IN_PRESETS, ...userPresets].find(p => p.id === presetId);
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

  // 自定义 preset modal — 复用 widget editor 的 HSV/radius/transparency/tilt 字段
  // 模板,加一个 name 输入。提交后 push 到 settings.widgetPresets。
  function openCustomPresetModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">新建自定义预设</div>
        <form class="custom-preset-form">
          <label>
            <div class="label-text">名字</div>
            <input name="name" type="text" required maxlength="20" placeholder="比如「淡奶油」" autocomplete="off">
          </label>
          ${transparencyFieldHtml(100)}
          ${tiltFieldHtml(0)}
          ${bgColorAndRadiusFieldsHtml(null, 16)}
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">保存</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    wireTransparencyReadout(modal);
    wireTiltReadout(modal);
    wireBgColorReadout(modal);

    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('.cancel-btn').addEventListener('click', close);

    modal.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      const name = String(fd.get('name') || '').trim();
      if (!name) return;
      const { bgColor, radius } = parseBgColorAndRadius(fd);
      const transparency = Number(fd.get('transparency')) || 100;
      const tilt = parseTilt(fd);
      const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const sampleBg = bgColor || 'var(--surface)';
      userPresets.push({
        id,
        label: name,
        hint: '我的自定义',
        sample: { bg: sampleBg, radius },
        override: { bgColor, radius, transparency, tilt },
      });
      await persistUserPresets();
      close();
      render();
    });
  }

  async function deleteUserPreset(presetId) {
    const p = userPresets.find(x => x.id === presetId);
    if (!p) return;
    const ok = await openConfirm(container, {
      title: `删除「${p.label}」`,
      message: '只是删除这个预设,已经套用过的 widget 颜色不变。',
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    userPresets = userPresets.filter(x => x.id !== presetId);
    await persistUserPresets();
    render();
  }

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    const delBtn = e.target.closest('.preset-delete');
    if (delBtn) {
      e.stopPropagation();
      await deleteUserPreset(delBtn.dataset.delId);
      return;
    }
    if (e.target.closest('.widget-preset-add')) {
      openCustomPresetModal();
      return;
    }
    // 套用按钮 — 把当前 previewPresetId 真的写入所有 widget
    if (e.target.closest('.apply-preset-btn')) {
      if (!previewPresetId) return;
      await applyPreset(previewPresetId);
      return;
    }
    // 点 preset card → 切预览,不立即套用
    const card = e.target.closest('.widget-preset-card');
    if (!card) return;
    previewPresetId = card.dataset.presetId;
    render();
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}
