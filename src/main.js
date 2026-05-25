// Entry point. Wires modules together at boot.

import * as db from './core/db.js';
import * as router from './core/router.js';
import * as ai from './core/ai.js';
import * as context from './core/context.js';
import { mountHome }        from './features/home/home.js';
import { mountSettings }    from './features/settings/settings.js';
import { mountApiSettings } from './features/settings/api-settings.js';
import { mountDataBackup }  from './features/settings/data-backup.js';
import { mountClearData }   from './features/settings/clear-data.js';
import { mountChatList }    from './features/chat-list/chat-list.js';
import { mountChat }        from './features/chat/chat.js';

// Expose modules on window for console-driven dev/debugging.
window.app = { db, router, ai, context };

function renderShell() {
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="phone-frame">
      <header class="status-bar">
        <span class="status-time">--:--</span>
        <span class="status-icons">
          <span class="signal">•••ıl</span>
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

async function boot() {
  await db.init();
  console.log('[boot] db ready');

  renderShell();
  startClock();
  startBattery();

  router.setContainer(document.getElementById('page-container'));
  router.registerPage('home',           mountHome);
  router.registerPage('settings',       mountSettings);
  router.registerPage('settings-api',   mountApiSettings);
  router.registerPage('settings-data',  mountDataBackup);
  router.registerPage('settings-clear', mountClearData);
  router.registerPage('chat-list',      mountChatList);
  router.registerPage('chat',           mountChat);

  await router.navigate('home');
  console.log('[boot] mounted home');
}

boot().catch(err => console.error('[boot] failed:', err));
