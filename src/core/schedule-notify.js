// Front-foreground schedule reminder.
//
// Polls the schedule store every 60s while the page is foreground. When a
// user-bucket schedule entry's startTs falls within ±60s of "now" and we
// haven't fired for that entry yet, it raises a banner inside .phone-frame.
//
// Browser limitations (CLAUDE.md 铁律 1: no backend):
//   - Backgrounded tabs have setInterval throttled to ~1min by Chrome; we
//     still tick, just less often.
//   - Closed tabs / suspended mobile browsers won't run JS at all — there
//     is no service worker or push server to fall back to.
//   - This is therefore "you'll see it when you come back to the tab", not
//     "I'll find you wherever you are". For the latter you'd need a
//     backend, which the design rules out.
//
// Dedup: settings.scheduleNotifiedIds[] is a rolling list (capped 50) of
// schedule entry ids we've already fired for. We don't store-per-entry
// because the schedule row should remain editable / deletable freely.
// A 30-minute staleness cutoff prevents replaying very-old fires on first
// page load after a long absence.
//
// Banner UI: slides in from top, two buttons (去行程 / 知道了). Stays
// until the user clicks — don't auto-dismiss, the whole point is they
// might be looking elsewhere when it fires.

import * as db from './db.js';

const POLL_MS    = 60_000;       // foreground tick
const WINDOW_MS  = 60_000;       // fire window: ±60s of startTs
const STALE_MS   = 30 * 60_000;  // don't fire on entries older than 30min
const KEEP_IDS   = 50;           // cap on settings.scheduleNotifiedIds

let intervalId = null;
let routerRef = null;
let bannerEl = null;

export function start(router) {
  routerRef = router;
  if (intervalId) stop();
  tick();
  intervalId = setInterval(tick, POLL_MS);
}

export function stop() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  dismissBanner();
}

async function tick() {
  // Always tick — even when hidden,我们可以走系统通知联动手机锁屏(只要 user
  // 在设置开了「弹系统通知」且授权了 Notification.permission)。banner 只在
  // tab 可见时弹(隐藏时弹 banner 没意义),OS notification 是 hidden 时的
  // 路径。
  if (bannerEl) return;  // 一次只弹一条 banner
  const settings = (await db.get('settings', 'default')) || {};
  const notified = new Set(settings.scheduleNotifiedIds || []);
  const all = await db.getAll('schedule');
  const now = Date.now();
  // user-bucket only — character schedules are for the model, not the user
  const due = all.find(e =>
       e.who === 'user'
    && Math.abs(e.startTs - now) <= WINDOW_MS
    && now - e.startTs <= STALE_MS
    && !notified.has(e.id));
  if (!due) return;
  // Mark notified BEFORE the banner shows. If banner code throws, we'd
  // rather lose the alert than fire forever in a loop.
  notified.add(due.id);
  await db.updateSettings(s => {
    s.scheduleNotifiedIds = [...notified].slice(-KEEP_IDS);
  });
  if (document.hidden) {
    // tab 不在前台 → 系统通知联动(锁屏弹出、桌面 toast 等)。前提:user
    // 在设置打开过「弹系统通知」+ 浏览器授权。permission denied 时静默
    // 跳过(用户已经明确说"不要")。
    fireOsNotification(due, settings);
  } else {
    showBanner(due);
  }
}

// 系统级 Notification — 跟 in-app banner 互补:可见时显 banner,隐藏时显
// OS 通知。复用 settings.notifyOnReply 开关(那个开关本来就叫"AI 回复 +
// 行程到点 时弹系统通知"覆盖两路)。失败静默 — 弹不出不影响 app 流程。
function fireOsNotification(entry, settings) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (settings.notifyOnReply !== true) return;  // 共用 toggle
  try {
    const n = new Notification(entry.title || '行程到点', {
      body: `${formatTime(entry.startTs)}${entry.desc ? ' · ' + entry.desc : ''}`,
      tag: `sched-${entry.id}`,
    });
    n.onclick = () => {
      try { window.focus(); } catch (_) {}
      try { routerRef?.navigate('schedule'); } catch (_) {}
      n.close();
    };
  } catch (e) {
    console.warn('[schedule-notify] OS notification failed:', e);
  }
}

function showBanner(entry) {
  dismissBanner();
  const frame = document.querySelector('.phone-frame');
  if (!frame) return;
  const time = formatTime(entry.startTs);
  const banner = document.createElement('div');
  banner.className = 'schedule-banner';
  banner.innerHTML = `
    <div class="sb-inner">
      <div class="sb-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/>
          <path d="M10 20a2 2 0 0 0 4 0"/>
        </svg>
      </div>
      <div class="sb-body">
        <div class="sb-title">${esc(entry.title || '行程到点')}</div>
        <div class="sb-meta">${esc(time)}${entry.desc ? ' · ' + esc(entry.desc) : ''}</div>
      </div>
      <div class="sb-actions">
        <button type="button" class="sb-go">去看看</button>
        <button type="button" class="sb-ok" aria-label="关闭">×</button>
      </div>
    </div>
  `;
  frame.appendChild(banner);
  bannerEl = banner;
  // Trigger slide-in on next frame so the initial transform-from-top can animate.
  requestAnimationFrame(() => banner.classList.add('show'));
  banner.querySelector('.sb-ok').addEventListener('click', dismissBanner);
  banner.querySelector('.sb-go').addEventListener('click', () => {
    dismissBanner();
    try { routerRef?.navigate('schedule'); } catch (_) {}
  });
}

function dismissBanner() {
  if (!bannerEl) return;
  const b = bannerEl;
  bannerEl = null;
  b.classList.remove('show');
  // Remove after the CSS transition finishes (250ms in base.css).
  setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, 260);
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
