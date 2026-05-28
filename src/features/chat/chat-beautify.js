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

          <div class="chat-beautify-preview">
            <span class="preview-label">预览</span>
            <div class="preview-bg-layer"></div>
            <div class="preview-bg-overlay"></div>
            <div class="chat-page preview-chat-page"${bubblePreset ? ` data-bubble-preset="${esc(bubblePreset)}"` : ''}>
              <div class="bubble char">在的,刚去倒了杯水</div>
              <div class="bubble user">好,你说</div>
              <div class="bubble char">明天还是同样的时间?</div>
            </div>
          </div>

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
            <div class="label-text">背景遮罩:<span class="chatbg-overlay-readout">${character.chatBgOverlay ?? 0}</span>%</div>
            <input type="range" min="0" max="100" step="5" name="chatBgOverlay" value="${character.chatBgOverlay ?? 0}">
            <p class="hint">页面背景色盖在聊天背景图上的不透明度。0% = 完全看到图片;100% = 页面背景色完全盖住图片(用来调暗背景让字读得清)。</p>
          </label>

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
            <div class="label-text">气泡透明度:<span class="bubble-alpha-readout">${Number.isFinite(initialBubble.bubbleAlpha) ? initialBubble.bubbleAlpha : 100}</span>%</div>
            <input type="range" min="0" max="100" step="5" name="bubbleAlpha" value="${Number.isFinite(initialBubble.bubbleAlpha) ? initialBubble.bubbleAlpha : 100}">
            <p class="hint">100% = 完全不透明(默认),数字越小气泡背景越透,字保持清晰。⚠ 主题里气泡用渐变(弥撒 / 荷紫)时这条不生效 — color-mix 不支持 gradient。</p>
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
    const previewWrap = container.querySelector('.chat-beautify-preview');
    const previewPage = previewWrap.querySelector('.preview-chat-page');
    const previewBg = previewWrap.querySelector('.preview-bg-layer');
    const previewOverlay = previewWrap.querySelector('.preview-bg-overlay');

    // 实时预览 — 收集当前 form 值 + 把 CSS var / dataset 同步到预览 chat-page。
    //   每条 input/change 事件都调用一次。chat.js 实际 apply 的逻辑这里同步
    //   复制一份(不复用避免循环 import + 预览有些字段是从 form 现读而非
    //   从 character 读)。
    function applyPreview() {
      // Preset attr
      if (bubblePreset) previewPage.dataset.bubblePreset = bubblePreset;
      else              delete previewPage.dataset.bubblePreset;
      // 字段 var
      const radiusV = container.querySelector('[name=bubbleRadius]')?.value.trim();
      const paddingV = container.querySelector('[name=bubblePadding]')?.value.trim();
      const userColor = container.querySelector('[name=userBubbleColor]')?.value.trim();
      const charColor = container.querySelector('[name=charBubbleColor]')?.value.trim();
      const alpha = parseInt(container.querySelector('[name=bubbleAlpha]')?.value || '100', 10);
      const radiusNum = parseInt(radiusV, 10);
      if (Number.isFinite(radiusNum) && radiusNum >= 0) {
        previewPage.style.setProperty('--chat-bubble-radius', `${radiusNum}px`);
      } else {
        previewPage.style.removeProperty('--chat-bubble-radius');
      }
      if (paddingV) previewPage.style.setProperty('--chat-bubble-padding', paddingV);
      else          previewPage.style.removeProperty('--chat-bubble-padding');
      if (userColor) previewPage.style.setProperty('--chat-bubble-user-bg', userColor);
      else           previewPage.style.removeProperty('--chat-bubble-user-bg');
      if (charColor) previewPage.style.setProperty('--chat-bubble-char-bg', charColor);
      else           previewPage.style.removeProperty('--chat-bubble-char-bg');
      // Alpha
      if (Number.isFinite(alpha) && alpha < 100) {
        previewPage.dataset.bubbleAlphaOn = '1';
        previewPage.style.setProperty('--chat-bubble-alpha', String(Math.max(0, alpha) / 100));
      } else {
        delete previewPage.dataset.bubbleAlphaOn;
        previewPage.style.removeProperty('--chat-bubble-alpha');
      }
      // 背景图 + overlay
      if (chatBgData) {
        previewBg.style.backgroundImage = `url("${chatBgData}")`;
      } else {
        previewBg.style.backgroundImage = '';
      }
      const overlayV = parseInt(container.querySelector('[name=chatBgOverlay]')?.value || '0', 10) || 0;
      previewOverlay.style.opacity = chatBgData ? String(overlayV / 100) : '1';
      // 字号
      const fsV = parseInt(container.querySelector('[name=chatFontSize]')?.value || '0', 10) || 0;
      if (fsV > 0) previewPage.style.setProperty('font-size', `${fsV}px`);
      else         previewPage.style.removeProperty('font-size');
    }

    // 所有 input/change 一律刷新预览。用 form-level delegation 一行搞定,
    //   不用对每个 input 单独注册。
    container.querySelector('.page-body').addEventListener('input', applyPreview);
    container.querySelector('.page-body').addEventListener('change', applyPreview);

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
        applyPreview();
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
      applyPreview();
    });

    fsInput.addEventListener('input', () => {
      const v = parseInt(fsInput.value, 10) || 0;
      fsReadout.textContent = v > 0 ? `${v} px` : '跟随全局';
    });

    // preset 选择 — 切 active class + 记 bubblePreset + 立刻刷新预览
    presetGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.bubble-preset-card');
      if (!card) return;
      bubblePreset = card.dataset.presetId;
      presetGrid.querySelectorAll('.bubble-preset-card').forEach(c => {
        c.classList.toggle('active', c.dataset.presetId === bubblePreset);
      });
      applyPreview();
    });

    // 背景遮罩 — live readout 跟字号同模式
    const overlayInput = container.querySelector('input[name="chatBgOverlay"]');
    const overlayReadout = container.querySelector('.chatbg-overlay-readout');
    overlayInput?.addEventListener('input', () => {
      if (overlayReadout) overlayReadout.textContent = overlayInput.value;
    });

    // 气泡透明度 readout
    const alphaInput = container.querySelector('input[name="bubbleAlpha"]');
    const alphaReadout = container.querySelector('.bubble-alpha-readout');
    alphaInput?.addEventListener('input', () => {
      if (alphaReadout) alphaReadout.textContent = alphaInput.value;
    });

    // 初次进入即应用一次,让 user 看到当前已存设置的预览状态
    applyPreview();

    saveBtn.addEventListener('click', async () => {
      const fsNum = parseInt(fsInput.value, 10) || 0;
      const overlayNum = parseInt(overlayInput?.value || '0', 10) || 0;
      const fresh = await db.get('characters', character.id);
      fresh.chatBackground = chatBgData;
      fresh.chatFontSize = fsNum > 0 ? fsNum : null;
      // chatBgOverlay 0 = 透出图(默认),100 = 完全盖。0 也存(明确意图)
      fresh.chatBgOverlay = Math.max(0, Math.min(100, overlayNum));
      // 收集气泡样式 — 空值 / 0 不存(走 preset / 主题默认)
      const rawRadius = container.querySelector('[name=bubbleRadius]').value.trim();
      const rawPadding = container.querySelector('[name=bubblePadding]').value.trim();
      const rawUserColor = container.querySelector('[name=userBubbleColor]').value.trim();
      const rawCharColor = container.querySelector('[name=charBubbleColor]').value.trim();
      const rawCustomCss = container.querySelector('[name=customCss]').value;
      const rawAlpha = container.querySelector('[name=bubbleAlpha]').value;
      const bubbleStyle = {};
      if (bubblePreset) bubbleStyle.preset = bubblePreset;
      const radiusNum = parseInt(rawRadius, 10);
      if (Number.isFinite(radiusNum) && radiusNum >= 0) bubbleStyle.bubbleRadius = radiusNum;
      if (rawPadding) bubbleStyle.bubblePadding = rawPadding;
      if (rawUserColor) bubbleStyle.userBubbleColor = rawUserColor;
      if (rawCharColor) bubbleStyle.charBubbleColor = rawCharColor;
      if (rawCustomCss.trim()) bubbleStyle.customCss = rawCustomCss;
      // alpha 100 = 默认不存(节省 IDB,等于没设置)
      const alphaNum = parseInt(rawAlpha, 10);
      if (Number.isFinite(alphaNum) && alphaNum >= 0 && alphaNum < 100) {
        bubbleStyle.bubbleAlpha = alphaNum;
      }
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
