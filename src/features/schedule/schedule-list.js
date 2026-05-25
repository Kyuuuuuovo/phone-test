// Schedule list — shows all schedule entries grouped by relative day
// (今天 / 明天 / 后续 / 已过). 「+」 in the header opens an editor modal.
//
// Data: schedule store, fields { id, who: 'user'|'character', characterId?,
// startTs, endTs?, title, desc, createdAt }. Used by context.js's
// buildSystemPrompt to inject "# 当前行程" into the AI's view of state.

import * as db from '../../core/db.js';
import * as ai from '../../core/ai.js';

export async function mountScheduleList(container, params, router) {
  async function render() {
    const entries = await db.getAll('schedule');
    entries.sort((a, b) => a.startTs - b.startTs);
    const chars = await db.getAll('characters');
    const charMap = new Map(chars.map(c => [c.id, c]));

    const buckets = bucketize(entries);

    container.innerHTML = `
      <div class="page schedule-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">行程</div>
          <div class="actions">
            <button class="ai-gen" title="让 AI 帮角色生成一段日程">✨ AI</button>
            <button class="new-entry" title="新建行程">+</button>
          </div>
        </header>
        <div class="page-body">
          <p class="hint">用户/角色未来 24 小时 + 过去 6 小时内的行程会被注入到 AI 的「当前行程」段,让对话和你的安排对得上。</p>
          ${entries.length === 0 ? `
            <p class="hint">还没有行程,点右上角 + 新建。</p>
          ` : `
            ${['今天', '明天', '后续', '已过'].map(b => {
              const list = buckets[b];
              if (!list || list.length === 0) return '';
              return `
                <h3 class="schedule-bucket-title">${b}</h3>
                <div class="schedule-list">
                  ${list.map(e => renderEntry(e, charMap)).join('')}
                </div>
              `;
            }).join('')}
          `}
        </div>
      </div>
    `;
    wire();
  }

  function wire() {
    container.querySelector('.back').addEventListener('click', () => router.back());
    container.querySelector('.new-entry').addEventListener('click', () => openEditor(null));
    container.querySelector('.ai-gen').addEventListener('click', () => openAIGenModal());
    container.querySelectorAll('[data-entry-id]').forEach(row => {
      row.querySelector('.entry-del')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm('删除这条行程?')) return;
        await db.del('schedule', row.dataset.entryId);
        await render();
      });
      row.addEventListener('click', () => {
        const id = row.dataset.entryId;
        openEditor(id);
      });
    });
  }

  async function openEditor(id) {
    const chars = await db.getAll('characters');
    const existing = id ? await db.get('schedule', id) : null;
    const e = existing || {
      who: 'user',
      characterId: chars[0]?.id || null,
      startTs: Date.now() + 60 * 60 * 1000,
      endTs: null,
      title: '',
      desc: '',
    };
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">${existing ? '编辑行程' : '新建行程'}</div>
        <form class="schedule-form" autocomplete="off">
          <label>
            <div class="label-text">属于</div>
            <select name="who">
              <option value="user"${e.who === 'user' ? ' selected' : ''}>我自己</option>
              <option value="character"${e.who === 'character' ? ' selected' : ''}>某个角色</option>
            </select>
          </label>
          <label class="char-pick" ${e.who === 'character' ? '' : 'hidden'}>
            <div class="label-text">角色</div>
            <select name="characterId">
              ${chars.map(c => `<option value="${esc(c.id)}"${c.id === e.characterId ? ' selected' : ''}>${esc(c.name || '(未命名)')}</option>`).join('')}
            </select>
          </label>
          <label>
            <div class="label-text">开始时间</div>
            <input type="datetime-local" name="startTs" value="${toLocalDT(e.startTs)}" required>
          </label>
          <label>
            <div class="label-text">结束时间(可选)</div>
            <input type="datetime-local" name="endTs" value="${e.endTs ? toLocalDT(e.endTs) : ''}">
          </label>
          <label>
            <div class="label-text">标题</div>
            <input type="text" name="title" value="${esc(e.title)}" required placeholder="比如:开会 / 健身 / 见朋友">
          </label>
          <label>
            <div class="label-text">描述(可选)</div>
            <textarea name="desc" rows="3">${esc(e.desc)}</textarea>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">${existing ? '保存' : '创建'}</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);

    const form = modal.querySelector('form');
    const whoSel = form.elements.who;
    const charPick = modal.querySelector('.char-pick');
    whoSel.addEventListener('change', () => {
      charPick.hidden = whoSel.value !== 'character';
    });
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const startTs = new Date(fd.get('startTs')).getTime();
      if (!Number.isFinite(startTs)) { alert('开始时间无效'); return; }
      const endRaw = fd.get('endTs');
      const endTs = endRaw ? new Date(endRaw).getTime() : null;
      const who = String(fd.get('who') || 'user');
      const characterId = who === 'character' ? String(fd.get('characterId') || '') : null;
      const next = {
        id: id || db.newId(),
        who,
        characterId,
        startTs,
        endTs,
        title: String(fd.get('title') || '').trim() || '(无标题)',
        desc: String(fd.get('desc') || '').trim(),
        createdAt: existing?.createdAt || Date.now(),
      };
      await db.set('schedule', next);
      modal.remove();
      await render();
    });
  }

  async function openAIGenModal() {
    const chars = await db.getAll('characters');
    if (chars.length === 0) { alert('先去角色管理建一个角色'); return; }
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setMinutes(0, 0, 0);
    const defaultEnd = new Date(defaultStart);
    defaultEnd.setHours(defaultEnd.getHours() + 24);

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">AI 生成角色日程</div>
        <p class="hint">基于角色人设,让 AI 在指定时间段内编排一系列合理的日程。生成的条目会直接写入「角色」的行程,无需手动确认每条。</p>
        <form class="ai-gen-form" autocomplete="off">
          <label>
            <div class="label-text">角色</div>
            <select name="characterId">
              ${chars.map(c => `<option value="${esc(c.id)}">${esc(c.name || '(未命名)')}</option>`).join('')}
            </select>
          </label>
          <label>
            <div class="label-text">开始</div>
            <input type="datetime-local" name="startTs" required value="${toLocalDT(defaultStart.getTime())}">
          </label>
          <label>
            <div class="label-text">结束</div>
            <input type="datetime-local" name="endTs" required value="${toLocalDT(defaultEnd.getTime())}">
          </label>
          <label>
            <div class="label-text">引导(可选 · 比如「这是工作日」「这天是 ta 的生日」)</div>
            <textarea name="hint" rows="2" placeholder=""></textarea>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">生成</button>
          </div>
          <div class="form-status"></div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    const status = modal.querySelector('.form-status');
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      const charId = String(fd.get('characterId'));
      const startTs = new Date(fd.get('startTs')).getTime();
      const endTs   = new Date(fd.get('endTs')).getTime();
      const hint    = String(fd.get('hint') || '').trim();
      if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) {
        status.textContent = '时间区间无效'; status.className = 'form-status error'; return;
      }
      const character = await db.get('characters', charId);
      if (!character) { status.textContent = '角色不存在'; status.className = 'form-status error'; return; }

      status.textContent = '调用 AI…'; status.className = 'form-status';
      const sys = '你是日程生成助手。基于人物的人设和指定的时间段,为 ta 生成一系列合理的日程。\n\n要求:\n- 只输出 JSON 数组,不要任何其他文字、不要 markdown 代码块包裹\n- 每项格式:{"startTs": ISO8601 字符串, "endTs": ISO8601 字符串(可选), "title": 简短标题, "desc": 描述(可选)}\n- 数量 3-8 条,时间必须落在指定区间内\n- 安排要符合人物身份、作息、性格(老师不会凌晨 3 点上课)\n- 标题简短(2-6 字),描述可以稍详(< 30 字)';
      const userMsg = `人物名:${character.name || '(未命名)'}\n\n人设:\n${character.persona || '(无)'}\n\n时间区间:${new Date(startTs).toISOString()} 到 ${new Date(endTs).toISOString()}\n\n额外引导:${hint || '(无)'}`;
      try {
        const raw = await ai.callAI({ systemPrompt: sys, messages: [{ role: 'user', content: userMsg }], temperature: 0.7 });
        const entries = parseScheduleJSON(raw);
        if (!Array.isArray(entries) || entries.length === 0) {
          status.textContent = '解析失败:模型返回的不是合法的 JSON 数组'; status.className = 'form-status error'; return;
        }
        let added = 0;
        for (const e of entries) {
          const st = new Date(e.startTs).getTime();
          if (!Number.isFinite(st)) continue;
          await db.set('schedule', {
            id: db.newId(),
            who: 'character',
            characterId: charId,
            startTs: st,
            endTs: e.endTs ? new Date(e.endTs).getTime() : null,
            title: String(e.title || '(无标题)').trim(),
            desc:  String(e.desc  || '').trim(),
            createdAt: Date.now(),
          });
          added++;
        }
        status.textContent = `成功添加 ${added} 条`; status.className = 'form-status success';
        setTimeout(() => { modal.remove(); render(); }, 600);
      } catch (e) {
        status.textContent = `失败:${String(e).slice(0, 200)}`; status.className = 'form-status error';
      }
    });
  }

  await render();
  return () => {};
}

// Tolerant JSON parse — strips ```json fences and surrounding prose.
function parseScheduleJSON(raw) {
  if (typeof raw !== 'string') return null;
  const stripped = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}
  const match = stripped.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  return null;
}

function bucketize(entries) {
  const now = new Date();
  const today = now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const buckets = { '今天': [], '明天': [], '后续': [], '已过': [] };
  const nowMs = now.getTime();
  for (const e of entries) {
    const d = new Date(e.startTs);
    if (e.startTs < nowMs && (e.endTs ? e.endTs < nowMs : true)) {
      buckets['已过'].push(e);
    } else if (d.toDateString() === today) {
      buckets['今天'].push(e);
    } else if (d.toDateString() === tomorrow.toDateString()) {
      buckets['明天'].push(e);
    } else {
      buckets['后续'].push(e);
    }
  }
  return buckets;
}

function renderEntry(e, charMap) {
  const who = e.who === 'user' ? '我' : (charMap.get(e.characterId)?.name || '(未知角色)');
  const time = formatTimeRange(e.startTs, e.endTs);
  return `
    <div class="schedule-entry" data-entry-id="${esc(e.id)}">
      <div class="entry-time">${esc(time)}</div>
      <div class="entry-body">
        <div class="entry-title"><span class="entry-who">${esc(who)}</span> ${esc(e.title || '(无标题)')}</div>
        ${e.desc ? `<div class="entry-desc">${esc(e.desc)}</div>` : ''}
      </div>
      <button class="entry-del" title="删除">×</button>
    </div>
  `;
}

function formatTimeRange(start, end) {
  const d = new Date(start);
  const pad = (n) => String(n).padStart(2, '0');
  const hh = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (!end) return hh;
  const e = new Date(end);
  return `${hh} – ${pad(e.getHours())}:${pad(e.getMinutes())}`;
}

function toLocalDT(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
