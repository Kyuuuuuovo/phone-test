// Entry point. Wires modules together at boot.

import * as db from './core/db.js';
import * as router from './core/router.js';
import * as ai from './core/ai.js';
import * as context from './core/context.js';
import { applyTheme as applyThemeObj, applyWallpaper } from './core/theme.js';
import { mountHome }        from './features/home/home.js';
import { mountSettings }    from './features/settings/settings.js';
import { mountApiSettings } from './features/settings/api-settings.js';
import { mountApiDetail }   from './features/settings/api-detail.js';
import { mountWeatherApi }  from './features/settings/weather-api.js';
import { mountTheme }       from './features/settings/theme.js';
import { mountMemorySettings } from './features/settings/memory.js';
import { mountEmbeddingSettings } from './features/settings/embedding.js';
import { mountDataBackup }  from './features/settings/data-backup.js';
import { mountClearData }   from './features/settings/clear-data.js';
import { mountAppIcons }    from './features/settings/app-icons.js';
import { mountWidgetPresets } from './features/settings/widget-presets.js';
import { mountChatList }    from './features/chat-list/chat-list.js';
import { mountMessaging }   from './features/messaging/messaging.js';
import { mountWallet }      from './features/wallet/wallet.js';
import { mountFavoritesList } from './features/favorites/favorites-list.js';
import { mountScheduleList } from './features/schedule/schedule-list.js';
import { mountChat }        from './features/chat/chat.js';
import { mountChatInfo }    from './features/chat/chat-info.js';
import { mountChatBeautify } from './features/chat/chat-beautify.js';
import { mountMemoryManage } from './features/chat/memory-manage.js';
import { mountChatSettings } from './features/chat/chat-settings.js';
import { mountPromptInspector } from './features/chat/prompt-inspector.js';
import { mountCharacterList }   from './features/character/character-list.js';
import { mountCharacterDetail } from './features/character/character-detail.js';
import { mountWorldbookList }   from './features/worldbook/worldbook-list.js';
import { mountWorldbookDetail } from './features/worldbook/worldbook-detail.js';
import { mountPersonaList }     from './features/persona/persona-list.js';
import { mountPersonaDetail }   from './features/persona/persona-detail.js';
import { mountPersonaPick }     from './features/persona/persona-pick.js';
import { mountMonitor }         from './features/monitor/monitor.js';
import { mountMonitorView }     from './features/monitor/monitor-view.js';
import { mountBottle }          from './features/bottle/bottle.js';
import { mountMemoryApp }       from './features/memory/memory-app.js';
import {
  BEAR_CHARACTER_ID, BEAR_SESSION_ID, DEFAULT_BEAR_AVATAR,
  ensureBearExists, pickAmbientLine,
} from './core/pet.js';
import { scanDueBottles } from './core/bottle.js';
import * as notify from './core/notify.js';
import * as scheduleNotify from './core/schedule-notify.js';

// Expose modules on window for console-driven dev/debugging.
window.app = { db, router, ai, context };

function renderShell() {
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="phone-frame">
      <header class="status-bar">
        <span class="status-time">--:--</span>
        <span class="status-icons">
          <svg class="signal-icon" viewBox="0 0 17 12" width="17" height="12" aria-hidden="true">
            <rect x="0"  y="9" width="2" height="3"  rx="0.5" fill="currentColor"/>
            <rect x="4"  y="6" width="2" height="6"  rx="0.5" fill="currentColor"/>
            <rect x="8"  y="3" width="2" height="9"  rx="0.5" fill="currentColor"/>
            <rect x="12" y="0" width="2" height="12" rx="0.5" fill="currentColor"/>
          </svg>
          <span class="battery">
            <span class="battery-pct">--%</span>
            <svg class="battery-icon" viewBox="0 0 27 12" width="27" height="12" aria-hidden="true">
              <rect x="0.75" y="0.75" width="22.5" height="10.5" rx="2.5" ry="2.5" fill="none" stroke="currentColor" stroke-width="1"/>
              <rect x="24" y="4" width="2" height="4" rx="0.6" fill="currentColor"/>
              <rect class="battery-fill" x="2" y="2" width="19.5" height="8" rx="0.6" fill="currentColor"/>
              <path class="battery-bolt" d="M14 2.5 L11 6.5 L13 6.5 L12 9.5 L15 5.5 L13 5.5 Z" fill="var(--surface)" style="display:none"/>
            </svg>
          </span>
        </span>
      </header>
      <div id="page-container"></div>
      <!-- Desk pet orb. Sits inside .phone-frame but OUTSIDE #page-container
           so it survives router.navigate() (pages get re-mounted, the orb
           doesn't). Hidden until ensureBearExists + setupPet bring it up. -->
      <button class="pet-orb" hidden type="button" aria-label="桌宠">
        <img class="pet-orb-img" alt="">
      </button>
      <div class="pet-bubble" hidden></div>
    </div>
  `;
}

function startClock() {
  const update = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const el = document.querySelector('.status-time');
    if (el) el.textContent = `${hh}:${mm}`;
  };
  update();
  setInterval(update, 30 * 1000);
}

async function startBattery() {
  const fillEl = () => document.querySelector('.battery-fill');
  const pctEl  = () => document.querySelector('.battery-pct');
  const boltEl = () => document.querySelector('.battery-bolt');

  const FILL_MAX = 19.5;  // inner fill width when 100% (matches SVG x=2..21.5)
  function render(level, charging) {
    const pct = Math.max(0, Math.min(100, Math.round(level * 100)));
    const f = fillEl(); const p = pctEl(); const b = boltEl();
    if (f) f.setAttribute('width', String(Math.max(0, FILL_MAX * (pct / 100))));
    if (p) p.textContent = `${pct}%`;
    if (b) b.style.display = charging ? 'block' : 'none';
  }

  if (typeof navigator.getBattery === 'function') {
    try {
      const bat = await navigator.getBattery();
      const update = () => render(bat.level, bat.charging);
      bat.addEventListener('levelchange',    update);
      bat.addEventListener('chargingchange', update);
      update();
      return;
    } catch (_) { /* fall through to fallback */ }
  }
  render(1.0, false);
}

async function applyTheme() {
  const settings = await db.get('settings', 'default');
  applyThemeObj(settings?.theme);
  // 壁纸全局 apply 到 .phone-frame —— 其他 page 默认 var(--bg) 不透明,
  // 自然会盖住壁纸,只有 .page.home 是 transparent 才能透出来。如果 user
  // 调高 surfaceAlpha,所有 page 都会变半透明,壁纸就 全 app 透出。这样
  // reload 后壁纸不丢(之前 home.js own lifecycle 的设计,但 reload 时
  // home 还没 mount,壁纸就空着)。
  applyWallpaper(settings?.wallpaper || null);
}

async function boot() {
  await db.init();
  console.log('[boot] db ready');

  // 先渲染 shell —— applyTheme 里的 applyWallpaper 需要 .phone-frame 已经在
  // DOM 里(它把背景图设到 frame 上)。之前是 applyTheme 先跑、renderShell
  // 后跑,所以 boot 时 wallpaper 设不上,要等到下次 user 上传/清除壁纸才
  // apply,reload 后壁纸丢失。
  renderShell();
  await applyTheme();
  startClock();
  startBattery();

  router.setContainer(document.getElementById('page-container'));
  router.registerPage('home',           mountHome);
  router.registerPage('settings',       mountSettings);
  router.registerPage('settings-api',        mountApiSettings);
  router.registerPage('settings-api-detail', mountApiDetail);
  router.registerPage('settings-weather',    mountWeatherApi);
  router.registerPage('settings-theme',      mountTheme);
  router.registerPage('settings-memory',     mountMemorySettings);
  router.registerPage('settings-embedding',  mountEmbeddingSettings);
  router.registerPage('settings-data',  mountDataBackup);
  router.registerPage('settings-clear', mountClearData);
  router.registerPage('settings-app-icons', mountAppIcons);
  router.registerPage('settings-widget-presets', mountWidgetPresets);
  router.registerPage('chat-list',         mountChatList);
  router.registerPage('messaging',         mountMessaging);
  router.registerPage('wallet',            mountWallet);
  router.registerPage('favorites-list',    mountFavoritesList);
  router.registerPage('schedule',          mountScheduleList);
  router.registerPage('chat',              mountChat);
  router.registerPage('chat-info',         mountChatInfo);
  router.registerPage('chat-beautify',     mountChatBeautify);
  router.registerPage('memory-manage',     mountMemoryManage);
  router.registerPage('chat-settings',     mountChatSettings);
  router.registerPage('prompt-inspector',  mountPromptInspector);
  router.registerPage('character-list',    mountCharacterList);
  router.registerPage('character-detail',  mountCharacterDetail);
  router.registerPage('worldbook-list',    mountWorldbookList);
  router.registerPage('worldbook-detail',  mountWorldbookDetail);
  router.registerPage('persona-list',      mountPersonaList);
  router.registerPage('persona-detail',    mountPersonaDetail);
  router.registerPage('persona-pick',      mountPersonaPick);
  router.registerPage('monitor',           mountMonitor);
  router.registerPage('monitor-view',      mountMonitorView);
  router.registerPage('bottle',            mountBottle);
  router.registerPage('memory',            mountMemoryApp);

  // Reserved bear character + session (id-stable, idempotent).
  await ensureBearExists(db, ai.getActiveApiConfig);
  // Bottles waiting to be auto-replied → check if any are due. Lazy
  // generation: only fires API calls when bottles cross their replyDueAt.
  scanDueBottles(db, ai).catch(err => console.warn('[boot] bottle scan failed:', err));
  // Pet floating orb wiring (drag persistence, ambient bubble, click → chat).
  setupPet(router).catch(err => console.warn('[boot] pet setup failed:', err));

  // Notification wiring — schedule-notify polls the user's own schedule
  // entries every 60s and raises an in-frame banner when one's startTs
  // is ±60s of now. notify just stashes a router reference so AI-reply
  // system notifications can navigate back to the right chat on click.
  notify.init(router);
  scheduleNotify.start(router);

  await router.navigate('home');
  console.log('[boot] mounted home');
}

// Set up the floating pet orb: load avatar / position from settings, wire
// drag + click + ambient bubble. Idempotent — safe to call once at boot.
async function setupPet(router) {
  const orb    = document.querySelector('.pet-orb');
  const img    = document.querySelector('.pet-orb-img');
  const bubble = document.querySelector('.pet-bubble');
  if (!orb || !img || !bubble) return;

  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  if (settings.petEnabled === false) {
    orb.hidden = true;
    bubble.hidden = true;
    return;
  }
  const bear = await db.get('characters', BEAR_CHARACTER_ID);
  img.src = bear?.avatar || DEFAULT_BEAR_AVATAR;
  orb.hidden = false;

  // Restore position. Default: bottom-right with margin.
  const frame = document.querySelector('.phone-frame');
  const frameRect = frame.getBoundingClientRect();
  const defaultX = frameRect.width  - 72;
  const defaultY = frameRect.height - 140;
  const x = Number.isFinite(settings.petX) ? settings.petX : defaultX;
  const y = Number.isFinite(settings.petY) ? settings.petY : defaultY;
  orb.style.left = clampToFrame(x, 'x') + 'px';
  orb.style.top  = clampToFrame(y, 'y') + 'px';

  function clampToFrame(v, axis) {
    const r = frame.getBoundingClientRect();
    const orbW = 48, orbH = 48;
    if (axis === 'x') return Math.max(8, Math.min(v, r.width  - orbW - 8));
    return Math.max(40, Math.min(v, r.height - orbH - 8));
  }

  // Pointer wiring:
  //   - pointerdown starts both a long-press timer (touch/pen → enter chat)
  //     and a drag-detect (>4px moved = drag, persisted on up).
  //   - pointerup with no drag and no long-press fired = short tap, shows
  //     an ambient bubble immediately.
  //   - contextmenu (desktop right-click) = enter chat.
  // The "tap to greet, long-press / right-click to chat" split matches
  // physical pet UX expectations — you can pet the orb without it dragging
  // you into a conversation.
  let drag = null;
  let longPressTimer = null;
  let longPressFired = false;
  const LONG_PRESS_MS = 600;

  function clearLongPress() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  orb.addEventListener('pointerdown', (e) => {
    const orbRect = orb.getBoundingClientRect();
    drag = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - orbRect.left,
      offsetY: e.clientY - orbRect.top,
      moved: false,
    };
    longPressFired = false;
    try { orb.setPointerCapture(e.pointerId); } catch (_) {}
    // Long-press for touch / pen only (desktop has right-click instead)
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        bubble.hidden = true;
        router.navigate('chat', { sessionId: BEAR_SESSION_ID });
        longPressTimer = null;
      }, LONG_PRESS_MS);
    }
  });
  orb.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      clearLongPress();  // moving cancels the long-press intent
    }
    if (drag.moved) {
      const r = frame.getBoundingClientRect();
      const nx = e.clientX - r.left - drag.offsetX;
      const ny = e.clientY - r.top  - drag.offsetY;
      orb.style.left = clampToFrame(nx, 'x') + 'px';
      orb.style.top  = clampToFrame(ny, 'y') + 'px';
      bubble.hidden = true;
    }
  });
  orb.addEventListener('pointerup', async (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    try { orb.releasePointerCapture(e.pointerId); } catch (_) {}
    clearLongPress();
    const wasDrag = drag.moved;
    const wasLongPress = longPressFired;
    drag = null;
    if (wasDrag) {
      const newX = parseFloat(orb.style.left) || 0;
      const newY = parseFloat(orb.style.top)  || 0;
      // Atomic settings write — concurrent updates (theme change, schedule
      // toggle, ambient dismissal) won't clobber petX/petY by racing on
      // the same get→put window.
      await db.updateSettings(s => { s.petX = newX; s.petY = newY; });
      return;
    }
    if (wasLongPress) return;  // chat already navigated
    // Plain short tap → pop an ambient bubble. If one's already up we just
    // re-trigger so the user sees a fresh line.
    await showBubble({ forceFresh: true });
  });
  // Right-click anywhere on the orb → go straight to chat.
  orb.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    bubble.hidden = true;
    router.navigate('chat', { sessionId: BEAR_SESSION_ID });
  });

  // Bubble — picks a rule-driven line, no API call. Click on bubble dismisses
  // + writes petDismissed[triggerKey] = now (cooldown lives in pet.js).
  // forceFresh: short-tap on the orb wants a greeting RIGHT NOW even if the
  // bubble's already up; we transiently clear the dismissed map so a recently
  // dismissed trigger can fire again, then restore it after the pick.
  let currentTriggerKey = null;
  async function showBubble({ forceFresh = false } = {}) {
    // All three settings writes below go through updateSettings so the
    // get→modify→put runs in a single IDB tx. Without this, the pickAmbientLine
    // await between read+write was the worst race-prone spot in the app —
    // a concurrent settings write (toggle, theme, dismissal) could clobber
    // petDismissed / petLastBubbleAt back to stale.
    let restoreDismissed = null;
    if (forceFresh) {
      await db.updateSettings(s => {
        restoreDismissed = s.petDismissed || {};
        s.petDismissed = {};
      });
    }
    const picked = await pickAmbientLine({ db, getActiveApiConfig: ai.getActiveApiConfig });
    if (restoreDismissed) {
      // Restore the dismissed map, except mark the just-used trigger as
      // "seen now" so the user-initiated greeting also counts and won't
      // re-pop a moment later.
      await db.updateSettings(s => {
        s.petDismissed = { ...restoreDismissed };
        if (picked) s.petDismissed[picked.triggerKey] = Date.now();
      });
    }
    if (!picked) return;
    currentTriggerKey = picked.triggerKey;
    bubble.textContent = picked.line;
    positionBubble();
    bubble.hidden = false;
    await db.updateSettings(s => { s.petLastBubbleAt = Date.now(); });
  }
  function positionBubble() {
    const orbRect = orb.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const bx = orbRect.left - frameRect.left - 100;  // bubble width-ish offset
    const by = orbRect.top  - frameRect.top  - 44;   // above orb
    bubble.style.left = Math.max(8, bx) + 'px';
    bubble.style.top  = Math.max(40, by) + 'px';
  }
  bubble.addEventListener('click', async () => {
    bubble.hidden = true;
    if (currentTriggerKey) {
      const key = currentTriggerKey;
      await db.updateSettings(s => {
        s.petDismissed = { ...(s.petDismissed || {}), [key]: Date.now() };
      });
    }
  });

  // Fire once at boot, after a short delay so the page can mount first.
  setTimeout(() => { showBubble().catch(() => {}); }, 800);
}

boot().catch(err => console.error('[boot] failed:', err));
