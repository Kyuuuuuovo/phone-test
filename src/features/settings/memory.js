// 全局记忆总结设置 — toggle + 触发轮数.
// 数据落在 settings.memoryEnabled / settings.memoryThreshold.
// maybeCompressMemory(sessionId) 在每次 AI 回复后被调用,它内部读这两个值
// 决定要不要压。这里的修改即时生效,不需要刷新。

import * as db from '../../core/db.js';

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
        <p class="hint">超过「触发轮数」的对话会被压成中文摘要写入「过往记忆」,原消息从对话上下文里移除(但消息本身保留在聊天界面里,只是标记为已归档 — AI 看的是摘要,不再是原文)。每次 AI 回复后自动检查一次,不需要手动触发。</p>
        <p class="hint">「压缩批量」决定一次压几条:超过触发轮数后,要积累到这么多条才真的发起一次总结。比如触发轮数 20、批量 10,那就是第 30 条到达时一次把最早的 10 条压成一条记忆。设小了会频繁调 API,设大了会让单次总结的输入很长。</p>
        <p class="hint">当摘要本身累积到 8 条以上,系统会自动把最老的 4 条再压成一条更高层级的「章节摘要」,注入到 system prompt 的「远期记忆」段。长线对话不会让上下文无限膨胀。</p>
        <p class="hint">关闭记忆总结后:超过窗口的旧消息 AI 看不到原文,但消息本身在聊天界面中保留。</p>
        <form class="settings-form" autocomplete="off">
          <label class="checkbox-row">
            <input type="checkbox" name="enabled"${enabled ? ' checked' : ''}>
            <span>开启记忆总结</span>
          </label>
          <label>
            <div class="label-text">触发轮数(超过这个数字才考虑压。默认 ${DEFAULT_THRESHOLD})</div>
            <input type="number" name="threshold" min="5" max="200" step="1" value="${threshold}">
          </label>
          <label>
            <div class="label-text">压缩批量(累积到这么多溢出条数才真压一次。默认 ${DEFAULT_BATCH})</div>
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
  };

  backBtn.addEventListener('click', onBack);
  form.addEventListener('submit', onSubmit);

  return () => {
    backBtn.removeEventListener('click', onBack);
    form.removeEventListener('submit', onSubmit);
  };
}
