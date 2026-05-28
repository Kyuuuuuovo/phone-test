// Drift-bottle (漂流瓶) UI.
//
// "漂流瓶" is the metaphor; the implementation is network-style messages,
// not physical bottles in the sea. Wording stays away from "捞 / 海 / 漂着"
// for that reason — it's "发出去" / "随机收一条" / "等回信".
//
// One list page in three buckets:
//   1. 等回信中 (drifting bottles you sent, not yet replyDueAt)
//   2. 有回信 (replied bottles you sent)
//   3. 随机收到的 (bottles you pulled from random users — read-only with
//      optional one-shot reply)
//
// Two primary actions (header buttons):
//   - "发一个" → write modal → choose audience (contacts / strangers) → save.
//     Bottle goes status='drifting', replyDueAt = now + random delay.
//     scanDueBottles runs on mount, so any bottles whose replyDueAt has
//     elapsed get their reply generated lazily right here.
//   - "随机收一条" → fishBottle() → fresh stranger persona writes a brand-new
//     bottle → appears in 随机收到的.
//
// Tapping a replied bottle opens a detail view showing the reply, who
// wrote it (anonymized for contacts; persona name for strangers), and
// — for stranger replies / random-received bottles — an "加好友" button
// that promotes the generatedPersona into a real characters row.

import * as db   from '../../core/db.js';
import * as ai   from '../../core/ai.js';
import * as bottleCore from '../../core/bottle.js';
import { openAlert } from '../../core/modal.js';
import { esc } from '../../core/util.js';

export async function mountBottle(container, params, router) {
  // On open: lazy-generate replies for any drifting bottles whose
  // replyDueAt has elapsed since last visit. Best-effort; failures are
  // swallowed inside scanDueBottles.
  try { await bottleCore.scanDueBottles(db, ai); } catch (_) {}

  async function render() {
    const all = await db.getAll('bottles');
    all.sort((a, b) => (b.castAt ?? 0) - (a.castAt ?? 0));

    const drifting = all.filter(b => b.status === 'drifting' && b.authorIsUser);
    const replied  = all.filter(b => b.status === 'replied'  && b.authorIsUser);
    const fished   = all.filter(b => !b.authorIsUser);

    container.innerHTML = `
      <div class="page bottle-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">漂流瓶</div>
          <div class="actions">
            <button class="bottle-cast" title="发一个漂流瓶">发</button>
            <button class="bottle-fish" title="随机收一条">收</button>
          </div>
        </header>
        <div class="page-body">
          ${all.length === 0 ? `
            <p class="hint">还没有任何瓶子。<br>"发" 一条匿名漂流瓶等回信,或 "收" 一条别人随机发出来的读一读。</p>
          ` : ''}
          ${replied.length > 0 ? `
            <h3 class="bottle-bucket-title">有回信(${replied.length})</h3>
            <div class="bottle-list">${replied.map(renderBottleRow).join('')}</div>
          ` : ''}
          ${drifting.length > 0 ? `
            <h3 class="bottle-bucket-title">等回信中(${drifting.length})</h3>
            <div class="bottle-list">${drifting.map(renderBottleRow).join('')}</div>
          ` : ''}
          ${fished.length > 0 ? `
            <h3 class="bottle-bucket-title">随机收到的(${fished.length})</h3>
            <div class="bottle-list">${fished.map(renderBottleRow).join('')}</div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function renderBottleRow(b) {
    const preview = (b.content || '').slice(0, 50);
    const sub = b.status === 'drifting'
      ? `${b.audience === 'contacts' ? '只发给联系人' : '陌生人也能收到'} · ${formatRelative(b.replyDueAt)}后到`
      : (b.authorIsUser
          ? `回信来自:${b.audience === 'contacts' ? '一个联系人(匿名)' : b.generatedPersona?.name || '陌生人'}`
          : `${b.generatedPersona?.name || '陌生人'} 发的`);
    const tag = b.status === 'drifting' ? '<span class="bottle-tag drifting">等回信</span>'
              : (b.status === 'replied' && b.authorIsUser ? '<span class="bottle-tag replied">回信</span>' : '');
    return `
      <button class="bottle-row" data-bottle-id="${esc(b.id)}">
        <div class="bottle-info">
          <div class="bottle-content">${esc(preview)}${(b.content || '').length > 50 ? '…' : ''}</div>
          <div class="bottle-sub">${tag}${esc(sub)}</div>
        </div>
      </button>
    `;
  }

  await render();

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    if (e.target.closest('.bottle-cast')) {
      await openCastModal(container, render);
      return;
    }
    if (e.target.closest('.bottle-fish')) {
      await fishOne(container, render);
      return;
    }
    const row = e.target.closest('[data-bottle-id]');
    if (row) {
      await openBottleDetail(container, row.dataset.bottleId, router, render);
    }
  };
  container.addEventListener('click', onClick);

  return () => container.removeEventListener('click', onClick);
}

async function openCastModal(container, onDone) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">发一个漂流瓶</div>
      <form class="bottle-cast-form" autocomplete="off">
        <label>
          <div class="label-text">写些什么(匿名的,对方不知道是你)</div>
          <textarea name="content" rows="5" required placeholder="想说就说..."></textarea>
        </label>
        <label>
          <div class="label-text">发给谁</div>
          <select name="audience">
            <option value="strangers" selected>陌生人也能收到</option>
            <option value="contacts">只发给我的联系人</option>
          </select>
        </label>
        <p class="hint">几分钟到几小时之后会有人回你一条。一瓶只回一条,没有续聊 — 想继续可以加好友。</p>
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
          <button type="submit" class="btn">发出去</button>
        </div>
      </form>
    </div>
  `;
  container.appendChild(modal);
  modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
  modal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(modal.querySelector('form'));
    const content = String(fd.get('content') || '').trim();
    const audience = String(fd.get('audience') || 'strangers');
    if (!content) return;
    const now = Date.now();
    await db.set('bottles', {
      id: db.newId(),
      content,
      authorIsUser: true,
      audience,
      status: 'drifting',
      reply: null,
      castAt: now,
      replyDueAt: now + bottleCore.randomReplyDelay(),
      repliedAt: null,
    });
    modal.remove();
    await onDone();
  });
}

async function fishOne(container, onDone) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">随机收一条</div>
      <p class="hint">正在为你随机匹配一个发漂流瓶的人...</p>
      <div class="form-status">AI 在凭空想一个陌生人...</div>
      <div class="modal-actions">
        <button type="button" class="btn secondary cancel-btn">取消</button>
      </div>
    </div>
  `;
  container.appendChild(modal);
  modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
  try {
    await bottleCore.fishBottle(db, ai);
    modal.remove();
    await onDone();
  } catch (e) {
    modal.querySelector('.form-status').textContent = `失败:${String(e).slice(0, 200)}`;
    modal.querySelector('.form-status').className = 'form-status error';
  }
}

async function openBottleDetail(container, bottleId, router, onChange) {
  const b = await db.get('bottles', bottleId);
  if (!b) return;

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';

  const replierLabel = b.replierCharacterId ? '一个联系人 · 匿名回复'
                     : b.generatedPersona?.name || '一个陌生人';
  const canPromote   = !!(b.generatedPersona && !b.promotedCharacterId);

  const isDrifting = b.status === 'drifting';
  const isUserCastReplied = b.status === 'replied' && b.authorIsUser;
  const isFished = !b.authorIsUser;

  // Common reply-back input shown only for received bottles that the user
  // hasn't replied to yet (one-shot, stored as bottle.reply).
  const canReplyBack = isFished && !b.reply;

  modal.innerHTML = `
    <div class="modal bottle-detail-modal">
      <div class="modal-header">${
        isDrifting ? '还在等回信'
        : isUserCastReplied ? '回信来了' : '一封陌生人的漂流瓶'
      }</div>
      <div class="bottle-card original">
        <div class="bottle-card-label">${isFished ? esc(b.generatedPersona?.name || '陌生人') + ' 发的' : '你发的'}</div>
        <div class="bottle-card-body">${esc(b.content || '')}</div>
      </div>
      ${isDrifting ? `<p class="hint">大约 ${formatRelative(b.replyDueAt)}后会有人回。</p>` : ''}
      ${b.reply && isUserCastReplied ? `
        <div class="bottle-card reply">
          <div class="bottle-card-label">${esc(replierLabel)}</div>
          <div class="bottle-card-body">${esc(b.reply)}</div>
        </div>
        ${b.generatedPersona ? `<p class="hint persona-blurb">人设:${esc(b.generatedPersona.persona || '').slice(0, 200)}</p>` : ''}
      ` : ''}
      ${b.reply && isFished ? `
        <div class="bottle-card reply">
          <div class="bottle-card-label">你的回信</div>
          <div class="bottle-card-body">${esc(b.reply)}</div>
        </div>
      ` : ''}
      ${canReplyBack ? `
        <form class="bottle-reply-form" autocomplete="off">
          <label>
            <div class="label-text">回信(只回一次,没有续聊)</div>
            <textarea name="reply" rows="3" required placeholder="想说就说..."></textarea>
          </label>
        </form>
      ` : ''}
      <div class="modal-actions">
        <button type="button" class="btn secondary cancel-btn">关闭</button>
        ${canPromote ? `<button type="button" class="btn promote-btn">加好友</button>` : ''}
        ${canReplyBack ? `<button type="button" class="btn send-reply-btn">寄回</button>` : ''}
      </div>
    </div>
  `;
  container.appendChild(modal);
  modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());

  const promoteBtn = modal.querySelector('.promote-btn');
  if (promoteBtn) {
    promoteBtn.addEventListener('click', async () => {
      try {
        const fresh = await db.get('bottles', bottleId);
        const newChar = await bottleCore.promoteStrangerToFriend(db, fresh);
        await openAlert(container, { title: '已加为联系人', message: `${newChar.name} 已经加进通讯录,可以去消息列表开个新对话。` });
        modal.remove();
        await onChange();
      } catch (e) {
        await openAlert(container, { title: '加好友失败', message: String(e).slice(0, 200), danger: true });
      }
    });
  }

  const sendBtn = modal.querySelector('.send-reply-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      const v = modal.querySelector('textarea[name="reply"]').value.trim();
      if (!v) return;
      const fresh = await db.get('bottles', bottleId);
      fresh.reply = v;
      fresh.repliedAt = Date.now();
      await db.set('bottles', fresh);
      modal.remove();
      await onChange();
    });
  }
}

function formatRelative(ts) {
  if (!ts) return '';
  const dt = ts - Date.now();
  if (dt <= 0) return '随时';
  const min = Math.round(dt / 60000);
  if (min < 60) return `${min} 分钟`;
  const h = Math.round(min / 60);
  return `${h} 小时`;
}
