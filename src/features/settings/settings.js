// Settings hub. A list of subpages, each navigates via router.

import * as db from '../../core/db.js';
import * as notify from '../../core/notify.js';
import { openAlert } from '../../core/modal.js';
import { BEAR_CHARACTER_ID, DEFAULT_BEAR_AVATAR } from '../../core/pet.js';

export async function mountSettings(container, params, router) {
  const settings = (await db.get('settings', 'default')) || { id: 'default' };
  const petEnabled = settings.petEnabled !== false;
  const bear = await db.get('characters', BEAR_CHARACTER_ID);
  const bearAvatar = bear?.avatar || DEFAULT_BEAR_AVATAR;
  // Notify toggle reflects BOTH the stored intent and the live permission
  // state — a stored true with revoked permission shouldn't look "on" in
  // the UI, because no notification will actually fire.
  const notifySupported = notify.isSupported();
  const notifyPerm = notify.permission();
  const notifyOnReply = settings.notifyOnReply === true && notifyPerm === 'granted';
  const notifyHint = !notifySupported ? '此浏览器不支持系统通知'
    : notifyPerm === 'denied' ? '浏览器已拒绝通知权限,需要在浏览器站点设置里手动允许'
    : notifyPerm === 'granted' ? '页面切到其他标签时,AI 回复完会弹系统通知'
    : '页面切到其他标签时,AI 回复完弹系统通知(需要授权一次)';

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">设置</div>
      </header>
      <div class="page-body">
        <h3 class="settings-section-title">基础</h3>
        <div class="settings-list">
          <button class="settings-item" data-target="settings-api">
            <span class="settings-label">API 设置</span>
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

        <h3 class="settings-section-title">扩展</h3>
        <div class="settings-list">
          <button class="settings-item" data-target="settings-weather">
            <span class="settings-label">天气 API</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-target="settings-embedding">
            <span class="settings-label">向量记忆</span>
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

        <h3 class="settings-section-title">聊天注入</h3>
        <div class="settings-list">
          <label class="settings-item toggle-row">
            <span class="settings-label">同步行程到聊天
              <div class="settings-sub">把 [-6h, +24h] 窗内的行程注入聊天的「# 当前行程」段。每条行程也可独立关闭。</div>
            </span>
            <input type="checkbox" data-toggle="syncScheduleToChat"${settings.syncScheduleToChat !== false ? ' checked' : ''}>
          </label>
          <label class="settings-item toggle-row">
            <span class="settings-label">同步监控到聊天
              <div class="settings-sub">在监控里把单台机位标为「同步」后,最近的画面会注入聊天的「# 角色当前活动」段。默认关 — 这是潜在的世界状态改变,先想清楚再开。</div>
            </span>
            <input type="checkbox" data-toggle="syncMonitorToChat"${settings.syncMonitorToChat === true ? ' checked' : ''}>
          </label>
        </div>

        <h3 class="settings-section-title">通知</h3>
        <div class="settings-list">
          <label class="settings-item toggle-row">
            <span class="settings-label">AI 回复 / 行程到点 弹系统通知
              <div class="settings-sub">${esc(notifyHint)}</div>
            </span>
            <input type="checkbox" data-toggle="notifyOnReply"${notifyOnReply ? ' checked' : ''}${(!notifySupported || notifyPerm === 'denied') ? ' disabled' : ''}>
          </label>
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
    } else if (which === 'syncScheduleToChat' || which === 'syncMonitorToChat') {
      s[which] = !!cb.checked;
      await db.set('settings', s);
    } else if (which === 'notifyOnReply') {
      // Toggle-on: request permission first (browsers require a user
      // gesture, which the checkbox click counts as). Only persist
      // `true` if permission actually lands on granted. The DOM
      // checkbox is rolled back to off when we can't grant, so the UI
      // stays honest about whether notifications will fire.
      if (cb.checked) {
        const result = await notify.requestPermission();
        if (result !== 'granted') {
          cb.checked = false;
          s.notifyOnReply = false;
          await db.set('settings', s);
          await openAlert(container, {
            title: '没拿到通知权限',
            message: result === 'denied'
              ? '浏览器记住了「拒绝」。要重新授权,需要在浏览器地址栏左侧的站点设置里把通知改回「允许」,再回到这里打开。'
              : '权限请求被关掉了。点开关再试一次?',
          });
          return;
        }
        s.notifyOnReply = true;
        await db.set('settings', s);
      } else {
        s.notifyOnReply = false;
        await db.set('settings', s);
      }
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
