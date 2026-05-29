// 全局记忆总结设置 — toggle + 触发轮数.
// 数据落在 settings.memoryEnabled / settings.memoryThreshold.
// maybeCompressMemory(sessionId) 在每次 AI 回复后被调用,它内部读这两个值
// 决定要不要压。这里的修改即时生效,不需要刷新。

import * as db from '../../core/db.js';
import { bindFormDirty } from '../../core/form-helpers.js';
import { esc } from '../../core/util.js';

// 默认缓冲 20 — 超过这么多条活跃消息就压最旧一天。20 接近"半天对话"
//   的体量,适合积极压缩节省 context。user 想保留更多活跃就调大。
const DEFAULT_THRESHOLD = 20;
// "立即提取记忆"按钮一次最多跑几轮(每轮压一天)。聊天历史很长时一次想
//   清空积压。默认 30 ≈ 一个月,够覆盖大多数场景。值太大可能撞速率限制 /
//   烧 token,达上限会提示「还剩 N 天再点继续」。
const DEFAULT_BATCH_LIMIT = 30;

export async function mountMemorySettings(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  const enabled = settings.memoryEnabled !== false;  // default on
  const threshold = Number.isFinite(settings.memoryThreshold) && settings.memoryThreshold > 0
    ? settings.memoryThreshold : DEFAULT_THRESHOLD;
  const batchLimit = Number.isFinite(settings.memoryForceBatchLimit) && settings.memoryForceBatchLimit > 0
    ? settings.memoryForceBatchLimit : DEFAULT_BATCH_LIMIT;
  // Timeline v3 — 自动合并阈值 + auto merge 开关。timelineInjectCount 删了
  //   (现在全部注入,auto merge 控制总量)。
  const tlMergeThreshold = Number.isFinite(settings.timelineAutoMergeThreshold) && settings.timelineAutoMergeThreshold > 0
    ? settings.timelineAutoMergeThreshold : 30;
  const tlAutoMerge = settings.timelineAutoMergeEnabled !== false;
  // 记忆专用 API — 让 memory 压缩 / timeline 合并 / L2 rollup 走另一个
  //   apiConfig(便宜模型省 token)。null = 跟聊天主 API。dropdown 列所有
  //   apiConfig 行 + 一个 "(跟随主 API)" 顶选项。
  const memoryApiConfigId = settings.memoryApiConfigId || '';
  const apiConfigs = await db.getAll('apiConfig');
  apiConfigs.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  // T34: 记忆卡片显示控制 — 默认都开,user 想瘦身记忆卡片就关掉。
  const showQuotes = settings.memoryShowQuotes !== false;
  const showEvents = settings.memoryShowEvents !== false;
  // memoryInjectQuotes — 把 quotes(关键原话)注入 prompt 的开关。默认关:
  //   quotes 是给用户翻看的高密度信息,塞 prompt 会翻倍 token。只在 vector
  //   召回的强命中卡(相关度 ≥0.7)附 quotes,linear L1/L2 全量段一刀切不附。
  const injectQuotes = settings.memoryInjectQuotes === true;
  // memoryProfileCap — 用户画像每段(likes / dislikes / 你发现)的条数上限。
  //   超过时最老的 FIFO 淘汰,防 prompt 的「# 关于你」段无限增长。
  const profileCap = Number.isFinite(settings.memoryProfileCap) && settings.memoryProfileCap > 0
    ? settings.memoryProfileCap : 20;

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">记忆总结</div>
      </header>
      <div class="page-body">
        <p class="hint">
          聊天越聊越长,AI 一次能读的内容是有限的。开了记忆总结,较早的对话会被自动压成简短的<b>记忆</b> —— AI 记住大意、不必再读原文,省出空间继续聊。
        </p>
        <p class="hint">
          压缩是<b>一天一天来</b>的:最近的消息超过下面设的条数,就把最早的那一天压成一条记忆,慢慢消化,不会一次全压。聊久了,很老的几条记忆还会再合并成一条「远期记忆」,这样上下文不会无限变长。
        </p>
        <p class="hint">
          被压的消息<b>不会消失</b> —— 聊天里会折叠成一条「点开看 N 条被总结的聊天」,随时能展开看原文,只是 AI 那边看到的是摘要。
        </p>
        <p class="hint">关掉的话:旧消息 AI 就读不到了(聊天记录照样保留,只是 AI 看不到)。</p>
        <form class="settings-form" autocomplete="off">
          <label class="checkbox-row">
            <input type="checkbox" name="enabled"${enabled ? ' checked' : ''}>
            <span>开启记忆总结</span>
          </label>
          <label>
            <div class="label-text">保留最近多少条不压缩(默认 ${DEFAULT_THRESHOLD};越大 AI 记住的原文越多,也越占空间)</div>
            <input type="number" name="threshold" min="5" max="200" step="1" value="${threshold}">
          </label>
          <label>
            <div class="label-text">「立即提取记忆」一次最多整理几天(默认 ${DEFAULT_BATCH_LIMIT})</div>
            <input type="number" name="batchLimit" min="1" max="100" step="1" value="${batchLimit}">
            <p class="hint" style="margin-top: 4px;">聊天里 ⋯ → 「立即提取记忆」会把还没整理的旧对话一天天压成记忆。一次最多整理这么多天,剩下的会提示你再点一次继续。整理一天调一次 AI,设太大会比较慢、也费 token。</p>
          </label>
          <h3 class="section-title" style="margin-top: 18px;">用单独的 AI 整理记忆(可选)</h3>
          <p class="hint">整理记忆也要调 AI,默认用你聊天那个。整理记忆<b>不需要很聪明的模型</b>,想省钱可以单独挑个便宜的(GPT-4o-mini / Qwen-turbo 之类)。先去「设置 → API 设置」建好,这里再选。</p>
          <label>
            <div class="label-text">整理记忆用哪个 API</div>
            <select name="memoryApiConfigId">
              <option value=""${!memoryApiConfigId ? ' selected' : ''}>(跟随聊天主 API)</option>
              ${apiConfigs.map(c => `<option value="${esc(c.id)}"${c.id === memoryApiConfigId ? ' selected' : ''}>${esc(c.name || '(未命名)')} — ${esc(c.modelName || '')}</option>`).join('')}
            </select>
          </label>

          <h3 class="section-title" style="margin-top: 18px;">时间线</h3>
          <p class="hint">时间线是一条条「几月几号发生了什么」的简短记录,跟着记忆总结自动生成,帮 AI 记住事情的<b>先后顺序</b>(记忆卡是内容,时间线是时间轴)。条数多了会自动合并,见下面。</p>
          <label class="checkbox-row">
            <input type="checkbox" name="timelineAutoMergeEnabled"${tlAutoMerge ? ' checked' : ''}>
            <span>太多了就自动合并(每次把最早 5 条并成 1 条)</span>
          </label>
          <label>
            <div class="label-text">攒到多少条就合并(默认 30)</div>
            <input type="number" name="timelineAutoMergeThreshold" min="5" max="100" step="1" value="${tlMergeThreshold}">
            <p class="hint" style="margin-top: 4px;">上面开关关掉时这个不生效。每次合并要调一次 AI,别设太低,免得老是费 token。</p>
          </label>
          <h3 class="section-title" style="margin-top: 18px;">记忆卡片显示</h3>
          <p class="hint">这两个只影响记忆卡片<b>长什么样</b>,不影响 AI、也不影响生成。关掉只是让卡片更清爽,数据还在,想看再开回来。</p>
          <label class="checkbox-row">
            <input type="checkbox" name="showQuotes"${showQuotes ? ' checked' : ''}>
            <span>显示「节选」(几句关键原话)</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" name="showEvents"${showEvents ? ' checked' : ''}>
            <span>显示「这次发生了」(红包 / 转账 / 语音 / 图片这些)</span>
          </label>

          <h3 class="section-title" style="margin-top: 18px;">让 AI 读到关键原话</h3>
          <p class="hint">默认关 —— 关键原话主要是给你翻看的,给 AI 看会明显多费 token。开了之后,只有在<b>按相关度找记忆</b>时命中的强相关那几条,才会把原话一并给 AI。要先在「设置 → 向量记忆」里启用才有用。</p>
          <label class="checkbox-row">
            <input type="checkbox" name="injectQuotes"${injectQuotes ? ' checked' : ''}>
            <span>让 AI 读到关键原话(只在强相关时)</span>
          </label>

          <h3 class="section-title" style="margin-top: 18px;">用户画像</h3>
          <p class="hint">整理记忆时,AI 会顺手记下关于你的新发现(喜欢什么、不喜欢什么、发现了什么),攒进「关于你」。时间久了越攒越多,这里设个上限,超了就丢掉最早的。</p>
          <label>
            <div class="label-text">每类最多记多少条(喜欢 / 不喜欢 / 发现 各算各的,默认 20)</div>
            <input type="number" name="profileCap" min="5" max="100" step="1" value="${profileCap}">
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
      setStatus('保留条数太小,建议 ≥ 5', 'error');
      return;
    }
    const bl = parseInt(String(fd.get('batchLimit') || '0'), 10) || DEFAULT_BATCH_LIMIT;
    const tlThr = parseInt(String(fd.get('timelineAutoMergeThreshold') || '0'), 10) || 30;
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    s.memoryEnabled = en;
    s.memoryThreshold = t;
    s.memoryForceBatchLimit = Math.max(1, Math.min(100, bl));
    s.timelineAutoMergeThreshold = Math.max(5, Math.min(100, tlThr));
    s.timelineAutoMergeEnabled = !!fd.get('timelineAutoMergeEnabled');
    // 记忆专用 API — 空字符串 = 跟随主 API(等同 null)
    const memApiId = String(fd.get('memoryApiConfigId') || '').trim();
    s.memoryApiConfigId = memApiId || null;
    s.memoryShowQuotes = !!fd.get('showQuotes');
    s.memoryShowEvents = !!fd.get('showEvents');
    s.memoryInjectQuotes = !!fd.get('injectQuotes');
    const pc = parseInt(String(fd.get('profileCap') || '0'), 10) || 20;
    s.memoryProfileCap = Math.max(5, Math.min(100, pc));
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
