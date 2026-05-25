// Data backup: export all stores as JSON, import a JSON file (replaces existing).

import * as db from '../../core/db.js';

export async function mountDataBackup(container, params, router) {
  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">数据备份</div>
      </header>
      <div class="page-body">
        <p class="hint">导出会把全部数据(包括 API key)打包成 JSON 文件下载到本地。导入会用文件里的数据覆盖当前数据。</p>
        <div class="form-actions">
          <button class="btn export-btn">导出数据</button>
          <button class="btn secondary import-btn">导入数据</button>
        </div>
        <div class="form-status"></div>
      </div>
    </div>
  `;

  const status    = container.querySelector('.form-status');
  const exportBtn = container.querySelector('.export-btn');
  const importBtn = container.querySelector('.import-btn');
  const backBtn   = container.querySelector('.back');

  const onBack = () => router.back();

  const onExport = async () => {
    try {
      status.className = 'form-status';
      status.textContent = '导出中…';
      const data = {};
      for (const name of Object.keys(db.STORES)) {
        data[name] = await db.getAll(name);
      }
      const payload = {
        _meta: { app: 'phone-app', version: 1, exportedAt: Date.now() },
        ...data,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.download = `phone-app-backup-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const counts = Object.entries(data).map(([k, v]) => `${k}=${v.length}`).join('  ');
      status.textContent = `导出完成:\n${counts}`;
      status.className = 'form-status success';
    } catch (e) {
      status.textContent = `导出失败:${String(e)}`;
      status.className = 'form-status error';
    }
  };

  const onImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) return;
      if (!confirm('导入会覆盖当前所有数据,确定继续吗?')) return;
      try {
        status.className = 'form-status';
        status.textContent = '导入中…';
        const text = await file.text();
        const data = JSON.parse(text);
        if (typeof data !== 'object' || !data) throw new Error('文件格式不对');
        const counts = {};
        for (const name of Object.keys(db.STORES)) {
          if (Array.isArray(data[name])) {
            await db.clear(name);
            for (const row of data[name]) await db.set(name, row);
            counts[name] = data[name].length;
          }
        }
        const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ');
        status.textContent = `导入完成:\n${summary}`;
        status.className = 'form-status success';
      } catch (e) {
        status.textContent = `导入失败:${String(e).slice(0, 300)}`;
        status.className = 'form-status error';
      }
    }, { once: true });
    input.click();
  };

  backBtn.addEventListener('click', onBack);
  exportBtn.addEventListener('click', onExport);
  importBtn.addEventListener('click', onImport);

  return () => {
    backBtn.removeEventListener('click', onBack);
    exportBtn.removeEventListener('click', onExport);
    importBtn.removeEventListener('click', onImport);
  };
}
