// Settings → 向量记忆 — embedding endpoint config + enable toggle + backfill.
//
// Stored under settings.embedding = { urlTemplate, apiKey, modelName,
// enabled, topK }. The chat-side reads this in context.buildVectorRecallLines
// + embedding.embedMemory. Disabled by default (opt-in extra API spend).

import * as db from '../../core/db.js';
import * as embedding from '../../core/embedding.js';
import { openAlert } from '../../core/modal.js';
import { bindFormDirty } from '../../core/form-helpers.js';

const PRESETS = [
  { label: 'OpenAI', urlTemplate: 'https://api.openai.com/v1', modelName: 'text-embedding-3-small' },
  { label: '硅基流动 BGE', urlTemplate: 'https://api.siliconflow.cn/v1', modelName: 'BAAI/bge-m3' },
  { label: 'DashScope Qwen', urlTemplate: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelName: 'text-embedding-v3' },
];

export async function mountEmbeddingSettings(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  const cfg = settings.embedding || {};

  container.innerHTML = `
    <div class="page embedding-settings-page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">向量记忆</div>
      </header>
      <div class="page-body">
        <p class="hint">
          向量记忆是「线性总结」之外的第二条记忆路径 — 适合检索"很久以前提过的一个事实"。
          每次 AI 回复前会把你最近几句话的语义嵌入,在本会话的记忆里做 top-K 相似度搜索,
          把最相关的几条注入「# 相关记忆(按语义检索)」段。<br>
          <b>每次回复多一次 embedding API 调用</b>,默认关闭。要用先在下面填配置 + 打开开关。
        </p>

        <div class="settings-list">
          <label class="settings-item toggle-row">
            <span class="settings-label">启用向量记忆</span>
            <input type="checkbox" data-toggle="enabled"${cfg.enabled === true ? ' checked' : ''}>
          </label>
        </div>

        <h3 class="settings-section-title">预设</h3>
        <div class="preset-picker preset-scroll">
          ${PRESETS.map(p => `<button type="button" class="btn secondary preset-chip" data-preset="${esc(p.label)}">${esc(p.label)}</button>`).join('')}
        </div>

        <form class="emb-form" autocomplete="off">
          <label>
            <div class="label-text">API URL(基础路径,会自动追加 /embeddings)</div>
            <input name="urlTemplate" type="text" value="${esc(cfg.urlTemplate || '')}" placeholder="https://api.openai.com/v1">
          </label>
          <label>
            <div class="label-text">API Key</div>
            <input name="apiKey" type="password" value="${esc(cfg.apiKey || '')}" placeholder="sk-...">
          </label>
          <label>
            <div class="label-text">模型名</div>
            <input name="modelName" type="text" value="${esc(cfg.modelName || '')}" placeholder="text-embedding-3-small">
          </label>
          <label>
            <div class="label-text">每轮注入条数(top-K,1-20)</div>
            <input name="topK" type="number" min="1" max="20" step="1" value="${esc(cfg.topK ?? 5)}">
          </label>
          <label>
            <div class="label-text">世界书 entries 向量触发的相似度阈值(0.0-1.0,低于此分数不注入)</div>
            <input name="worldbookThreshold" type="number" min="0" max="1" step="0.05" value="${esc(cfg.worldbookThreshold ?? 0.35)}">
          </label>
          <div class="form-actions">
            <button type="button" class="btn secondary test-btn">测试连接</button>
            <button type="submit" class="btn">保存</button>
          </div>
          <div class="form-status"></div>
        </form>

        <h3 class="settings-section-title">补 embedding</h3>
        <p class="hint">
          打开开关后,新生成的总结会自动 embed。已经生成的旧总结需要手动跑一次补齐。
          下面这个按钮会扫所有会话,给每条没有 vector 的 memory 调一次 embedding API
          (按会话分批,每次最多 50 条)。
        </p>
        <div class="form-actions">
          <button type="button" class="btn secondary backfill-btn">补齐所有会话的旧总结</button>
        </div>
        <div class="form-status backfill-status"></div>
      </div>
    </div>
  `;

  const form         = container.querySelector('.emb-form');
  const status       = container.querySelector('.emb-form .form-status');
  const backfillBtn  = container.querySelector('.backfill-btn');
  const backStatus   = container.querySelector('.backfill-status');
  const saveBtn      = form.querySelector('button[type="submit"]');
  const dirty        = bindFormDirty(form, saveBtn);
  dirty.markSaved();
  // 预设 chip 写入 form 后也算 dirty(form.elements 赋值不触发 input event)
  container.querySelectorAll('.preset-chip').forEach(btn => {
    btn.addEventListener('click', () => dirty.markDirty());
  });

  container.querySelector('.back').addEventListener('click', () => router.back());

  container.querySelector('[data-toggle="enabled"]').addEventListener('change', async (e) => {
    const fresh = (await db.get('settings', 'default')) || { id: 'default' };
    fresh.embedding = { ...(fresh.embedding || {}), enabled: !!e.target.checked };
    await db.set('settings', fresh);
  });

  container.querySelectorAll('.preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = PRESETS.find(x => x.label === btn.dataset.preset);
      if (!p) return;
      form.elements.urlTemplate.value = p.urlTemplate;
      form.elements.modelName.value   = p.modelName;
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const fresh = (await db.get('settings', 'default')) || { id: 'default' };
    const thRaw = Number(fd.get('worldbookThreshold'));
    fresh.embedding = {
      ...(fresh.embedding || {}),
      urlTemplate: String(fd.get('urlTemplate') || '').trim(),
      apiKey:      String(fd.get('apiKey')      || '').trim(),
      modelName:   String(fd.get('modelName')   || '').trim(),
      topK:        Math.max(1, Math.min(20, Number(fd.get('topK')) || 5)),
      worldbookThreshold: Number.isFinite(thRaw) ? Math.max(0, Math.min(1, thRaw)) : 0.35,
    };
    await db.set('settings', fresh);
    status.textContent = '已保存';
    status.className = 'form-status success';
    dirty.markSaved();
  });

  container.querySelector('.test-btn').addEventListener('click', async () => {
    // Use form-current values (not yet saved), so the user can test before
    // committing. Builds a one-shot fake config and runs embedText against it.
    const fd = new FormData(form);
    const cfgNow = {
      urlTemplate: String(fd.get('urlTemplate') || '').trim(),
      apiKey:      String(fd.get('apiKey')      || '').trim(),
      modelName:   String(fd.get('modelName')   || '').trim(),
    };
    if (!cfgNow.urlTemplate || !cfgNow.apiKey || !cfgNow.modelName) {
      status.textContent = 'URL / Key / 模型名都得填了再测';
      status.className = 'form-status error';
      return;
    }
    status.textContent = '调用中…';
    status.className = 'form-status';
    // Temporarily flip enabled + write to settings just for the test, then restore.
    const orig = (await db.get('settings', 'default')) || { id: 'default' };
    const origEmb = orig.embedding;
    orig.embedding = { ...cfgNow, enabled: true, topK: orig.embedding?.topK ?? 5 };
    await db.set('settings', orig);
    try {
      const vec = await embedding.embedText('test embedding');
      if (vec) {
        status.textContent = `成功 — 向量维度 ${vec.length}`;
        status.className = 'form-status success';
      } else {
        status.textContent = '调用返回空,可能没启用或响应不对';
        status.className = 'form-status error';
      }
    } catch (err) {
      status.textContent = `失败:${String(err).slice(0, 200)}`;
      status.className = 'form-status error';
    }
    // Restore original embedding settings (only the temp test config gets reverted)
    const after = (await db.get('settings', 'default')) || { id: 'default' };
    after.embedding = origEmb;
    await db.set('settings', after);
  });

  backfillBtn.addEventListener('click', async () => {
    const fresh = (await db.get('settings', 'default')) || {};
    if (fresh.embedding?.enabled !== true) {
      await openAlert(container, {
        title: '请先启用向量记忆',
        message: '把开关打开 + 保存配置后再来跑补齐。',
        danger: true,
      });
      return;
    }
    backfillBtn.disabled = true;
    backStatus.textContent = '扫描中…';
    backStatus.className = 'form-status';
    let total = { embedded: 0, skipped: 0 };
    try {
      const sessions = await db.getAll('chatSessions');
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        backStatus.textContent = `${i+1}/${sessions.length}:${s.title || s.id}`;
        const res = await embedding.backfillSessionMemories(s.id);
        total.embedded += res.embedded;
        total.skipped  += res.skipped;
      }
      backStatus.textContent = `完成:新 embed ${total.embedded} 条,已有 ${total.skipped} 条跳过`;
      backStatus.className = 'form-status success';
    } catch (e) {
      backStatus.textContent = `失败:${String(e).slice(0, 200)}`;
      backStatus.className = 'form-status error';
    } finally {
      backfillBtn.disabled = false;
    }
  });

  return () => {};
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
