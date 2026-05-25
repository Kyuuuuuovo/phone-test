// Chat-beautify page — per-character chat appearance. Same-level sibling of
// "编辑角色资料" in chat-info. Edits live on the character record (since one
// character has one look across all sessions with them), but the entry point
// is in the chat shell so it feels like a chat-specific setting.

import * as db from '../../core/db.js';

export async function mountChatBeautify(container, params, router) {
  const sessionId = params.sessionId;
  if (!sessionId) {
    container.innerHTML = `<div class="page"><div class="page-body">缺少 sessionId</div></div>`;
    return () => {};
  }
  const session = await db.get('chatSessions', sessionId);
  if (!session) {
    container.innerHTML = `<div class="page"><div class="page-body">会话不存在</div></div>`;
    return () => {};
  }
  const character = await db.get('characters', session.characterId);
  if (!character) {
    container.innerHTML = `<div class="page"><div class="page-body">角色不存在</div></div>`;
    return () => {};
  }

  let chatBgData = character.chatBackground || null;

  function render() {
    container.innerHTML = `
      <div class="page chat-beautify-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">聊天美化</div>
        </header>
        <div class="page-body">
          <p class="hint">这些设置只在和「${esc(character.name || '这个角色')}」的聊天里生效。改了之后回到聊天页就会看到。</p>

          <div class="label-text">聊天背景</div>
          <div class="avatar-uploader chat-bg-uploader">
            ${renderChatBgPreview(chatBgData)}
            <div class="avatar-controls">
              <button type="button" class="btn secondary upload-chatbg">上传背景</button>
              <button type="button" class="btn secondary clear-chatbg"${chatBgData ? '' : ' disabled'}>清除</button>
              <input type="file" accept="image/*" class="chatbg-file" hidden>
            </div>
          </div>

          <label>
            <div class="label-text">字号 · 留空跟随全局(<span class="chat-fontsize-readout">${character.chatFontSize ? character.chatFontSize + ' px' : '跟随全局'}</span>)</div>
            <input type="range" min="0" max="22" step="1" name="chatFontSize" value="${character.chatFontSize || 0}">
          </label>

          <div class="form-actions">
            <button type="button" class="btn save-btn">保存</button>
          </div>
          <div class="form-status"></div>
        </div>
      </div>
    `;
    wire();
  }

  function status(text, kind) {
    const el = container.querySelector('.form-status');
    if (el) {
      el.textContent = text;
      el.className = `form-status${kind ? ' ' + kind : ''}`;
    }
  }

  function wire() {
    const backBtn = container.querySelector('.back');
    const uploader = container.querySelector('.chat-bg-uploader');
    const upBtn = container.querySelector('.upload-chatbg');
    const clearBtn = container.querySelector('.clear-chatbg');
    const fileInput = container.querySelector('.chatbg-file');
    const fsInput = container.querySelector('[name=chatFontSize]');
    const fsReadout = container.querySelector('.chat-fontsize-readout');
    const saveBtn = container.querySelector('.save-btn');

    backBtn.addEventListener('click', () => router.back());

    upBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) {
        status(`图片太大(${(file.size/1024/1024).toFixed(1)} MB),建议 < 4 MB`, 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        chatBgData = reader.result;
        const old = uploader.querySelector('.avatar-preview');
        const fresh = document.createElement('div');
        fresh.innerHTML = renderChatBgPreview(chatBgData);
        old.replaceWith(fresh.firstElementChild);
        clearBtn.disabled = false;
        status('背景已加载,点保存写入', 'success');
      };
      reader.onerror = () => status('读取图片失败', 'error');
      reader.readAsDataURL(file);
    });

    clearBtn.addEventListener('click', () => {
      chatBgData = null;
      const old = uploader.querySelector('.avatar-preview');
      const fresh = document.createElement('div');
      fresh.innerHTML = renderChatBgPreview(chatBgData);
      old.replaceWith(fresh.firstElementChild);
      clearBtn.disabled = true;
      status('背景已清除,点保存写入', 'success');
    });

    fsInput.addEventListener('input', () => {
      const v = parseInt(fsInput.value, 10) || 0;
      fsReadout.textContent = v > 0 ? `${v} px` : '跟随全局';
    });

    saveBtn.addEventListener('click', async () => {
      const fsNum = parseInt(fsInput.value, 10) || 0;
      const fresh = await db.get('characters', character.id);
      fresh.chatBackground = chatBgData;
      fresh.chatFontSize = fsNum > 0 ? fsNum : null;
      fresh.updatedAt = Date.now();
      await db.set('characters', fresh);
      status('已保存', 'success');
    });
  }

  render();
  return () => {};
}

function renderChatBgPreview(data) {
  if (data) {
    return `<div class="avatar-preview chatbg-preview"><img src="${esc(data)}" alt=""></div>`;
  }
  return `<div class="avatar-preview placeholder chatbg-preview">无</div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
