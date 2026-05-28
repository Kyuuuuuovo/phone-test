// Entry point. Wires modules together at boot.

import * as db from './core/db.js';
import * as router from './core/router.js';
import * as ai from './core/ai.js';
import * as context from './core/context.js';
import { applyTheme as applyThemeObj, applyWallpaper } from './core/theme.js';
import { openConfirm, openAlert } from './core/modal.js';
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
import { mountKeepsakeApp }     from './features/keepsake/keepsake-app.js';
import { mountCycleApp }        from './features/cycle/cycle-app.js';
import {
  BEAR_CHARACTER_ID, BEAR_SESSION_ID, DEFAULT_BEAR_AVATAR,
  ensureBearExists, pickAmbientLine,
} from './core/pet.js';
import { scanDueBottles } from './core/bottle.js';
import * as notify from './core/notify.js';
import * as scheduleNotify from './core/schedule-notify.js';
import * as cycleNotify from './core/cycle-notify.js';

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
  router.registerPage('keepsake',          mountKeepsakeApp);
  router.registerPage('cycle',             mountCycleApp);

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
  // 周期通知 — 一次性 boot 检查,日级别 dedup,不需要 poll
  cycleNotify.start(router).catch(err => console.warn('[boot] cycle notify failed:', err));

  // T5: 桌面浏览器 .preset-scroll(主题预设 / 向量记忆 endpoint 预设那种横向 chip 行)
  // 在没有触屏的情况下用户没法滑 — 滚动条 CSS 又是 display: none。这里加一个
  // 文档级 wheel delegate:鼠标在 .preset-scroll 上滚 → 转成横向 scrollLeft。
  // passive: false 因为要 preventDefault 阻止 page 一起滚。
  document.addEventListener('wheel', (e) => {
    const scroller = e.target.closest?.('.preset-scroll');
    if (!scroller) return;
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;  // 已经是横向滚,不拦
    if (scroller.scrollWidth <= scroller.clientWidth) return;  // 不需要滚
    e.preventDefault();
    scroller.scrollLeft += e.deltaY;
  }, { passive: false });

  // 注册 AI 主动动作的副作用 handler。dispatchActions 调它把 action 写到
  // 业务 store 里。目前只有 add_schedule_entry — 角色对话里提了"明天 3
  // 点开会"模型输出这个 action,handler 自动写入 schedule store。
  ai.registerHandler('add_schedule_entry', async (action, ctx) => {
    const session = await db.get('chatSessions', ctx.sessionId);
    if (!session) return;
    const parseTs = (raw) => {
      if (raw == null || raw === '') return null;
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
      const t = new Date(String(raw)).getTime();
      return Number.isFinite(t) ? t : null;
    };
    const startTs = parseTs(action.startTs);
    if (startTs == null) {
      console.warn('[ai] add_schedule_entry: invalid startTs', action.startTs);
      return;
    }
    await db.set('schedule', {
      id: db.newId(),
      who: 'character',
      characterId: session.characterId,
      startTs,
      endTs: parseTs(action.endTs),
      title: String(action.title || '').trim() || '(无标题)',
      desc: String(action.desc || '').trim(),
      syncToChat: true,
      createdAt: Date.now(),
    });
  });

  await router.navigate('home');
  console.log('[boot] mounted home');

  // T18: Service Worker 注册 — iOS PWA(添加到主屏幕)无刷新按钮,SW 负责
  //   detect 新版本 + 通知 user 重启。file:// (本地双击 index.html) 跳过,
  //   localhost dev server / GH Pages 都注册。register('sw.js') 是相对路径,
  //   localhost / GH Pages 子目录部署都自动 resolve(scope = sw.js 所在目录)。
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      // 启动主动 check,触发 updatefound 如果 sw.js 字节有变化
      reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const newSw = reg.installing;
        if (!newSw) return;
        newSw.addEventListener('statechange', () => {
          // 新 SW 装好 + 已有 controller(说明这是 update,不是首次安装)
          if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });
    } catch (err) {
      console.warn('[sw] register failed:', err);
    }
  }
}

// 显示「有新版,点击重启」banner — T18 配合 SW updatefound 用。
// 避免重复显示 + 提供「重启」「关闭」两个交互。
function showUpdateBanner() {
  if (document.querySelector('.update-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span class="ub-text">有新版本,点击重启</span>
    <button class="ub-btn" type="button">重启</button>
    <button class="ub-dismiss" type="button" aria-label="关闭">×</button>
  `;
  document.body.appendChild(banner);
  banner.querySelector('.ub-btn').addEventListener('click', () => {
    // SW 已 skipWaiting + claim,直接 reload 就能拿新版资源
    location.reload();
  });
  banner.querySelector('.ub-dismiss').addEventListener('click', () => banner.remove());
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
    // 短点行为:聊天页打开「记忆助手」面板;其他页弹 ambient 气泡。
    // 「记忆助手」让 user 在聊天时不用切到其他 app 就能速览本会话记忆 +
    // 常用词 / 指令(点击复制到剪贴板)。再点桌宠 = 关闭面板(toggle)。
    const cur = router.current();
    if (cur?.id === 'chat' && cur.params?.sessionId) {
      const existing = document.querySelector('.memory-helper-backdrop');
      if (existing) { existing.remove(); return; }
      await openMemoryHelperPanel(cur.params.sessionId);
      return;
    }
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

// 记忆助手面板 — 聊天页戳桌宠短点触发。三段:本会话记忆速览 + 常用词
// + 常用指令。点击词 / 指令复制到剪贴板,user 自己粘到 chat input。
// 数据:settings.frequentPhrases / quickCommands(string[]),user 在
// 面板底部加新条目。本会话记忆从 memories store 拿(L1+L2)。
async function openMemoryHelperPanel(sessionId) {
  const frame = document.querySelector('.phone-frame');
  if (!frame) return;
  // 移除已存在的面板(防重复打开)
  document.querySelector('.memory-helper-backdrop')?.remove();

  async function render() {
    const settings = (await db.get('settings', 'default')) || {};
    const phrases = Array.isArray(settings.frequentPhrases) ? settings.frequentPhrases : [];
    const commands = Array.isArray(settings.quickCommands) ? settings.quickCommands : [];
    const mems = (await db.query('memories', 'sessionId', sessionId))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const esc = (s) => String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop memory-helper-backdrop';
    backdrop.innerHTML = `
      <div class="modal memory-helper-modal">
        <div class="modal-header">记忆助手</div>
        <div class="mh-section">
          <div class="mh-label">本会话记忆(${mems.length})</div>
          ${mems.length === 0 ? `
            <div class="mh-empty">还没有总结,聊得多了会自动生成。</div>
          ` : `
            <div class="mh-mem-list">
              ${mems.slice(0, 5).map(m => `
                <div class="mh-mem-row">
                  <span class="mh-tier">${m.tier === 2 ? '远期' : '近期'}</span>
                  <span class="mh-mem-summary">${esc((m.summary || '').slice(0, 80))}${(m.summary || '').length > 80 ? '…' : ''}</span>
                </div>
              `).join('')}
              ${mems.length > 5 ? `<div class="mh-mem-more">还有 ${mems.length - 5} 条 — 进记忆 app 看全部</div>` : ''}
            </div>
          `}
          <div class="mh-mem-actions">
            <button type="button" class="btn secondary mh-reset-btn">重置记忆</button>
            <button type="button" class="btn mh-resummarize-btn">重新提取</button>
          </div>
          <div class="mh-mem-status"></div>
        </div>
        <div class="mh-section">
          <div class="mh-label-row">
            <span class="mh-label">常用词(点击复制)</span>
            <button type="button" class="mh-add-btn" data-add="phrase">+</button>
          </div>
          ${phrases.length === 0 ? `
            <div class="mh-empty">还没有常用词。点 + 加一个。</div>
          ` : `
            <div class="mh-chips">
              ${phrases.map((p, i) => `
                <span class="mh-chip" data-copy="${esc(p)}">${esc(p)}<button class="mh-chip-del" data-del-phrase="${i}" title="删除">×</button></span>
              `).join('')}
            </div>
          `}
        </div>
        <div class="mh-section">
          <div class="mh-label-row">
            <span class="mh-label">常用指令(点击复制 → 粘到长按重新生成的 modal)</span>
            <button type="button" class="mh-add-btn" data-add="command">+</button>
          </div>
          ${commands.length === 0 ? `
            <div class="mh-empty">还没有常用指令。点 + 加一个,比如「换个角度」「短一点」。</div>
          ` : `
            <div class="mh-chips">
              ${commands.map((c, i) => `
                <span class="mh-chip" data-copy="${esc(c)}">${esc(c)}<button class="mh-chip-del" data-del-command="${i}" title="删除">×</button></span>
              `).join('')}
            </div>
          `}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn close-btn">关闭</button>
        </div>
      </div>
    `;
    frame.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    backdrop.querySelector('.close-btn').addEventListener('click', close);

    // 点击 chip 复制
    backdrop.querySelectorAll('.mh-chip').forEach(chip => {
      chip.addEventListener('click', async (e) => {
        if (e.target.closest('.mh-chip-del')) return;  // 删除子按钮自己处理
        const text = chip.dataset.copy;
        try {
          await navigator.clipboard.writeText(text);
        } catch (_) {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (_) {}
          document.body.removeChild(ta);
        }
        // 简单提示已复制(临时 toast)
        const orig = chip.textContent;
        const tag = document.createElement('span');
        tag.className = 'mh-copied';
        tag.textContent = '已复制';
        chip.appendChild(tag);
        setTimeout(() => tag.remove(), 1000);
      });
    });

    // 删除 chip
    backdrop.querySelectorAll('.mh-chip-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = btn.dataset.delPhrase ?? btn.dataset.delCommand;
        const key = btn.dataset.delPhrase != null ? 'frequentPhrases' : 'quickCommands';
        await db.updateSettings(s => {
          if (!Array.isArray(s[key])) return;
          s[key].splice(Number(idx), 1);
        });
        close();
        openMemoryHelperPanel(sessionId);
      });
    });

    // 加新 chip
    backdrop.querySelectorAll('.mh-add-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const kind = btn.dataset.add;
        const text = window.prompt(kind === 'phrase' ? '常用词 / 短语' : '常用指令');
        if (!text || !text.trim()) return;
        const key = kind === 'phrase' ? 'frequentPhrases' : 'quickCommands';
        await db.updateSettings(s => {
          if (!Array.isArray(s[key])) s[key] = [];
          s[key].push(text.trim());
        });
        close();
        openMemoryHelperPanel(sessionId);
      });
    });

    // 重置记忆 — 清 memories + 反 archive 所有消息 + 清相关 embeddings。
    // 不立即压缩,让用户接下来自己决定要不要继续聊或手动「重新提取」。
    const statusEl = backdrop.querySelector('.mh-mem-status');
    backdrop.querySelector('.mh-reset-btn')?.addEventListener('click', async () => {
      if (!await openConfirm(frame, {
        title: '重置当前记忆',
        message: '会删除本会话所有总结、把之前被压缩的消息恢复成正常聊天记录。不会立即重新生成总结。确定继续?',
        confirmLabel: '重置', danger: true,
      })) return;
      statusEl.textContent = '重置中…';
      try {
        await resetMemoriesForSession(sessionId);
        statusEl.textContent = '已重置';
        setTimeout(() => { close(); openMemoryHelperPanel(sessionId); }, 600);
      } catch (e) {
        statusEl.textContent = '失败:' + String(e).slice(0, 100);
      }
    });

    // 重新提取 — reset + 立即 maybeCompressMemory。一锤定音,基于当前所有
    // 消息从头压缩。会调 AI(可能慢),用户得明白这点。
    backdrop.querySelector('.mh-resummarize-btn')?.addEventListener('click', async () => {
      if (!await openConfirm(frame, {
        title: '重新提取记忆',
        message: '会删除现有总结、恢复被压缩的消息,然后基于当前所有消息重新生成总结。会调用 AI(可能慢)。确定继续?',
        confirmLabel: '重新提取', danger: true,
      })) return;
      statusEl.textContent = '重置 + AI 生成中…';
      try {
        await resetMemoriesForSession(sessionId);
        await context.maybeCompressMemory(sessionId);
        statusEl.textContent = '已重新提取';
        setTimeout(() => { close(); openMemoryHelperPanel(sessionId); }, 800);
      } catch (e) {
        statusEl.textContent = '失败:' + String(e).slice(0, 100);
      }
    });
  }

  await render();
}

// 重置一个会话的所有记忆 — 三件事原子心态(逐项 await 但不放一个 tx 里,
// 因为跨 3 个 store + maybeCompressMemory 后续也要写,大事务持有时间过长):
//   1. 删 memories(L1 + L2)
//   2. unarchive 所有 chatMessages(让被压缩进总结的消息恢复成活跃)
//   3. 删该会话的 memory-source embeddings(否则向量表留孤儿,以后再压缩
//      会重复 embed)
// 调用方:memory-helper 的「重置」按钮 / 「重新提取」按钮(后者再调
// maybeCompressMemory 跑一遍新压缩)。
async function resetMemoriesForSession(sessionId) {
  const mems = await db.query('memories', 'sessionId', sessionId);
  for (const m of mems) await db.del('memories', m.id);
  const msgs = await db.query('chatMessages', 'sessionId', sessionId);
  for (const m of msgs) {
    if (m.archived) {
      delete m.archived;
      delete m.archivedAt;
      delete m.archivedIntoMemoryId;
      await db.set('chatMessages', m);
    }
  }
  const embs = await db.query('embeddings', 'sessionId', sessionId);
  for (const e of embs) {
    if (e.sourceType === 'memory') await db.del('embeddings', e.id);
  }
}

boot().catch(err => console.error('[boot] failed:', err));
