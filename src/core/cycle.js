// 生理期 / 周期 共享逻辑 — phase 计算 + 日期算术。
//
// 为什么放在 core/ 而不是 features/cycle/:context.js(prompt 注入)+
// cycle-notify.js(boot 通知)+ cycle-app.js(UI)都需要这套算法。如果留
// 在 features/cycle/cycle-app.js,context.js → features/ 就成了反向依赖。
//
// 数据 schema 见 db.js STORES.cycle。
//
// computeCycleStatus(cfg) 返回:
//   { phase: 'inactive'|'in-period'|'fluctuation'|'predicted'|'overdue', ... }
//   其它字段视 phase 而定 — 调用方按需用。

import { dayKeyOf } from './util.js';

// dayKey 'YYYY-MM-DD' → ms(本地 00:00)
export function dayKeyToTs(dk) {
  if (!dk) return null;
  const [y, m, d] = dk.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt.getTime();
}

// dayKey + N 天 → 新 dayKey
export function addDays(dk, n) {
  const ts = dayKeyToTs(dk);
  if (ts == null) return null;
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return dayKeyOf(d.getTime());
}

// 两个 dayKey 间的天数差(b - a)
export function daysBetween(a, b) {
  const ta = dayKeyToTs(a), tb = dayKeyToTs(b);
  if (ta == null || tb == null) return null;
  return Math.round((tb - ta) / 86400000);
}

export function computeCycleStatus(cfg, todayDk = dayKeyOf(Date.now())) {
  if (!cfg?.lastStartDayKey) return { phase: 'inactive' };
  const lastStart = cfg.lastStartDayKey;
  const periodLen = cfg.periodLength ?? 5;
  const avgLen    = cfg.averageLength ?? 28;
  const fluct     = cfg.fluctuation ?? 2;
  const periodEnd = addDays(lastStart, periodLen);            // exclusive
  const nextStart = addDays(lastStart, avgLen);
  const winStart  = addDays(nextStart, -fluct);
  const winEnd    = addDays(nextStart,  fluct);

  if (todayDk >= lastStart && todayDk < periodEnd) {
    return {
      phase: 'in-period',
      lastStart, nextStart,
      dayInPeriod: daysBetween(lastStart, todayDk) + 1,
      periodLength: periodLen,
    };
  }
  if (todayDk >= winStart && todayDk <= winEnd) {
    return { phase: 'fluctuation', lastStart, nextStart, winStart, winEnd };
  }
  if (todayDk < winStart) {
    return {
      phase: 'predicted',
      lastStart, nextStart,
      daysUntil: daysBetween(todayDk, nextStart),
    };
  }
  return {
    phase: 'overdue',
    lastStart, nextStart,
    daysOverdue: daysBetween(winEnd, todayDk),
  };
}
