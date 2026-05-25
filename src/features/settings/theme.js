// Theme picker. Writes settings.theme + applies data-theme to <body> live.

import * as db from '../../core/db.js';

const THEMES = [
  { id: 'default', label: '默认',     desc: '当前 iOS 风格,无刘海' },
  { id: 'notch',   label: '刘海屏',   desc: 'iPhone 风格,顶部加 notch + 圆角加大' },
];

export async function mountTheme(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  const current  = settings.theme || 'default';

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">外观</div>
      </header>
      <div class="page-body">
        <div class="settings-list">
          ${THEMES.map(t => `
            <button class="settings-item theme-row" data-theme-id="${t.id}">
              <span class="settings-label">
                <div>${t.label}</div>
                <div class="theme-desc">${t.desc}</div>
              </span>
              <span class="theme-check${t.id === current ? ' active' : ''}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    const row = e.target.closest('[data-theme-id]');
    if (!row) return;
    const themeId = row.dataset.themeId;
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    s.theme = themeId;
    await db.set('settings', s);
    document.body.dataset.theme = themeId;
    container.querySelectorAll('.theme-check').forEach(el => el.classList.remove('active'));
    row.querySelector('.theme-check').classList.add('active');
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}
