// Prompt inspector — dev-mode debug page wired off chat header.
// Shows the EXACT system-prompt section list in injection order, lets the
// author hot-switch the active API config, edit the four override-able
// sections (humanizer / behavior / OUTPUT_COUNT_SPEC / ACTION_SCHEMAS_TEXT)
// inline, and dump the full joined string the model actually sees.
//
// Why this exists: when iterating on input/output rules you want to (a)
// confirm what the model receives, (b) tweak the conversation conventions
// without committing source-code changes, (c) flip between providers fast
// to A/B their JSON-output reliability. All three are needed often enough
// that hiding them behind 设置→API + console is friction.
//
// Edits go into settings.promptOverrides / .promptOutputOverrides — see
// context.js buildSystemPromptParts for the fallback chain. Empty string
// (intentional) means 「不注入此段」 and is preserved via `??` semantics.

import * as db from '../../core/db.js';
import * as context from '../../core/context.js';

export async function mountPromptInspector(container, params, router) {
  const sessionId = params?.sessionId;
  if (!sessionId) {
    container.innerHTML = `<div class="page"><div class="page-body">缺少 sessionId</div></div>`;
    return () => {};
  }

  // Tabbed layout — 整页之前是「API + 分段 + dump 折叠」一长串往下滚,在
  // 手机上找特定段很烦。改成 3 个 tab 顶上切换:API / 分段 / 完整。每个 tab
  // 独立 panel,active 才显示。dump 不再用「显示/隐藏」按钮,直接进自己的
  // tab。tab 切换不卸载 panel,数据已经预先 render 好(state 保留)。
  container.innerHTML = `
    <div class="page prompt-inspector-page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">提示词调试</div>
      </header>
      <nav class="pi-tabs">
        <button class="pi-tab active" data-tab="api">API</button>
        <button class="pi-tab" data-tab="parts">分段</button>
        <button class="pi-tab" data-tab="dump">完整</button>
      </nav>
      <div class="page-body">
        <section class="pi-panel" data-panel="api">
          <div class="pi-api-list"></div>
        </section>
        <section class="pi-panel" data-panel="parts" hidden>
          <div class="pi-parts"></div>
        </section>
        <section class="pi-panel" data-panel="dump" hidden>
          <pre class="pi-dump-pre"></pre>
        </section>
      </div>
    </div>
  `;

  const apiList = container.querySelector('.pi-api-list');
  const partsBox = container.querySelector('.pi-parts');
  const dumpPre = container.querySelector('.pi-dump-pre');
  const tabsNav = container.querySelector('.pi-tabs');

  // Bind 返回 before any awaits so it works during the initial load (which
  // can be slow when vector recall fires an embedding API call as part of
  // buildSystemPromptParts). Loading placeholders go into parts/api/dump
  // so the user sees the page is alive while data fills in.
  const onBack = () => router.back();
  container.querySelector('.back').addEventListener('click', onBack);
  apiList.innerHTML = `<div class="pi-empty">加载中…</div>`;
  partsBox.innerHTML = `<div class="pi-empty">加载中…</div>`;

  // ── API list ─────────────────────────────────────────────────────────
  async function renderApis() {
    const configs = await db.getAll('apiConfig');
    const settings = (await db.get('settings', 'default')) || {};
    const activeId = settings.activeApiConfigId;
    if (configs.length === 0) {
      apiList.innerHTML = `<div class="pi-empty">还没有 API 配置 — 去 <button class="pi-link" data-go="settings-api">设置 → API 设置</button> 创建</div>`;
      return;
    }
    apiList.innerHTML = configs.map(cfg => {
      const checked = cfg.id === activeId ? ' checked' : '';
      const sub = [cfg.modelName, hostOf(cfg.apiUrl)].filter(Boolean).join(' · ');
      return `
        <label class="pi-api-row${cfg.id === activeId ? ' active' : ''}">
          <input type="radio" name="api" value="${esc(cfg.id)}"${checked}>
          <div class="pi-api-text">
            <div class="pi-api-name">${esc(cfg.name || '(未命名)')}</div>
            <div class="pi-api-sub">${esc(sub)}</div>
          </div>
        </label>
      `;
    }).join('');
  }

  // ── Parts list ───────────────────────────────────────────────────────
  async function renderParts() {
    const parts = await context.buildSystemPromptParts(sessionId);
    const settings = (await db.get('settings', 'default')) || {};
    // 按 group 归类,group 内保持原 part 顺序(== 注入顺序)。GROUP_ORDER
    // 决定 group 之间的展示先后:与注入顺序对应(world → mem → state →
    // spec → output → misc)。
    const GROUP_ORDER = ['worldview', 'memory', 'state', 'spec', 'output', 'misc'];
    const grouped = new Map();
    parts.forEach((p, idx) => {
      const g = p.group || 'misc';
      if (!grouped.has(g)) grouped.set(g, []);
      grouped.get(g).push({ part: p, origIdx: idx });
    });
    partsBox.innerHTML = GROUP_ORDER
      .filter(g => grouped.has(g))
      .map(g => `
        <div class="pi-group">
          <h4 class="pi-group-title">${esc(context.GROUP_LABELS[g] || g)}</h4>
          ${grouped.get(g).map(({ part, origIdx }) => renderPart(part, origIdx, settings)).join('')}
        </div>
      `).join('');
  }

  // ── Dump ─────────────────────────────────────────────────────────────
  async function renderDump() {
    const full = await context.buildSystemPrompt(sessionId);
    dumpPre.textContent = full;
  }

  await Promise.all([renderApis(), renderParts(), renderDump()]);

  // ── Events ──────────────────────────────────────────────────────────

  // API hot-switch — radio change writes settings.activeApiConfigId.
  // No reload needed: ai.callAIOnce reads the active config on every call.
  apiList.addEventListener('change', async (e) => {
    const r = e.target.closest('input[type="radio"][name="api"]');
    if (!r) return;
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    s.activeApiConfigId = r.value;
    await db.set('settings', s);
    await renderApis();
  });

  // Link-style clicks in the empty state
  apiList.addEventListener('click', (e) => {
    const link = e.target.closest('[data-go]');
    if (link) router.navigate(link.dataset.go);
  });

  // Parts: edit / save / restore / go-to-edit-route
  partsBox.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-action="edit"]');
    if (edit) {
      const card = edit.closest('.pi-part');
      card.classList.toggle('editing');
      const ta = card.querySelector('textarea');
      if (card.classList.contains('editing')) {
        ta.removeAttribute('readonly');
        ta.focus();
      } else {
        ta.setAttribute('readonly', '');
      }
      return;
    }
    const save = e.target.closest('[data-action="save"]');
    if (save) {
      const card = save.closest('.pi-part');
      const scope = card.dataset.scope;
      const key = card.dataset.key;
      const ta = card.querySelector('textarea');
      const s = (await db.get('settings', 'default')) || { id: 'default' };
      s[scope] = { ...(s[scope] || {}), [key]: ta.value };
      await db.set('settings', s);
      await renderParts();
      await renderDump();
      return;
    }
    const restore = e.target.closest('[data-action="restore"]');
    if (restore) {
      const card = restore.closest('.pi-part');
      const scope = card.dataset.scope;
      const key = card.dataset.key;
      const s = (await db.get('settings', 'default')) || { id: 'default' };
      if (s[scope] && key in s[scope]) {
        delete s[scope][key];
        await db.set('settings', s);
      }
      await renderParts();
      await renderDump();
      return;
    }
    const goEdit = e.target.closest('[data-action="go-edit"]');
    if (goEdit) {
      const route = goEdit.dataset.route;
      const paramsStr = goEdit.dataset.params;
      const navParams = paramsStr ? JSON.parse(paramsStr) : {};
      router.navigate(route, navParams);
      return;
    }
  });

  // Tab switching — single source of truth = data-tab attribute. Panels
  // hidden by attribute; we never reload data on tab switch (already loaded).
  const onTabClick = (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    const want = tab.dataset.tab;
    tabsNav.querySelectorAll('.pi-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === want));
    container.querySelectorAll('.pi-panel').forEach(p => { p.hidden = p.dataset.panel !== want; });
  };
  tabsNav.addEventListener('click', onTabClick);

  return () => {
    container.querySelector('.back')?.removeEventListener('click', onBack);
    tabsNav?.removeEventListener('click', onTabClick);
  };
}

function renderPart(p, idx, settings) {
  const num = idx + 1;
  const hasOverride = p.kind === 'override'
    && settings[p.overrideScope]
    && p.overrideKey in (settings[p.overrideScope] || {});
  const empty = (p.body ?? '').trim() === '';
  const kindBadge =
    p.kind === 'override' ? (hasOverride ? '<span class="pi-badge override">已覆盖</span>' : '<span class="pi-badge locked">源常量</span>')
    : p.kind === 'data'   ? '<span class="pi-badge data">数据</span>'
    : '<span class="pi-badge computed">计算</span>';
  const skipBadge = empty ? '<span class="pi-badge skip">未注入</span>' : '';
  const warningRow = p.warning ? `<div class="pi-warning">${esc(p.warning)}</div>` : '';
  const titleLine = p.title ? esc(p.title) : `〈无段标题 — 顺位 ${num}〉`;
  const dataAttrs = p.kind === 'override'
    ? ` data-scope="${esc(p.overrideScope)}" data-key="${esc(p.overrideKey)}"`
    : '';

  if (p.kind === 'override') {
    return `
      <div class="pi-part"${dataAttrs}>
        <div class="pi-part-head">
          <div class="pi-part-title">${num}. ${titleLine} ${kindBadge}${skipBadge}</div>
          <div class="pi-part-actions">
            <button type="button" data-action="edit">编辑</button>
            ${hasOverride ? '<button type="button" data-action="restore">恢复默认</button>' : ''}
          </div>
        </div>
        ${warningRow}
        <textarea class="pi-part-body" readonly>${esc(p.body || '')}</textarea>
        <div class="pi-part-foot" hidden>
          <button type="button" data-action="save" class="btn">保存</button>
        </div>
      </div>
    `;
  }
  // data / computed — read-only, with optional 「去编辑」 link for data
  const goEdit = (p.kind === 'data' && p.editRoute)
    ? `<button type="button" data-action="go-edit" class="pi-link"
         data-route="${esc(p.editRoute)}"
         data-params='${esc(JSON.stringify(p.editParams || {}))}'>去编辑 →</button>`
    : '';
  return `
    <div class="pi-part">
      <div class="pi-part-head">
        <div class="pi-part-title">${num}. ${titleLine} ${kindBadge}${skipBadge}</div>
        <div class="pi-part-actions">${goEdit}</div>
      </div>
      <textarea class="pi-part-body" readonly>${esc(p.body || '')}</textarea>
    </div>
  `;
}

// Show the save button when the card is in editing mode.
// Easier as a CSS rule but we don't want to grow base.css before
// styles settle; expose via a tiny inline behavior in the click hook above.
// (.pi-part.editing .pi-part-foot is unhidden via CSS — set up in base.css.)

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return url ? String(url).slice(0, 30) : '';
  }
}
