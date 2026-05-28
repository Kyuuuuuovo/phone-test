// 生理期 周期 app — 3 tab(当前 / 日历 / 症状)。
//
// 数据形状(STORES.cycle / cycleSymptoms 见 db.js):
//   cycle (singleton id='default'):enabled / averageLength / periodLength /
//     fluctuation / lastStartDayKey / history[] / visibleToChat
//   cycleSymptoms (per row):dayKey / kind / severity? / note?
//
// 预测算法:nextStart = lastStartDayKey + averageLength
//   浮动窗口 [nextStart - fluctuation, nextStart + fluctuation]
//   进行中:lastStartDayKey 到 lastStartDayKey + periodLength
//
// Prompt 注入(context.buildCycleStatus):仅 enabled && visibleToChat,
// 仅在「进行中」/「浮动窗口内」生成内容,平日 return ''(空段不渲染)。
//
// 隐私 — 默认 enabled=false + visibleToChat=false 双门控,user 主动开两个
// 开关才暴露给 AI。

import * as db from '../../core/db.js';
import { openModal, openConfirm, openAlert } from '../../core/modal.js';
import { esc, dayKeyOf } from '../../core/util.js';
import { computeCycleStatus, addDays, daysBetween } from '../../core/cycle.js';

const DEFAULTS = {
  id: 'default',
  enabled: false,
  averageLength: 28,
  periodLength: 5,
  fluctuation: 2,
  lastStartDayKey: null,
  history: [],
  visibleToChat: false,
};

const SYMPTOM_KINDS = [
  { id: 'cramp',    label: '痛经'   },
  { id: 'headache', label: '头痛'   },
  { id: 'mood',     label: '情绪低' },
  { id: 'flow',     label: '量'     },
  { id: 'note',     label: '其他'   },
];

// Phase 计算 + 日期算术从 core/cycle.js 导入(共享给 context / notify)。

export async function mountCycleApp(container, params, router) {
  let cfg = (await db.get('cycle', 'default')) || { ...DEFAULTS };
  // Migrate-on-read: 老数据可能缺新字段,补 defaults。
  cfg = { ...DEFAULTS, ...cfg };
  let activeTab = 'current';

  async function persist() {
    await db.set('cycle', cfg);
  }

  function render() {
    container.innerHTML = `
      <div class="page cycle-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">周期</div>
          <div class="actions">
            <button class="cycle-settings-btn" title="设置" aria-label="设置">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 0 0 7.2z"/></svg>
            </button>
          </div>
        </header>
        <div class="cycle-tabs">
          <button class="cycle-tab${activeTab === 'current'  ? ' active' : ''}" data-tab="current">当前</button>
          <button class="cycle-tab${activeTab === 'calendar' ? ' active' : ''}" data-tab="calendar">日历</button>
          <button class="cycle-tab${activeTab === 'symptoms' ? ' active' : ''}" data-tab="symptoms">症状</button>
        </div>
        <div class="page-body cycle-body">
          ${renderTab()}
        </div>
      </div>
    `;
    wire();
  }

  function renderTab() {
    if (!cfg.enabled) return renderDisabledState();
    if (activeTab === 'current')  return renderCurrentTab();
    if (activeTab === 'calendar') return renderCalendarTab();
    if (activeTab === 'symptoms') return renderSymptomsTab();
    return '';
  }

  function renderDisabledState() {
    return `
      <div class="cycle-empty">
        <p class="hint">这个 app 还没启用。开了之后可以记录周期开始日期,自动算下次预计、显示在日历上。<br>所有数据只存在你浏览器,默认不会让 AI 看到 — 单独有个开关。</p>
        <button class="btn enable-btn">启用 周期 app</button>
      </div>
    `;
  }

  function renderCurrentTab() {
    const status = computeCycleStatus(cfg);
    const card = renderStatusCard(status);
    const lastStartFmt = cfg.lastStartDayKey || '(还没记过)';
    return `
      ${card}
      <div class="cycle-current-actions">
        <button class="btn mark-start-btn">${status.phase === 'in-period' ? '记今天为本次结束' : '记今天为开始'}</button>
      </div>
      <div class="settings-list cycle-info-list">
        <div class="settings-item">
          <span class="settings-label">上次开始</span>
          <span class="settings-value">${esc(lastStartFmt)}</span>
        </div>
        <div class="settings-item">
          <span class="settings-label">平均周期</span>
          <span class="settings-value">${cfg.averageLength} 天</span>
        </div>
        <div class="settings-item">
          <span class="settings-label">持续天数</span>
          <span class="settings-value">${cfg.periodLength} 天</span>
        </div>
        <div class="settings-item">
          <span class="settings-label">浮动 ±</span>
          <span class="settings-value">${cfg.fluctuation} 天</span>
        </div>
        <div class="settings-item">
          <span class="settings-label">注入 AI prompt</span>
          <span class="settings-value">${cfg.visibleToChat ? '开' : '关'}</span>
        </div>
      </div>
    `;
  }

  function renderStatusCard(status) {
    switch (status.phase) {
      case 'inactive':
        return `<div class="cycle-status-card cycle-status-inactive">
          <div class="cycle-status-title">还没有数据</div>
          <div class="cycle-status-hint">点下面「记今天为开始」开始记录</div>
        </div>`;
      case 'in-period':
        return `<div class="cycle-status-card cycle-status-in">
          <div class="cycle-status-title">进行中 · 第 ${status.dayInPeriod} 天</div>
          <div class="cycle-status-hint">预计持续 ${status.periodLength} 天 · 下次约 ${status.nextStart}</div>
        </div>`;
      case 'fluctuation':
        return `<div class="cycle-status-card cycle-status-fluct">
          <div class="cycle-status-title">可能就快了</div>
          <div class="cycle-status-hint">预测窗口 ${status.winStart} – ${status.winEnd}</div>
        </div>`;
      case 'predicted':
        return `<div class="cycle-status-card cycle-status-pred">
          <div class="cycle-status-title">距下次约 ${status.daysUntil} 天</div>
          <div class="cycle-status-hint">预计 ${status.nextStart}</div>
        </div>`;
      case 'overdue':
        return `<div class="cycle-status-card cycle-status-over">
          <div class="cycle-status-title">推迟 ${status.daysOverdue} 天</div>
          <div class="cycle-status-hint">如已开始,点下面「记今天为开始」补记</div>
        </div>`;
    }
    return '';
  }

  function renderCalendarTab() {
    // 月历 — 当月 6 周格子,每格显示日期 + dot(实际记录/预测窗口/进行中)。
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const firstDay = new Date(year, month, 1).getDay();  // 0=Sun, 1=Mon...
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const status = computeCycleStatus(cfg);
    const cells = [];
    // Leading blanks
    for (let i = 0; i < firstDay; i++) cells.push(`<div class="cy-cell cy-cell-blank"></div>`);
    for (let d = 1; d <= daysInMonth; d++) {
      const dk = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = d === today.getDate();
      const cls = cellClassFor(dk, status);
      cells.push(`
        <button class="cy-cell ${cls}${isToday ? ' cy-today' : ''}" data-day-key="${esc(dk)}">
          <span class="cy-day">${d}</span>
        </button>
      `);
    }
    return `
      <div class="cycle-calendar">
        <div class="cy-month-label">${year} 年 ${month+1} 月</div>
        <div class="cy-week-header">
          <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
        </div>
        <div class="cy-grid">${cells.join('')}</div>
        <div class="cy-legend">
          <span class="cy-legend-item"><i class="cy-dot cy-dot-in"></i>进行中</span>
          <span class="cy-legend-item"><i class="cy-dot cy-dot-fluct"></i>预测窗口</span>
          <span class="cy-legend-item"><i class="cy-dot cy-dot-pred"></i>预计开始</span>
        </div>
      </div>
    `;
  }

  function cellClassFor(dk, status) {
    if (!cfg.lastStartDayKey) return '';
    const periodEnd = addDays(cfg.lastStartDayKey, cfg.periodLength);
    if (dk >= cfg.lastStartDayKey && dk < periodEnd) return 'cy-cell-in';
    const nextStart = addDays(cfg.lastStartDayKey, cfg.averageLength);
    const winStart  = addDays(nextStart, -cfg.fluctuation);
    const winEnd    = addDays(nextStart,  cfg.fluctuation);
    if (dk === nextStart) return 'cy-cell-pred';
    if (dk >= winStart && dk <= winEnd) return 'cy-cell-fluct';
    return '';
  }

  function renderSymptomsTab() {
    return `
      <div class="cycle-symptoms-section">
        <div class="cy-actions-row">
          <button class="btn add-symptom-btn">+ 记一条症状</button>
        </div>
        <div class="symptom-list-host"><p class="hint">读取中...</p></div>
      </div>
    `;
  }

  async function loadSymptomsList() {
    const all = await db.getAll('cycleSymptoms');
    all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const host = container.querySelector('.symptom-list-host');
    if (!host) return;
    if (all.length === 0) {
      host.innerHTML = `<p class="hint">还没记过症状。点上面「+ 记一条症状」加一条。</p>`;
      return;
    }
    host.innerHTML = `
      <div class="settings-list">
        ${all.map(s => {
          const kind = SYMPTOM_KINDS.find(k => k.id === s.kind);
          return `
            <div class="settings-item symptom-row" data-symptom-id="${esc(s.id)}">
              <div class="symptom-meta">
                <div class="symptom-kind">${esc(kind?.label || s.kind)}${s.severity ? ` · 程度 ${s.severity}` : ''}</div>
                <div class="symptom-day">${esc(s.dayKey || '')}${s.note ? ` · ${esc(s.note)}` : ''}</div>
              </div>
              <button class="symptom-del" type="button" title="删除" aria-label="删除">×</button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function wire() {
    container.querySelector('.back').addEventListener('click', () => router.back());
    container.querySelectorAll('.cycle-tab').forEach(t => {
      t.addEventListener('click', () => {
        if (t.dataset.tab === activeTab) return;
        activeTab = t.dataset.tab;
        render();
        if (activeTab === 'symptoms') loadSymptomsList();
      });
    });
    container.querySelector('.cycle-settings-btn').addEventListener('click', openSettingsModal);

    // 未启用 — enable 按钮
    const enableBtn = container.querySelector('.enable-btn');
    if (enableBtn) {
      enableBtn.addEventListener('click', async () => {
        cfg.enabled = true;
        await persist();
        render();
      });
    }

    // 当前 tab — 记开始/结束
    const markBtn = container.querySelector('.mark-start-btn');
    if (markBtn) {
      markBtn.addEventListener('click', async () => {
        await markStartOrEnd();
      });
    }

    // 症状 tab — 加 / 删
    const addSymBtn = container.querySelector('.add-symptom-btn');
    if (addSymBtn) {
      addSymBtn.addEventListener('click', openAddSymptomModal);
      loadSymptomsList();
    }
    container.addEventListener('click', onSymptomDelClick);
  }

  async function onSymptomDelClick(e) {
    const del = e.target.closest('.symptom-del');
    if (!del) return;
    const row = del.closest('[data-symptom-id]');
    if (!row) return;
    const id = row.dataset.symptomId;
    const ok = await openConfirm(container, {
      title: '删除症状记录?',
      message: '删了就找不回来。',
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    await db.del('cycleSymptoms', id);
    loadSymptomsList();
  }

  async function markStartOrEnd() {
    const todayDk = dayKeyOf(Date.now());
    const status = computeCycleStatus(cfg);
    if (status.phase === 'in-period') {
      // 标结束 — 算出实际 periodLength,更新 history 最后一条 endDayKey
      const actualLen = (daysBetween(cfg.lastStartDayKey, todayDk) ?? 0) + 1;
      const last = cfg.history?.[cfg.history.length - 1];
      if (last && !last.endDayKey) last.endDayKey = todayDk;
      // 用本次实际长度去平均化 periodLength(简单 EMA — 老值 70%、新值 30%)
      cfg.periodLength = Math.max(1, Math.round(cfg.periodLength * 0.7 + actualLen * 0.3));
      await persist();
      await openAlert(container, {
        title: '已记结束',
        message: `本次持续 ${actualLen} 天,已合并到平均持续天数(现 ${cfg.periodLength} 天)。`,
      });
      render();
      return;
    }
    // 标开始
    const prevStart = cfg.lastStartDayKey;
    cfg.lastStartDayKey = todayDk;
    cfg.history = Array.isArray(cfg.history) ? cfg.history : [];
    cfg.history.push({ startDayKey: todayDk });
    // 用上次到这次的间隔去平均化 averageLength(EMA)
    if (prevStart) {
      const actualCycle = daysBetween(prevStart, todayDk);
      if (actualCycle && actualCycle > 14 && actualCycle < 60) {
        cfg.averageLength = Math.max(14, Math.round(cfg.averageLength * 0.7 + actualCycle * 0.3));
      }
    }
    await persist();
    render();
  }

  function openSettingsModal() {
    openModal(container, {
      title: '周期 设置',
      fields: [
        { name: 'enabled',       label: '启用 周期 app', kind: 'checkbox', defaultValue: cfg.enabled },
        { name: 'visibleToChat', label: '注入 AI prompt(浮动窗 / 进行中 时让角色感知到)', kind: 'checkbox', defaultValue: cfg.visibleToChat },
        { name: 'averageLength', label: '平均周期长度(天)',  kind: 'number', defaultValue: cfg.averageLength, min: 14, max: 60 },
        { name: 'periodLength',  label: '来潮持续天数',        kind: 'number', defaultValue: cfg.periodLength,  min: 1,  max: 14 },
        { name: 'fluctuation',   label: '预测浮动 ±(天)',     kind: 'number', defaultValue: cfg.fluctuation,   min: 0,  max: 7  },
      ],
      submitLabel: '保存',
    }).then(async result => {
      if (!result) return;
      // openModal 的 checkbox 返回 true/false(modal.js 已经处理),不再需要解析 'on'
      cfg.enabled       = !!result.enabled;
      cfg.visibleToChat = !!result.visibleToChat;
      cfg.averageLength = Math.max(14, Math.min(60, parseInt(result.averageLength, 10) || 28));
      cfg.periodLength  = Math.max(1,  Math.min(14, parseInt(result.periodLength,  10) || 5));
      cfg.fluctuation   = Math.max(0,  Math.min(7,  parseInt(result.fluctuation,   10) || 2));
      await persist();
      render();
    });
  }

  function openAddSymptomModal() {
    const todayDk = dayKeyOf(Date.now());
    openModal(container, {
      title: '记一条症状',
      fields: [
        { name: 'dayKey',   label: '日期', kind: 'text',     defaultValue: todayDk, placeholder: 'YYYY-MM-DD' },
        { name: 'kind',     label: '类型', kind: 'select',   defaultValue: 'cramp',
          options: SYMPTOM_KINDS.map(k => ({ value: k.id, label: k.label })) },
        { name: 'severity', label: '程度(1 轻 / 2 中 / 3 重 · 留空也行)', kind: 'number', defaultValue: '', min: 1, max: 3 },
        { name: 'note',     label: '备注(可空)', kind: 'textarea', defaultValue: '' },
      ],
      submitLabel: '记录',
    }).then(async result => {
      if (!result) return;
      const dk = String(result.dayKey || todayDk).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) {
        await openAlert(container, { title: '日期格式不对', message: '要 YYYY-MM-DD 格式' });
        return;
      }
      await db.set('cycleSymptoms', {
        id: db.newId(),
        dayKey: dk,
        kind: String(result.kind || 'note'),
        severity: result.severity ? parseInt(result.severity, 10) : null,
        note: String(result.note || '').trim() || null,
        createdAt: Date.now(),
      });
      loadSymptomsList();
    });
  }

  render();
  return () => {
    container.removeEventListener('click', onSymptomDelClick);
  };
}
