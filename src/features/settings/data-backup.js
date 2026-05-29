// Data backup: export all stores as JSON, import a JSON file (replaces existing).
//
// Float32Array 处理:embeddings.vector 是 Float32Array,JSON.stringify 直接
// 序列化会变 `{"0":0.1,"1":0.2,...}` 对象形式 — 导回去再 set 拿到普通对象,
// 后续 cosineSimilarity 在对象上跑虽然不立刻报错(数字 key 索引能用)但
// `.length` 是 undefined 导致行为不一致。所以 export 时 vector → Array.from,
// import 时 → new Float32Array 还原。旧备份(object form)也兼容。
//
// 事务原子性:每个 store 的 clear + writes 在同一个 IDB tx 里跑(用 db
// 暴露的 _db 不太礼貌,所以走 db.STORES 配合标准 api;原子性的"一个 store
// 内 clear+puts"用 IDBTransaction 直接做)。中途崩了至少不会"一些 store
// 空了另一些没动",每个 store 是原子的。

import * as db from '../../core/db.js';
import { openConfirm } from '../../core/modal.js';

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
        const rows = await db.getAll(name);
        data[name] = rows.map(r => serializeRow(name, r));
      }
      const payload = {
        _meta: { app: 'phone-app', version: 1, dbVersion: db.DB_VERSION, exportedAt: Date.now() },
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
      // 先解析,才能读 _meta.dbVersion 做版本门。
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (e) {
        status.textContent = '导入失败:文件不是合法 JSON';
        status.className = 'form-status error';
        return;
      }
      if (typeof data !== 'object' || !data) {
        status.textContent = '导入失败:文件格式不对';
        status.className = 'form-status error';
        return;
      }
      // 版本门:备份记录的 dbVersion 跟当前不一致 → 结构可能不兼容,先警告确认。
      // 老备份没有 dbVersion 字段(null)→ 跳过检查走旧流程(向后兼容)。
      const bkVer = data?._meta?.dbVersion;
      if (bkVer != null && bkVer !== db.DB_VERSION) {
        if (!await openConfirm(container, {
          title: '版本不一致',
          message: `这份备份的数据版本是 v${bkVer},当前是 v${db.DB_VERSION}。${bkVer > db.DB_VERSION ? '它比当前版本新,' : ''}导入后结构可能不完全兼容,可能出错。仍要继续吗?`,
          confirmLabel: '仍然导入',
          danger: true,
        })) return;
      }
      if (!await openConfirm(container, {
        title: '导入备份',
        message: '导入会覆盖当前所有数据,确定继续吗?',
        confirmLabel: '导入',
        danger: true,
      })) return;
      try {
        status.className = 'form-status';
        status.textContent = '导入中…';
        const counts = {};
        for (const name of Object.keys(db.STORES)) {
          if (Array.isArray(data[name])) {
            const rows = data[name].map(r => deserializeRow(name, r));
            await db.txnReplace(name, rows);
            counts[name] = rows.length;
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

// 序列化时 vector 强制转普通数组,JSON 出来是 `[0.1, 0.2, ...]` 数组形式
// 而不是 `{"0":0.1, ...}` 对象形式。其他 store 当前没 TypedArray 字段,如果
// 以后有了再加 case。
function serializeRow(storeName, row) {
  if (storeName === 'embeddings' && row.vector instanceof Float32Array) {
    return { ...row, vector: Array.from(row.vector) };
  }
  return row;
}

// 反序列化时把 vector 还原成 Float32Array。兼容三种来源:
//   - 新格式(导出已修过):vector 是 plain Array,直接 new Float32Array(arr)
//   - 已经是 Float32Array(罕见,但 IDB structured clone 可能给):直接用
//   - 旧 buggy 格式 `{"0":0.1, "1":0.2}`:按数字 key 排序后重组
function deserializeRow(storeName, row) {
  if (storeName !== 'embeddings') return row;
  const v = row.vector;
  if (!v) return row;
  if (v instanceof Float32Array) return row;
  if (Array.isArray(v)) return { ...row, vector: new Float32Array(v) };
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
    const arr = keys.map(k => v[k]);
    return { ...row, vector: new Float32Array(arr) };
  }
  return row;
}
