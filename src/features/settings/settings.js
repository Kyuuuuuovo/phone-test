// Settings hub. A list of subpages, each navigates via router.

export async function mountSettings(container, params, router) {
  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">设置</div>
      </header>
      <div class="page-body">
        <div class="settings-list">
          <button class="settings-item" data-target="settings-api">
            <span class="settings-label">API 设置</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-target="settings-weather">
            <span class="settings-label">天气 API</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-target="settings-theme">
            <span class="settings-label">外观</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-target="settings-memory">
            <span class="settings-label">记忆总结</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-target="settings-data">
            <span class="settings-label">数据备份</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item danger" data-target="settings-clear">
            <span class="settings-label">清空数据</span>
            <span class="settings-chevron">›</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const onClick = (e) => {
    if (e.target.closest('.back')) return router.back();
    const item = e.target.closest('[data-target]');
    if (item) router.navigate(item.dataset.target);
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}
