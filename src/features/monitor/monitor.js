// Monitor app — list of placed surveillance cameras + flow to add a new one.
// Each row shows character / room / mode and the latest snapshot caption (if
// any). Tap a row → monitor-view. "+" opens a 3-step modal:
//   1) pick character
//   2) pick mode (光明正大 / 不让ta知道) — same generation pipeline, different
//      world-fact line injected into the prompt (CLAUDE.md 铁律 9). The
//      "spy" mode (internal name) is shown to the user as "不让ta知道".
//   3) pick room
//      - 光明正大 mode: call proposeRooms (AI suggests 3-4 rooms the
//        character would consent to), user picks one
//      - 不让ta知道 mode: user types the room name freely (or picks from a
//        few common suggestions); the character isn't asked.

import * as db from '../../core/db.js';
import * as surveillance from '../../core/surveillance.js';
import { openAlert } from '../../core/modal.js';

const SPY_PLACEHOLDERS = ['卧室', '客厅', '浴室', '书房', '厨房'];

export async function mountMonitor(container, params, router) {
  async function render() {
    const cameras = await db.getAll('cameras');
    cameras.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const chars = await db.getAll('characters');
    const charMap = new Map(chars.map(c => [c.id, c]));

    // For each camera, peek the latest snapshot caption to show inline.
    const latestByCamera = new Map();
    for (const cam of cameras) {
      const logs = await db.query('activityLog', 'cameraId', cam.id);
      if (logs.length === 0) continue;
      logs.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      latestByCamera.set(cam.id, logs[0]);
    }

    container.innerHTML = `
      <div class="page monitor-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">监控</div>
          <div class="actions">
            <button class="new-camera" title="添加机位" aria-label="添加机位"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
          </div>
        </header>
        <div class="page-body">
          ${cameras.length === 0 ? `
            <p class="hint">还没有摄像头。点右上角 + 添加一个。</p>
            <p class="hint">两种模式 — <b>光明正大</b>:ta 知道你放了一台摄像头,看看 ta 会对着镜头干什么吧,也可能什么都不干。<b>不让 ta 知道</b>:嘘,我们不让 ta 知道。小心不要被发现。</p>
          ` : `
            <div class="camera-list">
              ${cameras.map(cam => {
                const char = charMap.get(cam.characterId);
                const last = latestByCamera.get(cam.id);
                const modeLabel = cam.mode === 'open' ? '光明正大' : '不让 ta 知道';
                const stateTag = cam.discoveredAt ? '<span class="cam-state-discovered">已被察觉</span>' : '';
                const captionPreview = last?.payload?.caption || '(还没拍过画面 — 点开机位刷新)';
                return `
                  <button class="camera-row" data-camera-id="${esc(cam.id)}">
                    <div class="cam-info">
                      <div class="cam-title">
                        <span class="cam-room">${esc(cam.room)}</span>
                        <span class="cam-meta">· ${esc(char?.name || '(未知角色)')} · ${modeLabel}</span>
                        ${stateTag}
                      </div>
                      <div class="cam-caption">${esc(captionPreview)}</div>
                    </div>
                  </button>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  await render();

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    if (e.target.closest('.new-camera')) return openAddCameraFlow(container, render);
    const row = e.target.closest('[data-camera-id]');
    if (row) {
      router.navigate('monitor-view', { cameraId: row.dataset.cameraId });
    }
  };
  container.addEventListener('click', onClick);

  return () => {
    container.removeEventListener('click', onClick);
  };
}

// Multi-step modal: character → mode → room → save.
async function openAddCameraFlow(container, rerender) {
  const allChars = (await db.getAll('characters')).filter(c => c.id !== '__bear__');
  if (allChars.length === 0) {
    await openAlert(container, { title: '没有角色', message: '先去角色管理建一个角色,再回来添加机位。' });
    return;
  }
  const chars = allChars.filter(c => !c.blocked);
  if (chars.length === 0) {
    await openAlert(container, { title: '没有可用角色', message: '已存在的角色全部在黑名单里。先解除拉黑或新建角色。' });
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  container.appendChild(modal);

  let pickedCharId = null;
  let pickedMode   = null;

  function step1_character() {
    chars.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">添加机位 · 选角色</div>
        <div class="character-pick-list">
          ${chars.map(c => `
            <button class="character-pick-row" data-char-id="${esc(c.id)}">
              ${renderAvatar(c)}
              <div class="session-info">
                <div class="session-name">${esc(c.name || '(未命名)')}</div>
                <div class="session-preview">${esc((c.persona || '').slice(0, 60))}</div>
              </div>
            </button>
          `).join('')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
        </div>
      </div>
    `;
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelectorAll('[data-char-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        pickedCharId = btn.dataset.charId;
        step2_mode();
      });
    });
  }

  function step2_mode() {
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">选模式</div>
        <p class="hint">两种模式不是 UI 开关 — 它会真的告诉 AI 角色知不知道这台摄像头存在,角色的反应是按人设演的。</p>
        <div class="mode-pick">
          <button class="mode-card" data-mode="open">
            <div class="mode-title">光明正大</div>
            <div class="mode-desc">ta 知道你放了一台摄像头,看看 ta 会对着镜头干什么吧,也可能什么都不干?</div>
          </button>
          <button class="mode-card" data-mode="spy">
            <div class="mode-title">不让 ta 知道</div>
            <div class="mode-desc">嘘,我们不让 ta 知道。小心不要被发现。</div>
          </button>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn secondary back-btn">‹ 返回</button>
          <button type="button" class="btn secondary cancel-btn">取消</button>
        </div>
      </div>
    `;
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('.back-btn').addEventListener('click', step1_character);
    modal.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        pickedMode = btn.dataset.mode;
        if (pickedMode === 'open') step3_openRooms();
        else step3_spyRoom();
      });
    });
  }

  async function step3_openRooms() {
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">选房间 · 光明正大</div>
        <p class="hint">AI 正在基于角色人设思考 ta 会同意的房间...</p>
        <div class="form-status">调用中…</div>
        <div class="modal-actions">
          <button type="button" class="btn secondary back-btn">‹ 返回</button>
          <button type="button" class="btn secondary cancel-btn">取消</button>
        </div>
      </div>
    `;
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('.back-btn').addEventListener('click', step2_mode);

    let rooms = null;
    try {
      rooms = await surveillance.proposeRooms(pickedCharId);
    } catch (e) {
      modal.querySelector('.form-status').textContent = `失败:${String(e).slice(0, 200)}`;
      modal.querySelector('.form-status').className = 'form-status error';
      return;
    }
    // Empty array = AI explicitly refused (ta 已经不耐烦了). Show a polite
    // refusal card with a way out (switch to spy mode = "不让 ta 知道").
    if (Array.isArray(rooms) && rooms.length === 0) {
      modal.innerHTML = `
        <div class="modal">
          <div class="modal-header">ta 摇头</div>
          <p class="hint">看起来 ta 觉得家里已经装够了,不愿意再加一台公开摄像头。<br><br>你可以返回换"不让 ta 知道"模式,或者就此作罢。</p>
          <div class="modal-actions">
            <button type="button" class="btn secondary back-btn">‹ 换模式</button>
            <button type="button" class="btn cancel-btn">就此作罢</button>
          </div>
        </div>
      `;
      modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
      modal.querySelector('.back-btn').addEventListener('click', step2_mode);
      return;
    }
    if (!rooms) {
      modal.querySelector('.form-status').textContent = '没拿到结果,要么再试一次,要么直接手填';
      modal.querySelector('.form-status').className = 'form-status error';
      return;
    }
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">选房间 · 光明正大</div>
        <p class="hint">AI 觉得 ta 会同意装在这些地方:</p>
        <div class="room-pick">
          ${rooms.map(r => `<button class="room-chip" data-room="${esc(r)}">${esc(r)}</button>`).join('')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn secondary back-btn">‹ 返回</button>
          <button type="button" class="btn secondary cancel-btn">取消</button>
        </div>
      </div>
    `;
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('.back-btn').addEventListener('click', step2_mode);
    modal.querySelectorAll('[data-room]').forEach(chip => {
      chip.addEventListener('click', () => saveAndClose(chip.dataset.room));
    });
  }

  function step3_spyRoom() {
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">选房间 · 不让 ta 知道</div>
        <p class="hint">ta 不知道,所以由你决定。越私密的地方风险越高 — ta 越容易察觉。</p>
        <form class="spy-room-form" autocomplete="off">
          <label>
            <div class="label-text">房间名</div>
            <input name="room" type="text" required placeholder="比如:卧室 / 浴室 / 玄关">
          </label>
          <div class="room-pick">
            ${SPY_PLACEHOLDERS.map(r => `<button type="button" class="room-chip" data-room="${esc(r)}">${esc(r)}</button>`).join('')}
          </div>
          <div class="modal-actions">
            <button type="button" class="btn secondary back-btn">‹ 返回</button>
            <button type="submit" class="btn">装上</button>
          </div>
        </form>
      </div>
    `;
    const input = modal.querySelector('input[name="room"]');
    modal.querySelector('.back-btn').addEventListener('click', step2_mode);
    modal.querySelectorAll('[data-room]').forEach(chip => {
      chip.addEventListener('click', () => { input.value = chip.dataset.room; });
    });
    modal.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const room = String(input.value || '').trim();
      if (!room) return;
      saveAndClose(room);
    });
  }

  async function saveAndClose(room) {
    await db.set('cameras', {
      id: db.newId(),
      characterId: pickedCharId,
      room,
      mode: pickedMode,
      createdAt: Date.now(),
      discoveredAt: null,
    });
    modal.remove();
    await rerender();
  }

  step1_character();
}

function renderAvatar(c) {
  if (c?.avatar) {
    return `<div class="session-avatar"><img src="${esc(c.avatar)}" alt=""></div>`;
  }
  const initial = (c?.name ?? '?').slice(0, 1);
  return `<div class="session-avatar">${esc(initial)}</div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
