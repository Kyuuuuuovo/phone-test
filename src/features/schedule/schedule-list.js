// 行程 app — 单一视图:月历 + 选中日的 24h 纵向时间轴 + 打卡 chip 行。
//
// 早期做过 mode-toggle 双模式(月历+日 / 三日时间轴),但跨日比较视野在月
// 历 dot 已经够用,toggle 反而是额外认知成本。合并后:点月历任一格 →
// 下方 timeline 切到那天,既能翻看任意月任意日,又能看到时间密度。
//
// 数据:schedule(原)+ checkinTypes(打卡类型定义)+ checkins(每次打卡
// 一行)。schedule 由 context.buildScheduleLines 注入「# 当前行程」段;打卡
// 由 context.buildCheckinLines 注入「# 当前打卡(用户)」段。

import * as db from '../../core/db.js';
import * as ai from '../../core/ai.js';
import { openConfirm, openAlert } from '../../core/modal.js';
import { esc, dayKeyOf, parseTolerantJSON } from '../../core/util.js';

const HOUR_PX = 28;

export async function mountScheduleList(container, params, router) {
  // 月历游标(本月第一天)+ 当前选中日(初始 = 今天)
  let calendarCursor = new Date();
  calendarCursor.setDate(1);
  calendarCursor.setHours(0, 0, 0, 0);
  let selectedDayKey = dayKeyOf(Date.now());

  async function render() {
    const [entries, allChars, allTypes, allCheckins] = await Promise.all([
      db.getAll('schedule'),
      db.getAll('characters'),
      db.getAll('checkinTypes'),
      db.getAll('checkins'),
    ]);
    const chars = allChars.filter(c => c.id !== '__bear__');
    const charMap = new Map(chars.map(c => [c.id, c]));
    // 生理期(kind='period')走专门的「周期」app,不在这里当普通打卡显示 —— 把
    // period type 和它的 checkin 一并滤掉(否则月历 dot / 完成度计数会被污染)。
    const periodTypeIds = new Set(allTypes.filter(t => t.kind === 'period').map(t => t.id));
    const types = allTypes.filter(t => t.kind !== 'period');
    const checkins = allCheckins.filter(c => !periodTypeIds.has(c.typeId));
    // (dayKey, typeId) → checkin row。月历 dot + 当日 chip 共享同一索引。
    const checkinIdx = new Map();
    for (const c of checkins) checkinIdx.set(`${c.dayKey}|${c.typeId}`, c);

    container.innerHTML = `
      <div class="page schedule-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">行程</div>
          <div class="actions">
            <button class="manage-types" title="管理打卡类型" aria-label="管理打卡类型">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            </button>
            <button class="ai-gen" title="让 AI 帮角色生成一段日程">✨ AI</button>
            <button class="new-entry" title="新建行程" aria-label="新建行程"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
          </div>
        </header>
        <div class="page-body schedule-page-body">
          <div class="schedule-content">
            ${renderCalendar(entries, types, checkinIdx)}
            ${renderDay(selectedDayKey, entries, charMap, types, checkinIdx)}
          </div>
        </div>
      </div>
    `;
    wire(entries, charMap, types, checkinIdx);
  }

  // ── 月历 ────────────────────────────────────────────────────────────
  function renderCalendar(entries, types, checkinIdx) {
    const year  = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const monthLabel = `${year} 年 ${month + 1} 月`;
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth  = new Date(year, month + 1, 0);
    const daysInMonth  = lastOfMonth.getDate();
    const startWeekday = firstOfMonth.getDay();

    // 按 dayKey 预聚合两种 dot 来源。
    const schedDays  = new Set();
    for (const e of entries) {
      const dk = dayKeyOf(e.startTs);
      schedDays.add(dk);
      if (e.endTs) {
        // 跨天 entry 把所有跨入的 day 都标上 dot。
        let cur = new Date(e.startTs); cur.setHours(0, 0, 0, 0);
        const endDay = new Date(e.endTs); endDay.setHours(0, 0, 0, 0);
        while (cur.getTime() < endDay.getTime()) {
          cur.setDate(cur.getDate() + 1);
          schedDays.add(dayKeyOf(cur.getTime()));
        }
      }
    }
    // checkin dot:某天至少有一条 checkin。partial / full 区分用比例。
    const checkinByDay = new Map();  // dayKey → { done: n, total: types.length }
    for (const key of checkinIdx.keys()) {
      const [dk] = key.split('|');
      const rec = checkinByDay.get(dk) || { done: 0, total: types.length };
      rec.done++;
      checkinByDay.set(dk, rec);
    }

    const todayKey = dayKeyOf(Date.now());
    const cells = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push('<div class="sched-cell empty" aria-hidden="true"></div>');
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dk = `${year}-${pad(month + 1)}-${pad(d)}`;
      const hasSched   = schedDays.has(dk);
      const checkin    = checkinByDay.get(dk);
      const isToday    = dk === todayKey;
      const isSelected = dk === selectedDayKey;
      const checkinClass = !checkin ? '' :
        (types.length > 0 && checkin.done >= types.length) ? ' done' : ' partial';
      cells.push(`
        <button class="sched-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}" data-day-key="${dk}" type="button">
          <span class="sched-cell-day">${d}</span>
          <span class="sched-cell-dots">
            ${hasSched ? '<i class="dot sched"></i>' : ''}
            ${checkin  ? `<i class="dot checkin${checkinClass}"></i>` : ''}
          </span>
        </button>
      `);
    }

    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return `
      <div class="sched-cal-nav">
        <button class="sched-nav-btn prev" type="button">‹</button>
        <span class="sched-month-label">${monthLabel}</span>
        <button class="sched-nav-btn next" type="button">›</button>
      </div>
      <div class="sched-cal-weekdays">
        ${weekdays.map(w => `<div class="sched-weekday">${w}</div>`).join('')}
      </div>
      <div class="sched-cal-grid">${cells.join('')}</div>
      <div class="sched-legend">
        <span><i class="dot sched"></i> 行程</span>
        <span><i class="dot checkin done"></i> 全打卡</span>
        <span><i class="dot checkin partial"></i> 部分打卡</span>
      </div>
    `;
  }

  // ── 选中日详情:header + 打卡 chip 行 + 24h 纵向 timeline ───────────
  function renderDay(dayKey, entries, charMap, types, checkinIdx) {
    const [y, m, d] = dayKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const wd = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    const dayStart = date.getTime();
    const dayEnd   = dayStart + 86400000;
    const dayEntries = entries
      .filter(e => {
        const s = e.startTs;
        const ee = e.endTs || (s + 3600000);
        return s < dayEnd && ee > dayStart;
      })
      .sort((a, b) => a.startTs - b.startTs);

    const checkinsHtml = types.length === 0
      ? `<div class="day-detail-empty">还没有打卡类型 · <a class="link link-add-type" href="javascript:void(0)">添加</a></div>`
      : types.map(t => {
          const done = checkinIdx.has(`${dayKey}|${t.id}`);
          const style = t.color ? `--type-color: ${esc(t.color)};` : '';
          // chip 状态:filled(.done)= 已打,outlined = 未打。视觉只靠背景/
          // 边框区分,不再额外塞 ✓ / ○ 字符(铁律:能用 CSS 表达的状态不
          // 用 emoji)。icon 由用户自定,留空时显示名字首字。
          const iconText = t.icon ? esc(t.icon) : esc((t.name || '?').slice(0, 1));
          return `
            <button class="checkin-chip${done ? ' done' : ''}" data-type-id="${esc(t.id)}" data-day-key="${esc(dayKey)}" type="button" style="${style}">
              <span class="ci-icon">${iconText}</span>
              <span class="ci-name">${esc(t.name || '(未命名)')}</span>
            </button>
          `;
        }).join('') + `<button class="checkin-chip add" type="button" data-action="add-checkin">+ 添加</button>`;

    // 纵向 timeline 改双列结构:user 1 列固定 + 每个当天有行程的角色一列,
    // 列数 = 1 + N(N 由数据决定,user 反馈"不要预设 2-3 列")。
    // 同时段不再叠加,各自走自己列。
    function entryRect(e) {
      const s = Math.max(e.startTs, dayStart);
      const ee = Math.min(e.endTs || (e.startTs + 3600000), dayEnd);
      const top = ((s - dayStart) / 3600000) * HOUR_PX;
      const height = Math.max(22, ((ee - s) / 3600000) * HOUR_PX);
      return { top, height };
    }
    // 扫当天有行程的角色 id 集合
    const charIdsToday = [...new Set(
      dayEntries.filter(e => e.who === 'character' && e.characterId).map(e => e.characterId)
    )];
    // 把 user entry / 各 character entry 分桶
    const userEntries = dayEntries.filter(e => e.who === 'user');
    const charEntriesByCharId = new Map();
    for (const cid of charIdsToday) {
      charEntriesByCharId.set(cid, dayEntries.filter(e => e.who === 'character' && e.characterId === cid));
    }
    // 列 spec:[ {label, who, charId?, entries} ],第 1 列固定是 user
    const columns = [
      { label: '我', who: 'user', entries: userEntries },
      ...charIdsToday.map(cid => ({
        label: charMap.get(cid)?.name || '?',
        who: 'character',
        charId: cid,
        entries: charEntriesByCharId.get(cid),
      })),
    ];

    function renderEntryBlock(e) {
      const r = entryRect(e);
      return `<div class="time-entry${e.who === 'user' ? ' time-entry-user' : ' time-entry-char'}${e.syncToChat === false ? ' muted' : ''}" data-entry-id="${esc(e.id)}" style="top: ${r.top}px; height: ${r.height}px">
        <div class="time-entry-title">${esc(e.title || '(无标题)')}</div>
        <button class="time-entry-del" type="button" title="删除" aria-label="删除">×</button>
      </div>`;
    }

    // 周条:7 天(选中天所在那周,周日开头跟月历对齐),点击切日。
    const sel = new Date(y, m - 1, d);
    const weekStart = new Date(sel);
    weekStart.setDate(sel.getDate() - sel.getDay());  // 回到周日
    const weekCells = Array.from({ length: 7 }, (_, i) => {
      const c = new Date(weekStart);
      c.setDate(weekStart.getDate() + i);
      const ck = `${c.getFullYear()}-${String(c.getMonth()+1).padStart(2,'0')}-${String(c.getDate()).padStart(2,'0')}`;
      const isSel = ck === dayKey;
      const isToday = ck === dayKeyOf(Date.now());
      const wname = ['日','一','二','三','四','五','六'][c.getDay()];
      return `
        <button class="week-cell${isSel ? ' selected' : ''}${isToday ? ' today' : ''}" data-day-key="${esc(ck)}" type="button">
          <span class="week-cell-w">${wname}</span>
          <span class="week-cell-d">${c.getDate()}</span>
        </button>
      `;
    }).join('');

    const timelineHtml = `
      <div class="day-week-strip">${weekCells}</div>
      <div class="day-timeline-multi" style="--col-count: ${columns.length}">
        <div class="dtm-hours" style="height: ${24 * HOUR_PX}px">
          ${Array.from({ length: 25 }, (_, h) => `<div class="hour-mark" style="top: ${h * HOUR_PX}px">${h}:00</div>`).join('')}
        </div>
        <div class="dtm-cols">
          ${columns.map(col => `
            <div class="dtm-col" data-col-who="${esc(col.who)}"${col.charId ? ` data-col-char="${esc(col.charId)}"` : ''}>
              <div class="dtm-col-head">${esc(col.label)}</div>
              <div class="dtm-col-body" style="height: ${24 * HOUR_PX}px">
                ${col.entries.map(renderEntryBlock).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    return `
      <div class="day-detail-block" data-day-key="${esc(dayKey)}">
        <div class="day-detail-head">
          <span class="ddh-date">${m} 月 ${d} 日 · 周${wd}</span>
          <button class="ddh-new-entry" type="button" data-action="new-entry-on-day">+ 行程</button>
        </div>
        <div class="day-detail-section">
          <div class="dds-label">打卡</div>
          <div class="day-detail-checkins">${checkinsHtml}</div>
        </div>
        <div class="day-detail-section">
          <div class="dds-label">时间轴</div>
          ${timelineHtml}
        </div>
      </div>
    `;
  }

  // ── 事件绑定 ────────────────────────────────────────────────────────
  function wire(entries, charMap, types, checkinIdx) {
    container.querySelector('.back').addEventListener('click', () => router.back());
    container.querySelector('.new-entry').addEventListener('click', () => openEditor(null));
    container.querySelector('.ai-gen').addEventListener('click', () => openAIGenModal());
    container.querySelector('.manage-types').addEventListener('click', () => openManageTypesModal());

    // 月历翻页 / 选日
    container.querySelector('.sched-nav-btn.prev')?.addEventListener('click', async () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
      await render();
    });
    container.querySelector('.sched-nav-btn.next')?.addEventListener('click', async () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
      await render();
    });
    container.querySelectorAll('.sched-cell[data-day-key]').forEach(c => {
      c.addEventListener('click', async () => {
        selectedDayKey = c.dataset.dayKey;
        await render();
      });
    });
    // 周条 7 天点击切换选中日
    container.querySelectorAll('.week-cell[data-day-key]').forEach(c => {
      c.addEventListener('click', async () => {
        selectedDayKey = c.dataset.dayKey;
        await render();
      });
    });

    // 打卡 chip toggle + 入口
    container.querySelectorAll('.checkin-chip[data-type-id]').forEach(chip => {
      chip.addEventListener('click', async () => {
        await toggleCheckin(chip.dataset.typeId, chip.dataset.dayKey);
        await render();
      });
    });
    container.querySelector('.checkin-chip.add')?.addEventListener('click', () => openManageTypesModal());
    container.querySelector('.link-add-type')?.addEventListener('click', () => openManageTypesModal());

    // 选中日的「+ 行程」按钮:默认 09:00 起
    container.querySelector('.ddh-new-entry')?.addEventListener('click', () => {
      const [y, m, d] = selectedDayKey.split('-').map(Number);
      const defaultStart = new Date(y, m - 1, d, 9, 0, 0, 0).getTime();
      openEditor(null, { defaultStartTs: defaultStart });
    });

    // 时间块点击编辑 + 右上 × 删除
    container.querySelectorAll('.time-entry[data-entry-id]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.time-entry-del')) return;
        openEditor(row.dataset.entryId);
      });
      row.querySelector('.time-entry-del')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!await openConfirm(container, {
          title: '删除行程', message: '删除这条行程?',
          confirmLabel: '删除', danger: true,
        })) return;
        await db.del('schedule', row.dataset.entryId);
        await render();
      });
    });
  }

  // ── 打卡 toggle:同 (dayKey, typeId) 存在则删,不存在则建 ────────────
  async function toggleCheckin(typeId, dayKey) {
    const sameDay = await db.query('checkins', 'dayKey', dayKey);
    const matches = sameDay.filter(c => c.typeId === typeId);
    if (matches.length > 0) {
      // 删全部匹配 —— 顺手清掉历史上连点 / 并发产生的重复行。
      for (const c of matches) await db.del('checkins', c.id);
    } else {
      // 确定性 id:连点 / 并发两次都写同一行,不再插重复(原来 db.newId() 两次
      // 创建会插两条 → 月历完成度计数虚高)。
      await db.set('checkins', {
        id: `ck_${dayKey}_${typeId}`,
        typeId,
        dayKey,
        checkedAt: Date.now(),
      });
    }
  }

  // ── 管理打卡类型 modal ─────────────────────────────────────────────
  async function openManageTypesModal() {
    const types = (await db.getAll('checkinTypes')).filter(t => t.kind !== 'period');  // 生理期在「周期」app 管,不在打卡类型里
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal manage-types-modal">
        <div class="modal-header">打卡类型</div>
        <div class="mt-list">
          ${types.length === 0
            ? `<p class="hint">还没有打卡类型。点下面「+ 新建」加一个。</p>`
            : types.map(t => `
                <div class="mt-row" data-type-id="${esc(t.id)}">
                  <span class="mt-icon" style="${t.color ? `--type-color: ${esc(t.color)};` : ''}">${esc(t.icon || (t.name || '?').slice(0, 1))}</span>
                  <div class="mt-info">
                    <div class="mt-name">${esc(t.name || '(未命名)')}</div>
                  </div>
                  <button class="mt-edit" type="button" title="编辑">编辑</button>
                  <button class="mt-del" type="button" title="删除" aria-label="删除">×</button>
                </div>
              `).join('')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn secondary close-btn">关闭</button>
          <button type="button" class="btn new-type-btn">+ 新建类型</button>
        </div>
      </div>
    `;
    container.appendChild(modal);
    modal.querySelector('.close-btn').addEventListener('click', () => { modal.remove(); render(); });
    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); render(); } });
    modal.querySelector('.new-type-btn').addEventListener('click', () => {
      modal.remove();
      openTypeEditor(null);
    });
    modal.querySelectorAll('.mt-edit').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.closest('[data-type-id]').dataset.typeId;
        modal.remove();
        openTypeEditor(id);
      });
    });
    modal.querySelectorAll('.mt-del').forEach(b => {
      b.addEventListener('click', async () => {
        const row = b.closest('[data-type-id]');
        const id = row.dataset.typeId;
        if (!await openConfirm(container, {
          title: '删除类型',
          message: '删除此打卡类型?该类型相关的所有打卡记录也会被清除。',
          confirmLabel: '删除', danger: true,
        })) return;
        // 级联清打卡记录
        const related = await db.query('checkins', 'typeId', id);
        for (const c of related) await db.del('checkins', c.id);
        await db.del('checkinTypes', id);
        modal.remove();
        openManageTypesModal();
      });
    });
  }

  // ── 单个打卡类型编辑 modal ─────────────────────────────────────────
  async function openTypeEditor(id) {
    const existing = id ? await db.get('checkinTypes', id) : null;
    const t = existing || {
      name: '', icon: '', color: '#5ec97e',
      reminder: null,
    };
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">${existing ? '编辑类型' : '新建类型'}</div>
        <form class="type-form" autocomplete="off">
          <label>
            <div class="label-text">名字</div>
            <input name="name" type="text" required value="${esc(t.name)}" placeholder="比如:跑步 / 喝水 / 看书">
          </label>
          <label>
            <div class="label-text">图标(留空就显示名字首字 · 想用 emoji 也行)</div>
            <input name="icon" type="text" value="${esc(t.icon || '')}" maxlength="4" placeholder="">
          </label>
          <label>
            <div class="label-text">颜色</div>
            <input name="color" type="color" value="${esc(t.color || '#5ec97e')}">
          </label>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">${existing ? '保存' : '创建'}</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    modal.querySelector('.cancel-btn').addEventListener('click', () => { modal.remove(); openManageTypesModal(); });
    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); openManageTypesModal(); } });
    modal.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      // T6: 不再写 targetFreq 字段 — 打卡纯记录,不做目标频率/连续追踪。老
      // 数据里 existing.targetFreq 也不带过来(隐式 drop)。
      const next = {
        id: id || db.newId(),
        name: String(fd.get('name') || '').trim() || '(未命名)',
        icon: String(fd.get('icon') || '').trim(),
        color: String(fd.get('color') || '#5ec97e'),
        reminder: existing?.reminder || null,
        createdAt: existing?.createdAt || Date.now(),
      };
      await db.set('checkinTypes', next);
      modal.remove();
      openManageTypesModal();
    });
  }

  // ── 行程条目编辑(沿用旧版逻辑,接收 defaultStartTs 起始时间) ───────
  async function openEditor(id, opts = {}) {
    const chars = (await db.getAll('characters')).filter(c => c.id !== '__bear__');
    const personas = await db.getAll('personas');
    const settings = (await db.get('settings', 'default')) || {};
    const existing = id ? await db.get('schedule', id) : null;
    const defaultStart = opts.defaultStartTs || (Date.now() + 60 * 60 * 1000);
    const e = existing || {
      who: 'user',
      characterId: chars[0]?.id || null,
      personaId: settings.activePersonaId || '',
      startTs: defaultStart,
      endTs: null,
      title: '',
      desc: '',
    };
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">${existing ? '编辑行程' : '新建行程'}</div>
        <form class="schedule-form" autocomplete="off">
          <label>
            <div class="label-text">属于</div>
            <select name="who">
              <option value="user"${e.who === 'user' ? ' selected' : ''}>我自己</option>
              <option value="character"${e.who === 'character' ? ' selected' : ''}>某个角色</option>
            </select>
          </label>
          <label class="char-pick" ${e.who === 'character' ? '' : 'hidden'}>
            <div class="label-text">角色</div>
            <select name="characterId">
              ${chars.map(c => `<option value="${esc(c.id)}"${c.id === e.characterId ? ' selected' : ''}>${esc(c.name || '(未命名)')}</option>`).join('')}
            </select>
          </label>
          <label class="user-persona-pick" ${e.who === 'user' ? '' : 'hidden'}>
            <div class="label-text">这是哪个「我」的行程</div>
            <select name="userPersonaId">
              <option value=""${!e.personaId ? ' selected' : ''}>所有「我」共享(不限定人设)</option>
              ${personas.map(p => `<option value="${esc(p.id)}"${p.id === e.personaId ? ' selected' : ''}>${esc(p.name || '(未命名)')}</option>`).join('')}
            </select>
          </label>
          <div class="user-visibility" ${e.who === 'user' ? '' : 'hidden'}>
            <div class="label-text">谁能看到这条(我的行程对哪些角色可见)</div>
            ${(() => {
              const v = e.visibleTo;
              const mode = !v ? 'all' : (Array.isArray(v) && v.length === 0 ? 'none' : 'some');
              const selected = new Set(Array.isArray(v) ? v : []);
              return `
                <div class="visibility-mode-row">
                  <label class="radio-inline">
                    <input type="radio" name="visMode" value="all"${mode === 'all' ? ' checked' : ''}>
                    <span>所有角色都能看</span>
                  </label>
                  <label class="radio-inline">
                    <input type="radio" name="visMode" value="none"${mode === 'none' ? ' checked' : ''}>
                    <span>谁都看不到</span>
                  </label>
                  <label class="radio-inline">
                    <input type="radio" name="visMode" value="some"${mode === 'some' ? ' checked' : ''}>
                    <span>仅勾选的</span>
                  </label>
                </div>
                <div class="visibility-pick-list" ${mode === 'some' ? '' : 'hidden'}>
                  ${chars.length === 0
                    ? `<div class="muted-hint">还没有角色</div>`
                    : chars.map(c => `
                        <label class="checkbox-row">
                          <input type="checkbox" name="visChar" value="${esc(c.id)}"${selected.has(c.id) ? ' checked' : ''}>
                          <span>${esc(c.name || '(未命名)')}</span>
                        </label>
                      `).join('')}
                </div>
              `;
            })()}
          </div>
          <label>
            <div class="label-text">开始时间</div>
            <input type="datetime-local" name="startTs" value="${toLocalDT(e.startTs)}" required>
          </label>
          <label>
            <div class="label-text">结束时间(可选)</div>
            <input type="datetime-local" name="endTs" value="${e.endTs ? toLocalDT(e.endTs) : ''}">
          </label>
          <label>
            <div class="label-text">标题</div>
            <input type="text" name="title" value="${esc(e.title)}" required placeholder="比如:开会 / 健身 / 见朋友">
          </label>
          <label>
            <div class="label-text">描述(可选)</div>
            <textarea name="desc" rows="3">${esc(e.desc)}</textarea>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" name="syncToChat"${e.syncToChat !== false ? ' checked' : ''}>
            <span>同步到聊天的「# 当前行程」段</span>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">${existing ? '保存' : '创建'}</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);

    const form = modal.querySelector('form');
    const whoSel = form.elements.who;
    const charPick = modal.querySelector('.char-pick');
    const userVisBlock = modal.querySelector('.user-visibility');
    const userPersonaPick = modal.querySelector('.user-persona-pick');
    const visPickList = modal.querySelector('.visibility-pick-list');
    whoSel.addEventListener('change', () => {
      charPick.hidden = whoSel.value !== 'character';
      userVisBlock.hidden = whoSel.value !== 'user';
      userPersonaPick.hidden = whoSel.value !== 'user';
    });
    modal.querySelectorAll('input[name="visMode"]').forEach(r => {
      r.addEventListener('change', () => {
        const mode = modal.querySelector('input[name="visMode"]:checked')?.value;
        visPickList.hidden = mode !== 'some';
      });
    });
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const startTs = new Date(fd.get('startTs')).getTime();
      if (!Number.isFinite(startTs)) { await openAlert(container, { title: '时间无效', message: '开始时间格式有误。', danger: true }); return; }
      const endRaw = fd.get('endTs');
      const endTs = endRaw ? new Date(endRaw).getTime() : null;
      const who = String(fd.get('who') || 'user');
      const characterId = who === 'character' ? String(fd.get('characterId') || '') : null;
      let visibleTo;
      if (who === 'user') {
        const mode = String(fd.get('visMode') || 'all');
        if (mode === 'all')       visibleTo = undefined;
        else if (mode === 'none') visibleTo = [];
        else                      visibleTo = fd.getAll('visChar').map(String);
      }
      const userPersonaId = who === 'user' ? String(fd.get('userPersonaId') || '') : '';
      const next = {
        id: id || db.newId(),
        who,
        characterId,
        startTs,
        endTs,
        title: String(fd.get('title') || '').trim() || '(无标题)',
        desc: String(fd.get('desc') || '').trim(),
        syncToChat: form.elements.syncToChat.checked,
        visibleTo,
        createdAt: existing?.createdAt || Date.now(),
      };
      if (userPersonaId) next.personaId = userPersonaId;
      await db.set('schedule', next);
      modal.remove();
      await render();
    });
  }

  // ── AI 生成日程 modal(沿用旧版) ────────────────────────────────────
  async function openAIGenModal() {
    const chars = (await db.getAll('characters')).filter(c => c.id !== '__bear__');
    if (chars.length === 0) { await openAlert(container, { title: '没有角色', message: '先去角色管理建一个角色,才能给角色生成日程。' }); return; }
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setMinutes(0, 0, 0);
    const defaultEnd = new Date(defaultStart);
    defaultEnd.setHours(defaultEnd.getHours() + 24);

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">AI 生成角色日程</div>
        <p class="hint">基于角色人设,让 AI 在指定时间段内编排一系列合理的日程。生成的条目会直接写入「角色」的行程,无需手动确认每条。</p>
        <form class="ai-gen-form" autocomplete="off">
          <label>
            <div class="label-text">角色</div>
            <select name="characterId">
              ${chars.map(c => `<option value="${esc(c.id)}">${esc(c.name || '(未命名)')}</option>`).join('')}
            </select>
          </label>
          <label>
            <div class="label-text">开始</div>
            <input type="datetime-local" name="startTs" required value="${toLocalDT(defaultStart.getTime())}">
          </label>
          <label>
            <div class="label-text">结束</div>
            <input type="datetime-local" name="endTs" required value="${toLocalDT(defaultEnd.getTime())}">
          </label>
          <label>
            <div class="label-text">引导(可选 · 比如「这是工作日」「这天是 ta 的生日」)</div>
            <textarea name="hint" rows="2" placeholder=""></textarea>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">生成</button>
          </div>
          <div class="form-status"></div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    const status = modal.querySelector('.form-status');
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      const charId = String(fd.get('characterId'));
      const startTs = new Date(fd.get('startTs')).getTime();
      const endTs   = new Date(fd.get('endTs')).getTime();
      const hint    = String(fd.get('hint') || '').trim();
      if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) {
        status.textContent = '时间区间无效'; status.className = 'form-status error'; return;
      }
      const character = await db.get('characters', charId);
      if (!character) { status.textContent = '角色不存在'; status.className = 'form-status error'; return; }
      const submitBtn = modal.querySelector('button[type="submit"]');
      const submitLabelOrig = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'AI 调用中…';
      status.textContent = ''; status.className = 'form-status';
      // T12: 引入 记忆(L1+L2) + 已有行程(同窗口内,任意角色) — 让 AI 知道
      //   - 角色的长期状态(从总结里推出"最近在忙什么 / 关心什么")
      //   - 同时段已有什么行程(避免硬冲突 / 跟 user 的行程协调)
      //   memories 全部都拿(L1+L2 都喂,跨 session 通吃 — 这个角色所有的记忆),
      //   schedule 窗口取生成区间 ± 1 天兜底跨界事件。每段限长防爆 token。
      const memoriesAll = await db.getAll('memories');
      const charSessions = (await db.getAll('chatSessions')).filter(s => s.characterId === charId);
      const charSessionIds = new Set(charSessions.map(s => s.id));
      const charMemories = memoriesAll.filter(m => charSessionIds.has(m.sessionId));
      charMemories.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const memoryBlock = charMemories.length === 0
        ? ''
        : `\n\n角色的历史记忆(由旧到新,可推断 ta 最近在做/关心什么):\n${
            charMemories.map(m => {
              const d = new Date(m.fromTs ?? m.createdAt);
              const dateStr = `【${d.getMonth()+1}月${d.getDate()}日】`;
              return `${dateStr} ${m.summary || ''}`.trim();
            }).slice(-30).join('\n')  // 防爆 token, 最多 30 条
          }`;
      const winStart = startTs - 24 * 3600_000;
      const winEnd   = endTs   + 24 * 3600_000;
      const allSched = await db.getAll('schedule');
      const nearbySched = allSched.filter(e => {
        const eEnd = e.endTs || (e.startTs + 3600_000);
        return eEnd >= winStart && e.startTs <= winEnd;
      }).sort((a, b) => a.startTs - b.startTs);
      const scheduleBlock = nearbySched.length === 0
        ? ''
        : `\n\n同窗口已有的行程(避免硬冲突 + 注意与之相邻 / 衔接):\n${
            nearbySched.map(e => {
              const who = e.who === 'user' ? '用户' : '另一个角色';
              const startStr = new Date(e.startTs).toISOString();
              const endStr   = e.endTs ? ` 到 ${new Date(e.endTs).toISOString()}` : '';
              return `- ${who} · ${startStr}${endStr} · ${e.title || '(无题)'}${e.desc ? ' — ' + e.desc : ''}`;
            }).join('\n')
          }`;
      const sys = '你是日程生成助手。基于人物的人设、ta 的历史记忆、同窗口已有的行程,为 ta 在指定时间段内生成一系列合理的日程。\n\n要求:\n- 只输出 JSON 数组,不要任何其他文字、不要 markdown 代码块包裹\n- 每项格式:{"startTs": ISO8601 字符串, "endTs": ISO8601 字符串(可选), "title": 简短标题, "desc": 描述(可选)}\n- 数量 3-8 条,时间必须落在指定区间内\n- 安排要符合人物身份、作息、性格(老师不会凌晨 3 点上课)\n- 充分利用提供的「角色历史记忆」推断 ta 最近的兴趣 / 关心 / 在做的项目,排出贴合状态的日程\n- 「同窗口已有的行程」是硬约束:不要跟 ta 同一时间段的安排冲突;跟 user 的行程可以协调(比如 user 那时在工作,角色就别安排"找 user 喝咖啡")\n- 标题简短(2-6 字),描述可以稍详(< 30 字)';
      const userMsg = `人物名:${character.name || '(未命名)'}\n\n人设:\n${character.persona || '(无)'}\n\n时间区间:${new Date(startTs).toISOString()} 到 ${new Date(endTs).toISOString()}\n\n额外引导:${hint || '(无)'}${memoryBlock}${scheduleBlock}`;
      try {
        const raw = await ai.callAI({ systemPrompt: sys, messages: [{ role: 'user', content: userMsg }], temperature: 0.7 });
        const entries = parseTolerantJSON(raw, { expect: 'array' });
        if (!Array.isArray(entries) || entries.length === 0) {
          status.textContent = '解析失败:模型返回的不是合法的 JSON 数组'; status.className = 'form-status error';
          submitBtn.disabled = false; submitBtn.textContent = submitLabelOrig;
          return;
        }
        let added = 0;
        for (const e of entries) {
          const st = new Date(e.startTs).getTime();
          if (!Number.isFinite(st)) continue;
          await db.set('schedule', {
            id: db.newId(),
            who: 'character',
            characterId: charId,
            startTs: st,
            endTs: e.endTs ? new Date(e.endTs).getTime() : null,
            title: String(e.title || '(无标题)').trim(),
            desc:  String(e.desc  || '').trim(),
            createdAt: Date.now(),
          });
          added++;
        }
        status.textContent = `成功添加 ${added} 条`; status.className = 'form-status success';
        setTimeout(() => { modal.remove(); render(); }, 600);
      } catch (e) {
        status.textContent = `失败:${String(e).slice(0, 200)}`; status.className = 'form-status error';
        submitBtn.disabled = false; submitBtn.textContent = submitLabelOrig;
      }
    });
  }

  await render();
  return () => {};
}

// ── 杂项工具函数 ──────────────────────────────────────────────────────

function formatTimeRange(start, end) {
  const d = new Date(start);
  const hh = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (!end) return hh;
  const e = new Date(end);
  return `${hh}–${pad(e.getHours())}:${pad(e.getMinutes())}`;
}

function toLocalDT(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

