// 独立「记忆」app — home 第二页入口,4 个 tab 横向打通现有记忆资产。
//
// 区别于聊天里的 memory-manage:那个是 session-scoped(只看当前会话);
// 这个是 cross-session 总览:把 timeline / memories / milestones 三类
// 数据全摊在一起,按日期组织。
//
// 4 tab:
//   月历:当月视图,有事件的日期着色,点开看当天细节
//   时间线:跨会话的一句话日总结流(各自会话生成,这里集中显示)
//   纪念日:用户标记的重要日子(本 phase 新增数据类型 — milestones store)
//   总结:跨会话的 L1/L2 记忆,按会话折叠分组
//
// 不进 system prompt — 整个 app 是给用户翻看 / 整理的。要进 prompt 的是
// memories(L1/L2,via context.buildSystemPromptParts)和 schedule(via
// buildScheduleLines)。

import * as db from '../../core/db.js';
import * as timeline from '../../core/timeline.js';
import { openConfirm } from '../../core/modal.js';

// 5 风格 + 默认。default = 不挂 body[data-mem-style](回退到 base.css 的 .ma-row),
// 其余 5 个由 src/styles/memory-styles.css 的 scope 接管 .mem-card 样式。
const MEMORY_STYLES = [
  { id: 'default', name: '默认',   desc: '简洁清单' },
  { id: 'planner', name: '手账本', desc: '横线纸 + 纸胶带' },
  { id: 'cabinet', name: '档案柜', desc: '文件夹 + 标签' },
  { id: 'petal',   name: '花瓣',   desc: '毛玻璃 + 渐变' },
  { id: 'film',    name: '胶片',   desc: '拍立得 + 齿孔' },
  { id: 'cosmic',  name: '星河',   desc: '深色 + 星点' },
];

export async function mountMemoryApp(container, params, router) {
  let activeTab = 'calendar';
  let calendarCursor = new Date();  // 1st day of currently-viewed month
  // Timeline-gen state survives re-render so the user sees button state +
  // last result text after the gen-driven render() lands.
  let tlGenBusy = false;
  let tlStatus = { text: '', cls: '' };
  // 角色筛选(timeline / milestones / summary tab 用,月历不动) — 空 = 全部。
  // user 先选角色才能进各 tab,也可以一直留"全部"看全局。
  let filterCharId = '';
  // 视觉风格 — 从 settings.memoryStyle 读,默认 planner(手账本)。每次进 app
  // 把 body.dataset.memStyle 设上,cleanup 清掉。这样 memory-styles.css 里的
  // `body[data-mem-style="..."]` scope 只在记忆 app 内生效。
  const initialSettings = (await db.get('settings', 'default')) || {};
  let memoryStyle = initialSettings.memoryStyle || 'planner';
  applyMemoryStyleToBody(memoryStyle);
  let stylePickerOpen = false;

  async function render() {
    const chars = (await db.getAll('characters')).filter(c => c.id !== '__bear__');
    const showFilter = activeTab !== 'calendar';
    const styleCur = MEMORY_STYLES.find(s => s.id === memoryStyle) || MEMORY_STYLES[0];
    container.innerHTML = `
      <div class="page memory-app-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">记忆</div>
          <div class="actions">
            <button class="ma-style-btn" type="button" title="切换风格" aria-label="切换风格">
              <span class="ma-style-name">${esc(styleCur.name)}</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            ${stylePickerOpen ? `
              <div class="ma-style-menu" role="menu">
                ${MEMORY_STYLES.map(s => `
                  <button class="ma-style-opt${s.id === memoryStyle ? ' active' : ''}" data-style="${esc(s.id)}" type="button">
                    <span class="ma-style-opt-name">${esc(s.name)}</span>
                    <span class="ma-style-opt-desc">${esc(s.desc)}</span>
                  </button>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </header>
        <div class="page-body">
          <div class="ma-tabs">
            <button class="ma-tab${activeTab === 'calendar'   ? ' active' : ''}" data-tab="calendar">月历</button>
            <button class="ma-tab${activeTab === 'timeline'   ? ' active' : ''}" data-tab="timeline">时间线</button>
            <button class="ma-tab${activeTab === 'milestones' ? ' active' : ''}" data-tab="milestones">纪念日</button>
            <button class="ma-tab${activeTab === 'summary'    ? ' active' : ''}" data-tab="summary">总结</button>
          </div>
          ${showFilter ? `
            <div class="ma-char-filter">
              <label>
                <span class="ma-filter-label">角色</span>
                <select class="ma-filter-select">
                  <option value=""${!filterCharId ? ' selected' : ''}>全部</option>
                  ${chars.map(c => `<option value="${esc(c.id)}"${c.id === filterCharId ? ' selected' : ''}>${esc(c.name || '(未命名)')}</option>`).join('')}
                </select>
              </label>
            </div>
          ` : ''}
          <div class="ma-tab-body">
            ${activeTab === 'calendar'   ? await renderCalendar()
            : activeTab === 'timeline'   ? await renderTimeline()
            : activeTab === 'milestones' ? await renderMilestones()
            :                              await renderSummary()}
          </div>
        </div>
      </div>
    `;
    wire();
  }

  // ── Calendar tab ────────────────────────────────────────────────────
  async function renderCalendar() {
    const year  = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const monthLabel = `${year} 年 ${month + 1} 月`;

    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth  = new Date(year, month + 1, 0);
    const daysInMonth  = lastOfMonth.getDate();
    const startWeekday = firstOfMonth.getDay();  // 0 = Sun

    // Pre-bucket events by dayKey for this month — three sets, three dot colors.
    const allTl  = (await db.getAll('timeline')).filter(t => !t.mergedInto);
    const allMem = await db.getAll('memories');
    const allMs  = await db.getAll('milestones');
    const tlByDay  = new Map();
    const memByDay = new Map();
    const msByDay  = new Map();
    for (const t of allTl)  tlByDay.set(t.dayKey, (tlByDay.get(t.dayKey) || 0) + 1);
    for (const m of allMem) {
      const k = dayKeyOf(m.createdAt);
      memByDay.set(k, (memByDay.get(k) || 0) + 1);
    }
    for (const ms of allMs) {
      if (!ms.dayKey) continue;
      msByDay.set(ms.dayKey, (msByDay.get(ms.dayKey) || 0) + 1);
      // Recurring milestones also light up the same MM-DD in the currently-viewed year.
      if (ms.recurring) {
        const parts = ms.dayKey.split('-');
        if (parts.length === 3) {
          const recurKey = `${year}-${parts[1]}-${parts[2]}`;
          if (recurKey !== ms.dayKey && Number(parts[1]) === month + 1) {
            msByDay.set(recurKey, (msByDay.get(recurKey) || 0) + 1);
          }
        }
      }
    }

    const todayKey = dayKeyOf(Date.now());
    const cells = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push('<div class="ma-cell empty" aria-hidden="true"></div>');
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dayKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hasTl  = tlByDay.has(dayKey);
      const hasMem = memByDay.has(dayKey);
      const hasMs  = msByDay.has(dayKey);
      const isToday = dayKey === todayKey;
      cells.push(`
        <button class="ma-cell${isToday ? ' today' : ''}${(hasTl || hasMem || hasMs) ? ' has-event' : ''}" data-day-key="${dayKey}">
          <span class="ma-cell-day">${d}</span>
          <span class="ma-cell-dots">
            ${hasTl  ? '<i class="dot tl"></i>'  : ''}
            ${hasMem ? '<i class="dot mem"></i>' : ''}
            ${hasMs  ? '<i class="dot ms"></i>'  : ''}
          </span>
        </button>
      `);
    }

    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return `
      <div class="ma-cal-nav">
        <button class="ma-nav-btn prev" type="button">‹</button>
        <span class="ma-month-label">${monthLabel}</span>
        <button class="ma-nav-btn next" type="button">›</button>
      </div>
      <div class="ma-cal-weekdays">
        ${weekdays.map(w => `<div class="ma-weekday">${w}</div>`).join('')}
      </div>
      <div class="ma-cal-grid">${cells.join('')}</div>
      <div class="ma-legend">
        <span><i class="dot tl"></i> 时间线</span>
        <span><i class="dot mem"></i> 总结</span>
        <span><i class="dot ms"></i> 纪念日</span>
      </div>
    `;
  }

  // ── Timeline tab (cross-session) ────────────────────────────────────
  async function renderTimeline() {
    // Pull EVERY row including merged-into ones — we need them as a lookup
    // for the merged row's <details> expansion. The top-level list still
    // hides mergedInto rows so they don't show up twice.
    const allTl = await db.getAll('timeline');
    const byId = new Map(allTl.map(t => [t.id, t]));
    const sessions = await db.getAll('chatSessions');
    const chars    = await db.getAll('characters');
    // 角色 filter:把 sessionId 映射到 characterId,然后过滤
    let topLevel = allTl.filter(t => !t.mergedInto);
    if (filterCharId) {
      const sidByChar = new Set(sessions.filter(s => s.characterId === filterCharId).map(s => s.id));
      topLevel = topLevel.filter(t => sidByChar.has(t.sessionId));
    }
    topLevel.sort((a, b) => (b.dayKey || '').localeCompare(a.dayKey || ''));
    const labelFor = (sid) => {
      const s = sessions.find(x => x.id === sid);
      if (!s) return '(未知会话)';
      const c = chars.find(x => x.id === s.characterId);
      return c?.name || s.title || '(未命名)';
    };
    // Header: scan-and-gen button + status. Survives re-render via the
    // mountMemoryApp closure (tlGenBusy / tlStatus).
    const head = `
      <div class="ma-tl-head">
        <button class="ma-tl-gen btn" type="button"${tlGenBusy ? ' disabled' : ''}>${tlGenBusy ? '生成中…' : '扫描并生成缺失天'}</button>
        <span class="ma-tl-status${tlStatus.cls || ''}">${esc(tlStatus.text || '')}</span>
      </div>
    `;
    if (topLevel.length === 0) {
      return head + `<p class="hint">还没有时间线条目。点击上方按钮扫描各会话的对话历史,自动生成每天的一句话总结(不含今天)。</p>`;
    }
    return head + `
      <div class="ma-list">
        ${topLevel.map(t => {
          const mergedDetail = (Array.isArray(t.mergedFrom) && t.mergedFrom.length > 0)
            ? `<details class="ma-merged-detail">
                <summary>展开合并前 ${t.mergedFrom.length} 天</summary>
                ${t.mergedFrom.map(origId => {
                  const orig = byId.get(origId);
                  if (!orig) return `<div class="ma-sub-row dim">(原始行已丢失)</div>`;
                  return `<div class="ma-sub-row"><b>${esc(orig.dayKey)}</b> · ${esc(orig.summary || '(空)')}</div>`;
                }).join('')}
              </details>`
            : '';
          return `
            <div class="ma-row${t.mergedFrom ? ' merged-row' : ''}">
              <div class="ma-row-meta">${esc(t.dayKey || '')} · ${esc(labelFor(t.sessionId))}${t.mergedFrom ? ` · 合并(${t.mergedFrom.length})` : ''}</div>
              <div class="ma-row-body">${esc(t.summary || '(空)')}</div>
              ${mergedDetail}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Cross-session timeline gen. Iterates sessions serially so we don't
  // blast the embedding/chat endpoint with parallel calls. onProgress
  // writes into the live DOM mid-flight; the final outcome lives on the
  // tlStatus closure so the post-gen re-render shows it.
  async function runTimelineGen() {
    if (tlGenBusy) return;
    tlGenBusy = true;
    tlStatus = { text: '扫描中…', cls: '' };
    const btn  = container.querySelector('.ma-tl-gen');
    const stat = container.querySelector('.ma-tl-status');
    if (btn)  { btn.disabled = true; btn.textContent = '生成中…'; }
    if (stat) { stat.textContent = tlStatus.text; stat.className = 'ma-tl-status'; }
    let totalGen = 0, totalErr = 0, totalRemaining = 0;
    try {
      const sessions = await db.getAll('chatSessions');
      const chars    = await db.getAll('characters');
      const labelOf = (s) => {
        const c = chars.find(x => x.id === s.characterId);
        return c?.name || s.title || '(未命名会话)';
      };
      for (const s of sessions) {
        try {
          const res = await timeline.generateMissingDays(s.id, {
            onProgress: ({ dayKey, total, done }) => {
              const live = container.querySelector('.ma-tl-status');
              if (live) {
                live.textContent = `${labelOf(s)}: ${done + 1}/${total} ${dayKey}`;
                live.className = 'ma-tl-status';
              }
            },
          });
          totalGen += res.generated;
          totalErr += res.errors;
          totalRemaining += res.remaining || 0;
        } catch (e) {
          console.warn('[memory-app] timeline gen failed for', s.id, e);
          totalErr++;
        }
      }
      const remainingNote = totalRemaining > 0 ? ` · 还有 ${totalRemaining} 天未生成,再点继续` : '';
      tlStatus = (totalGen > 0 || totalErr > 0)
        ? { text: `共生成 ${totalGen} 条${totalErr ? ` · ${totalErr} 条失败` : ''}${remainingNote}`, cls: totalErr ? ' error' : ' success' }
        : { text: '没有需要生成的(今天不算)', cls: '' };
    } catch (e) {
      tlStatus = { text: `失败:${String(e).slice(0, 200)}`, cls: ' error' };
    } finally {
      tlGenBusy = false;
      if (activeTab === 'timeline') await render();
    }
  }

  // ── Milestones tab ──────────────────────────────────────────────────
  async function renderMilestones() {
    let all = await db.getAll('milestones');
    if (filterCharId) {
      all = all.filter(m => m.characterId === filterCharId);
    }
    all.sort((a, b) => (b.dayKey || '').localeCompare(a.dayKey || ''));
    const chars = await db.getAll('characters');
    const charLabel = (cid) => cid ? (chars.find(c => c.id === cid)?.name || '(未知角色)') : '';
    return `
      <div class="ma-ms-head">
        <button class="ma-ms-new btn" type="button">+ 新建纪念日</button>
      </div>
      ${all.length === 0 ? `
        <p class="hint">还没有纪念日。点上方按钮添加。可以设「每年重复」让生日 / 周年自动在月历里高亮。</p>
      ` : `
        <div class="ma-list">
          ${all.map(m => `
            <div class="ma-row ms-row" data-ms-id="${esc(m.id)}">
              <div class="ma-row-meta">
                ${esc(m.dayKey || '')}${m.recurring ? ' · 每年' : ''}${m.characterId ? ` · ${esc(charLabel(m.characterId))}` : ''}
              </div>
              <div class="ma-row-body">
                <b>${esc(m.title || '(无标题)')}</b>${m.desc ? ` — ${esc(m.desc)}` : ''}
              </div>
              <button class="ma-row-del" type="button" title="删除">×</button>
            </div>
          `).join('')}
        </div>
      `}
    `;
  }

  // ── Summary tab (cross-session memories) ────────────────────────────
  async function renderSummary() {
    let allMems = await db.getAll('memories');
    const sessions = await db.getAll('chatSessions');
    const chars    = await db.getAll('characters');
    if (filterCharId) {
      const sidByChar = new Set(sessions.filter(s => s.characterId === filterCharId).map(s => s.id));
      allMems = allMems.filter(m => sidByChar.has(m.sessionId));
    }
    if (allMems.length === 0) {
      return `<p class="hint">还没有总结。在某个会话里聊到超过 threshold(设置 → 记忆总结)后会自动生成。</p>`;
    }
    allMems.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const bySession = new Map();
    for (const m of allMems) {
      if (!bySession.has(m.sessionId)) bySession.set(m.sessionId, []);
      bySession.get(m.sessionId).push(m);
    }
    // Sort groups by most-recent memory's createdAt desc.
    const groups = [...bySession.entries()]
      .map(([sid, mems]) => ({ sid, mems, latest: mems[0]?.createdAt || 0 }))
      .sort((a, b) => b.latest - a.latest);
    return `
      <div class="ma-list">
        ${groups.map(g => {
          const s = sessions.find(x => x.id === g.sid);
          const c = s ? chars.find(x => x.id === s.characterId) : null;
          return `
            <details class="ma-session-group" open>
              <summary>${esc(c?.name || s?.title || '(未知会话)')} · ${g.mems.length} 条</summary>
              ${g.mems.map(m => `
                <div class="ma-row">
                  <div class="ma-row-meta">${esc(formatDate(m.createdAt))}${m.tier === 2 ? ' · 远期' : ''}</div>
                  <div class="ma-row-body">${esc(m.summary || '(空)')}</div>
                </div>
              `).join('')}
            </details>
          `;
        }).join('')}
      </div>
    `;
  }

  // ── Wiring (per-render) ─────────────────────────────────────────────
  function wire() {
    container.querySelector('.back')?.addEventListener('click', () => router.back());
    // 风格切换 — 点 btn 开/关菜单,点选项写 settings 并立即应用。
    container.querySelector('.ma-style-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      stylePickerOpen = !stylePickerOpen;
      await render();
    });
    container.querySelectorAll('.ma-style-opt').forEach(opt => {
      opt.addEventListener('click', async (e) => {
        e.stopPropagation();
        const next = opt.dataset.style;
        if (next === memoryStyle) { stylePickerOpen = false; await render(); return; }
        memoryStyle = next;
        applyMemoryStyleToBody(memoryStyle);
        await db.updateSettings(s => { s.memoryStyle = next; return s; });
        stylePickerOpen = false;
        await render();
      });
    });
    // 点菜单外面关掉(下一次 render 清掉)。
    if (stylePickerOpen) {
      const onDocClick = (e) => {
        if (!e.target.closest('.actions')) {
          stylePickerOpen = false;
          document.removeEventListener('click', onDocClick);
          render();
        }
      };
      // 延后绑定,避免本次 click 立刻自身触发关闭。
      setTimeout(() => document.addEventListener('click', onDocClick), 0);
    }
    container.querySelectorAll('.ma-tab').forEach(t => {
      t.addEventListener('click', async () => {
        if (t.dataset.tab === activeTab) return;
        activeTab = t.dataset.tab;
        await render();
      });
    });
    // 角色 filter change → re-render 当前 tab(filterCharId 是 closure)
    container.querySelector('.ma-filter-select')?.addEventListener('change', async (e) => {
      filterCharId = e.target.value || '';
      await render();
    });

    container.querySelector('.ma-nav-btn.prev')?.addEventListener('click', async () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
      await render();
    });
    container.querySelector('.ma-nav-btn.next')?.addEventListener('click', async () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
      await render();
    });
    container.querySelectorAll('.ma-cell[data-day-key]').forEach(c => {
      c.addEventListener('click', () => openDayModal(c.dataset.dayKey));
    });

    container.querySelector('.ma-tl-gen')?.addEventListener('click', runTimelineGen);

    container.querySelector('.ma-ms-new')?.addEventListener('click', () => openMilestoneEditor(null));
    container.querySelectorAll('.ms-row').forEach(r => {
      r.addEventListener('click', (e) => {
        if (e.target.closest('.ma-row-del')) return;
        openMilestoneEditor(r.dataset.msId);
      });
    });
    container.querySelectorAll('.ma-row-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row = btn.closest('[data-ms-id]');
        if (!await openConfirm(container, {
          title: '删除纪念日', message: '确定删除这条纪念日?',
          confirmLabel: '删除', danger: true,
        })) return;
        await db.del('milestones', row.dataset.msId);
        await render();
      });
    });
  }

  // ── Per-day detail modal (calendar click) ───────────────────────────
  async function openDayModal(dayKey) {
    const allTl   = (await db.getAll('timeline')).filter(t => t.dayKey === dayKey && !t.mergedInto);
    const allMs   = (await db.getAll('milestones')).filter(m => m.dayKey === dayKey);
    const allMems = (await db.getAll('memories')).filter(m => dayKeyOf(m.createdAt) === dayKey);
    const sessions = await db.getAll('chatSessions');
    const chars    = await db.getAll('characters');
    const labelFor = (sid) => {
      const s = sessions.find(x => x.id === sid);
      if (!s) return '(未知会话)';
      return chars.find(x => x.id === s.characterId)?.name || s.title || '(未命名)';
    };
    const sections = [];
    if (allMs.length > 0) {
      sections.push(`<div class="ma-day-section"><h4>纪念日</h4>${allMs.map(m =>
        `<div><b>${esc(m.title)}</b>${m.desc ? ' — ' + esc(m.desc) : ''}</div>`
      ).join('')}</div>`);
    }
    if (allTl.length > 0) {
      sections.push(`<div class="ma-day-section"><h4>时间线</h4>${allTl.map(t =>
        `<div><b>${esc(labelFor(t.sessionId))}</b>:${esc(t.summary)}</div>`
      ).join('')}</div>`);
    }
    if (allMems.length > 0) {
      sections.push(`<div class="ma-day-section"><h4>总结</h4>${allMems.map(m =>
        `<div><b>${esc(labelFor(m.sessionId))}</b>${m.tier === 2 ? '(远期)' : ''}:${esc(m.summary)}</div>`
      ).join('')}</div>`);
    }
    const content = sections.length > 0
      ? sections.join('')
      : '<p class="hint">这天没有任何记录。</p>';
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">${esc(dayKey)}</div>
        <div class="ma-day-content">${content}</div>
        <div class="modal-actions">
          <button type="button" class="btn secondary close-btn">关闭</button>
          <button type="button" class="btn add-ms-btn">+ 加纪念日</button>
        </div>
      </div>
    `;
    container.appendChild(modal);
    modal.querySelector('.close-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('.add-ms-btn').addEventListener('click', () => {
      modal.remove();
      openMilestoneEditor(null, { dayKey });
    });
  }

  // ── Milestone editor (new + edit) ───────────────────────────────────
  async function openMilestoneEditor(id, defaults = {}) {
    const existing = id ? await db.get('milestones', id) : null;
    const m = existing || {
      dayKey: defaults.dayKey || dayKeyOf(Date.now()),
      title: '', desc: '',
      recurring: false, characterId: null,
    };
    const chars = (await db.getAll('characters')).filter(c => c.id !== '__bear__');
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">${existing ? '编辑纪念日' : '新建纪念日'}</div>
        <form class="ms-form" autocomplete="off">
          <label>
            <div class="label-text">日期</div>
            <input name="dayKey" type="date" value="${esc(m.dayKey)}" required>
          </label>
          <label>
            <div class="label-text">标题</div>
            <input name="title" type="text" required value="${esc(m.title)}" placeholder="比如:第一次见面 / 生日">
          </label>
          <label>
            <div class="label-text">描述(可选)</div>
            <textarea name="desc" rows="3">${esc(m.desc || '')}</textarea>
          </label>
          <label>
            <div class="label-text">关联角色(可选)</div>
            <select name="characterId">
              <option value="">(无关联)</option>
              ${chars.map(c => `<option value="${esc(c.id)}"${c.id === m.characterId ? ' selected' : ''}>${esc(c.name || '(未命名)')}</option>`).join('')}
            </select>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" name="recurring"${m.recurring ? ' checked' : ''}>
            <span>每年重复(月-日 在月历里都会高亮)</span>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">${existing ? '保存' : '创建'}</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      const next = {
        id: id || db.newId(),
        dayKey: String(fd.get('dayKey')),
        title: String(fd.get('title') || '').trim() || '(无标题)',
        desc: String(fd.get('desc') || '').trim(),
        characterId: String(fd.get('characterId') || '') || null,
        recurring: fd.get('recurring') === 'on',
        createdAt: existing?.createdAt || Date.now(),
      };
      await db.set('milestones', next);
      modal.remove();
      await render();
    });
  }

  await render();
  // cleanup:离开记忆 app 时清掉 body.dataset.memStyle,免得 memory-styles.css
  // 的 scope 漏到其他 app(例如桌面也用 .mem-card 的话)。
  return () => {
    delete document.body.dataset.memStyle;
  };
}

function applyMemoryStyleToBody(style) {
  if (!style || style === 'default') {
    delete document.body.dataset.memStyle;
  } else {
    document.body.dataset.memStyle = style;
  }
}

function dayKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
