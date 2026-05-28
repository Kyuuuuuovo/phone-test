// 「我」tab — entry hub for player-facing settings & data.
// Hosts:
//   • 顶部 profile card with the active persona's name / avatar
//     (点击头像可换图,直接 patch persona.avatar — 写回 personas store)
//   • 钱包 / 当前人设 / 收藏 入口
//   • #49: 头像可换 — 点头像触发 file picker → base64 → persona.avatar update。
//     no active persona 时,提示 user 先去选 / 创建一个 persona。

import * as db from '../../core/db.js';
import { openAlert, openModal } from '../../core/modal.js';
import { esc } from '../../core/util.js';

export async function mountMe(container, params, router) {
  const settings = (await db.get('settings', 'default')) || {};
  const activePersonaId = settings.activePersonaId || null;
  const persona = activePersonaId ? await db.get('personas', activePersonaId) : null;
  const wallet = (await db.get('wallet', 'default')) || { balance: 0 };
  const favorites = await db.getAll('favorites');

  // 用户状态(per-persona)— 显示在 profile 卡下面、像微信状态那种一行
  // 短文本。空时占位文字提示「点击设置」。点击 → 打开编辑 modal,改的是
  // 当前 active persona 的 statusText / statusSetAt。chat 注入时按
  // session.personaId 找对应 persona 的状态。
  const statusText = persona?.statusText || '';
  const statusAgo = persona?.statusSetAt ? formatRelTime(persona.statusSetAt) : '';
  const signature = persona?.signature || '';
  const personaContent = persona?.persona || '';

  container.innerHTML = `
    <div class="me-body">
      <div class="me-profile">
        <div class="me-avatar-wrap" role="button" tabindex="0" aria-label="${persona ? '换头像' : '先去当前人设创建/选一个 persona'}">
          ${renderAvatar(persona)}
          ${persona ? '<div class="me-avatar-edit-badge" aria-hidden="true">换</div>' : ''}
        </div>
        <div class="me-profile-text">
          <div class="me-name">${esc(persona?.name || '未设置人设')}</div>
          <button class="me-signature${signature ? '' : ' empty'}${persona ? '' : ' disabled'}" type="button" aria-label="${persona ? '编辑签名' : '先选一个人设'}">
            ${signature ? esc(signature) : (persona ? '点这里写个签名' : '点「当前人设」选一个')}
          </button>
        </div>
      </div>

      <button class="me-status-card${persona ? '' : ' disabled'}" type="button" aria-label="${persona ? '编辑状态' : '先选一个人设'}">
        <span class="me-status-label">状态</span>
        <span class="me-status-line">
          <span class="me-status-text${statusText ? '' : ' empty'}">${statusText ? esc(statusText) : (persona ? '点这里写一句状态' : '先选个人设')}</span>
          ${statusAgo ? `<span class="me-status-ago">${esc(statusAgo)}</span>` : ''}
        </span>
      </button>

      ${personaContent ? `
        <details class="me-persona-card">
          <summary><span class="me-persona-card-label">我的设定</span><span class="me-persona-card-hint">展开 / 收起</span></summary>
          <div class="me-persona-card-body">${esc(personaContent)}</div>
        </details>
      ` : ''}

      <div class="settings-list me-list">
        <button class="settings-item" data-target="wallet">
          <span class="settings-label">钱包</span>
          <span class="me-row-value">¥${Number(wallet.balance || 0).toFixed(2)}</span>
          <span class="settings-chevron">›</span>
        </button>
        <button class="settings-item" data-target="persona-pick">
          <span class="settings-label">当前人设</span>
          <span class="me-row-value">${esc(persona?.name || '未设置')}</span>
          <span class="settings-chevron">›</span>
        </button>
        <button class="settings-item" data-target="favorites-list">
          <span class="settings-label">收藏</span>
          <span class="me-row-value">${favorites.length} 条</span>
          <span class="settings-chevron">›</span>
        </button>
      </div>
    </div>
  `;

  const avatarWrap = container.querySelector('.me-avatar-wrap');

  async function pickAndSaveAvatar() {
    if (!persona) {
      await openAlert(container, {
        title: '先选个人设',
        message: '当前没有 active persona — 点「当前人设」选一个或新建一个再换头像。',
      });
      return;
    }
    const file = await new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      await openAlert(container, {
        title: '图片太大',
        message: `${(file.size/1024/1024).toFixed(1)} MB,建议 < 2 MB(头像 60px 圆,大图浪费 IDB)。`,
        danger: true,
      });
      return;
    }
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    persona.avatar = dataUrl;
    persona.updatedAt = Date.now();
    await db.set('personas', persona);
    // 重新渲染头像区域(不重 mount 整个 me tab,避免闪烁)
    const newAvatar = renderAvatar(persona);
    avatarWrap.querySelector('.me-avatar')?.outerHTML && (avatarWrap.innerHTML = newAvatar + '<div class="me-avatar-edit-badge" aria-hidden="true">换</div>');
  }

  async function editStatus() {
    if (!persona) {
      await openAlert(container, {
        title: '先选个人设',
        message: '当前没有 active persona — 点「当前人设」选一个,再回来设置状态。',
      });
      return;
    }
    const result = await openModal(container, {
      title: '编辑状态',
      fields: [
        { name: 'text', label: '一句话状态(留空 = 清空状态)', kind: 'textarea', defaultValue: persona.statusText || '', placeholder: '在加班 / 看书 / 心情低落' },
      ],
      submitLabel: '保存',
    });
    if (!result) return;
    const text = String(result.text || '').trim();
    const fresh = await db.get('personas', persona.id);
    if (!fresh) return;
    if (text) {
      fresh.statusText = text;
      fresh.statusSetAt = Date.now();
    } else {
      delete fresh.statusText;
      delete fresh.statusSetAt;
    }
    await db.set('personas', fresh);
    // 重新 mount me tab(简单粗暴,反正改动小)
    await mountMe(container, params, router);
  }

  const onClick = (e) => {
    if (e.target.closest('.me-avatar-wrap')) {
      pickAndSaveAvatar();
      return;
    }
    if (e.target.closest('.me-status-card')) {
      editStatus();
      return;
    }
    if (e.target.closest('.me-signature')) {
      editSignature();
      return;
    }
    const item = e.target.closest('[data-target]');
    if (!item) return;
    router.navigate(item.dataset.target);
  };

  // 签名编辑 — 跟 status 同一套交互模式,改的是 persona.signature。短句(40 字
  // 上限),空字符串 = 清空签名。
  async function editSignature() {
    if (!persona) {
      await openAlert(container, {
        title: '先选个人设',
        message: '当前没有 active persona — 点「当前人设」选一个,再回来设置签名。',
      });
      return;
    }
    const result = await openModal(container, {
      title: '编辑签名',
      fields: [
        { name: 'text', label: '签名(40 字内 · 留空 = 清空)', kind: 'text', defaultValue: persona.signature || '', placeholder: '一句话标签 · 比如「在写代码 / 周末爬山」' },
      ],
      submitLabel: '保存',
    });
    if (!result) return;
    const text = String(result.text || '').trim().slice(0, 40);
    const fresh = await db.get('personas', persona.id);
    if (!fresh) return;
    if (text) fresh.signature = text;
    else      delete fresh.signature;
    fresh.updatedAt = Date.now();
    await db.set('personas', fresh);
    await mountMe(container, params, router);
  }
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}

// 简单相对时间格式 — 几分钟前 / 几小时前 / 几天前。超过 7 天显示月日。
function formatRelTime(ts) {
  if (!Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function renderAvatar(p) {
  if (p?.avatar) {
    return `<div class="me-avatar"><img src="${esc(p.avatar)}" alt=""></div>`;
  }
  const initial = (p?.name ?? '我').slice(0, 1);
  return `<div class="me-avatar">${esc(initial)}</div>`;
}
