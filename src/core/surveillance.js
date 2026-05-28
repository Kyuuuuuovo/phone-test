// Surveillance / 监控 module.
//
// Two entry points used by the monitor UI:
//   generateSnapshot(cameraId) — pull a fresh "camera frame" for an existing
//     camera. Builds a small, single-purpose system prompt (NOT the full
//     buildSystemPrompt), runs the active AI config at temperature 0.4, and
//     persists one activityLog row. If the camera is in spy mode and the
//     model returns noticed=true, flips camera.discoveredAt — the spy
//     channel is now blown.
//   proposeRooms(characterId) — for 光明正大 mode only. Asks the AI to
//     propose 3-4 rooms this character would agree to have a camera placed
//     in, returned as a plain JSON string array. The UI offers these as
//     picks instead of letting the user type.
//
// Why a separate prompt path:
//   buildSystemPrompt is tuned for chat — it injects 对话规范, 动作使用规约,
//   action schemas, persona-driven framing. For surveillance we want a
//   short, structured-output prompt that produces JSON with a fixed schema.
//   Reusing buildSystemPrompt would drag in the entire action protocol the
//   model would then try to satisfy on top of the camera output. Keep
//   surveillance lean.
//
// Mode injection (CLAUDE.md 铁律 9 — state = fact, not feature toggle):
//   - open:「角色知道这里有一台摄像头,接受你能看到 ta」
//   - spy: 「角色不知道这里被装了摄像头,处于无防备状态」
//   Same generation pipeline; the only difference is this fact-line. The
//   model decides how the character reacts based on persona.

import * as db from './db.js';
import * as ai from './ai.js';
import * as context from './context.js';
import { buildScheduleLines } from './context.js';
import { parseTolerantJSON } from './util.js';

// Per-camera activityLog cap. Each refresh appends one row; without
// pruning a daily-checked camera grows to thousands over a year. Keep
// the most recent N, drop the rest after each new write. 50 is plenty
// for the monitor-view's "history" usage (it only renders latest anyway).
const ACTIVITY_LOG_KEEP = 50;

const SNAPSHOT_SYS = `你是角色的实时监控生成器。基于角色的人设、当前的时间和行程、最近的对话上下文、摄像头所在的房间和模式,生成一帧"摄像头画面"的结构化描述。

只输出一个合法 JSON 对象,绝对不要任何 JSON 以外的文字、不要 markdown 代码块包裹。

字段:
- location: 字符串,角色此刻所在的具体位置(应与摄像头所在房间一致或在同一个房间的某个角落)
- posture: 字符串,简短姿态描述(2-8 字,例如"蜷在床头"、"靠窗站着")
- activity: 字符串,正在做的事(简短,2-12 字,例如"刷手机"、"切菜")
- mood: 字符串,情绪状态(1-4 字,例如"烦躁"、"放空"、"专注")
- caption: 字符串,一句监控字幕风格的画面旁白(15-40 字,客观描述而非角色心声)
- noticed: 布尔值。仅当摄像头处于偷窥模式且角色此刻确实察觉到了被偷拍(扫到镜头、注意到不对的物件)时为 true,否则 false。光明正大模式下永远为 false
- outOfReach: 布尔值。仅当用户填的"角度"明显超出摄像头物理能拍到的范围(例如卧室摄像头想"对着小区门口"、客厅镜头要"看楼上卧室")才为 true;其他情况一律 false。如果 true,location/posture/activity/mood 可以留空字符串,caption 写一句解释"够不到"的话(类似"镜头方向偏了,这个角度看不到 ta 在哪")

要求:
- 画面必须与"当前时间"和"最近行程"一致(刚说去洗澡就不要出现在公司)
- 必须与"最近聊天"对得上(刚在聊天里说累了,画面不该是精神百倍)
- 偷窥模式下,noticed 由你按风险与人设决定(角色多敏感、机位多隐蔽、最近 ta 是否在该房间长时间停留),不要每次都 noticed=true,但合理时该 flip 就 flip
- outOfReach 是物理判定 — 角度是否可达,跟人设无关。绝大多数 angle 都能拍到(房间内的常规角度),保守判定,只在用户填的 angle 明显是"另一个房间 / 另一栋楼 / 室外远景"时才 true
- caption 用观察者口吻,不要写角色心理活动,写"看得见的"
- 不要解释、不要前缀、不要后缀,只输出 JSON 对象本身`;

const PROPOSE_ROOMS_SYS = `你是房间推荐助手。基于人物的人设,列出 3-4 个 ta 会同意再装一台摄像头的房间或空间。

只输出一个合法 JSON 字符串数组,绝对不要任何 JSON 以外的文字、不要 markdown 包裹。

要求:
- 每个房间名 2-6 字(例如"客厅"、"书房"、"玄关")
- 优先公共/半公共空间(ta 会接受);避开过度私密的(浴室、更衣间)除非人设明显有此倾向
- 不要重复推荐已经装过的房间(用户消息里会告诉你 ta 家已经装了哪些公开摄像头)
- 如果家里已经装了不少摄像头、ta 已经不耐烦了/觉得没必要再装,直接返回空数组 [] 表示 ta 拒绝再装,不要强凑数
- 数组里 3-4 个元素(拒绝时为空数组),不要超过 4 个
- 只输出数组本身`;

const PROPOSE_ANGLES_SYS = `你是摄像头角度推荐助手。基于人物的人设 + 摄像头所在的房间,列出 3-4 个合理的镜头朝向/视角。

只输出一个合法 JSON 字符串数组,绝对不要任何 JSON 以外的文字、不要 markdown 包裹。

要求:
- 每个角度 4-10 字,简短可读(例如"对着床头"、"扫整个客厅"、"对着书桌"、"对着窗外街景")
- 跟房间相关(卧室别给"对着炉灶")
- 偏向"角色会希望被拍到/不在意的角度";避开过度暴露(如果人设特别允许例外)
- 数组里 3-4 个元素,不要超过 4 个
- 只输出数组本身`;

const RECENT_CHAT_LINES = 8;  // last N msgs from any active session for this char

// Pick the most recent chat lines across all this character's sessions, so
// the snapshot prompt has context for "what just happened in this story".
// We deliberately keep this small — the snapshot is a momentary frame, not
// a continuation; just enough to anchor it in the current thread.
async function recentChatContext(characterId) {
  const allSessions = await db.query('chatSessions', 'characterId', characterId);
  if (allSessions.length === 0) return '';
  // Newest session by lastMessageAt
  allSessions.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  const sess = allSessions[0];
  const msgs = await db.query('chatMessages', 'sessionId', sess.id);
  const active = msgs.filter(m => !m.archived).sort((a, b) => a.createdAt - b.createdAt);
  const recent = active.slice(-RECENT_CHAT_LINES);
  return recent.map(m => {
    const who = m.role === 'user' ? '用户' : '角色';
    const txt = (m.actions || []).map(a => {
      if (a.type === 'text' || a.type === 'reply') return a.content;
      if (a.type === 'voice') return `[语音]${a.content || ''}`;
      if (a.type === 'image') return `[图片]${a.description || ''}`;
      if (a.type === 'location') return `[位置]${a.name || ''}`;
      if (a.type === 'recall') return '[撤回了一条]';
      return `[${a.type}]`;
    }).filter(Boolean).join(' ');
    return `${who}:${txt}`;
  }).join('\n');
}

// (scheduleLinesFor used to live here as a near-copy of
// context.buildScheduleLines. context.js now exports the helper so we just
// import it — single source of truth for the [-6h, +24h] window logic.)

// Resolve a display name for "the user" to reference in the surveillance
// prompt. Persona binding lives on chatSessions, not on the camera — so
// we look up the most-recent session for this character to get its
// personaId. Fallback: settings.activePersonaId (the "current persona"
// the user picks in 我 → 当前人设). Final fallback: the literal "用户".
async function activePersonaNameFor(characterId) {
  const allSessions = await db.query('chatSessions', 'characterId', characterId);
  allSessions.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  for (const sess of allSessions) {
    if (sess.personaId) {
      const p = await db.get('personas', sess.personaId);
      if (p?.name) return p.name;
    }
  }
  const settings = await db.get('settings', 'default');
  if (settings?.activePersonaId) {
    const p = await db.get('personas', settings.activePersonaId);
    if (p?.name) return p.name;
  }
  return '用户';
}

function modeFactLine(camera, character) {
  const name = character?.name || '角色';
  if (camera.mode === 'open') {
    return `${name}知道【${camera.room}】这里装了一台摄像头,接受你能看到 ta。`;
  }
  return `${name}并不知道【${camera.room}】这里被装了一台摄像头,目前处于无防备状态。`;
}

function nowLine() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `当前时间:${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${['日','一','二','三','四','五','六'][d.getDay()]}`;
}

function parseSnapshotJSON(raw) {
  return parseTolerantJSON(raw, { expect: 'object' });
}

function parseRoomsJSON(raw) {
  const arr = parseTolerantJSON(raw, { expect: 'array' });
  if (!arr) return null;
  return arr.map(String).filter(Boolean);
}

// Pull a fresh camera frame. Persists one activityLog row + flips
// camera.discoveredAt if spy mode and the model decided noticed=true.
// Returns the parsed payload (or throws on AI failure / unparseable).
export async function generateSnapshot(cameraId) {
  const camera = await db.get('cameras', cameraId);
  if (!camera) throw new Error(`generateSnapshot: camera ${cameraId} not found`);
  const character = await db.get('characters', camera.characterId);
  if (!character) throw new Error(`generateSnapshot: character ${camera.characterId} not found`);

  const persona  = (character.persona || '').trim();
  const schedule = await buildScheduleLines(character.id, null, {
    userName,
    charName: character.name,
  });
  const recent   = await recentChatContext(character.id);
  const modeFact = modeFactLine(camera, character);
  const userName = await activePersonaNameFor(character.id);
  const discoveredHint = camera.discoveredAt
    ? `\n注意:${character.name || '角色'}早些时候已经发现过${userName}装了这台摄像头(在 ${new Date(camera.discoveredAt).toLocaleString('zh-CN')})。这台摄像头之后的画面应该反映这件事 — 怎么反映由人设决定,不要替 ta 决定情绪走向。`
    : '';
  // If the user just changed the room or angle (within the last 60s), the
  // model should weigh "did the character notice the shift" — moving an
  // installed camera physically takes effort, turning it remotely makes
  // small noises, both can blow a spy cover. Open mode this is informational
  // (the character knew about the camera already); the model still uses it
  // for caption flavor.
  const justChanged = camera.viewChangedAt && (Date.now() - camera.viewChangedAt < 60_000);
  const justChangedHint = justChanged
    ? `\n注意:这台摄像头刚刚(${Math.round((Date.now() - camera.viewChangedAt) / 1000)} 秒内)被人为换过机位/转过角度。${camera.mode === 'spy' ? `${character.name || '角色'}可能因为听见声音、注意到家里东西被动过、或扫到了镜头本身而察觉,你按风险与人设判断 noticed。` : `${character.name || '角色'}知道有摄像头,所以会自然意识到角度变了,可能看一眼镜头、调整自己的姿态、或不在意。`}`
    : '';
  const angleLine = camera.angle ? `\n角度:${camera.angle}` : '';

  const userMsg = [
    nowLine(),
    '',
    '# 角色',
    persona || '(无设定)',
    '',
    schedule ? `# 当前行程\n${schedule}` : '',
    recent   ? `# 最近聊天\n${recent}` : '',
    `# 摄像头机位\n房间:${camera.room}${angleLine}\n模式:${camera.mode === 'open' ? '光明正大(已告知)' : '偷窥(未告知)'}`,
    `# 世界事实\n${modeFact}${discoveredHint}${justChangedHint}`,
  ].filter(Boolean).join('\n\n');

  const raw = await ai.callAI({
    systemPrompt: SNAPSHOT_SYS,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.4,
  });
  const payload = parseSnapshotJSON(raw);
  if (!payload) throw new Error(`监控生成失败:模型未返回合法 JSON\n原文:${raw.slice(0, 300)}`);

  // Defensive defaults — pad missing fields rather than render undefined cells.
  const safe = {
    location: String(payload.location || camera.room),
    posture:  String(payload.posture  || ''),
    activity: String(payload.activity || ''),
    mood:     String(payload.mood     || ''),
    caption:  String(payload.caption  || ''),
    noticed:  camera.mode === 'spy' ? !!payload.noticed : false,
    outOfReach: !!payload.outOfReach,
  };

  const now = Date.now();
  await db.set('activityLog', {
    id: db.newId(),
    cameraId: camera.id,
    characterId: character.id,
    sessionId: null,
    payload: safe,
    createdAt: now,
  });

  // Prune: keep only the most-recent ACTIVITY_LOG_KEEP rows per camera.
  // Done on every write so the table stays bounded — no separate sweep.
  // Cheap because the per-camera count is small (50 cap) and we already
  // have an index on cameraId.
  const allLogs = await db.query('activityLog', 'cameraId', camera.id);
  if (allLogs.length > ACTIVITY_LOG_KEEP) {
    allLogs.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    for (const old of allLogs.slice(ACTIVITY_LOG_KEEP)) {
      await db.del('activityLog', old.id);
    }
  }

  // Spy mode + noticed flips the camera into "discovered" state (sticky —
  // we don't unset it on later snapshots). Once discovered, future snapshots
  // get the discoveredHint above so the model knows the world has changed.
  if (camera.mode === 'spy' && safe.noticed && !camera.discoveredAt) {
    camera.discoveredAt = now;
    await db.set('cameras', camera);
  }

  return safe;
}

// Ask the AI for 3-4 rooms this character would consent to having a camera
// in. Used by 光明正大 mode for both add-camera and change-room flows.
//
// Now passes the rooms this character ALREADY has open cameras in (and the
// count) so the model can:
//   1. avoid recommending duplicates
//   2. return an empty array [] to mean "ta refuses to let you add more"
//      when density is already excessive (the UI then shows a "ta 摇头"
//      card instead of fabricating yet more rooms)
//
// `excludeRoom` lets the change-room flow exclude the camera's current
// room from "already installed" (so when changing a room, the AI can
// suggest the same set minus the one we're replacing).
//
// Empty array from the AI is a real signal — we propagate it, not fall back
// to placeholder rooms.
export async function proposeRooms(characterId, opts = {}) {
  const { excludeRoom = null } = opts;
  const character = await db.get('characters', characterId);
  if (!character) throw new Error(`proposeRooms: character ${characterId} not found`);

  const existing = (await db.query('cameras', 'characterId', characterId))
    .filter(c => c.mode === 'open')
    .map(c => c.room)
    .filter(r => r !== excludeRoom);

  const existingLine = existing.length === 0
    ? '当前 ta 家里还没有装任何公开摄像头。'
    : `当前 ta 家里已经装了 ${existing.length} 台公开摄像头,分别在:${existing.join('、')}。不要重复推荐这些房间。`;

  const userMsg = `角色:${character.name || '(未命名)'}\n人设:\n${character.persona || '(无)'}\n\n${existingLine}`;
  let raw;
  try {
    raw = await ai.callAI({
      systemPrompt: PROPOSE_ROOMS_SYS,
      messages: [{ role: 'user', content: userMsg }],
      temperature: 0.4,
    });
  } catch (e) {
    console.warn('[surveillance] proposeRooms AI call failed, using fallback:', e);
    return ['客厅', '书房', '玄关'].filter(r => !existing.includes(r));
  }
  const arr = parseRoomsJSON(raw);
  // null = parse failure → fall back. [] = AI explicitly refused → propagate.
  if (arr === null) return ['客厅', '书房', '玄关'].filter(r => !existing.includes(r));
  return arr.slice(0, 4);
}

// Ask the AI for 3-4 reasonable camera angles for the given character +
// room. Used by the 转动镜头 flow when the user picks "AI 推荐". Same
// fallback semantics as proposeRooms: parse failure → defaults, explicit
// [] → propagate (though "no angles" is less meaningful than "no rooms",
// the UI treats empty array as "let user type one in manually").
export async function proposeAngles(characterId, room) {
  const character = await db.get('characters', characterId);
  if (!character) throw new Error(`proposeAngles: character ${characterId} not found`);
  const userMsg = `角色:${character.name || '(未命名)'}\n人设:\n${character.persona || '(无)'}\n\n摄像头所在房间:${room}`;
  let raw;
  try {
    raw = await ai.callAI({
      systemPrompt: PROPOSE_ANGLES_SYS,
      messages: [{ role: 'user', content: userMsg }],
      temperature: 0.4,
    });
  } catch (e) {
    console.warn('[surveillance] proposeAngles AI call failed, using fallback:', e);
    return [`扫整个${room}`, '对着主要活动区', '对着门'];
  }
  const arr = parseRoomsJSON(raw);  // same JSON-array parser
  if (arr === null) return [`扫整个${room}`, '对着主要活动区', '对着门'];
  return arr.slice(0, 4);
}
