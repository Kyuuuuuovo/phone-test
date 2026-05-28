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
import * as embedding from '../../core/embedding.js';
import { openConfirm } from '../../core/modal.js';
import { normalizeMemorySummary } from '../../core/context.js';

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
  // Vector hits 区(summary tab 顶部)— 配置了 embedding 才显示。query 用
  // 输入框,user 输入后跑跨会话 cosine 召回。状态走 closure,re-render 保持。
  let vectorQuery = '';
  let vectorHits = null;     // null = 未搜过;[] = 搜过没结果;[...] = 有命中
  let vectorBusy = false;
  // 向量打标 backfill 状态。老 memory 没 tag 字段,新生成的(context MVP)有。
  // user 点按钮 → 串行扫所有缺 tag 的 memory,逐条 AI 分类,写回 m.tag。
  let backfillBusy = false;
  let backfillStatus = { text: '', cls: '' };

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
            <button class="ma-tab${activeTab === 'profile'    ? ' active' : ''}" data-tab="profile">关于你</button>
            <button class="ma-tab${activeTab === 'summary'    ? ' active' : ''}" data-tab="summary">总结</button>
          </div>
          ${showFilter ? renderCharFilter(chars) : ''}
          <div class="ma-tab-body">
            ${activeTab === 'calendar'   ? await renderCalendar()
            : activeTab === 'timeline'   ? await renderTimeline()
            : activeTab === 'milestones' ? await renderMilestones()
            : activeTab === 'profile'    ? await renderProfiles()
            :                              await renderSummary()}
          </div>
        </div>
      </div>
    `;
    wire();
  }

  // ── 角色选择器(两种形态) ───────────────────────────────────────────
  // cabinet 风格:纵向文件夹列表(左色条 + 名字 + 计数 + 右箭头)— 替代 select
  // 其他 4 风格:横向头像 chip(圆头 + 名字 + 选中态色边)
  // 一律保留"全部"选项作为第 0 个。
  function renderCharFilter(chars) {
    if (memoryStyle === 'cabinet') {
      const all = `
        <button class="mem-folder${!filterCharId ? ' active' : ''}" data-char-id="" type="button">
          <span class="mem-folder-bar" style="background:#9A9A95"></span>
          <span class="mem-folder-name">全部</span>
          <span class="mem-folder-arrow">›</span>
        </button>
      `;
      const rows = chars.map(c => {
        const color = stableColor(c.id);
        return `
          <button class="mem-folder${c.id === filterCharId ? ' active' : ''}" data-char-id="${esc(c.id)}" type="button">
            <span class="mem-folder-bar" style="background:${color}"></span>
            <span class="mem-folder-name">${esc(c.name || '(未命名)')}</span>
            <span class="mem-folder-arrow">›</span>
          </button>
        `;
      }).join('');
      return `<div class="mem-folder-list">${all}${rows}</div>`;
    }
    // 默认 / planner / petal / film / cosmic — 横向 chip
    const chip = (id, name, avatar) => {
      const color = stableColor(id || 'all');
      const active = (id || '') === filterCharId ? ' active' : '';
      const initial = (name || '?').slice(0, 1);
      const avatarHtml = avatar
        ? `<span class="mem-chip-avatar"><img src="${esc(avatar)}" alt=""></span>`
        : `<span class="mem-chip-avatar" style="background:${color}">${esc(initial)}</span>`;
      return `<button class="mem-char-chip${active}" data-char-id="${esc(id || '')}" type="button">${avatarHtml}<span class="mem-chip-name">${esc(name)}</span></button>`;
    };
    return `
      <div class="mem-char-chips">
        ${chip('', '全部', null)}
        ${chars.map(c => chip(c.id, c.name || '(未命名)', c.avatar)).join('')}
      </div>
    `;
  }

  // 一份卡片 builder,5 风格共用结构、各 scope 改外观。
  // 入参:meta=string[](会用 · join)、body=主文本、tier=1/2(可选)、
  //   timeRange='5月22日'/'5月22日–5月23日'(可选)、tag='转折'等(可选)、
  //   score=0..1(可选,vector hits 用)、extras=尾部 HTML、dataAttrs=自定义属性。
  function buildMemCard({ meta = [], body, tier, timeRange, tag, score, extras = '', dataAttrs = '', cardClass = '' }) {
    const tierChip = tier
      ? `<span class="mem-tier mem-tier-${tier === 2 ? 'l2' : 'l1'}">${tier === 2 ? 'L2' : 'L1'}</span>`
      : '';
    const timeChip   = timeRange ? `<span class="mem-timerange">${esc(timeRange)}</span>` : '';
    const tagChip    = tag       ? `<span class="mem-tag mem-tag-${esc(tag)}">${esc(tag)}</span>` : '';
    const scoreChip  = (score != null) ? `<span class="mem-score">${Math.round(score * 100)}%</span>` : '';
    const chips = [tierChip, timeChip, tagChip, scoreChip].filter(Boolean).join('');
    return `
      <div class="ma-row${cardClass ? ' ' + cardClass : ''}"${dataAttrs ? ' ' + dataAttrs : ''}>
        ${chips ? `<div class="mem-chips">${chips}</div>` : ''}
        ${meta.length > 0 ? `<div class="ma-row-meta">${meta.map(esc).join(' · ')}</div>` : ''}
        <div class="ma-row-body">${esc(body || '(空)')}</div>
        ${extras}
      </div>
    `;
  }

  // tag 优先 saved(向量打标 MVP — context.maybeCompressMemory 现在生成时
  // 顺带打 tag),没保存的(老 memory + 解析失败的)走启发式 fallback。
  // 启发式优先级:转折 > 冲突 > 亲密 > 发现 > 约定 > 日常(兜底)。
  function tagOf(m) {
    if (typeof m?.tag === 'string' && m.tag.trim()) return m.tag.trim();
    return heuristicTag(normalizeMemorySummary(m?.summary));
  }
  function heuristicTag(text) {
    const t = String(text || '');
    if (/第一次|表白|分手|和好|决定|改变|转变/.test(t))                       return '转折';
    if (/吵架|生气|冷战|不满|失望|矛盾|争执/.test(t))                         return '冲突';
    if (/喜欢|爱|温柔|拥抱|想念|心动|甜|亲密|陪/.test(t))                     return '亲密';
    if (/知道|了解|原来|学到|发现|聊到|讲到|说起/.test(t))                    return '发现';
    if (/约|计划|周末|下次|明天|去|要做|安排|准备/.test(t))                   return '约定';
    return '日常';
  }

  // 时间覆盖范围 — m.fromMsgId / m.toMsgId 查 chatMessages cache,渲成
  // `5月22日` 或 `5月22日–5月23日`。msgIdx 是 caller 预建的 id→msg map。
  function timeRangeOf(m, msgIdx) {
    const from = m.fromMsgId ? msgIdx.get(m.fromMsgId) : null;
    const to   = m.toMsgId   ? msgIdx.get(m.toMsgId)   : null;
    if (!from || !to) return null;
    const fromDate = new Date(from.createdAt);
    const toDate   = new Date(to.createdAt);
    const fmt = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;
    const sameDay = fromDate.toDateString() === toDate.toDateString();
    return sameDay ? fmt(fromDate) : `${fmt(fromDate)}–${fmt(toDate)}`;
  }

  // 角色 id → 稳定颜色(用于 folder 色条 / chip 头像兜底背景)。简单 hash 取
  // HSL 色相,避免对每个 c 都从 character.color 字段读(那字段不存在)。
  function stableColor(id) {
    let h = 0;
    const s = String(id || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xfffff;
    return `hsl(${h % 360}, 38%, 56%)`;
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
          const meta = [t.dayKey || '', labelFor(t.sessionId)];
          if (t.mergedFrom) meta.push(`合并(${t.mergedFrom.length})`);
          return buildMemCard({
            meta,
            body: t.summary,
            tag: heuristicTag(t.summary),
            extras: mergedDetail,
            cardClass: t.mergedFrom ? 'merged-row' : '',
          });
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
          ${all.map(m => {
            const meta = [m.dayKey || ''];
            if (m.recurring) meta.push('每年');
            if (m.characterId) meta.push(charLabel(m.characterId));
            const body = m.title || '(无标题)';
            const extras = `<button class="ma-row-del" type="button" title="删除">×</button>${m.desc ? `<div class="ma-row-desc">${esc(m.desc)}</div>` : ''}`;
            return buildMemCard({
              meta,
              body,
              cardClass: 'ms-row',
              dataAttrs: `data-ms-id="${esc(m.id)}"`,
              extras,
            });
          }).join('')}
        </div>
      `}
    `;
  }

  // ── User profile tab ────────────────────────────────────────────────
  // 每条 profile = 一对 (角色×人设) 的"在你眼里 ta 是什么人"。三段:喜欢 /
  // 不喜欢 / 你发现。注入到「# 用户画像」prompt section,context 端 lookup 先
  // 精确匹配后 fallback 共享行。受角色 filter 限定。
  async function renderProfiles() {
    let all = await db.getAll('userProfiles');
    const chars    = await db.getAll('characters');
    const personas = await db.getAll('personas');
    if (filterCharId) {
      all = all.filter(p => p.characterId === filterCharId);
    }
    all.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    const charLabel    = (cid) => cid ? (chars.find(c => c.id === cid)?.name || '(未知角色)') : '';
    const personaLabel = (pid) => pid ? (personas.find(p => p.id === pid)?.name || '(未知人设)') : '所有人设共享';
    return `
      <div class="ma-ms-head">
        <button class="ma-profile-new btn" type="button">+ 新建</button>
      </div>
      ${all.length === 0 ? `
        <p class="hint">还没有「关于你」的记录。新建后,聊天 system prompt 会注入「# 关于你」段,让 ta 知道你的喜好。每条 500 字以内,空段不渲染。</p>
      ` : `
        <div class="ma-list">
          ${all.map(p => {
            const meta = [charLabel(p.characterId), personaLabel(p.personaId)];
            const previewBits = [];
            if (p.likes)       previewBits.push(`喜欢:${p.likes.split('\n')[0].slice(0, 30)}`);
            if (p.dislikes)    previewBits.push(`不喜欢:${p.dislikes.split('\n')[0].slice(0, 30)}`);
            if (p.discoveries) previewBits.push(`发现:${p.discoveries.split('\n')[0].slice(0, 30)}`);
            const body = previewBits.length > 0 ? previewBits.join(' · ') : '(空 — 点击编辑)';
            const extras = `<button class="ma-row-del" type="button" title="删除">×</button>`;
            return buildMemCard({
              meta,
              body,
              cardClass: 'profile-row',
              dataAttrs: `data-profile-id="${esc(p.id)}"`,
              extras,
            });
          }).join('')}
        </div>
      `}
    `;
  }

  // 用户画像编辑器 — 新建或编辑。三段 textarea + 角色 picker + 人设 picker。
  // 总字数提示但不强卡,模型 prompt 端 ≤500 字时效果最好(超了仍可保存)。
  async function openProfileEditor(id, defaults = {}) {
    const chars = (await db.getAll('characters')).filter(c => c.id !== '__bear__');
    const personas = await db.getAll('personas');
    const existing = id ? await db.get('userProfiles', id) : null;
    const p = existing || {
      characterId: defaults.characterId || filterCharId || chars[0]?.id || '',
      personaId: '',
      likes: '', dislikes: '', discoveries: '',
    };
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">${existing ? '编辑「关于你」' : '新建「关于你」'}</div>
        <form class="profile-form" autocomplete="off">
          <label>
            <div class="label-text">角色</div>
            <select name="characterId" ${existing ? 'disabled' : ''} required>
              ${chars.map(c => `<option value="${esc(c.id)}"${c.id === p.characterId ? ' selected' : ''}>${esc(c.name || '(未命名)')}</option>`).join('')}
            </select>
          </label>
          <label>
            <div class="label-text">人设(留空 = 所有人设共享)</div>
            <select name="personaId" ${existing ? 'disabled' : ''}>
              <option value=""${!p.personaId ? ' selected' : ''}>所有人设共享</option>
              ${personas.map(pp => `<option value="${esc(pp.id)}"${pp.id === p.personaId ? ' selected' : ''}>${esc(pp.name || '(未命名)')}</option>`).join('')}
            </select>
          </label>
          <label>
            <div class="label-text">ta 喜欢的</div>
            <textarea name="likes" rows="3" placeholder="比如:咖啡、周末爬山、推理小说">${esc(p.likes)}</textarea>
          </label>
          <label>
            <div class="label-text">ta 不喜欢的</div>
            <textarea name="dislikes" rows="3" placeholder="比如:迟到、油腻食物">${esc(p.dislikes)}</textarea>
          </label>
          <label>
            <div class="label-text">你发现的事</div>
            <textarea name="discoveries" rows="4" placeholder="ta 是程序员,养了只猫叫毛毛,最近备战马拉松…">${esc(p.discoveries)}</textarea>
          </label>
          <p class="hint">三段加起来建议 ≤500 字。注入 prompt 的「# 关于你」段时空段自动跳过。${existing ? '<br>id 锁定(角色 + 人设不能改),想换组合请新建。' : ''}</p>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">${existing ? '保存' : '创建'}</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      // 锁定字段在 disabled 状态下不进 FormData — 从 existing 拿
      const characterId = existing ? existing.characterId : String(fd.get('characterId') || '');
      const personaId   = existing ? existing.personaId   : String(fd.get('personaId') || '');
      if (!characterId) { modal.querySelector('select[name="characterId"]').focus(); return; }
      const compositeId = `${characterId}|${personaId}`;
      // 不允许同一 (char, persona) 创建两条 — 提示用户去编辑现有
      if (!existing) {
        const dup = await db.get('userProfiles', compositeId);
        if (dup) {
          const status = document.createElement('div');
          status.className = 'form-status error';
          status.textContent = '这个组合已有画像了,关闭后从列表里编辑。';
          modal.querySelector('form').appendChild(status);
          return;
        }
      }
      const next = {
        id: compositeId,
        characterId,
        personaId,
        likes:       String(fd.get('likes')       || '').trim(),
        dislikes:    String(fd.get('dislikes')    || '').trim(),
        discoveries: String(fd.get('discoveries') || '').trim(),
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      await db.set('userProfiles', next);
      modal.remove();
      await render();
    });
  }

  // ── Summary tab (cross-session memories) ────────────────────────────
  // 多了 3 件事(per critique):
  //   1. 顶部 .mem-vector-hits 区(配了 embedding 才显)— 输入框 + 跨会话召回
  //   2. 每张卡片显示 tier(L1/L2)/ 时间覆盖范围 / 启发式 tag
  //   3. ma-row 走 buildMemCard,跟 timeline / milestones 共用结构
  async function renderSummary() {
    const settings = (await db.get('settings', 'default')) || {};
    const embEnabled = settings.embedding?.enabled === true;
    let allMems = await db.getAll('memories');
    const sessions = await db.getAll('chatSessions');
    const chars    = await db.getAll('characters');
    if (filterCharId) {
      const sidByChar = new Set(sessions.filter(s => s.characterId === filterCharId).map(s => s.id));
      allMems = allMems.filter(m => sidByChar.has(m.sessionId));
    }
    // chatMessages 一次性 cache,为 timeRangeOf 服务(避免 N+1)。
    const allMsgs = await db.getAll('chatMessages');
    const msgIdx = new Map(allMsgs.map(m => [m.id, m]));

    // vector hits 区块 — embedding 没开就 hint,开了就显输入框 + 命中卡片
    const vectorBlock = embEnabled ? `
      <div class="mem-vector-hits">
        <div class="mem-vh-head">
          <span class="mem-vh-label">语义检索命中</span>
          <input type="text" class="mem-vh-input" placeholder="想找跟什么相关的记忆?" value="${esc(vectorQuery)}" ${vectorBusy ? 'disabled' : ''}>
          <button type="button" class="mem-vh-search btn" ${vectorBusy ? 'disabled' : ''}>${vectorBusy ? '搜索中…' : '搜索'}</button>
        </div>
        ${vectorHits === null ? `
          <div class="mem-vh-empty">输入关键词或想表达的情境,Enter 或点搜索。</div>
        ` : vectorHits.length === 0 ? `
          <div class="mem-vh-empty">没有命中(阈值 0.35,试试换个表达?)</div>
        ` : `
          <div class="ma-list mem-vh-list">
            ${vectorHits.map(h => {
              const s = sessions.find(x => x.id === h.memory.sessionId);
              const c = s ? chars.find(x => x.id === s.characterId) : null;
              const meta = [formatDate(h.memory.createdAt), c?.name || s?.title || '(未知会话)'];
              return buildMemCard({
                meta,
                body: normalizeMemorySummary(h.memory.summary),
                tier: h.memory.tier,
                timeRange: timeRangeOf(h.memory, msgIdx),
                tag: tagOf(h.memory),
                score: h.score,
                cardClass: 'vh-row',
              });
            }).join('')}
          </div>
        `}
      </div>
    ` : '';

    // 补齐缺失 tag 按钮 — 只在有 memory 但部分没 tag 时显示。把 saved tag
    // 缺的逐条 AI 分类。
    const untaggedCount = allMems.filter(m => !m.tag).length;
    const backfillBlock = untaggedCount > 0 ? `
      <div class="ma-tl-head">
        <button class="ma-tag-backfill btn" type="button"${backfillBusy ? ' disabled' : ''}>${backfillBusy ? '打标中…' : `补齐 ${untaggedCount} 条缺失的 tag`}</button>
        <span class="ma-tl-status${backfillStatus.cls || ''}">${esc(backfillStatus.text || '')}</span>
      </div>
    ` : '';

    if (allMems.length === 0) {
      return vectorBlock + `<p class="hint">还没有总结。在某个会话里聊到超过 threshold(设置 → 记忆总结)后会自动生成。</p>`;
    }
    allMems.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const bySession = new Map();
    for (const m of allMems) {
      if (!bySession.has(m.sessionId)) bySession.set(m.sessionId, []);
      bySession.get(m.sessionId).push(m);
    }
    const groups = [...bySession.entries()]
      .map(([sid, mems]) => ({ sid, mems, latest: mems[0]?.createdAt || 0 }))
      .sort((a, b) => b.latest - a.latest);
    return vectorBlock + backfillBlock + `
      <div class="ma-list">
        ${groups.map(g => {
          const s = sessions.find(x => x.id === g.sid);
          const c = s ? chars.find(x => x.id === s.characterId) : null;
          return `
            <details class="ma-session-group" open>
              <summary>${esc(c?.name || s?.title || '(未知会话)')} · ${g.mems.length} 条</summary>
              ${g.mems.map(m => buildMemCard({
                meta: [formatDate(m.createdAt)],
                body: normalizeMemorySummary(m.summary),
                tier: m.tier,
                timeRange: timeRangeOf(m, msgIdx),
                tag: tagOf(m),
              })).join('')}
            </details>
          `;
        }).join('')}
      </div>
    `;
  }

  // 跨会话向量召回 — embedding.topKMemoriesForQuery 只针对单 session,这里
  // 自己写一版扫所有 memory-source embeddings。MIN_SIMILARITY 0.35 跟原版一致。
  async function runVectorSearch() {
    if (vectorBusy) return;
    const q = vectorQuery.trim();
    if (!q) return;
    vectorBusy = true;
    await render();
    try {
      const qvec = await embedding.embedText(q);
      if (!qvec) { vectorHits = []; return; }
      const allEmbs = await db.getAll('embeddings');
      const memEmbs = allEmbs.filter(e => e.sourceType === 'memory');
      const scored = [];
      for (const e of memEmbs) {
        if (!e.vector || e.dim !== qvec.length) continue;
        scored.push({ embedding: e, score: embedding.cosineSimilarity(qvec, e.vector) });
      }
      scored.sort((a, b) => b.score - a.score);
      const top = scored.filter(s => s.score >= 0.35).slice(0, 8);
      const hits = [];
      for (const s of top) {
        const m = await db.get('memories', s.embedding.sourceId);
        if (!m) continue;
        if (filterCharId) {
          const sess = await db.get('chatSessions', m.sessionId);
          if (sess?.characterId !== filterCharId) continue;
        }
        hits.push({ memory: m, score: s.score });
      }
      vectorHits = hits;
    } catch (e) {
      console.warn('[memory-app] vector search failed', e);
      vectorHits = [];
    } finally {
      vectorBusy = false;
      await render();
    }
  }

  // 向量打标 backfill — 扫 memories 里 m.tag 为空的(老 memory + 当时解析
  // 失败的),串行调 AI 分类。每次最多 30 条,避免一次性烧 token / 撞限速。
  // Prompt 极简,只让模型从 6 类挑 1 个,不二次复述 summary。
  async function runTagBackfill() {
    if (backfillBusy) return;
    backfillBusy = true;
    backfillStatus = { text: '扫描中…', cls: '' };
    await render();
    const ai = await import('../../core/ai.js');
    const TAGS = ['转折', '亲密', '冲突', '发现', '约定', '日常'];
    const sys = `分类下面这段记忆摘要,从 6 类挑 1 个最贴切的:转折(关系关键节点)/ 亲密(温柔深入暖)/ 冲突(摩擦紧张)/ 发现(新事实)/ 约定(计划承诺)/ 日常(闲聊兜底)。**只输出 tag 名**(2 字),不加引号、不加解释、不加标点。`;
    let done = 0, errors = 0;
    try {
      const all = (await db.getAll('memories')).filter(m => !m.tag).slice(0, 30);
      const total = all.length;
      for (const m of all) {
        try {
          const raw = await ai.callAI({
            systemPrompt: sys,
            messages: [{ role: 'user', content: normalizeMemorySummary(m.summary) || '(空)' }],
            temperature: 0.2,
          });
          const tag = String(raw || '').trim().slice(0, 4);  // 模型可能多吐字符,截 4 字内
          if (TAGS.includes(tag)) {
            const fresh = await db.get('memories', m.id);
            if (fresh) { fresh.tag = tag; await db.set('memories', fresh); }
            done++;
          } else {
            errors++;
          }
        } catch (e) {
          console.warn('[memory-app] tag backfill failed for', m.id, e);
          errors++;
        }
        const live = container.querySelector('.ma-tag-backfill + .ma-tl-status');
        if (live) { live.textContent = `${done + errors} / ${total}`; }
      }
      backfillStatus = { text: `打标完成:成功 ${done}${errors ? ` · 失败 ${errors}` : ''}`, cls: errors ? ' error' : ' success' };
    } catch (e) {
      backfillStatus = { text: `失败:${String(e).slice(0, 200)}`, cls: ' error' };
    } finally {
      backfillBusy = false;
      if (activeTab === 'summary') await render();
    }
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
    // 角色 filter — 两种形态共用 data-char-id 属性。chip / folder 任一点击都
    // 更新 filterCharId 并 re-render(filterCharId 是 closure)。
    container.querySelectorAll('[data-char-id]').forEach(el => {
      el.addEventListener('click', async () => {
        filterCharId = el.dataset.charId || '';
        await render();
      });
    });
    // Vector hits 搜索 — Enter 或按钮触发,blur 时同步输入值。
    const vhInput = container.querySelector('.mem-vh-input');
    if (vhInput) {
      vhInput.addEventListener('input', (e) => { vectorQuery = e.target.value; });
      vhInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          await runVectorSearch();
        }
      });
    }
    container.querySelector('.mem-vh-search')?.addEventListener('click', () => runVectorSearch());
    container.querySelector('.ma-tag-backfill')?.addEventListener('click', () => runTagBackfill());

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
    container.querySelector('.ma-profile-new')?.addEventListener('click', () => openProfileEditor(null));
    container.querySelectorAll('.profile-row').forEach(r => {
      r.addEventListener('click', (e) => {
        if (e.target.closest('.ma-row-del')) return;
        openProfileEditor(r.dataset.profileId);
      });
    });
    // ma-row-del 通用 — 根据父 row 的 data 属性判断属于哪种数据,删对应 store
    container.querySelectorAll('.ma-row-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const msRow = btn.closest('[data-ms-id]');
        const profileRow = btn.closest('[data-profile-id]');
        if (msRow) {
          if (!await openConfirm(container, {
            title: '删除纪念日', message: '确定删除这条纪念日?',
            confirmLabel: '删除', danger: true,
          })) return;
          await db.del('milestones', msRow.dataset.msId);
          await render();
        } else if (profileRow) {
          if (!await openConfirm(container, {
            title: '删除', message: '确定删除这条「关于你」?这会让聊天 prompt 不再注入对应 (角色×人设) 的「关于你」段。',
            confirmLabel: '删除', danger: true,
          })) return;
          await db.del('userProfiles', profileRow.dataset.profileId);
          await render();
        }
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
        `<div><b>${esc(labelFor(m.sessionId))}</b>${m.tier === 2 ? '(远期)' : ''}:${esc(normalizeMemorySummary(m.summary))}</div>`
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
