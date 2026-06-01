// 朋友圈 (Moments) —— 熟人圈 feed。仅好友可见(不混陌生人)。
//
// 你能发动态(文字 + 图)、给任何动态点赞 / 评论 / 删自己的。AI 联动是
// **纯按钮驱动**(铁律 2「积攒后触发」,不自动调 API):
//   - feed 顶部「让好友发条动态」→ 现造一条角色朋友圈;
//   - 每条动态上「让好友回应」→ 生成好友点赞/评论(你评论后按它,作者/好友就回你)。
// 生成逻辑全在 core/moments.js,不进 chatMessages。

import * as db from '../../core/db.js';
import * as ai from '../../core/ai.js';
import * as momentsCore from '../../core/moments.js';
import { openModal, openAlert, openConfirm } from '../../core/modal.js';
import { esc } from '../../core/util.js';

const HEART = `<svg class="moment-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.3-9.3-8.2C1 10.1 1.8 6.5 5 5.4c2-0.7 4 0.2 5 1.9 1-1.7 3-2.6 5-1.9 3.2 1.1 4 4.7 2.3 7.4C18.7 16.7 12 21 12 21z"/></svg>`;

export async function mountMoments(container, params, router) {
  let persona = null;
  async function loadPersona() {
    const s = await db.get('settings', 'default');
    persona = s?.activePersonaId ? await db.get('personas', s.activePersonaId) : null;
  }

  function avatarHtml(name, avatar) {
    if (avatar) return `<img src="${esc(avatar)}" alt="">`;
    const ch = (String(name || '?').trim()[0]) || '?';
    return `<span class="avatar-fallback">${esc(ch)}</span>`;
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 60000) return '刚刚';
    const min = Math.floor(d / 60000); if (min < 60) return `${min} 分钟前`;
    const h = Math.floor(min / 60);    if (h < 24)  return `${h} 小时前`;
    const day = Math.floor(h / 24);    if (day < 7) return `${day} 天前`;
    const dt = new Date(ts);
    return `${dt.getMonth() + 1}月${dt.getDate()}日`;
  }

  function renderMoment(m) {
    const liked = Array.isArray(m.likes) && m.likes.some(l => l.by === 'user');
    const likeNames = (m.likes || []).map(l => esc(l.name || '匿名')).join('、');
    const comments = (m.comments || [])
      .map(c => `<div class="moment-cmt"><span class="moment-cmt-name">${esc(c.name || '匿名')}</span>:${esc(c.text || '')}</div>`)
      .join('');
    const n = Math.min(9, (m.images || []).length);
    const imgs = n
      ? `<div class="moment-imgs n${n}">${m.images.slice(0, 9).map(src => `<img src="${esc(src)}" alt="">`).join('')}</div>`
      : '';
    const canDelete = m.authorType === 'user';
    return `
      <div class="moment" data-id="${esc(m.id)}">
        <span class="moments-avatar">${avatarHtml(m.authorName, m.authorAvatar)}</span>
        <div class="moment-main">
          <div class="moment-name">${esc(m.authorName || (m.authorType === 'user' ? '我' : '好友'))}</div>
          ${m.text ? `<div class="moment-text">${esc(m.text)}</div>` : ''}
          ${imgs}
          <div class="moment-bar">
            <span class="moment-time">${esc(formatTime(m.createdAt))}</span>
            <span class="moment-acts">
              ${canDelete ? `<button class="moment-del" data-id="${esc(m.id)}">删除</button>` : ''}
              <button class="moment-react" data-id="${esc(m.id)}" title="让好友点赞 / 评论 / 回你">让好友回应</button>
              <button class="moment-like${liked ? ' liked' : ''}" data-id="${esc(m.id)}">${HEART}<span>${liked ? '已赞' : '赞'}</span></button>
              <button class="moment-comment" data-id="${esc(m.id)}">评论</button>
            </span>
          </div>
          ${(m.likes || []).length ? `<div class="moment-likes">${HEART}<span>${likeNames}</span></div>` : ''}
          ${comments ? `<div class="moment-cmts">${comments}</div>` : ''}
        </div>
      </div>`;
  }

  async function render() {
    const all = await db.getAll('moments');
    all.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    container.innerHTML = `
      <div class="moments-feed">
        <div class="moments-cover">
          <button class="moments-compose" title="发条朋友圈" aria-label="发条朋友圈">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <div class="moments-me">
            <span class="moments-me-name">${esc(persona?.name || '我')}</span>
            <span class="moments-avatar moments-me-avatar">${avatarHtml(persona?.name || '我', persona?.avatar)}</span>
          </div>
        </div>
        <div class="moments-actions">
          <button class="moments-gen-char">让好友发条动态</button>
        </div>
        ${all.length === 0
          ? `<div class="empty-state moments-empty">还没有动态。<br>点右上角发一条;或点「让好友发条动态」让某个好友冒个泡。<br>发完 / 评论后,点动态上的「让好友回应」让好友来点赞、评论、回你。</div>`
          : `<div class="moments-list">${all.map(renderMoment).join('')}</div>`}
      </div>`;
  }

  await loadPersona();
  await render();

  // 临时禁用按钮 + 改文字,跑 fn,完事 render;失败弹 alert。
  async function withBtnBusy(btn, busyText, fn) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = busyText;
    try {
      await fn();
    } catch (e) {
      await openAlert(container, { title: '生成失败', message: `${String(e).slice(0, 160)}\n(检查设置里的 API 配置)`, danger: true });
    } finally {
      // render() 会重建 DOM,这里的 btn 可能已不在;兜底恢复一下。
      if (btn.isConnected) { btn.disabled = false; btn.textContent = old; }
    }
  }

  const onClick = async (e) => {
    if (e.target.closest('.moments-compose')) {
      await openComposeModal(container, persona, render);
      return;
    }
    const genCharBtn = e.target.closest('.moments-gen-char');
    if (genCharBtn) {
      await withBtnBusy(genCharBtn, '生成中…', async () => {
        const r = await momentsCore.generateCharacterMoment(db, ai);
        if (!r.ok && r.reason === 'no-friends') {
          await openAlert(container, { title: '还没有好友', message: '先去通讯录里加一个角色,好友才能发朋友圈。' });
        } else if (!r.ok) {
          await openAlert(container, { title: '没生成出来', message: '这次没写出内容,再按一次试试。' });
        }
        await render();
      });
      return;
    }
    const reactBtn = e.target.closest('.moment-react');
    if (reactBtn) {
      const id = reactBtn.dataset.id;
      await withBtnBusy(reactBtn, '生成中…', async () => {
        const r = await momentsCore.generateReactionsFor(db, ai, id);
        if (!r.ok && r.reason === 'no-friends') {
          await openAlert(container, { title: '还没有好友', message: '先去通讯录里加一个角色。' });
        } else if (r.ok && (r.likesAdded + r.commentsAdded) === 0) {
          await openAlert(container, { title: '好友没反应', message: '这次好友没点赞也没评论,可以再按一次。' });
        }
        await render();
      });
      return;
    }
    const delBtn = e.target.closest('.moment-del');
    if (delBtn) {
      const ok = await openConfirm(container, { title: '删除这条动态?', message: '删了就没了,评论和点赞一起删。', danger: true });
      if (ok) { await db.del('moments', delBtn.dataset.id); await render(); }
      return;
    }
    const likeBtn = e.target.closest('.moment-like');
    if (likeBtn) {
      await toggleLike(likeBtn.dataset.id);
      await render();
      return;
    }
    const cmtBtn = e.target.closest('.moment-comment');
    if (cmtBtn) {
      await addComment(container, cmtBtn.dataset.id, render);
      return;
    }
  };
  container.addEventListener('click', onClick);

  async function toggleLike(id) {
    const m = await db.get('moments', id);
    if (!m) return;
    if (!Array.isArray(m.likes)) m.likes = [];
    const i = m.likes.findIndex(l => l.by === 'user');
    if (i >= 0) m.likes.splice(i, 1);
    else m.likes.push({ by: 'user', name: persona?.name || '我' });
    await db.set('moments', m);
  }

  async function addComment(host, id, onDone) {
    const res = await openModal(host, {
      title: '评论',
      fields: [{ name: 'text', label: '说点什么', kind: 'textarea', placeholder: '友善评论…' }],
      submitLabel: '发送',
    });
    if (!res) return;
    const text = String(res.text || '').trim();
    if (!text) return;
    const m = await db.get('moments', id);
    if (!m) return;
    if (!Array.isArray(m.comments)) m.comments = [];
    m.comments.push({ id: db.newId(), by: 'user', name: persona?.name || '我', text, at: Date.now() });
    await db.set('moments', m);
    await onDone();
    // 评论完提示:想让对方回你,点这条上的「让好友回应」。
  }

  return () => container.removeEventListener('click', onClick);
}

// ── 发动态 modal(文字 + 多图)──────────────────────────────────────────────
async function openComposeModal(host, persona, onDone) {
  let images = [];
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';

  function render() {
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">发条朋友圈</div>
        <form class="moment-compose-form" autocomplete="off">
          <label>
            <div class="label-text">这一刻的想法…</div>
            <textarea name="text" rows="4" placeholder="分享点什么(仅好友可见)"></textarea>
          </label>
          <div class="moment-compose-imgs">
            ${images.map((src, i) => `<div class="mc-thumb"><img src="${esc(src)}" alt=""><button type="button" class="mc-thumb-del" data-i="${i}" aria-label="删除">×</button></div>`).join('')}
            ${images.length < 9 ? `<button type="button" class="mc-add">+ 图片</button>` : ''}
          </div>
          <p class="hint">仅好友可见。发出后点动态上的「让好友回应」,好友会来点赞 / 评论。</p>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">发表</button>
          </div>
        </form>
      </div>`;

    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    const addBtn = modal.querySelector('.mc-add');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const got = await pickImages(9 - images.length);
      if (got.length) { images = images.concat(got).slice(0, 9); render(); }
    });
    modal.querySelectorAll('.mc-thumb-del').forEach(b => b.addEventListener('click', () => {
      images.splice(Number(b.dataset.i), 1);
      render();
    }));
    modal.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = String(new FormData(e.target).get('text') || '').trim();
      if (!text && images.length === 0) {
        await openAlert(document.body, { title: '空空的', message: '写点字、或加张图再发。' });
        return;
      }
      const now = Date.now();
      await db.set('moments', {
        id: db.newId(),
        authorType: 'user',
        authorId: persona?.id || null,
        authorName: persona?.name || '我',
        authorAvatar: persona?.avatar || null,
        text,
        images,
        likes: [],
        comments: [],
        visibility: 'all-friends',
        reactedAt: null,
        createdAt: now,
      });
      modal.remove();
      await onDone();
    });
  }

  host.appendChild(modal);
  render();
}

async function pickImages(maxCount = 9, maxMB = 2) {
  if (maxCount <= 0) return [];
  const files = await new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => resolve([...(input.files || [])]);
    input.click();
  });
  if (!files.length) return [];
  const out = [];
  for (const f of files.slice(0, maxCount)) {
    if (f.size > maxMB * 1024 * 1024) {
      await openAlert(document.body, { title: '图片太大', message: `${f.name}:${(f.size / 1024 / 1024).toFixed(1)} MB,建议每张 < ${maxMB} MB。`, danger: true });
      continue;
    }
    out.push(await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(f);
    }));
  }
  return out;
}
