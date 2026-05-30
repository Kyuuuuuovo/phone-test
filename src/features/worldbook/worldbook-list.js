// Worldbook list. Each row shows name + entry count + how many characters mount it.
// 「导入酒馆 JSON」 accepts SillyTavern V2 character card AND raw worldbook
// (lorebook) exports; see importTavernWorldbook() below for the schema map.

import * as db from '../../core/db.js';
import { openAlert, openConfirm } from '../../core/modal.js';
import { esc } from '../../core/util.js';

export async function mountWorldbookList(container, params, router) {
  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">世界书</div>
        <div class="actions">
          <button class="import-tavern" title="导入酒馆 JSON">⇪</button>
          <button class="new-entity" title="新建世界书" aria-label="新建世界书"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
        </div>
      </header>
      <div class="page-body entity-list-body"></div>
    </div>
  `;

  const body = container.querySelector('.entity-list-body');

  async function renderList() {
    const wbs = await db.getAll('worldbooks');
    wbs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (wbs.length === 0) {
      body.innerHTML = `<div class="empty-state">还没有世界书<br>点右上角 + 新建一个</div>`;
      return;
    }
    // Pre-count entries + mounts in batch
    const entriesAll  = await db.getAll('worldbookEntries');
    const bindingsAll = await db.getAll('characterWorldbooks');
    const rows = wbs.map(wb => {
      const entryCount = entriesAll.filter(e => e.worldbookId === wb.id).length;
      const mountCount = bindingsAll.filter(b => b.worldbookId === wb.id).length;
      const meta = [
        `${entryCount} 个条目`,
        mountCount > 0 ? `${mountCount} 个角色挂载` : '未挂载',
      ].join(' · ');
      return `
        <button class="entity-row" data-id="${esc(wb.id)}">
          <div class="entity-avatar wb-avatar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 16H8v-2h8v2zm0-4H8v-2h8v2zm0-4H8V8h8v2z"/></svg></div>
          <div class="entity-info">
            <div class="entity-name">${esc(wb.name || '(未命名)')}</div>
            <div class="entity-sub">${esc(wb.description || '(没有描述)')}</div>
            <div class="entity-meta">${esc(meta)}</div>
          </div>
          <div class="entity-chevron">›</div>
        </button>
      `;
    }).join('');
    body.innerHTML = `<div class="entity-list">${rows}</div>`;
  }

  await renderList();

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    if (e.target.closest('.import-tavern')) {
      await importTavernWorldbook(router, renderList);
      return;
    }
    if (e.target.closest('.new-entity')) {
      const id = db.newId();
      const now = Date.now();
      await db.set('worldbooks', {
        id, name: '新世界书', description: '', createdAt: now, updatedAt: now,
      });
      return router.navigate('worldbook-detail', { id, isNew: true });
    }
    const row = e.target.closest('[data-id]');
    if (row) router.navigate('worldbook-detail', { id: row.dataset.id });
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}

// Import a SillyTavern worldbook / character-card JSON into a new worldbook.
//
// Accepts three shapes, in priority order:
//   1. V2 character card:   { data: { character_book: { entries: [...], name? } } }
//   2. Raw worldbook export: { entries: [...] | {0: ..., 1: ...}, name? }
//   3. Bare entries array:  [...]
//
// Per-entry mapping (lossy but practical — this app's worldbook model is
// "全量注入", whereas ST's is keyword-triggered, so `keys` becomes the title
// prefix as a label-only field; only `content` actually reaches the prompt):
//   • keys[] → title           (joined with " / ", capped 80 chars)
//   • content → content
//   • enabled → enabled        (defaults true if absent)
//   • position: 'before_char'  → before
//   • position: 'after_char'   → inline   (closest equivalent; before-user-persona)
//   • position: '0' / numeric  → inline
//   • insertion_order → used to sort, mapped onto createdAt sequentially
async function importTavernWorldbook(router, refresh) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    document.body.removeChild(input);
    if (!file) return;
    let data;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch (e) {
      await openAlert(document.body, { title: 'JSON 解析失败', message: String(e).slice(0, 200), danger: true });
      return;
    }
    // Resolve to { entries, name? }
    let book = null;
    if (data?.data?.character_book) book = data.data.character_book;
    else if (data?.entries)         book = data;
    else if (Array.isArray(data))   book = { entries: data };
    else if (Array.isArray(data?.blocks)) {
      // 有些工具把世界书导成 { blocks: [{content, enabled, keywords, sort_order, …}] }
      // —— 字段名不同但能对上,转成下面统一处理的 entries 形状。按"有 blocks 数组"
      // 这个结构识别,不绑定具体来源。
      book = {
        name: data.name,
        entries: data.blocks.map((b, i) => ({
          content: b?.content,
          enabled: b?.enabled,
          keys: Array.isArray(b?.keywords) ? b.keywords : [],
          comment: b?.title || b?.category || '',
          insertion_order: Number.isFinite(b?.sort_order) ? b.sort_order : i,
        })),
      };
    }
    if (!book) {
      await openAlert(document.body, { title: '导入失败', message: '文件里没找到 worldbook / character_book 字段。', danger: true });
      return;
    }
    // entries can be an object {0:..., 1:...} or an array
    let rawEntries = book.entries;
    if (rawEntries && !Array.isArray(rawEntries) && typeof rawEntries === 'object') {
      rawEntries = Object.values(rawEntries);
    }
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
      await openAlert(document.body, { title: '没东西可导入', message: 'entries 字段为空。', danger: true });
      return;
    }
    // Sort by insertion_order if present (lower first ≈ injected first)
    rawEntries = [...rawEntries].sort((a, b) => (a.insertion_order ?? 0) - (b.insertion_order ?? 0));

    const wbId = db.newId();
    const now = Date.now();
    const wbName = String(book.name || data?.name || file.name.replace(/\.json$/i, '') || '导入的世界书').slice(0, 60);
    if (!await openConfirm(document.body, {
      title: '导入世界书',
      message: `导入「${wbName}」,共 ${rawEntries.length} 条条目?`,
      confirmLabel: '导入',
    })) return;
    await db.set('worldbooks', {
      id: wbId, name: wbName,
      description: `从酒馆 JSON 导入(${rawEntries.length} 条)`,
      createdAt: now, updatedAt: now,
    });
    // Use a monotonically increasing createdAt offset so sort order matches
    // insertion_order even though the rows are written in a tight loop.
    let i = 0;
    for (const e of rawEntries) {
      const keys = Array.isArray(e.keys) ? e.keys
        : Array.isArray(e.key) ? e.key
        : [];
      const title = keys.length > 0
        ? keys.map(String).join(' / ').slice(0, 80)
        : String(e.comment || e.name || '').slice(0, 80) || '(导入条目)';
      const content = String(e.content || '').trim();
      if (!content) { i++; continue; }
      const pos = mapTavernPosition(e.position);
      await db.set('worldbookEntries', {
        id: db.newId(),
        worldbookId: wbId,
        title,
        content,
        enabled: e.enabled !== false,
        position: pos,
        createdAt: now + i,
      });
      i++;
    }
    await refresh();
    router.navigate('worldbook-detail', { id: wbId });
  });
  input.click();
}

function mapTavernPosition(p) {
  // ST V2 uses string positions; some exports use numeric codes.
  if (p === 'before_char' || p === 0) return 'before';
  if (p === 'after_char'  || p === 1) return 'inline';
  // 2/3 in ST are insertion before/after example chats — no equivalent here,
  // map to 'inline' as the safest default.
  return 'inline';
}
