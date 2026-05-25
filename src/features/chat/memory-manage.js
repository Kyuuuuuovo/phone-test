// 会话级记忆总结管理 — 从 chat-info 进入,带 sessionId.
// 展示该 session 已生成的所有 summary(按 createdAt 升序),并允许编辑该会话
// 专用的总结「风格补充」(memoryPromptOverride)。这段风格会被 context.js 的
// maybeCompressMemory 附加到默认压缩 prompt 后面 — 默认 prompt 管结构、
// 这里管语气。
//
// 用户也可以手动删除某条 summary(比如总结跑偏了想重压)。删除后,如果
// session 仍超过 threshold,下一次 AI 回复就会重新触发压缩。

import * as db from '../../core/db.js';
import { DEFAULT_MEMORY_SYS } from '../../core/context.js';

export async function mountMemoryManage(container, params, router) {
  const sessionId = params.sessionId;
  if (!sessionId) {
    container.innerHTML = `<div class="page"><div class="page-body">缺少 sessionId</div></div>`;
    return () => {};
  }
  const session = await db.get('chatSessions', sessionId);
  if (!session) {
    container.innerHTML = `<div class="page"><div class="page-body">会话不存在</div></div>`;
    return () => {};
  }

  async function render() {
    const memories = await db.query('memories', 'sessionId', sessionId);
    memories.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const override = session.memoryPromptOverride || '';

    container.innerHTML = `
      <div class="page memory-manage-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">记忆总结</div>
        </header>
        <div class="page-body">
          <h3 class="section-title">该会话已生成的总结(${memories.length})</h3>
          ${memories.length === 0 ? `
            <p class="hint">还没有总结。聊到超过设定轮数(去 设置 → 记忆总结 调整)后会自动生成。</p>
          ` : `
            <div class="memory-list">
              ${memories.map(m => `
                <div class="memory-card" data-mem-id="${esc(m.id)}">
                  <div class="memory-meta">
                    <span>${esc(formatTime(m.createdAt))}</span>
                    <button type="button" class="memory-delete" title="删除这条总结">×</button>
                  </div>
                  <div class="memory-summary">${esc(m.summary || '(空)')}</div>
                </div>
              `).join('')}
            </div>
          `}

          <h3 class="section-title">总结风格(可选)</h3>
          <p class="hint">这段会被附加到默认压缩 prompt 后面,改变摘要的语气 / 视角 / 体裁,但不影响结构(保留关键信息、不分段、≤300 字)。留空表示用默认。</p>
          <form class="memory-prompt-form" autocomplete="off">
            <label>
              <div class="label-text">风格补充</div>
              <textarea name="prompt" rows="4" placeholder="如:用第一人称日记体 / 第三人称冷淡口吻 / 以悬疑短篇风格">${esc(override)}</textarea>
            </label>
            <details class="default-prompt-details">
              <summary>查看默认 prompt(只读)</summary>
              <pre class="default-prompt-text">${esc(DEFAULT_MEMORY_SYS)}</pre>
            </details>
            <div class="form-actions">
              <button type="submit" class="btn">保存风格</button>
            </div>
            <div class="form-status"></div>
          </form>
        </div>
      </div>
    `;
    wire();
  }

  function wire() {
    const backBtn = container.querySelector('.back');
    const form    = container.querySelector('.memory-prompt-form');
    const status  = container.querySelector('.form-status');
    const list    = container.querySelector('.memory-list');

    backBtn.addEventListener('click', () => router.back());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const fresh = await db.get('chatSessions', sessionId);
      fresh.memoryPromptOverride = String(fd.get('prompt') || '').trim();
      await db.set('chatSessions', fresh);
      Object.assign(session, fresh);
      status.textContent = '已保存(下一次压缩生效)';
      status.className = 'form-status success';
    });

    if (list) {
      list.addEventListener('click', async (e) => {
        const del = e.target.closest('.memory-delete');
        if (!del) return;
        const card = del.closest('[data-mem-id]');
        const memId = card?.dataset.memId;
        if (!memId) return;
        if (!confirm('删除这条总结?这段的原始消息已经被压缩时删掉了,删了就只能下次重新生成新的。')) return;
        await db.del('memories', memId);
        await render();
      });
    }
  }

  await render();
  return () => {};
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
