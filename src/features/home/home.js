// Home page. Grid of "app icons" that route to features.
// Step 1: only `settings` is implemented; others alert "尚未实现".

const APPS = [
  { id: 'chat-list',     label: '聊天',   icon: '💬' },
  { id: 'character-list',label: '角色',   icon: '👤' },
  { id: 'worldbook-list',label: '世界书', icon: '📖' },
  { id: 'persona-list',  label: '人设',   icon: '🧑' },
  { id: 'settings',      label: '设置',   icon: '⚙' },
];

export async function mountHome(container, params, router) {
  container.innerHTML = `
    <div class="page">
      <div class="page-body">
        <div class="app-grid">
          ${APPS.map(a => `
            <button class="app-icon" data-target="${a.id}" data-label="${a.label}">
              <div class="icon">${a.icon}</div>
              <div class="label">${a.label}</div>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  const onClick = async (e) => {
    const btn = e.target.closest('[data-target]');
    if (!btn) return;
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

  return () => container.removeEventListener('click', onClick);
}
