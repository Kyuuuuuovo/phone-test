// 千纸鹤 / 叠星星 — 延迟揭晓的关系信物 app。
//
// 设计:
//   - User 出题:选角色 + 主题(「你想跟我说的话」之类)+ 类型(纸鹤 / 星星)
//     + 数量 → 创建 N 条 status='folded' 行,**不调 API**。
//   - 拆:点 folded → lazy 调 API 生成 content → status='opened'。生成时
//     prompt 带角色 persona + 主题 + "这是第 N 颗 / 共 M 颗",让每一颗
//     内容不一样、跟当前关系状态贴合。
//   - opened:两个按钮「留下」(→ kept,可重读)/「丢掉」(→ delete row,
//     hard delete,仪式感)。
//   - kept 单独 tab 可反复重读;留下的可以让角色之后提起(暂不做)。
//
// 文案是作者锁定占位 — 作者填具体语气。Claude 不替作者定稿。

import * as db from '../../core/db.js';
import * as ai from '../../core/ai.js';
import { openConfirm, openAlert, openModal } from '../../core/modal.js';

const TYPE_LABELS = { crane: '纸鹤', star: '星星' };
const TYPE_ICONS  = { crane: '🕊️', star: '⭐' };

// 作者锁定文案(2026-05-28 user 写定)。
// sys 里 __USER_NAME__ / __CHAR_NAME__ / __CHAR_PERSONA__ 三个占位 — type /
// nth / total / theme 放 userMsg 里(具体 task 上下文,sys 保持诗意框架)。
const KEEPSAKE_SYS_TEMPLATE = `# 千纸鹤与星星

你偶尔会叠千纸鹤或星星给__USER_NAME__,把字写在里面。__USER_NAME__拆开才能看到。

这些是你没说出口的东西——某次对话里咽回去的半句话,某个回忆浮上来时的念头,某些你想对ta说的话或者你自己也说不清为什么会想到的一个瞬间。

**千纸鹤** — 正方形纸,可以写几句。但不要多。
**星星** — 窄纸带,只够写一句。

那些留在心里会发霉的东西,趁叠纸的时候写下来吧。

---

你是【__CHAR_NAME__】。
__CHAR_PERSONA__`;

function escHtml(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}

export async function mountKeepsakeApp(container, params, router) {
  let activeTab = 'folded';  // folded / kept

  async function render() {
    const all = await db.getAll('keepsakes');
    const folded = all.filter(k => k.status === 'folded' || k.status === 'opened');
    const kept   = all.filter(k => k.status === 'kept');
    const chars = (await db.getAll('characters')).filter(c => c.id !== '__bear__');
    const charMap = new Map(chars.map(c => [c.id, c]));

    const tabRows = activeTab === 'folded' ? folded : kept;
    tabRows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    container.innerHTML = `
      <div class="page keepsake-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">千纸鹤</div>
          <div class="actions">
            <button class="new-keepsake" title="折一些" aria-label="折一些"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
          </div>
        </header>
        <div class="page-body">
          <div class="ks-tabs">
            <button class="ks-tab${activeTab === 'folded' ? ' active' : ''}" data-tab="folded">未拆 / 已拆(${folded.length})</button>
            <button class="ks-tab${activeTab === 'kept' ? ' active' : ''}" data-tab="kept">已留下(${kept.length})</button>
          </div>
          ${tabRows.length === 0 ? `
            <p class="hint">${activeTab === 'folded' ? '罐子是空的。点右上角 +,让某个角色给你折几颗。' : '还没留下什么。拆开后选「留下」就会出现在这里,可以反复打开重读。'}</p>
          ` : `
            <div class="ks-grid">
              ${tabRows.map(k => renderKeepsake(k, charMap)).join('')}
            </div>
          `}
        </div>
      </div>
    `;
    wire();
  }

  function renderKeepsake(k, charMap) {
    const c = charMap.get(k.characterId);
    const icon = TYPE_ICONS[k.type] || '🎁';
    const label = TYPE_LABELS[k.type] || '信物';
    const charName = c?.name || '?';
    if (k.status === 'folded') {
      return `<button class="ks-card folded" data-keepsake-id="${escHtml(k.id)}" data-action="open">
        <div class="ks-icon">${icon}</div>
        <div class="ks-meta">${escHtml(charName)} · ${escHtml(label)} · 第 ${k.nth}/${k.total} 颗</div>
        <div class="ks-hint">点击拆开</div>
      </button>`;
    }
    if (k.status === 'opened' || k.status === 'kept') {
      const opened = k.status === 'opened';
      return `<div class="ks-card ${opened ? 'opened' : 'kept'}" data-keepsake-id="${escHtml(k.id)}">
        <div class="ks-icon">${icon}</div>
        <div class="ks-meta">${escHtml(charName)} · ${escHtml(label)} · 主题「${escHtml(k.theme || '')}」</div>
        <div class="ks-content">${escHtml(k.content || '')}</div>
        ${opened ? `
          <div class="ks-actions">
            <button class="btn ks-keep" type="button">留下</button>
            <button class="btn secondary ks-discard" type="button">丢掉</button>
          </div>
        ` : `
          <div class="ks-kept-stamp">已留下 · 可反复重读</div>
          <button class="ks-row-del" type="button" title="移除">×</button>
        `}
      </div>`;
    }
    return '';
  }

  async function openCreateModal() {
    const chars = (await db.getAll('characters')).filter(c => c.id !== '__bear__');
    if (chars.length === 0) {
      await openAlert(container, { title: '还没有角色', message: '先去角色管理建一个,再回来让 ta 折给你。' });
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">让 ta 折一些</div>
        <form class="ks-create-form" autocomplete="off">
          <label>
            <div class="label-text">谁折给你</div>
            <select name="characterId">
              ${chars.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name || '(未命名)')}</option>`).join('')}
            </select>
          </label>
          <label>
            <div class="label-text">折什么</div>
            <select name="type">
              <option value="crane">🕊️ 千纸鹤</option>
              <option value="star">⭐ 星星</option>
            </select>
          </label>
          <label>
            <div class="label-text">主题(给 ta 一个出发点 — 写得具体点效果更好)</div>
            <input type="text" name="theme" required maxlength="80" placeholder="比如:你想跟我说但平时不会说的话 / 关于我们那次旅行 / 你最近想了什么">
          </label>
          <label>
            <div class="label-text">折几颗(1-9)</div>
            <input type="number" name="count" min="1" max="9" value="3" required>
          </label>
          <p class="hint">折好后是"未拆"状态。每颗点开才会让 ta 现写内容(每颗都不一样,跟当前关系状态贴合)。所以这是一个慢慢拆的小仪式。</p>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">折好</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      const characterId = String(fd.get('characterId') || '');
      const type = String(fd.get('type') || 'crane');
      const theme = String(fd.get('theme') || '').trim();
      const count = Math.max(1, Math.min(9, Number(fd.get('count')) || 3));
      if (!characterId || !theme) return;
      const now = Date.now();
      for (let i = 1; i <= count; i++) {
        await db.set('keepsakes', {
          id: db.newId(),
          characterId,
          type,
          theme,
          status: 'folded',
          nth: i,
          total: count,
          createdAt: now + i,  // +i 让 sort 时按顺序
        });
      }
      modal.remove();
      await render();
    });
  }

  async function openKeepsake(id) {
    const k = await db.get('keepsakes', id);
    if (!k || k.status !== 'folded') return;
    const c = await db.get('characters', k.characterId);
    if (!c) { await openAlert(container, { title: '角色不存在', message: '这个角色被删了,没法拆开。' }); return; }
    // 显示 loading 状态先 — 把那张卡换成 ".loading",防止 user 多点
    const cardEl = container.querySelector(`[data-keepsake-id="${id}"]`);
    if (cardEl) cardEl.classList.add('loading');
    try {
      // user 名字从 active persona 拿(settings.activePersonaId),没设就 fallback「你」。
      const settings = (await db.get('settings', 'default')) || {};
      const activePersona = settings.activePersonaId
        ? await db.get('personas', settings.activePersonaId)
        : null;
      const userName = activePersona?.name || '你';
      const sys = KEEPSAKE_SYS_TEMPLATE
        .replace(/__USER_NAME__/g, userName)
        .replace('__CHAR_NAME__', c.name || '角色')
        .replace('__CHAR_PERSONA__', c.persona || '');
      const userMsg = `这次叠的是${TYPE_LABELS[k.type]},第 ${k.nth} 颗 / 共 ${k.total} 颗,每一颗都要不一样。\n契机:${k.theme}\n直接写纸上那段字。不要"亲爱的"这种抬头,不要署名,不要"以下是..."之类的前缀。`;
      const content = await ai.callAI({
        systemPrompt: sys,
        messages: [{ role: 'user', content: userMsg }],
        temperature: 0.85,
      });
      const text = String(content || '').trim();
      if (!text) throw new Error('模型没返回内容');
      k.content = text;
      k.status = 'opened';
      k.openedAt = Date.now();
      await db.set('keepsakes', k);
      await render();
    } catch (err) {
      if (cardEl) cardEl.classList.remove('loading');
      await openAlert(container, { title: '拆开失败', message: String(err).slice(0, 300), danger: true });
    }
  }

  async function keepKeepsake(id) {
    const k = await db.get('keepsakes', id);
    if (!k || k.status !== 'opened') return;
    k.status = 'kept';
    await db.set('keepsakes', k);
    await render();
  }

  async function discardKeepsake(id) {
    if (!await openConfirm(container, { title: '丢掉这颗', message: '丢了就找不回来了。确定?', confirmLabel: '丢掉', danger: true })) return;
    await db.del('keepsakes', id);
    await render();
  }

  async function delKeptKeepsake(id) {
    if (!await openConfirm(container, { title: '从留下移除', message: '彻底删掉这颗,不能恢复。确定?', confirmLabel: '删除', danger: true })) return;
    await db.del('keepsakes', id);
    await render();
  }

  function wire() {
    container.querySelector('.back')?.addEventListener('click', () => router.back());
    container.querySelector('.new-keepsake')?.addEventListener('click', () => openCreateModal());
    container.querySelectorAll('.ks-tab').forEach(t => {
      t.addEventListener('click', async () => {
        if (t.dataset.tab === activeTab) return;
        activeTab = t.dataset.tab;
        await render();
      });
    });
    container.querySelectorAll('[data-keepsake-id]').forEach(el => {
      const id = el.dataset.keepsakeId;
      if (el.dataset.action === 'open') {
        el.addEventListener('click', () => openKeepsake(id));
      }
      el.querySelector('.ks-keep')?.addEventListener('click', (ev) => { ev.stopPropagation(); keepKeepsake(id); });
      el.querySelector('.ks-discard')?.addEventListener('click', (ev) => { ev.stopPropagation(); discardKeepsake(id); });
      el.querySelector('.ks-row-del')?.addEventListener('click', (ev) => { ev.stopPropagation(); delKeptKeepsake(id); });
    });
  }

  await render();
  return () => {};
}
