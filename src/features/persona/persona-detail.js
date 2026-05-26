// Edit one player persona. Delete also nulls any chatSessions.personaId that referenced it.
// Persona avatar is shown wherever the user appears as themselves — currently the
// music widget's left earbud (matching the character on the right).

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

  let avatarData = persona.avatar || null;

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">编辑人设</div>
      </header>
      <div class="page-body">
        <form class="settings-form" autocomplete="off">
          <div class="avatar-uploader">
            ${renderAvatarPreview(avatarData, persona.name)}
            <div class="avatar-controls">
              <button type="button" class="btn secondary upload-avatar">上传头像</button>
              <button type="button" class="btn secondary clear-avatar"${avatarData ? '' : ' disabled'}>清除</button>
              <input type="file" accept="image/*" class="avatar-file" hidden>
            </div>
          </div>
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

  const form        = container.querySelector('form');
  const status      = container.querySelector('.form-status');
  const backBtn     = container.querySelector('.back');
  const uploadBtn   = container.querySelector('.upload-avatar');
  const clearBtn    = container.querySelector('.clear-avatar');
  const fileInput   = container.querySelector('.avatar-file');
  const avatarBox   = container.querySelector('.avatar-uploader');
  const deleteBtn   = container.querySelector('.delete-btn');

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = `form-status${kind ? ' ' + kind : ''}`;
  }

  function refreshAvatarPreview() {
    const old = avatarBox.querySelector('.avatar-preview');
    const fresh = document.createElement('div');
    fresh.innerHTML = renderAvatarPreview(avatarData, form.elements.name.value);
    old.replaceWith(fresh.firstElementChild);
    clearBtn.disabled = !avatarData;
  }

  const onBack = () => router.back();

  const onSubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    Object.assign(persona, {
      name:    String(fd.get('name')    || '').trim() || '(未命名)',
      persona: String(fd.get('persona') || '').trim(),
      avatar:  avatarData,
      updatedAt: Date.now(),
    });
    await db.set('personas', persona);
    setStatus('已保存', 'success');
  };

  const onUpload = () => fileInput.click();

  const onFile = () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setStatus(`图片太大(${(file.size/1024/1024).toFixed(1)} MB),建议 < 2 MB`, 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      avatarData = reader.result;
      refreshAvatarPreview();
      setStatus('头像已加载,点保存写入', 'success');
    };
    reader.onerror = () => setStatus('读取图片失败', 'error');
    reader.readAsDataURL(file);
  };

  const onClearAvatar = () => {
    avatarData = null;
    refreshAvatarPreview();
    setStatus('头像已清除,点保存写入', 'success');
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
    for (const s of sessions) {
      s.personaId = null;
      await db.set('chatSessions', s);
    }
    await db.del('personas', id);
    router.back();
  };

  backBtn.addEventListener('click', onBack);
  form.addEventListener('submit', onSubmit);
  uploadBtn.addEventListener('click', onUpload);
  fileInput.addEventListener('change', onFile);
  clearBtn.addEventListener('click', onClearAvatar);
  deleteBtn.addEventListener('click', onDelete);

  return () => {
    backBtn.removeEventListener('click', onBack);
    form.removeEventListener('submit', onSubmit);
    uploadBtn.removeEventListener('click', onUpload);
    fileInput.removeEventListener('change', onFile);
    clearBtn.removeEventListener('click', onClearAvatar);
    deleteBtn.removeEventListener('click', onDelete);
  };
}

function renderAvatarPreview(data, name) {
  if (data) {
    return `<div class="avatar-preview"><img src="${esc(data)}" alt=""></div>`;
  }
  const initial = (name || '?').slice(0, 1);
  return `<div class="avatar-preview placeholder">${esc(initial)}</div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
