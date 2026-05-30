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

export async function mountMemorySettings(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  const enabled = settings.memoryEnabled !== false;  // default on
  const threshold = Number.isFinite(settings.memoryThreshold) && settings.memoryThreshold > 0
    ? settings.memoryThreshold : DEFAULT_THRESHOLD;
  // 缓冲条数 — 超过「保留数」后再多攒这么多条才真正触发压缩。默认 0(老行为)。
  const buffer = Number.isFinite(settings.memoryBuffer) && settings.memoryBuffer >= 0
    ? settings.memoryBuffer : 0;
  // Timeline 自动压缩开关(把同一天的多条时间线压成这天一条;阈值概念已去掉)。
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
          开启后,较早的对话会自动压缩成简短记忆;AI 据此记住大意,不再逐条读原文,为后续对话腾出空间。
        </p>
        <p class="hint">
          压缩按天进行:活跃消息超过设定条数时,压缩最早的一天,逐步推进;积累较多后,更早的记忆会进一步合并为远期记忆,上下文不会无限增长。
        </p>
        <p class="hint">
          被压缩的消息仍保留在聊天中,折叠为「点开看 N 条被总结的聊天」,可随时展开;AI 看到的是摘要。关闭后旧消息不再进入 AI 视野,聊天记录照常保留。
        </p>
        <form class="settings-form" autocomplete="off">
          <label class="checkbox-row">
            <input type="checkbox" name="enabled"${enabled ? ' checked' : ''}>
            <span>开启记忆总结</span>
          </label>
          <label>
            <div class="label-text">保留最近多少条不压缩(默认 ${DEFAULT_THRESHOLD})</div>
            <input type="number" name="threshold" min="5" max="200" step="1" value="${threshold}">
          </label>
          <label>
            <div class="label-text">缓冲:超过保留数后,再多攒多少条才开始压(默认 0)</div>
            <input type="number" name="buffer" min="0" max="200" step="1" value="${buffer}">
            <p class="hint" style="margin-top: 4px;">例:保留 100 + 缓冲 30 → 攒到 130 条才压一次、压回 100;设 0 就是一超过保留数立刻压。给「别刚过线就压」留点余量。</p>
          </label>
          <h3 class="section-title" style="margin-top: 18px;">用单独的 AI 整理记忆(可选)</h3>
          <p class="hint">整理记忆同样会调用 AI,默认使用聊天所用的 API。此项对模型要求不高,可单独指定更便宜的模型以节省开销;需先在「设置 → API 设置」中创建。</p>
          <label>
            <div class="label-text">整理记忆用哪个 API</div>
            <select name="memoryApiConfigId">
              <option value=""${!memoryApiConfigId ? ' selected' : ''}>(跟随聊天主 API)</option>
              ${apiConfigs.map(c => `<option value="${esc(c.id)}"${c.id === memoryApiConfigId ? ' selected' : ''}>${esc(c.name || '(未命名)')} — ${esc(c.modelName || '')}</option>`).join('')}
            </select>
          </label>

          <h3 class="section-title" style="margin-top: 18px;">时间线</h3>
          <p class="hint">时间线记录「几月几号发生了什么」,跟着记忆总结自动生成,帮 AI 记住事情的先后顺序。同一天若有多条,会自动压成这天一条;不同的天各自保留,不会合并。</p>
          <label class="checkbox-row">
            <input type="checkbox" name="timelineAutoMergeEnabled"${tlAutoMerge ? ' checked' : ''}>
            <span>自动压缩</span>
          </label>
          <h3 class="section-title" style="margin-top: 18px;">记忆卡片显示</h3>
          <p class="hint">以下两项仅影响记忆卡片的显示,不影响 AI 与生成。关闭后卡片更简洁,数据仍保留。</p>
          <label class="checkbox-row">
            <input type="checkbox" name="showQuotes"${showQuotes ? ' checked' : ''}>
            <span>显示「节选」(关键原话)</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" name="showEvents"${showEvents ? ' checked' : ''}>
            <span>显示「这次发生了」(红包 / 转账 / 语音 / 图片等)</span>
          </label>

          <h3 class="section-title" style="margin-top: 18px;">让 AI 读到关键原话</h3>
          <p class="hint">默认关闭。关键原话主要供翻阅,提供给 AI 会明显增加 token 消耗。开启后仅对按相关度检索命中的强相关记忆附带原话;需先在「设置 → 向量记忆」中启用。</p>
          <label class="checkbox-row">
            <input type="checkbox" name="injectQuotes"${injectQuotes ? ' checked' : ''}>
            <span>让 AI 读到关键原话(仅强相关时)</span>
          </label>

          <h3 class="section-title" style="margin-top: 18px;">用户画像</h3>
          <p class="hint">整理记忆时,AI 会记录关于你的新信息(喜欢、不喜欢、发现),归入「关于你」。为避免无限增长,可限制每类的条数,超出时淘汰最早的。</p>
          <label>
            <div class="label-text">每类上限(喜欢 / 不喜欢 / 发现 分别计算,默认 20)</div>
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
    const buf = Math.max(0, Math.min(200, parseInt(String(fd.get('buffer') || '0'), 10) || 0));
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    s.memoryEnabled = en;
    s.memoryThreshold = t;
    s.memoryBuffer = buf;
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
