// Edit one worldbook + inline-manage its entries.
// Each entry is its own card with title/content/order/enabled fields that autosave on change.

import * as db from '../../core/db.js';
import { openConfirm } from '../../core/modal.js';

export async function mountWorldbookDetail(container, params, router) {
  const id = params.id;
  if (!id) {
    container.innerHTML = `<div class="page"><div class="page-body">缺少 id</div></div>`;
    return () => {};
  }
  const wb = await db.get('worldbooks', id);
  if (!wb) {
    container.innerHTML = `<div class="page"><div class="page-body">世界书不存在</div></div>`;
    return () => {};
  }
  const mountCount = (await db.query('characterWorldbooks', 'worldbookId', id)).length;

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">编辑世界书</div>
      </header>
      <div class="page-body">
        <form class="settings-form wb-meta-form" autocomplete="off">
          <label>
            <div class="label-text">名称</div>
            <input name="name" required value="${esc(wb.name)}">
          </label>
          <label>
            <div class="label-text">描述(只给你自己看)</div>
            <textarea name="description" rows="2">${esc(wb.description)}</textarea>
          </label>
          <p class="hint">${mountCount > 0 ? `当前被 ${mountCount} 个角色挂载` : '当前没有角色挂载这本世界书'} — 在角色详情页里勾选挂载。</p>
          <div class="form-actions">
            <button type="submit" class="btn">保存</button>
            <button type="button" class="btn danger delete-wb">删除世界书</button>
          </div>
          <div class="form-status"></div>
        </form>

        <div class="entries-section">
          <div class="entries-header">
            <div class="label-text">条目(v1 全量常驻注入)</div>
            <button type="button" class="btn add-entry">+ 新建条目</button>
          </div>
          <div class="entries-list"></div>
        </div>
      </div>
    </div>
  `;

  const metaForm   = container.querySelector('.wb-meta-form');
  const status     = container.querySelector('.form-status');
  const backBtn    = container.querySelector('.back');
  const deleteBtn  = container.querySelector('.delete-wb');
  const addEntryBtn = container.querySelector('.add-entry');
  const entriesList = container.querySelector('.entries-list');

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = `form-status${kind ? ' ' + kind : ''}`;
  }

  async function renderEntries() {
    const entries = await db.query('worldbookEntries', 'worldbookId', id);
    entries.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    if (entries.length === 0) {
      entriesList.innerHTML = `<p class="hint">还没有条目,点上方「+ 新建条目」开始。</p>`;
      return;
    }
    entriesList.innerHTML = entries.map(e => {
      const pos = (e.position === 'before' || e.position === 'after') ? e.position : 'inline';
      const keywordsCsv = Array.isArray(e.keywords) ? e.keywords.join(', ') : '';
      return `
      <div class="entry-card" data-entry-id="${esc(e.id)}">
        <div class="entry-card-row">
          <input class="entry-title" placeholder="标题(只你自己看,用来识别条目)" value="${esc(e.title)}">
          <select class="entry-position" title="注入位置">
            <option value="before"${pos === 'before' ? ' selected' : ''}>角色设定前</option>
            <option value="inline"${pos === 'inline' ? ' selected' : ''}>角色设定后(默认)</option>
            <option value="after"${pos === 'after'   ? ' selected' : ''}>用户人设后</option>
          </select>
          <label class="entry-enabled" title="启用">
            <input type="checkbox"${e.enabled !== false ? ' checked' : ''}>
            <span>启用</span>
          </label>
          <button type="button" class="btn danger entry-delete">删除</button>
        </div>
        <textarea class="entry-content" rows="4" placeholder="条目内容,会被原样注入到 system prompt 的「世界观/背景设定」段">${esc(e.content)}</textarea>
        <input class="entry-keywords" placeholder="关键词触发(逗号分隔,留空 = 永远注入;填了 = 只在最近 10 条消息出现其中一个才注入)" value="${esc(keywordsCsv)}">
      </div>
    `;
    }).join('');
  }

  await renderEntries();

  async function saveMeta() {
    const fd = new FormData(metaForm);
    Object.assign(wb, {
      name:        String(fd.get('name')        || '').trim() || '(未命名)',
      description: String(fd.get('description') || '').trim(),
      updatedAt:   Date.now(),
    });
    await db.set('worldbooks', wb);
  }

  async function saveEntryFromCard(card) {
    const entryId = card.dataset.entryId;
    const e = await db.get('worldbookEntries', entryId);
    if (!e) return;
    e.title    = card.querySelector('.entry-title').value.trim();
    e.content  = card.querySelector('.entry-content').value;
    e.enabled  = card.querySelector('.entry-enabled input').checked;
    e.position = card.querySelector('.entry-position').value || 'inline';
    // 关键词触发:UI 是逗号分隔字符串,DB 存 string[]。空 → undefined(向后
    // 兼容,等同永远注入)。每个 keyword trim + 过滤空字符串,避免「,, A」
    // 这种输入产生 ["", "", "A"] 然后空 keyword 匹配所有消息。
    const kwRaw = card.querySelector('.entry-keywords')?.value || '';
    const kwList = kwRaw.split(/[,,]/).map(s => s.trim()).filter(Boolean);
    if (kwList.length > 0) e.keywords = kwList;
    else delete e.keywords;
    await db.set('worldbookEntries', e);
  }

  const onBack = () => router.back();

  const onSubmitMeta = async (e) => {
    e.preventDefault();
    await saveMeta();
    setStatus('已保存', 'success');
  };

  const onDeleteWb = async () => {
    const entries = await db.query('worldbookEntries', 'worldbookId', id);
    const bindings = await db.query('characterWorldbooks', 'worldbookId', id);
    const msg = `删除世界书「${wb.name}」会同时删 ${entries.length} 个条目${bindings.length > 0 ? `,并从 ${bindings.length} 个角色身上解除挂载` : ''}。继续?`;
    if (!await openConfirm(container, {
      title: '删除世界书',
      message: msg,
      confirmLabel: '删除',
      danger: true,
    })) return;
    for (const e of entries)  await db.del('worldbookEntries', e.id);
    for (const b of bindings) await db.del('characterWorldbooks', b.id);
    await db.del('worldbooks', id);
    router.back();
  };

  const onAddEntry = async () => {
    await db.set('worldbookEntries', {
      id: db.newId(),
      worldbookId: id,
      title: '',
      content: '',
      enabled: true,
      position: 'inline',
      createdAt: Date.now(),
    });
    await renderEntries();
  };

  // Autosave entries on blur of any input/textarea inside the card.
  const onEntriesChange = async (e) => {
    const card = e.target.closest('.entry-card');
    if (!card) return;
    if (e.target.matches('.entry-title, .entry-content, .entry-position, .entry-keywords') ||
        e.target.matches('.entry-enabled input')) {
      try {
        await saveEntryFromCard(card);
      } catch (err) {
        setStatus(`条目保存失败:${String(err).slice(0, 200)}`, 'error');
      }
    }
  };

  const onEntriesClick = async (e) => {
    if (e.target.closest('.entry-delete')) {
      const card = e.target.closest('.entry-card');
      const entryId = card.dataset.entryId;
      if (!await openConfirm(container, {
        title: '删除条目',
        message: '删除这个条目?',
        confirmLabel: '删除',
        danger: true,
      })) return;
      await db.del('worldbookEntries', entryId);
      await renderEntries();
    }
  };

  backBtn.addEventListener('click', onBack);
  metaForm.addEventListener('submit', onSubmitMeta);
  deleteBtn.addEventListener('click', onDeleteWb);
  addEntryBtn.addEventListener('click', onAddEntry);
  entriesList.addEventListener('change', onEntriesChange);
  entriesList.addEventListener('blur',   onEntriesChange, true);
  entriesList.addEventListener('click',  onEntriesClick);

  return () => {
    backBtn.removeEventListener('click', onBack);
    metaForm.removeEventListener('submit', onSubmitMeta);
    deleteBtn.removeEventListener('click', onDeleteWb);
    addEntryBtn.removeEventListener('click', onAddEntry);
    entriesList.removeEventListener('change', onEntriesChange);
    entriesList.removeEventListener('blur',   onEntriesChange, true);
    entriesList.removeEventListener('click',  onEntriesClick);
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
