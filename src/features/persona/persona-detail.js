// Edit one player persona. Delete also nulls any chatSessions.personaId that referenced it.

import * as db from '../../core/db.js';
import { openConfirm } from '../../core/modal.js';

export async function mountPersonaDetail(container, params, router) {
  const id = params.id;
  if (!id) {
    container.innerHTML = `<div class="page"><div class="page-body">缺少 id</div></div>`;
    return () => {};
  }
  const persona = await db.get('personas', id);
  if (!persona) {
    container.innerHTML = `<div class="page"><div class="page-body">人设不存在</div></div>`;
    return () => {};
  }

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">编辑人设</div>
      </header>
      <div class="page-body">
        <form class="settings-form" autocomplete="off">
          <label>
            <div class="label-text">名称(自己看的)</div>
            <input name="name" required value="${esc(persona.name)}">
          </label>
          <label>
            <div class="label-text">人设描述(角色聊天时看到的「你是谁」)</div>
            <textarea name="persona" rows="10" placeholder="比如:我叫小白,大三程序员,作息黑白颠倒...">${esc(persona.persona)}</textarea>
          </label>
          <div class="form-actions">
            <button type="submit" class="btn">保存</button>
            <button type="button" class="btn danger delete-btn">删除人设</button>
          </div>
          <div class="form-status"></div>
        </form>
      </div>
    </div>
  `;

  const form      = container.querySelector('form');
  const status    = container.querySelector('.form-status');
  const backBtn   = container.querySelector('.back');
  const deleteBtn = container.querySelector('.delete-btn');

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = `form-status${kind ? ' ' + kind : ''}`;
  }

  const onBack = () => router.back();

  const onSubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    Object.assign(persona, {
      name:    String(fd.get('name')    || '').trim() || '(未命名)',
      persona: String(fd.get('persona') || '').trim(),
      updatedAt: Date.now(),
    });
    await db.set('personas', persona);
    setStatus('已保存', 'success');
  };

  const onDelete = async () => {
    const sessions = (await db.getAll('chatSessions')).filter(s => s.personaId === id);
    const msg = sessions.length > 0
      ? `删除人设「${persona.name}」?引用它的 ${sessions.length} 个对话会变成没有人设(对话本身保留)。`
      : `删除人设「${persona.name}」?`;
    if (!await openConfirm(container, {
      title: '删除人设',
      message: msg,
      confirmLabel: '删除',
      danger: true,
    })) return;
    // Null out references in chatSessions
    for (const s of sessions) {
      s.personaId = null;
      await db.set('chatSessions', s);
    }
    await db.del('personas', id);
    router.back();
  };

  backBtn.addEventListener('click', onBack);
  form.addEventListener('submit', onSubmit);
  deleteBtn.addEventListener('click', onDelete);

  return () => {
    backBtn.removeEventListener('click', onBack);
    form.removeEventListener('submit', onSubmit);
    deleteBtn.removeEventListener('click', onDelete);
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
