// 全局记忆总结设置 — toggle + 触发轮数.
// 数据落在 settings.memoryEnabled / settings.memoryThreshold.
// maybeCompressMemory(sessionId) 在每次 AI 回复后被调用,它内部读这两个值
// 决定要不要压。这里的修改即时生效,不需要刷新。

import * as db from '../../core/db.js';
import { bindFormDirty } from '../../core/form-helpers.js';

// T17: 默认缓冲从 20 改 30 — 跟 maybeCompressMemory 的 threshold 默认对齐。
//   新规则只一个旋钮:超过缓冲就按天压最旧一天,不再有"一次压几条"概念。
const DEFAULT_THRESHOLD = 30;
// "立即提取记忆"按钮一次最多跑几轮(每轮压一天)。聊天历史很长时一次想压
//   全没现实 — 烧 token + 撞速率限制。设上限分批,user 多点几次。默认 5
//   足够一次清掉一周左右的积压。
const DEFAULT_BATCH_LIMIT = 5;

export async function mountMemorySettings(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  const enabled = settings.memoryEnabled !== false;  // default on
  const threshold = Number.isFinite(settings.memoryThreshold) && settings.memoryThreshold > 0
    ? settings.memoryThreshold : DEFAULT_THRESHOLD;
  const batchLimit = Number.isFinite(settings.memoryForceBatchLimit) && settings.memoryForceBatchLimit > 0
    ? settings.memoryForceBatchLimit : DEFAULT_BATCH_LIMIT;
  // Timeline v3 — 注入 prompt 的最近 N 条 + 自动合并阈值 + auto merge 开关
  const tlInject = Number.isFinite(settings.timelineInjectCount) && settings.timelineInjectCount > 0
    ? settings.timelineInjectCount : 20;
  const tlMergeThreshold = Number.isFinite(settings.timelineAutoMergeThreshold) && settings.timelineAutoMergeThreshold > 0
    ? settings.timelineAutoMergeThreshold : 30;
  const tlAutoMerge = settings.timelineAutoMergeEnabled !== false;
  // T34: 记忆卡片显示控制 — 默认都开,user 想瘦身记忆卡片就关掉。
  const showQuotes = settings.memoryShowQuotes !== false;
  const showEvents = settings.memoryShowEvents !== false;

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">记忆总结</div>
      </header>
      <div class="page-body">
        <p class="hint">
          <b>缓冲条数</b>:聊天活跃消息超过这么多条时,就开始把多余的较老消息按天分组压缩成记忆。
          总结后被压的消息会折叠到聊天里的「点开看 N 条被总结的聊天」横条里,AI 只看到摘要。
        </p>
        <p class="hint">
          压缩规则:活跃消息 > 缓冲条数 时,把<b>溢出的最旧那一天</b>的消息压成一条记忆。每次只压一天,渐进式消化 — 第一次压完后下次新消息再触发时再压下一天。
        </p>
        <p class="hint">
          默认缓冲 ${DEFAULT_THRESHOLD} 条。L1 摘要累积到 8 条以上,最老的 4 条再压成一条「远期 / 章节」摘要,注入 prompt 的「# 远期记忆」段。长线对话上下文不会无限涨。
        </p>
        <p class="hint">关闭总结后:超出缓冲的旧消息 AI 看不到原文,聊天界面照常保留。</p>
        <form class="settings-form" autocomplete="off">
          <label class="checkbox-row">
            <input type="checkbox" name="enabled"${enabled ? ' checked' : ''}>
            <span>开启记忆总结</span>
          </label>
          <label>
            <div class="label-text">缓冲条数(留多少条活跃不压,默认 ${DEFAULT_THRESHOLD})</div>
            <input type="number" name="threshold" min="5" max="200" step="1" value="${threshold}">
          </label>
          <label>
            <div class="label-text">「立即提取记忆」单次最多提取几天(默认 ${DEFAULT_BATCH_LIMIT})</div>
            <input type="number" name="batchLimit" min="1" max="30" step="1" value="${batchLimit}">
            <p class="hint" style="margin-top: 4px;">聊天框 ⋯ → 「立即提取记忆」按钮跑一次,自动循环压最旧的天,达到这个上限或全部压完才停。一次几天就要多少次 API 调用,值太大可能撞速率限制 / 烧 token,达到上限后会提示「还剩 N 天再点一次继续」。</p>
          </label>
          <h3 class="section-title" style="margin-top: 18px;">时间索引(timeline)</h3>
          <p class="hint">时间索引是一行简短的"什么时候发生了什么"记录,跟着每次记忆压缩自动生成。会**注入到 system prompt 的「# 时间索引」段**作为时间锚点(memory 卡是故事内容,时间索引是时间轴)。</p>
          <label>
            <div class="label-text">注入 prompt 的最近 N 条(默认 20)</div>
            <input type="number" name="timelineInjectCount" min="1" max="50" step="1" value="${tlInject}">
          </label>
          <label class="checkbox-row">
            <input type="checkbox" name="timelineAutoMergeEnabled"${tlAutoMerge ? ' checked' : ''}>
            <span>超过阈值自动合并最老的几条(每次合并 5 条 → 1 条)</span>
          </label>
          <label>
            <div class="label-text">自动合并阈值(超过这么多条触发合并,默认 30)</div>
            <input type="number" name="timelineAutoMergeThreshold" min="5" max="100" step="1" value="${tlMergeThreshold}">
            <p class="hint" style="margin-top: 4px;">关掉上面的开关时这值不生效。合并会调用 1 次 AI(把最老 5 条合成 1 条),所以阈值不要设太低(频繁烧 token)。</p>
          </label>
          <h3 class="section-title" style="margin-top: 18px;">记忆卡片显示</h3>
          <p class="hint">控制记忆 app 和聊天内总结里,每张卡片是否显示这两个区段。关掉只让卡片更简洁,不影响生成 — 数据仍写入 memory,改回开就能看到。</p>
          <label class="checkbox-row">
            <input type="checkbox" name="showQuotes"${showQuotes ? ' checked' : ''}>
            <span>显示「节选」(1-5 条关键原话)</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" name="showEvents"${showEvents ? ' checked' : ''}>
            <span>显示「这次发生了」(红包/转账/语音/图片等手机原生事件链)</span>
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
    if (t < 5) {
      setStatus('缓冲太小,建议 ≥ 5', 'error');
      return;
    }
    const bl = parseInt(String(fd.get('batchLimit') || '0'), 10) || DEFAULT_BATCH_LIMIT;
    const tlInj = parseInt(String(fd.get('timelineInjectCount') || '0'), 10) || 20;
    const tlThr = parseInt(String(fd.get('timelineAutoMergeThreshold') || '0'), 10) || 30;
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    s.memoryEnabled = en;
    s.memoryThreshold = t;
    s.memoryForceBatchLimit = Math.max(1, Math.min(30, bl));
    s.timelineInjectCount = Math.max(1, Math.min(50, tlInj));
    s.timelineAutoMergeThreshold = Math.max(5, Math.min(100, tlThr));
    s.timelineAutoMergeEnabled = !!fd.get('timelineAutoMergeEnabled');
    s.memoryShowQuotes = !!fd.get('showQuotes');
    s.memoryShowEvents = !!fd.get('showEvents');
    // T17: memoryBatchSize 字段废弃 — 新规则按 dayKey 分组,每天一条 memory,
    //   不再需要"一次总结 N 条"概念。老 settings 里的值留着不动也不读。
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
