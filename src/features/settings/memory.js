// 全局记忆总结设置 — toggle + 触发轮数.
// 数据落在 settings.memoryEnabled / settings.memoryThreshold.
// maybeCompressMemory(sessionId) 在每次 AI 回复后被调用,它内部读这两个值
// 决定要不要压。这里的修改即时生效,不需要刷新。

import * as db from '../../core/db.js';
import { bindFormDirty } from '../../core/form-helpers.js';

const DEFAULT_THRESHOLD = 20;
const DEFAULT_BATCH = 10;

export async function mountMemorySettings(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  const enabled = settings.memoryEnabled !== false;  // default on
  const threshold = Number.isFinite(settings.memoryThreshold) && settings.memoryThreshold > 0
    ? settings.memoryThreshold : DEFAULT_THRESHOLD;
  const batchSize = Number.isFinite(settings.memoryBatchSize) && settings.memoryBatchSize > 0
    ? settings.memoryBatchSize : DEFAULT_BATCH;

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">记忆总结</div>
      </header>
      <div class="page-body">
        <p class="hint">
          两个旋钮决定什么时候开始总结:<br>
          • <b>缓冲条数</b>:总结之后,最近这么多条永远不被压,留给 AI 当短期记忆<br>
          • <b>一次总结条数</b>:每次触发要压多少条
        </p>
        <p class="hint">
          触发点 = 缓冲 + 一次总结。<br>
          举例:缓冲 <b>20</b>、一次总结 <b>50</b> → 活跃消息攒到 <b>70</b> 条时,把最早的 50 条压成一条记忆,
          剩下 20 条继续活跃,等下次再到 70 条再压一次。<br>
          默认:缓冲 ${DEFAULT_THRESHOLD}、一次总结 ${DEFAULT_BATCH} → 第 ${DEFAULT_THRESHOLD + DEFAULT_BATCH} 条到的时候压最早 ${DEFAULT_BATCH} 条。
        </p>
        <p class="hint">被压缩的消息<b>不会发给 AI 原文</b>,只发摘要。聊天界面里这些消息折叠成「已归档 N 条」横条,点击展开。</p>
        <p class="hint">L1 摘要累积到 8 条以上,最老的 4 条再压成一条「远期 / 章节」摘要,注入 prompt 的「# 远期记忆」段。长线对话上下文不会无限涨。</p>
        <p class="hint">关闭总结后:超出窗口的旧消息 AI 看不到原文,聊天界面照常保留。</p>
        <form class="settings-form" autocomplete="off">
          <label class="checkbox-row">
            <input type="checkbox" name="enabled"${enabled ? ' checked' : ''}>
            <span>开启记忆总结</span>
          </label>
          <label>
            <div class="label-text">缓冲条数(总结之后保留多少条活跃,默认 ${DEFAULT_THRESHOLD})</div>
            <input type="number" name="threshold" min="5" max="200" step="1" value="${threshold}">
          </label>
          <label>
            <div class="label-text">一次总结条数(每次触发压几条,默认 ${DEFAULT_BATCH})</div>
            <input type="number" name="batch" min="1" max="100" step="1" value="${batchSize}">
          </label>
          <div class="form-actions">
            <button type="submit" class="btn">保存</button>
          </div>
          <div class="form-status"></div>
        </form>
      </div>
    </div>
  `;

  const form    = container.querySelector('form');
  const status  = container.querySelector('.form-status');
  const backBtn = container.querySelector('.back');
  const saveBtn = form.querySelector('button[type="submit"]');
  const dirty   = bindFormDirty(form, saveBtn);
  dirty.markSaved();

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = `form-status${kind ? ' ' + kind : ''}`;
  }

  const onBack = () => router.back();
  const onSubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const en = !!fd.get('enabled');
    const t = parseInt(String(fd.get('threshold') || '0'), 10) || DEFAULT_THRESHOLD;
    const b = parseInt(String(fd.get('batch') || '0'), 10) || DEFAULT_BATCH;
    if (t < 5) {
      setStatus('触发轮数太小,建议 ≥ 5', 'error');
      return;
    }
    if (b < 1) {
      setStatus('压缩批量必须 ≥ 1', 'error');
      return;
    }
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    s.memoryEnabled = en;
    s.memoryThreshold = t;
    s.memoryBatchSize = b;
    await db.set('settings', s);
    setStatus('已保存', 'success');
    dirty.markSaved();
  };

  backBtn.addEventListener('click', onBack);
  form.addEventListener('submit', onSubmit);

  return () => {
    backBtn.removeEventListener('click', onBack);
    form.removeEventListener('submit', onSubmit);
  };
}
