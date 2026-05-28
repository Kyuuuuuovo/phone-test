// 会话级记忆 + 时间线管理 — 从 chat-info 进入,带 sessionId.
//
// 两个 tab:
// 1. 总结(memories) — 已生成的 L1/L2 summary 列表,可删;会话级风格补充
//    (memoryPromptOverride)的编辑入口。这一段进 system prompt(给模型用)。
// 2. 时间线(timeline) — 每天一句话总结,可多选合并 / 撤销合并 / 删除。
//    这一段 NOT 进 system prompt(只给用户翻看)。
//
// 时间线懒生成:打开时间线 tab 才扫描缺失天数,每个 dayKey 只生成一次。
// 今天不生成(那天还没结束)。

import * as db from '../../core/db.js';
import { DEFAULT_MEMORY_SYS } from '../../core/context.js';
import * as timeline from '../../core/timeline.js';
import { openConfirm } from '../../core/modal.js';

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

  // Default to 总结 tab on first mount.
  let activeTab = 'memories';
  // Multi-select state for the timeline tab (id set).
  const selected = new Set();
  // Lazy-gen guard: only run once per page mount when timeline tab opens.
  let lazyGenDone = false;
  let lazyGenBusy = false;

  async function render() {
    container.innerHTML = `
      <div class="page memory-manage-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">记忆 · 时间线</div>
        </header>
        <div class="page-body">
          <div class="mm-tabs">
            <button class="mm-tab${activeTab === 'memories' ? ' active' : ''}" data-tab="memories">总结</button>
            <button class="mm-tab${activeTab === 'timeline' ? ' active' : ''}" data-tab="timeline">时间线</button>
          </div>
          <div class="mm-tab-body">
            ${activeTab === 'memories' ? await renderMemoriesTab() : await renderTimelineTab()}
          </div>
        </div>
      </div>
    `;
    wire();
  }

  async function renderMemoriesTab() {
    const memories = await db.query('memories', 'sessionId', sessionId);
    memories.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const override = session.memoryPromptOverride || '';
    return `
      <div class="mem-head">
        <h3 class="section-title">该会话已生成的总结(${memories.length})</h3>
        ${memories.length > 0 ? `<button type="button" class="mem-export-btn">导出为文本</button>` : ''}
      </div>
      ${memories.length === 0 ? `
        <p class="hint">还没有总结。聊到超过设定轮数(去 设置 → 记忆总结 调整)后会自动生成。</p>
      ` : `
        <div class="memory-list">
          ${memories.map(m => `
            <div class="memory-card" data-mem-id="${esc(m.id)}">
              <div class="memory-meta">
                <span>${esc(formatTime(m.createdAt))}${m.tier === 2 ? ' · 远期' : ''}</span>
                <button type="button" class="memory-delete" title="删除这条总结">×</button>
              </div>
              <div class="memory-summary">${esc(normalizeMemorySummary(m.summary) || '(空)')}</div>
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
    `;
  }

  async function renderTimelineTab() {
    const all = await db.query('timeline', 'sessionId', sessionId);
    // Show merged rows + originals-not-yet-merged. Hide rows that have a
    // mergedInto pointer set (those have been folded into a merged row,
    // surfaced via the merged row's mergedFrom list).
    const visible = all.filter(t => !t.mergedInto);
    visible.sort((a, b) => (a.dayKey || '').localeCompare(b.dayKey || ''));
    const selectableCount = visible.filter(t => !t.mergedFrom).length;
    const selectedCount = visible.filter(t => selected.has(t.id) && !t.mergedFrom).length;

    return `
      <p class="hint">每天一句话总结(≤40 字),只给你翻看,不进聊天的 system prompt。今天不生成。每天只生成一次,删了才会重新生成。</p>
      <div class="form-actions tl-actions">
        <button type="button" class="btn secondary tl-gen-btn">${lazyGenBusy ? '生成中…' : '扫描缺失天数 → 生成'}</button>
        <button type="button" class="btn tl-merge-btn" ${selectedCount < 2 ? 'disabled' : ''}>合并选中(${selectedCount})</button>
      </div>
      <div class="tl-status"></div>
      ${visible.length === 0 ? `
        <p class="hint">还没有时间线条目。${selectableCount === 0 ? '聊几天再来。' : ''}</p>
      ` : `
        <div class="tl-list">
          ${visible.map(t => renderTimelineRow(t)).join('')}
        </div>
      `}
    `;
  }

  function renderTimelineRow(t) {
    const isMerged = Array.isArray(t.mergedFrom);
    const cls = ['tl-row'];
    if (isMerged) cls.push('merged');
    if (selected.has(t.id)) cls.push('selected');
    const cb = isMerged
      ? ''  // merged rows can't be re-selected for merging
      : `<input type="checkbox" class="tl-check" data-id="${esc(t.id)}"${selected.has(t.id) ? ' checked' : ''}>`;
    const undoBtn = isMerged
      ? `<button type="button" class="tl-unmerge" data-id="${esc(t.id)}" title="撤销合并">↺</button>`
      : '';
    const delBtn = `<button type="button" class="tl-del" data-id="${esc(t.id)}" title="删除">×</button>`;
    const mergedTag = isMerged ? `<span class="tl-merged-tag">合并(${t.mergedFrom.length} 条)</span>` : '';
    return `
      <div class="${cls.join(' ')}" data-id="${esc(t.id)}">
        ${cb}
        <div class="tl-body">
          <div class="tl-day">${esc(t.dayKey || '')} ${mergedTag}</div>
          <div class="tl-summary">${esc(t.summary || '(空)')}</div>
        </div>
        ${undoBtn}
        ${delBtn}
      </div>
    `;
  }

  function wire() {
    const backBtn = container.querySelector('.back');
    backBtn.addEventListener('click', () => router.back());

    // Tab switching
    container.querySelectorAll('.mm-tab').forEach(t => {
      t.addEventListener('click', async () => {
        if (t.dataset.tab === activeTab) return;
        activeTab = t.dataset.tab;
        await render();
        if (activeTab === 'timeline' && !lazyGenDone && !lazyGenBusy) {
          await runLazyGen({ background: true });
        }
      });
    });

    if (activeTab === 'memories') wireMemoriesTab();
    else                          wireTimelineTab();

    // First-time enter timeline tab → trigger lazy gen
    if (activeTab === 'timeline' && !lazyGenDone && !lazyGenBusy) {
      runLazyGen({ background: true });
    }
  }

  function wireMemoriesTab() {
    const form    = container.querySelector('.memory-prompt-form');
    const status  = container.querySelector('.form-status');
    const list    = container.querySelector('.memory-list');

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const fresh = await db.get('chatSessions', sessionId);
      fresh.memoryPromptOverride = String(fd.get('prompt') || '').trim();
      await db.set('chatSessions', fresh);
      Object.assign(session, fresh);
      status.textContent = '已保存(下一次压缩生效)';
      status.className = 'form-status success';
    });

    list?.addEventListener('click', async (e) => {
      const del = e.target.closest('.memory-delete');
      if (!del) return;
      const card = del.closest('[data-mem-id]');
      const memId = card?.dataset.memId;
      if (!memId) return;
      if (!await openConfirm(container, {
        title: '删除总结',
        message: '删除这条总结?这段的原始消息已经被压缩时删掉了,删了就只能下次重新生成新的。',
        confirmLabel: '删除',
        danger: true,
      })) return;
      await db.del('memories', memId);
      await render();
    });

    // Export — assemble plain text + download via a transient anchor. Keeps the
    // file inside the user's browser; we never upload anything.
    container.querySelector('.mem-export-btn')?.addEventListener('click', async () => {
      const memories = await db.query('memories', 'sessionId', sessionId);
      memories.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      const character = await db.get('characters', session.characterId);
      const header = `# ${character?.name || '会话'} · 记忆导出 · ${new Date().toLocaleString('zh-CN')}\n\n`;
      const body = memories.map((m, i) => {
        const d = new Date(m.createdAt);
        const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const tier = m.tier === 2 ? '[远期 / 章节]' : '[近期 / 片段]';
        return `${tier} #${i + 1} · ${date}\n${normalizeMemorySummary(m.summary) || '(空)'}`;
      }).join('\n\n---\n\n');
      const text = header + body + '\n';
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = `memories-${(character?.name || sessionId).replace(/[^\w一-龥]+/g, '_')}-${Date.now()}.txt`;
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a tick so Chrome has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  function wireTimelineTab() {
    const status = container.querySelector('.tl-status');
    const list   = container.querySelector('.tl-list');

    container.querySelector('.tl-gen-btn')?.addEventListener('click', () => runLazyGen({ background: false }));
    container.querySelector('.tl-merge-btn')?.addEventListener('click', async () => {
      const ids = [...selected];
      if (ids.length < 2) return;
      const btn = container.querySelector('.tl-merge-btn');
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = '合并中…';
      try {
        await timeline.mergeDays(sessionId, ids);
        selected.clear();
        await render();
      } catch (e) {
        status.textContent = `失败:${String(e).slice(0, 200)}`;
        status.className = 'tl-status error';
        btn.disabled = false;
        btn.textContent = orig;
      }
    });

    list?.addEventListener('click', async (e) => {
      const cb = e.target.closest('.tl-check');
      if (cb) {
        const id = cb.dataset.id;
        if (cb.checked) selected.add(id); else selected.delete(id);
        // Re-render only the merge button label + counter; cheap to just re-render whole tab
        await render();
        return;
      }
      const del = e.target.closest('.tl-del');
      if (del) {
        const id = del.dataset.id;
        if (!await openConfirm(container, {
          title: '删除时间线',
          message: '删除这条时间线?如果是合并条目,会一并把内部的原始条目恢复显示。',
          confirmLabel: '删除',
          danger: true,
        })) return;
        // If it's a merged row, also unlink originals
        const row = await db.get('timeline', id);
        if (row?.mergedFrom) {
          for (const origId of row.mergedFrom) {
            const orig = await db.get('timeline', origId);
            if (orig?.mergedInto === id) {
              delete orig.mergedInto;
              await db.set('timeline', orig);
            }
          }
        }
        await db.del('timeline', id);
        selected.delete(id);
        await render();
        return;
      }
      const undo = e.target.closest('.tl-unmerge');
      if (undo) {
        const id = undo.dataset.id;
        if (!await openConfirm(container, {
          title: '撤销合并',
          message: '撤销这次合并?合并条目被删除,原始的每日条目会恢复显示。',
          confirmLabel: '撤销',
        })) return;
        await timeline.unmerge(sessionId, id);
        await render();
        return;
      }
    });
  }

  async function runLazyGen({ background }) {
    if (lazyGenBusy) return;
    lazyGenBusy = true;
    const btn = container.querySelector('.tl-gen-btn');
    if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
    // Stash the final status onto closure state so we can write it AFTER
    // render() rebuilds the tab DOM (otherwise we'd be writing on a
    // node that's about to be replaced).
    let finalStatus = null;
    try {
      const res = await timeline.generateMissingDays(sessionId, {
        onProgress: ({ dayKey, total, done }) => {
          // Mid-flight progress writes to the live DOM (which won't be
          // replaced until generation completes).
          const live = container.querySelector('.tl-status');
          if (live) {
            live.textContent = `生成中 ${done + 1}/${total}: ${dayKey}`;
            live.className = 'tl-status';
          }
        },
      });
      lazyGenDone = true;
      if (res.generated === 0 && res.errors === 0) {
        finalStatus = { text: '没有需要生成的(今天不算)', cls: 'tl-status' };
      } else {
        finalStatus = {
          text: `生成 ${res.generated} 条${res.errors > 0 ? ` · ${res.errors} 条失败` : ''}`,
          cls: 'tl-status success',
        };
      }
    } catch (e) {
      finalStatus = { text: `失败:${String(e).slice(0, 200)}`, cls: 'tl-status error' };
    } finally {
      lazyGenBusy = false;
      await render();
      if (finalStatus) {
        const live = container.querySelector('.tl-status');
        if (live) { live.textContent = finalStatus.text; live.className = finalStatus.cls; }
      }
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
