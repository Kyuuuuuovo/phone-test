// 生理期 提醒通知。
//
// 跟 schedule-notify 不同 — 周期是「日」粒度,不需要每分钟 poll。boot 时
// 检查一次今天的 status,如果在浮动窗口 / 已 overdue,就 fire 一次 OS 通知
// (前提:enabled && settings.notifyOnReply 都打开)。
//
// dedup 用 dayKey — settings.cycleNotifiedDayKey 存上次发的日子,同一天不
// 重复发。user 切到 in-period(标了"开始")之后,这一周期就不再发任何通知,
// 等下个浮动窗口才有。

import * as db from './db.js';
import { dayKeyOf } from './util.js';
import { computeCycleStatus } from './cycle.js';

let routerRef = null;

export async function start(router) {
  routerRef = router;
  await checkAndNotify();
}

async function checkAndNotify() {
  const cfg = await db.get('cycle', 'default');
  if (!cfg?.enabled) return;
  const status = computeCycleStatus(cfg);
  // 只对「快开始(浮动窗内)」和「已推迟」发通知 — in-period 是 user 自己
  // 标的不需要 app 反过来提醒,inactive / predicted 距离还远没意义。
  if (status.phase !== 'fluctuation' && status.phase !== 'overdue') return;

  const settings = (await db.get('settings', 'default')) || {};
  if (settings.notifyOnReply !== true) return;  // 复用全局通知 toggle

  const todayDk = dayKeyOf(Date.now());
  if (settings.cycleNotifiedDayKey === todayDk) return;  // 今天发过了

  await db.updateSettings(s => { s.cycleNotifiedDayKey = todayDk; });

  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;

  const title = status.phase === 'fluctuation' ? '周期 · 可能就快了' : '周期 · 推迟提醒';
  const body  = status.phase === 'fluctuation'
    ? `预测窗口 ${status.winStart} – ${status.winEnd}`
    : `已推迟 ${status.daysOverdue} 天 · 如已开始记得在 app 里标一下`;
  try {
    const n = new Notification(title, { body, tag: `cycle-${todayDk}` });
    n.onclick = () => {
      try { window.focus(); } catch (_) {}
      try { routerRef?.navigate('cycle'); } catch (_) {}
      n.close();
    };
  } catch (e) {
    console.warn('[cycle-notify] OS notification failed:', e);
  }
}
