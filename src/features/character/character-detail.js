// Edit one character. Avatar upload (base64), persona/notes, blocked toggle,
// worldbook mount checkboxes (writes characterWorldbooks directly), delete with cascade.

import * as db from '../../core/db.js';

export async function mountCharacterDetail(container, params, router) {
  const id = params.id;
  if (!id) {
    container.innerHTML = `<div class="page"><div class="page-body">缺少 id</div></div>`;
    return () => {};
  }
  const character = await db.get('characters', id);
  if (!character) {
    container.innerHTML = `<div class="page"><div class="page-body">角色不存在</div></div>`;
    return () => {};
  }

  const worldbooks = await db.getAll('worldbooks');
  worldbooks.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const boundIds = new Set(
    (await db.query('characterWorldbooks', 'characterId', id)).map(b => b.worldbookId)
  );

  let avatarData = character.avatar || null;

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">编辑角色</div>
      </header>
      <div class="page-body">
        <form class="settings-form" autocomplete="off">
          <div class="avatar-uploader">
            ${renderAvatarPreview(avatarData, character.name)}
            <div class="avatar-controls">
              <button type="button" class="btn secondary upload-avatar">上传头像</button>
              <button type="button" class="btn secondary clear-avatar"${avatarData ? '' : ' disabled'}>清除</button>
              <input type="file" accept="image/*" class="avatar-file" hidden>
            </div>
          </div>
          <label>
            <div class="label-text">名称</div>
            <input name="name" required placeholder="角色名" value="${esc(character.name)}">
          </label>
          <label>
            <div class="label-text">人设(背景 / 性格 / 说话风格)</div>
            <textarea name="persona" rows="8" placeholder="比如:林夏,25岁,咖啡师...">${esc(character.persona)}</textarea>
          </label>
          <label>
            <div class="label-text">备注(只给你自己看,不进 prompt)</div>
            <textarea name="notes" rows="3">${esc(character.notes)}</textarea>
          </label>

          <div class="label-text">挂载世界书</div>
          <div class="wb-mount-list">
            ${worldbooks.length === 0
              ? `<p class="hint">还没有世界书。去 主页 → 世界书 创建一个。</p>`
              : worldbooks.map(wb => `
                  <label class="checkbox-row">
                    <input type="checkbox" data-wb-id="${esc(wb.id)}"${boundIds.has(wb.id) ? ' checked' : ''}>
                    <span>${esc(wb.name || '(未命名)')}</span>
                  </label>
                `).join('')}
          </div>
          <div class="form-actions">
            <button type="submit" class="btn">保存</button>
            <button type="button" class="btn secondary toggle-block">
              ${character.blocked ? '解除拉黑' : '加入黑名单'}
            </button>
            <button type="button" class="btn danger delete-btn">删除角色</button>
          </div>
          <div class="form-status"></div>
        </form>
      </div>
    </div>
  `;

  const form         = container.querySelector('form');
  const status       = container.querySelector('.form-status');
  const backBtn      = container.querySelector('.back');
  const uploadBtn    = container.querySelector('.upload-avatar');
  const clearBtn     = container.querySelector('.clear-avatar');
  const fileInput    = container.querySelector('.avatar-file');
  const avatarBox    = container.querySelector('.avatar-uploader');
  const toggleBlock  = container.querySelector('.toggle-block');
  const deleteBtn    = container.querySelector('.delete-btn');
  const wbList       = container.querySelector('.wb-mount-list');

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

  async function saveFromForm() {
    const fd = new FormData(form);
    // Note: chatBackground / chatFontSize live on the character but are edited
    // in chat-beautify, not here — preserve whatever values are already set.
    const c = {
      ...character,
      name:    String(fd.get('name')    || '').trim() || '(未命名)',
      persona: String(fd.get('persona') || '').trim(),
      notes:   String(fd.get('notes')   || '').trim(),
      avatar:  avatarData,
      updatedAt: Date.now(),
    };
    await db.set('characters', c);
    Object.assign(character, c);
    return c;
  }

  const onBack = () => router.back();

  const onSubmit = async (e) => {
    e.preventDefault();
    await saveFromForm();
    setStatus('已保存', 'success');
  };

  const onUpload = () => fileInput.click();

  const onFile = () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';  // allow re-selecting the same file later
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

  const onToggleBlock = async () => {
    character.blocked = !character.blocked;
    character.updatedAt = Date.now();
    await db.set('characters', character);
    toggleBlock.textContent = character.blocked ? '解除拉黑' : '加入黑名单';
    setStatus(character.blocked ? '已拉黑(聊天里 AI 回复会被禁用)' : '已解除拉黑', 'success');
  };

  const onWbChange = async (e) => {
    const cb = e.target.closest('input[type=checkbox][data-wb-id]');
    if (!cb) return;
    const wbId = cb.dataset.wbId;
    const existing = await db.query('characterWorldbooks', 'characterId', id);
    const match = existing.find(b => b.worldbookId === wbId);
    if (cb.checked && !match) {
      await db.set('characterWorldbooks', {
        id: db.newId(), characterId: id, worldbookId: wbId, priority: 0,
      });
    } else if (!cb.checked && match) {
      await db.del('characterWorldbooks', match.id);
    }
  };

  const onDelete = async () => {
    const sessions = (await db.query('chatSessions', 'characterId', id));
    const msg = sessions.length > 0
      ? `删除角色「${character.name}」会同时删 ${sessions.length} 个对话(连同消息和记忆)。世界书本体不动。继续?`
      : `删除角色「${character.name}」?`;
    if (!confirm(msg)) return;
    // Cascade: sessions → their messages + memories, then sessions themselves
    for (const s of sessions) {
      const msgs = await db.query('chatMessages', 'sessionId', s.id);
      for (const m of msgs) await db.del('chatMessages', m.id);
      const mems = await db.query('memories', 'sessionId', s.id);
      for (const m of mems) await db.del('memories', m.id);
      await db.del('chatSessions', s.id);
    }
    // Cascade: worldbook bindings owned by this character
    const bindings = await db.query('characterWorldbooks', 'characterId', id);
    for (const b of bindings) await db.del('characterWorldbooks', b.id);
    await db.del('characters', id);
    router.back();
  };

  backBtn.addEventListener('click', onBack);
  form.addEventListener('submit', onSubmit);
  uploadBtn.addEventListener('click', onUpload);
  fileInput.addEventListener('change', onFile);
  clearBtn.addEventListener('click', onClearAvatar);
  toggleBlock.addEventListener('click', onToggleBlock);
  wbList.addEventListener('change', onWbChange);
  deleteBtn.addEventListener('click', onDelete);

  return () => {
    backBtn.removeEventListener('click', onBack);
    form.removeEventListener('submit', onSubmit);
    uploadBtn.removeEventListener('click', onUpload);
    fileInput.removeEventListener('change', onFile);
    clearBtn.removeEventListener('click', onClearAvatar);
    toggleBlock.removeEventListener('click', onToggleBlock);
    wbList.removeEventListener('change', onWbChange);
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
