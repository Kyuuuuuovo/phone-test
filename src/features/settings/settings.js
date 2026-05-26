// Settings hub. A list of subpages, each navigates via router.

import * as db from '../../core/db.js';
import { BEAR_CHARACTER_ID, DEFAULT_BEAR_AVATAR } from '../../core/pet.js';

export async function mountSettings(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  const petEnabled = settings.petEnabled !== false;
  const bear = await db.get('characters', BEAR_CHARACTER_ID);
  const bearAvatar = bear?.avatar || DEFAULT_BEAR_AVATAR;

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">设置</div>
      </header>
      <div class="page-body">
        <div class="settings-list">
          <button class="settings-item" data-target="settings-api">
            <span class="settings-label">API 设置</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-target="settings-weather">
            <span class="settings-label">天气 API</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-target="settings-theme">
            <span class="settings-label">外观</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-target="settings-memory">
            <span class="settings-label">记忆总结</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-target="settings-data">
            <span class="settings-label">数据备份</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item danger" data-target="settings-clear">
            <span class="settings-label">清空数据</span>
            <span class="settings-chevron">›</span>
          </button>
        </div>

        <h3 class="settings-section-title">桌宠</h3>
        <div class="settings-list">
          <label class="settings-item toggle-row">
            <span class="settings-label">显示桌宠</span>
            <input type="checkbox" data-toggle="petEnabled"${petEnabled ? ' checked' : ''}>
          </label>
          <div class="settings-item pet-avatar-row">
            <div class="settings-label">贴图</div>
            <div class="pet-avatar-controls">
              <img class="pet-avatar-thumb" src="${esc(bearAvatar)}" alt="">
              <button type="button" class="btn secondary change-pet-avatar">更换</button>
            </div>
          </div>
          <button class="settings-item" data-action="edit-bear-persona">
            <span class="settings-label">编辑桌宠人设</span>
            <span class="settings-chevron">›</span>
          </button>
        </div>

        <h3 class="settings-section-title">调试</h3>
        <div class="settings-list">
          <label class="settings-item toggle-row">
            <span class="settings-label">开发者模式
              <div class="settings-sub">聊天页右上角显示「提示词调试」入口</div>
            </span>
            <input type="checkbox" data-toggle="devMode"${settings.devMode === true ? ' checked' : ''}>
          </label>
        </div>
      </div>
    </div>
  `;

  const onChange = async (e) => {
    const cb = e.target.closest('[data-toggle]');
    if (!cb) return;
    const which = cb.dataset.toggle;
    const s = (await db.get('settings', 'default')) || { id: 'default' };
    if (which === 'petEnabled') {
      s.petEnabled = !!cb.checked;
      await db.set('settings', s);
      // Toggle the orb in-place. Reload not needed but the simplest path.
      const orb = document.querySelector('.pet-orb');
      const bubble = document.querySelector('.pet-bubble');
      if (orb)    orb.hidden    = !cb.checked;
      if (bubble) bubble.hidden = true;
    } else if (which === 'devMode') {
      s.devMode = !!cb.checked;
      await db.set('settings', s);
      // The chat page reads devMode at mount time, so the gear icon won't
      // appear until next chat navigation. Acceptable — toggling devMode
      // is rare and the visual change is one back-and-back away.
    }
  };
  container.addEventListener('change', onChange);

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    if (e.target.closest('.change-pet-avatar')) {
      await openChangeAvatarModal(container, async (newAvatar) => {
        const fresh = await db.get('characters', BEAR_CHARACTER_ID);
        if (!fresh) return;
        fresh.avatar = newAvatar;
        fresh.updatedAt = Date.now();
        await db.set('characters', fresh);
        const thumb = document.querySelector('.pet-avatar-thumb');
        if (thumb) thumb.src = newAvatar;
        const orbImg = document.querySelector('.pet-orb-img');
        if (orbImg) orbImg.src = newAvatar;
      });
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit-bear-persona') {
      router.navigate('character-detail', { id: BEAR_CHARACTER_ID });
      return;
    }
    const item = e.target.closest('[data-target]');
    if (item) router.navigate(item.dataset.target);
  };
  container.addEventListener('click', onClick);
  return () => {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
  };
}

// Change avatar: file upload OR URL input. Resolves to a base64 data URL
// (upload) or a direct URL string. The chooser is a small two-stage modal.
function openChangeAvatarModal(container, onPick) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">更换贴图</div>
        <form class="avatar-form" autocomplete="off">
          <label>
            <div class="label-text">图片 URL(任意外链或留空走上传)</div>
            <input name="url" type="text" placeholder="https://...">
          </label>
          <label>
            <div class="label-text">或上传本地图片</div>
            <input name="file" type="file" accept="image/*">
          </label>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">用这个</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);
    modal.querySelector('.cancel-btn').addEventListener('click', () => { modal.remove(); resolve(null); });
    modal.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(modal.querySelector('form'));
      const url = String(fd.get('url') || '').trim();
      const file = fd.get('file');
      let result = null;
      if (url) result = url;
      else if (file && file.size > 0) {
        result = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = () => rej(r.error);
          r.readAsDataURL(file);
        });
      }
      modal.remove();
      if (result) await onPick(result);
      resolve(result);
    });
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
