// Edit one player persona. Delete also nulls any chatSessions.personaId that referenced it.
// Persona avatar is shown wherever the user appears as themselves — currently the
// music widget's left earbud (matching the character on the right).

import * as db from '../../core/db.js';
import { openConfirm } from '../../core/modal.js';
import { bindFormDirty } from '../../core/form-helpers.js';
import { esc } from '../../core/util.js';

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
            <div class="label-text">个人签名(短句 · 「我」tab 显示在名字下方)</div>
            <input name="signature" type="text" maxlength="40" value="${esc(persona.signature || '')}" placeholder="一句话标签 · 比如「在写代码 / 周末爬山」">
          </label>
          <label>
            <div class="label-text">
              当前状态(微信「我」也能改 · 角色聊天时能感知到)
              ${persona.statusSetAt ? `<span class="hint-inline">设于 ${humanTimeAgo(Date.now() - persona.statusSetAt)}前</span>` : ''}
            </div>
            <input name="statusText" type="text" maxlength="80" value="${esc(persona.statusText || '')}" placeholder="在加班 / 看书 / 心情低落">
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
  const saveBtn     = form.querySelector('button[type="submit"]');
  const dirty       = bindFormDirty(form, saveBtn);

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
    // T7: statusText 跟微信「我」tab 共享同一字段。statusSetAt 只在实际改了
    // 的时候 bump,否则每次保存 persona 都重置时间会误导角色的相对感知。
    const newStatus = String(fd.get('statusText') || '').trim();
    const oldStatus = String(persona.statusText || '').trim();
    if (newStatus !== oldStatus) {
      if (newStatus) {
        persona.statusText = newStatus;
        persona.statusSetAt = Date.now();
      } else {
        delete persona.statusText;
        delete persona.statusSetAt;
      }
    }
    Object.assign(persona, {
      name:      String(fd.get('name')      || '').trim() || '(未命名)',
      signature: String(fd.get('signature') || '').trim(),
      persona:   String(fd.get('persona')   || '').trim(),
      avatar:    avatarData,
      updatedAt: Date.now(),
    });
    await db.set('personas', persona);
    setStatus('已保存', 'success');
    dirty.markSaved();
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
      dirty.markDirty();
    };
    reader.onerror = () => setStatus('读取图片失败', 'error');
    reader.readAsDataURL(file);
  };

  const onClearAvatar = () => {
    avatarData = null;
    refreshAvatarPreview();
    setStatus('头像已清除,点保存写入', 'success');
    dirty.markDirty();
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

// 跟 me.js 用的同款相对时间 humanizer,但持有在本文件就不强 coupling。
// ms → 「N 分钟 / N 小时 / N 天 / N 个月」最大单位。
function humanTimeAgo(ms) {
  if (ms < 60_000) return '刚刚';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天`;
  const months = Math.floor(days / 30);
  return `${months} 个月`;
}
