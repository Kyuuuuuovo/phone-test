// Monitor view — single camera's live frame, with refresh + delete.
//
// UI is a "CCTV card": dark backdrop, ● REC + timestamp top bar, room label,
// posture · activity line, caption strip, mood corner tag. A noise overlay
// + slight desaturated / green-shifted filter sells the surveillance feel
// without trying to be photoreal.
//
// Refresh calls surveillance.generateSnapshot(cameraId) — one AI round-trip,
// persists an activityLog row, and re-renders. The button is the user's
// pacing knob: each tap = one frame = one API call. Snapshot mode (per the
// design discussion), not live streaming.
//
// If the camera was discovered (spy mode + a previous snapshot returned
// noticed=true), a red banner shows at top. Refresh still works — but the
// generation prompt now tells the model "the character knows you've been
// spying", so subsequent frames reflect that world state.

import * as db from '../../core/db.js';
import * as surveillance from '../../core/surveillance.js';
import { openConfirm, openAlert } from '../../core/modal.js';
import { esc } from '../../core/util.js';

export async function mountMonitorView(container, params, router) {
  const cameraId = params?.cameraId;
  if (!cameraId) {
    container.innerHTML = `<div class="page"><div class="page-body">缺少 cameraId</div></div>`;
    return () => {};
  }

  let busy = false;

  async function render() {
    const camera = await db.get('cameras', cameraId);
    if (!camera) {
      container.innerHTML = `<div class="page"><div class="page-body">机位已删除</div></div>`;
      return;
    }
    const character = await db.get('characters', camera.characterId);
    const allLogs = await db.query('activityLog', 'cameraId', cameraId);
    // Filter out logs from before the last room/angle change — the user
    // changed the view, so the old room's snapshots aren't this camera's
    // "current" reality anymore (data is kept, just hidden visually).
    const cutoff = camera.viewChangedAt ?? 0;
    const logs = allLogs.filter(l => (l.createdAt ?? 0) >= cutoff);
    logs.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const latest = logs[0] || null;
    const modeLabel = camera.mode === 'open' ? '光明正大' : '不让 ta 知道';
    const noticedBanner = camera.discoveredAt
      ? `<div class="cctv-noticed">⚠ ${esc(character?.name || '角色')}已发现摄像头(${formatTime(camera.discoveredAt)})。</div>`
      : '';
    const roomLabel = camera.angle
      ? `${esc(camera.room)} · ${esc(camera.angle)}`
      : esc(camera.room);

    container.innerHTML = `
      <div class="page monitor-view-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">${roomLabel} · ${esc(character?.name || '(未知)')}</div>
          <div class="actions">
            <button class="cam-delete" title="删除机位">×</button>
          </div>
        </header>
        <div class="page-body">
          ${noticedBanner}
          <div class="cctv-card${latest ? '' : ' empty'}">
            <div class="cctv-noise"></div>
            <div class="cctv-top">
              <span class="cctv-rec">● REC</span>
              <span class="cctv-time">${latest ? formatTime(latest.createdAt) : '— —:— —:— —'}</span>
              <span class="cctv-room">${roomLabel}</span>
            </div>
            ${latest ? (latest.payload.outOfReach ? `
              <div class="cctv-body cctv-out-of-reach">
                <div class="cctv-posture">— 太远了 / 角度够不到 —</div>
                <div class="cctv-caption">${esc(latest.payload.caption || '镜头朝向偏了,这个角度看不到 ta。换个角度试试?')}</div>
              </div>
            ` : `
              <div class="cctv-body">
                <div class="cctv-posture">${esc(latest.payload.posture || '')}${latest.payload.posture && latest.payload.activity ? ' · ' : ''}${esc(latest.payload.activity || '')}</div>
                <div class="cctv-caption">${esc(latest.payload.caption || '')}</div>
                ${latest.payload.mood ? `<div class="cctv-mood">${esc(latest.payload.mood)}</div>` : ''}
                ${camera.mode === 'spy' && latest.payload.noticed && !camera.discoveredAt ? `<div class="cctv-mood cctv-mood-alert">!</div>` : ''}
              </div>
            `) : `
              <div class="cctv-body cctv-empty-body">
                <div class="cctv-caption">— 还没有画面 —<br>点下面的刷新拉一帧</div>
              </div>
            `}
            <div class="cctv-bottom">
              <span class="cctv-meta">${modeLabel}</span>
              <span class="cctv-meta">${esc(character?.name || '')}</span>
            </div>
          </div>
          <div class="form-actions cctv-actions">
            <button class="btn refresh-btn" type="button">${busy ? '生成中…' : '刷新画面'}</button>
          </div>
          <div class="form-actions cctv-actions">
            <button class="btn secondary change-room-btn" type="button">换机位</button>
            <button class="btn secondary change-angle-btn" type="button">转动镜头</button>
          </div>
          <label class="cam-feed-toggle">
            <input type="checkbox" class="feed-toggle"${camera.feedToChat === true ? ' checked' : ''}>
            <span class="cam-feed-label">把这台的画面同步到聊天
              <small>聊天的 system prompt 会注入「# 角色当前活动」(只描述 ta 在做什么,不提镜头)。需要总开关在 设置 → 聊天注入 也打开。</small>
            </span>
          </label>
          <p class="hint">每次刷新会调一次 AI 生成一帧。模式 = <b>${modeLabel}</b>(${camera.mode === 'open' ? '角色知道镜头' : '角色不知道'})。换机位 / 转动镜头会让之前的画面记录在 UI 上隐藏(数据保留)。</p>
        </div>
      </div>
    `;
    if (busy) container.querySelector('.refresh-btn').disabled = true;
  }

  await render();

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    if (e.target.closest('.cam-delete')) {
      if (!await openConfirm(container, {
        title: '删除机位',
        message: '删除这个机位?画面历史也会一起删。',
        confirmLabel: '删除',
        danger: true,
      })) return;
      const logs = await db.query('activityLog', 'cameraId', cameraId);
      for (const l of logs) await db.del('activityLog', l.id);
      await db.del('cameras', cameraId);
      router.back();
      return;
    }
    if (e.target.closest('.change-room-btn')) {
      await openChangeRoomModal(container, cameraId, render);
      return;
    }
    if (e.target.closest('.change-angle-btn')) {
      await openChangeAngleModal(container, cameraId, render);
      return;
    }
    const feedTgl = e.target.closest('.feed-toggle');
    if (feedTgl) {
      const cam = await db.get('cameras', cameraId);
      if (cam) {
        cam.feedToChat = feedTgl.checked;
        await db.set('cameras', cam);
      }
      return;
    }
    if (e.target.closest('.refresh-btn') && !busy) {
      busy = true;
      await render();
      try {
        await surveillance.generateSnapshot(cameraId);
      } catch (err) {
        await openAlert(container, { title: '生成画面失败', message: String(err).slice(0, 300), danger: true });
      } finally {
        busy = false;
        await render();
      }
    }
  };
  container.addEventListener('click', onClick);

  return () => {
    container.removeEventListener('click', onClick);
  };
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Change room: keeps the same camera (and mode) but moves it to a different
// room. Open mode re-runs proposeRooms (excluding the current room) so the
// AI can again refuse if density is excessive. Spy mode lets the user type
// freely. Clears `angle` (a new room invalidates old angles) and stamps
// viewChangedAt so the snapshot UI hides the pre-move logs.
async function openChangeRoomModal(container, cameraId, onDone) {
  const camera = await db.get('cameras', cameraId);
  if (!camera) return;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  container.appendChild(modal);

  async function applyNewRoom(newRoom) {
    const room = String(newRoom || '').trim();
    if (!room || room === camera.room) { modal.remove(); return; }
    camera.room = room;
    camera.angle = null;
    camera.viewChangedAt = Date.now();
    await db.set('cameras', camera);
    modal.remove();
    await onDone();
  }

  if (camera.mode === 'open') {
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">换机位 · 光明正大</div>
        <p class="hint">AI 在重新基于角色人设思考 ta 同意的房间(会排除当前的 ${esc(camera.room)})...</p>
        <div class="form-status">调用中…</div>
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
        </div>
      </div>
    `;
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    let rooms = null;
    try {
      rooms = await surveillance.proposeRooms(camera.characterId, { excludeRoom: camera.room });
    } catch (e) {
      modal.querySelector('.form-status').textContent = `失败:${String(e).slice(0, 200)}`;
      modal.querySelector('.form-status').className = 'form-status error';
      return;
    }
    if (Array.isArray(rooms) && rooms.length === 0) {
      modal.innerHTML = `
        <div class="modal">
          <div class="modal-header">ta 摇头</div>
          <p class="hint">ta 觉得家里已经装够了,不愿意再换地方。这台留在 ${esc(camera.room)} 吧。</p>
          <div class="modal-actions">
            <button type="button" class="btn cancel-btn">好</button>
          </div>
        </div>
      `;
      modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
      return;
    }
    if (!rooms) {
      modal.querySelector('.form-status').textContent = '没拿到结果,稍后再试';
      modal.querySelector('.form-status').className = 'form-status error';
      return;
    }
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">换机位 · 光明正大</div>
        <p class="hint">挑一个新房间(ta 已同意):</p>
        <div class="room-pick">
          ${rooms.map(r => `<button class="room-chip" data-room="${esc(r)}">${esc(r)}</button>`).join('')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
        </div>
      </div>
    `;
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelectorAll('[data-room]').forEach(chip => {
      chip.addEventListener('click', () => applyNewRoom(chip.dataset.room));
    });
  } else {
    // spy mode — free text
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">换机位 · 不让 ta 知道</div>
        <p class="hint">物理换地方,ta 可能会因为家里东西被动过而察觉。当前:${esc(camera.room)}。</p>
        <form class="spy-room-form" autocomplete="off">
          <label>
            <div class="label-text">新房间</div>
            <input name="room" type="text" required placeholder="比如:卧室 / 浴室 / 玄关">
          </label>
          <div class="room-pick">
            ${['卧室','客厅','浴室','书房','厨房'].map(r => `<button type="button" class="room-chip" data-room="${esc(r)}">${esc(r)}</button>`).join('')}
          </div>
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">取消</button>
            <button type="submit" class="btn">换</button>
          </div>
        </form>
      </div>
    `;
    const input = modal.querySelector('input[name="room"]');
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelectorAll('[data-room]').forEach(chip => {
      chip.addEventListener('click', () => { input.value = chip.dataset.room; });
    });
    modal.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      applyNewRoom(input.value);
    });
  }
}

// Change angle: turn the camera within the same room. Two paths — AI
// recommend (proposeAngles), or user types one in. spy mode there's a
// small noise risk; we don't UI-warn separately (the model handles it via
// the viewChangedAt-just-happened hint in generateSnapshot).
async function openChangeAngleModal(container, cameraId, onDone) {
  const camera = await db.get('cameras', cameraId);
  if (!camera) return;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  container.appendChild(modal);

  async function applyNewAngle(newAngle) {
    const angle = String(newAngle || '').trim();
    if (!angle) { modal.remove(); return; }
    camera.angle = angle;
    camera.viewChangedAt = Date.now();
    await db.set('cameras', camera);
    modal.remove();
    await onDone();
  }

  function renderPick() {
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">转动镜头 · ${esc(camera.room)}</div>
        <p class="hint">${camera.angle ? `当前角度:${esc(camera.angle)}。` : '当前没有具体角度。'}选 AI 推荐,或直接自己填。</p>
        <div class="mode-pick">
          <button class="mode-card" data-pick="ai">
            <div class="mode-title">AI 推荐</div>
            <div class="mode-desc">基于角色人设 + 房间,给你 3-4 个合理的镜头朝向。</div>
          </button>
          <button class="mode-card" data-pick="manual">
            <div class="mode-title">自己填</div>
            <div class="mode-desc">想拍哪儿你说了算。</div>
          </button>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">取消</button>
        </div>
      </div>
    `;
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('[data-pick="ai"]').addEventListener('click', () => renderAI());
    modal.querySelector('[data-pick="manual"]').addEventListener('click', () => renderManual());
  }

  async function renderAI() {
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">转动镜头 · AI 推荐</div>
        <p class="hint">基于人设 + ${esc(camera.room)} 思考可能的角度...</p>
        <div class="form-status">调用中…</div>
        <div class="modal-actions">
          <button type="button" class="btn secondary back-btn">‹ 返回</button>
          <button type="button" class="btn secondary cancel-btn">取消</button>
        </div>
      </div>
    `;
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('.back-btn').addEventListener('click', renderPick);
    let angles = null;
    try {
      angles = await surveillance.proposeAngles(camera.characterId, camera.room);
    } catch (e) {
      modal.querySelector('.form-status').textContent = `失败:${String(e).slice(0, 200)}`;
      modal.querySelector('.form-status').className = 'form-status error';
      return;
    }
    if (!angles || angles.length === 0) {
      modal.querySelector('.form-status').textContent = '没拿到结果,直接自己填吧';
      modal.querySelector('.form-status').className = 'form-status error';
      return;
    }
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">转动镜头 · AI 推荐</div>
        <p class="hint">挑一个角度:</p>
        <div class="room-pick">
          ${angles.map(a => `<button class="room-chip" data-angle="${esc(a)}">${esc(a)}</button>`).join('')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn secondary back-btn">‹ 返回</button>
          <button type="button" class="btn secondary cancel-btn">取消</button>
        </div>
      </div>
    `;
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('.back-btn').addEventListener('click', renderPick);
    modal.querySelectorAll('[data-angle]').forEach(chip => {
      chip.addEventListener('click', () => applyNewAngle(chip.dataset.angle));
    });
  }

  function renderManual() {
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">转动镜头 · 自己填</div>
        <form class="angle-form" autocomplete="off">
          <label>
            <div class="label-text">镜头朝向 / 视角</div>
            <input name="angle" type="text" required placeholder="比如:对着床头 / 扫客厅 / 对着书桌" value="${esc(camera.angle || '')}">
          </label>
          <div class="modal-actions">
            <button type="button" class="btn secondary back-btn">‹ 返回</button>
            <button type="submit" class="btn">转</button>
          </div>
        </form>
      </div>
    `;
    modal.querySelector('.back-btn').addEventListener('click', renderPick);
    modal.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = modal.querySelector('input[name="angle"]').value;
      applyNewAngle(v);
    });
  }

  renderPick();
}
