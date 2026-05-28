// Chat-beautify page — per-character chat appearance. Same-level sibling of
// "编辑角色资料" in chat-info. Edits live on the character record (since one
// character has one look across all sessions with them), but the entry point
// is in the chat shell so it feels like a chat-specific setting.
//
// T25 加了气泡样式自定义:6 个 preset + 4 字段微调 + 自由 CSS textarea。
// 全部存在 character.chatBubbleStyle 字段(per-character)。chat.js mount 时
// apply 到 .chat-page,见那里的 T25 注释段。

import * as db from '../../core/db.js';
import { esc } from '../../core/util.js';

const BUBBLE_PRESETS = [
  { id: '',            label: '默认',     hint: '跟主题走' },
  { id: 'ios',         label: 'iOS',     hint: '大圆角 + 同侧小尖角' },
  { id: 'material',    label: 'Material',hint: '小圆角卡片 + 阴影' },
  { id: 'minimal',     label: '极简',     hint: '无背景描边' },
  { id: 'card',        label: '卡片',     hint: '超大圆角 + 浅阴影' },
  { id: 'outline',     label: '描边',     hint: '2px 实色描边,无填充' },
  { id: 'handwritten', label: '手写',     hint: '手写体字号略大' },
];

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
  const initialBubble = character.chatBubbleStyle || {};
  let bubblePreset = initialBubble.preset || '';

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

          <h3 class="settings-section-title">气泡样式</h3>
          <div class="label-text">预设</div>
          <div class="bubble-preset-grid">
            ${BUBBLE_PRESETS.map(p => `
              <button type="button" class="bubble-preset-card${p.id === bubblePreset ? ' active' : ''}" data-preset-id="${esc(p.id)}">
                <span class="bubble-preset-label">${esc(p.label)}</span>
                <span class="bubble-preset-hint">${esc(p.hint)}</span>
              </button>
            `).join('')}
          </div>

          <label>
            <div class="label-text">气泡圆角(px,留空跟 preset)</div>
            <input type="number" name="bubbleRadius" min="0" max="40" step="1" value="${Number.isFinite(initialBubble.bubbleRadius) ? initialBubble.bubbleRadius : ''}" placeholder="跟 preset">
          </label>
          <label>
            <div class="label-text">气泡内边距(CSS padding,如 "8px 12px",留空跟 preset)</div>
            <input type="text" name="bubblePadding" value="${esc(initialBubble.bubblePadding || '')}" placeholder="8px 12px">
          </label>
          <label>
            <div class="label-text">User 气泡底色(留空跟主题)</div>
            <input type="text" name="userBubbleColor" value="${esc(initialBubble.userBubbleColor || '')}" placeholder="#007aff 或 hsl(220, 80%, 60%)">
          </label>
          <label>
            <div class="label-text">角色 气泡底色(留空跟主题)</div>
            <input type="text" name="charBubbleColor" value="${esc(initialBubble.charBubbleColor || '')}" placeholder="#e9e9eb 或 hsl(0, 0%, 92%)">
          </label>
          <label>
            <div class="label-text">自由 CSS(高级 · 留空不注入)</div>
            <textarea name="customCss" rows="6" placeholder=".chat-page .bubble.user { font-style: italic; }&#10;.chat-page .bubble.char::before { content: '◆ '; opacity: .5; }">${esc(initialBubble.customCss || '')}</textarea>
            <p class="hint">写完整 CSS rule(选择器 + { ... })。自己写 <code>.chat-page</code> 前缀,会全局生效但只在打开聊天页时存在。</p>
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
    const presetGrid = container.querySelector('.bubble-preset-grid');

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

    // preset 选择 — 切 active class + 记 bubblePreset
    presetGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.bubble-preset-card');
      if (!card) return;
      bubblePreset = card.dataset.presetId;
      presetGrid.querySelectorAll('.bubble-preset-card').forEach(c => {
        c.classList.toggle('active', c.dataset.presetId === bubblePreset);
      });
    });

    saveBtn.addEventListener('click', async () => {
      const fsNum = parseInt(fsInput.value, 10) || 0;
      const fresh = await db.get('characters', character.id);
      fresh.chatBackground = chatBgData;
      fresh.chatFontSize = fsNum > 0 ? fsNum : null;
      // 收集气泡样式 — 空值 / 0 不存(走 preset / 主题默认)
      const rawRadius = container.querySelector('[name=bubbleRadius]').value.trim();
      const rawPadding = container.querySelector('[name=bubblePadding]').value.trim();
      const rawUserColor = container.querySelector('[name=userBubbleColor]').value.trim();
      const rawCharColor = container.querySelector('[name=charBubbleColor]').value.trim();
      const rawCustomCss = container.querySelector('[name=customCss]').value;
      const bubbleStyle = {};
      if (bubblePreset) bubbleStyle.preset = bubblePreset;
      const radiusNum = parseInt(rawRadius, 10);
      if (Number.isFinite(radiusNum) && radiusNum >= 0) bubbleStyle.bubbleRadius = radiusNum;
      if (rawPadding) bubbleStyle.bubblePadding = rawPadding;
      if (rawUserColor) bubbleStyle.userBubbleColor = rawUserColor;
      if (rawCharColor) bubbleStyle.charBubbleColor = rawCharColor;
      if (rawCustomCss.trim()) bubbleStyle.customCss = rawCustomCss;
      // 整个 object 空 = 没设(后续 chat.js 检查会跳过 apply),删字段省 IDB
      if (Object.keys(bubbleStyle).length > 0) {
        fresh.chatBubbleStyle = bubbleStyle;
      } else {
        delete fresh.chatBubbleStyle;
      }
      fresh.updatedAt = Date.now();
      await db.set('characters', fresh);
      status('已保存,回聊天页看效果', 'success');
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
