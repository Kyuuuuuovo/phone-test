// 生理期 phase 计算 — 替代旧 core/cycle.js。
//
// 数据源换了:不再读独立 STORES.cycle 单例,而是从 checkinTypes 里 kind='period'
// 的那一条 type 上读 cycleConfig 字段。"周期 = 打卡的一种特殊类型" 设计的副作用 —
// 算法不变,只换数据入口。
//
// 调用方:context.buildCheckinLines(已合并 period 注入)/ period-notify.js
// (boot 检查通知)/ schedule app 的月历 + period section 渲染。
//
// Lookup helper:`findPeriodType(types)` 找到 array 里 kind='period' 的第一条,
// 没有就 return null;cycleConfig 也可能缺(老 data / 还没 migrate)→ 同 null
// 处理(phase='inactive')。

import { dayKeyOf } from './util.js';

// dayKey 'YYYY-MM-DD' → ms(本地 00:00)
export function dayKeyToTs(dk) {
  if (!dk) return null;
  const [y, m, d] = dk.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt.getTime();
}

export function addDays(dk, n) {
  const ts = dayKeyToTs(dk);
  if (ts == null) return null;
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return dayKeyOf(d.getTime());
}

export function daysBetween(a, b) {
  const ta = dayKeyToTs(a), tb = dayKeyToTs(b);
  if (ta == null || tb == null) return null;
  return Math.round((tb - ta) / 86400000);
}

// 从 checkinTypes array 里挑 kind='period' 的(通常只有 1 个,有多个取第一个)。
export function findPeriodType(types) {
  if (!Array.isArray(types)) return null;
  return types.find(t => t?.kind === 'period') || null;
}

// 计算 period status — 输入 cycleConfig(period type 上的字段),输出 phase。
// 跟 老 cycle.js#computeCycleStatus 同语义,只是 cfg 来源换了。
export function computePeriodStatus(cycleConfig, todayDk = dayKeyOf(Date.now())) {
  const cfg = cycleConfig || {};
  if (!cfg.lastStartDayKey) return { phase: 'inactive' };
  const lastStart = cfg.lastStartDayKey;
  const periodLen = cfg.periodLength ?? 5;
  const avgLen    = cfg.averageLength ?? 28;
  const fluct     = cfg.fluctuation ?? 2;
  const periodEnd = addDays(lastStart, periodLen);
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
