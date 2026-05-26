// System prompt assembly and long-conversation memory compression.

import * as db from './db.js';
import * as ai from './ai.js';
import { HUMANIZER_PROMPT } from './humanizer.js';
import { BEHAVIOR_GUIDANCE } from './behavior.js';

// Output format constraints — split into two segments so they sit at different
// positions in the prompt: count + JSON-only rule first (before per-turn data),
// schema table last (right before the model generates). Both are stable text.

export const OUTPUT_COUNT_SPEC = `# 输出格式严格约束

你必须只返回一个合法的 JSON 数组,数组里每个元素是一个动作对象,绝对不要返回任何 JSON 数组以外的文本(无解释、无 markdown 代码块包裹、无前后多余字符)。

# 数量约束

至少 1 条,通常 1-5 条,如有必要可以更多。`;

export const ACTION_SCHEMAS_TEXT = `# 动作定义表

本轮可用的动作类型如下,每种类型给出 schema。

所有动作可选带一个 from 字段(string),用来在群聊场景标明发言人(对应群成员的名字)。单聊场景下省略不填。当前是单聊,可忽略 from 字段。

动作类型:

1. text — 普通文本消息
   { "type": "text", "content": "..." }

2. reply — 引用回复(quoteMsgId 是被引用消息的 id,从历史里找;quoteMsgId 可省略)
   { "type": "reply", "content": "...", "quoteMsgId": "..." }

3. recall — 撤回(可选 targetMsgId;省略则撤回你刚刚发出的上一条)
   { "type": "recall", "targetMsgId": "..." }

4. image — 发送图片(只给描述文字,前端按描述渲染)
   { "type": "image", "description": "..." }

5. voice — 语音条(content 是文字内容,duration 是估算秒数,可省略)
   { "type": "voice", "content": "...", "duration": 8 }

6. unblock_request — 请求对方解除拉黑(content 是你想对对方说的话;前端会渲染成一个让用户决定是否同意的按钮)
   { "type": "unblock_request", "content": "..." }

7. red_packet — 发红包(amount 是金额数字,以元为单位,可带两位小数;message 是封皮上的祝福语,可省略。前端渲染成可点击「领取」的红包卡片)
   { "type": "red_packet", "amount": 5.20, "message": "恭喜发财" }

8. transfer — 转账(amount 是金额数字,以元为单位;message 是转账说明,可省略。前端渲染成可点击「接收」的转账卡片。相比红包,语气更郑重)
   { "type": "transfer", "amount": 100, "message": "上次的饭钱" }

9. location — 发送地点(name 是地点名,desc 可选用作地址 / 短描述。前端渲染成带定位图标的卡片,纯展示)
   { "type": "location", "name": "外滩", "desc": "黄浦江边" }

你可以在一个数组里发多条动作(用来断句、补刀、撤回等)。

示例(只是示例,不要照抄):
[
  { "type": "text", "content": "在的" },
  { "type": "text", "content": "刚去倒了杯水,你说" }
]

再次强调:只输出 JSON 数组本身,不输出任何其他字符,也不要用 \`\`\`json 包裹。`;

// Build the structured part list for one session's system prompt. Each part
// is { key, title, body, kind, ... } so the prompt-inspector UI can render
// each segment, mark which ones are user-overridable, and dump the full
// joined string when needed. buildSystemPrompt below joins these parts.
//
// Section order (maps to the user-facing 6-block abstraction in CLAUDE.md):
//   ① Framing
//   1. "你是【char】,正在与【user】聊天。" (always)
//   ② 上下文(static setting + memory + state)
//   2. # 世界观 / 背景设定(前置)    (worldbook entries with position='before')
//   3. # 角色设定                  (always)
//   4. # 世界观 / 背景设定          (entries with position='inline', default)
//   5. # 用户人设                  (if a persona is linked)
//   6. # 世界观 / 背景设定(用户人设后) (entries with position='after')
//   7. # 过往记忆                  (if any memory summaries)
//   8. # 当前社交状态              (if character.blocked)
//   ③ 对话规范
//   9. # 对话规范                  (humanizer constant, override-able)
//   ④ 动作使用规约
//  10. # 动作使用规约               (behavior constant, override-able)
//  (per-turn hook)
//  11. # 用户本轮使用的功能定义     (optional featureContext arg — set per-turn)
//   ⑤ 输出格式数量约束
//  12. OUTPUT_COUNT_SPEC          (always, override-able)
//   ⑥ 动作定义表
//  13. ACTION_SCHEMAS_TEXT        (always, override-able)
//
// `kind` values:
//   'computed' — built from app state (framing line) — not editable here
//   'data'     — user data (character/persona/worldbook/memory/schedule/...);
//                editable via editRoute, not via the inspector itself
//   'override' — author-locked source constants with optional settings override
//                (humanizer, behavior, OUTPUT_COUNT_SPEC, ACTION_SCHEMAS_TEXT)
export async function buildSystemPromptParts(sessionId, { featureContext } = {}) {
  const session = await db.get('chatSessions', sessionId);
  if (!session) throw new Error(`buildSystemPromptParts: session ${sessionId} not found`);

  const character = await db.get('characters', session.characterId);
  if (!character) throw new Error(`buildSystemPromptParts: character ${session.characterId} not found`);

  const persona = session.personaId ? await db.get('personas', session.personaId) : null;

  // Group worldbook entries by injection position.
  const wbBy = { before: [], inline: [], after: [] };
  const bindings = await db.query('characterWorldbooks', 'characterId', character.id);
  bindings.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  for (const binding of bindings) {
    const entries = await db.query('worldbookEntries', 'worldbookId', binding.worldbookId);
    const enabled = entries.filter(e => e.enabled !== false);
    enabled.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    for (const entry of enabled) {
      const pos = (entry.position === 'before' || entry.position === 'after') ? entry.position : 'inline';
      // title is user-facing only — used as the row label in the editor, not
      // shown to the AI. Only content goes into the prompt.
      const c = (entry.content || '').trim();
      if (c) wbBy[pos].push(c);
    }
  }

  const memories = await db.query('memories', 'sessionId', sessionId);
  // Split memories by tier so we can inject them in two sections from
  // abstract → concrete: "# 远期记忆" (L2 chapter summaries) precede
  // "# 近期记忆" (L1 per-batch summaries) precede the raw recent messages.
  const l1Mem = memories.filter(m => (m.tier ?? 1) === 1).sort((a, b) => a.createdAt - b.createdAt);
  const l2Mem = memories.filter(m => m.tier === 2).sort((a, b) => a.createdAt - b.createdAt);

  // Settings-driven overrides for the author-locked sections. `??` (not `||`)
  // is intentional: a user-set empty string ('') means "intentionally skip
  // this section" and must NOT fall back to the source constant. Only an
  // *absent* field (undefined) falls back.
  const settings = (await db.get('settings', 'default')) || {};
  const ov  = settings.promptOverrides       || {};
  const ovo = settings.promptOutputOverrides || {};
  const humanizer   = (ov.humanizer   ?? HUMANIZER_PROMPT   ?? '').trim();
  const behavior    = (ov.behavior    ?? BEHAVIOR_GUIDANCE  ?? '').trim();
  const countSpec   = (ovo.countSpec   ?? OUTPUT_COUNT_SPEC).trim();
  const schemasText = (ovo.schemasText ?? ACTION_SCHEMAS_TEXT).trim();

  const parts = [];
  // 1. Framing — who you are, who you're talking to.
  const charName = character.name || '(未命名角色)';
  const userName = persona?.name || null;
  parts.push({
    key: 'framing',
    title: null,
    body: userName
      ? `你是【${charName}】,正在与【${userName}】聊天。`
      : `你是【${charName}】,正在跟一位用户聊天。`,
    kind: 'computed',
  });
  // 2. 世界观(前置)
  parts.push({
    key: 'wb-before',
    title: '# 世界观 / 背景设定(前置)',
    body: wbBy.before.join('\n\n'),
    kind: 'data',
    editRoute: 'worldbook-list',
  });
  // 3. 角色设定
  parts.push({
    key: 'character',
    title: '# 角色设定',
    body: character.persona || character.name || '(无设定)',
    kind: 'data',
    editRoute: 'character-detail',
    editParams: { id: character.id },
  });
  // 4. 世界观(默认)
  parts.push({
    key: 'wb-inline',
    title: '# 世界观 / 背景设定',
    body: wbBy.inline.join('\n\n'),
    kind: 'data',
    editRoute: 'worldbook-list',
  });
  // 5. 用户人设
  parts.push({
    key: 'user-persona',
    title: '# 用户人设',
    body: persona ? (persona.persona || persona.name || '(未填写)') : '',
    kind: 'data',
    editRoute: persona ? 'persona-detail' : 'persona-list',
    editParams: persona ? { id: persona.id } : undefined,
  });
  // 6. 世界观(后置)
  parts.push({
    key: 'wb-after',
    title: '# 世界观 / 背景设定(用户人设后)',
    body: wbBy.after.join('\n\n'),
    kind: 'data',
    editRoute: 'worldbook-list',
  });
  // 7. 远期 + 近期记忆
  parts.push({
    key: 'mem-l2',
    title: '# 远期记忆(章节,由老到新)',
    body: l2Mem.map(m => m.summary).join('\n\n'),
    kind: 'data',
    editRoute: 'memory-manage',
    editParams: { sessionId },
  });
  parts.push({
    key: 'mem-l1',
    title: '# 近期记忆(由老到新)',
    body: l1Mem.map(m => m.summary).join('\n\n'),
    kind: 'data',
    editRoute: 'memory-manage',
    editParams: { sessionId },
  });
  // 8. 当前社交状态
  parts.push({
    key: 'social',
    title: '# 当前社交状态',
    body: character.blocked
      ? '注意:你目前已被对方加入黑名单。这是该 app 内的关系状态,具体如何反应由你的人设决定。'
      : '',
    kind: 'data',
    editRoute: 'character-detail',
    editParams: { id: character.id },
  });
  // 8b. 当前行程
  const scheduleLines = await buildScheduleLines(character.id);
  parts.push({
    key: 'schedule',
    title: '# 当前行程',
    body: scheduleLines,
    kind: 'data',
    editRoute: 'schedule',
  });
  // 8c. 摄像头
  const cameraLines = await buildCameraLines(character.id, persona?.name);
  parts.push({
    key: 'cameras',
    title: '# 摄像头',
    body: cameraLines,
    kind: 'data',
    editRoute: 'monitor',
  });
  // 8d. 角色当前活动 — derived from activityLog. Opt-in (default off).
  //     Rule 9: the prompt body is a first-person status ("你目前的状态:
  //     卧室 · 坐在床上 · 看书"), never mentions cameras.
  const activityLine = await buildActivityLine(character.id);
  parts.push({
    key: 'activity',
    title: '# 角色当前活动',
    body: activityLine,
    kind: 'data',
    editRoute: 'monitor',
  });
  // 9. 对话规范
  parts.push({
    key: 'humanizer',
    title: '# 对话规范',
    body: humanizer,
    kind: 'override',
    overrideScope: 'promptOverrides',
    overrideKey: 'humanizer',
    defaultValue: HUMANIZER_PROMPT,
  });
  // 10. 动作使用规约 — WHEN / in what context to use each action.
  //     Boundary: action-context spec, NOT character-behavior steering.
  parts.push({
    key: 'behavior',
    title: '# 动作使用规约',
    body: behavior,
    kind: 'override',
    overrideScope: 'promptOverrides',
    overrideKey: 'behavior',
    defaultValue: BEHAVIOR_GUIDANCE,
  });
  // 11. 用户本轮使用的功能定义 (per-turn featureContext)
  const fc = (featureContext ?? '').trim();
  parts.push({
    key: 'feature',
    title: '# 用户本轮使用的功能定义',
    body: fc,
    kind: 'computed',
  });
  // 12. 输出数量约束 — title is null because countSpec already contains its
  //     own '# 输出格式严格约束' heading.
  parts.push({
    key: 'output-count',
    title: null,
    body: countSpec,
    kind: 'override',
    overrideScope: 'promptOutputOverrides',
    overrideKey: 'countSpec',
    defaultValue: OUTPUT_COUNT_SPEC,
    warning: '改这里会影响 JSON 输出契约,出错会让动作解析失败',
  });
  // 13. 动作定义表(每种动作的 JSON schema + 示例)
  parts.push({
    key: 'output-schemas',
    title: null,
    body: schemasText,
    kind: 'override',
    overrideScope: 'promptOutputOverrides',
    overrideKey: 'schemasText',
    defaultValue: ACTION_SCHEMAS_TEXT,
    warning: '改这里会影响 JSON 输出契约,出错会让动作解析失败',
  });
  return parts;
}

// Join the structured parts into one string suitable for the chat API's
// system role. Parts with empty bodies (e.g. no worldbook entries, no
// memory, no persona) are dropped — they take up no space in the prompt.
export async function buildSystemPrompt(sessionId, opts) {
  const parts = await buildSystemPromptParts(sessionId, opts);
  return parts
    .filter(p => (p.body ?? '').trim() !== '')
    .map(p => p.title ? `${p.title}\n\n${p.body}` : p.body)
    .join('\n\n---\n\n');
}

// Character's current activity — pulled from the latest activityLog row
// across the character's cameras that are feeding to chat. Pure first-
// person fact statement ("你刚才在 卧室:坐在床上看书"); deliberately
// avoids any mention of cameras / being watched.
//
// Rule 9 boundary: a spy camera with feedToChat=true that has NOT yet
// been discovered is still legal to use as a data source here — what
// the character is doing is something the character themselves knows.
// What we must NEVER inject is "you're being recorded" / "the camera
// caught you" — those phrases would break the design. Our format only
// says where they are and what they're doing, both of which the
// character is conscious of.
//
// Two-layer toggle:
//   - global: settings.syncMonitorToChat (default false — opt-in)
//   - per-camera: cameras.feedToChat (default false)
async function buildActivityLine(characterId) {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.syncMonitorToChat !== true) return '';
  const cameras = await db.query('cameras', 'characterId', characterId);
  const feeding = cameras.filter(c => c.feedToChat === true);
  if (feeding.length === 0) return '';
  // Collect latest log per camera, then pick the overall freshest.
  let latest = null;
  for (const cam of feeding) {
    const logs = await db.query('activityLog', 'cameraId', cam.id);
    const cutoff = cam.viewChangedAt ?? 0;
    const visible = logs.filter(l => (l.createdAt ?? 0) >= cutoff);
    visible.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const top = visible[0];
    if (top && (!latest || (top.createdAt ?? 0) > (latest.createdAt ?? 0))) {
      latest = top;
    }
  }
  if (!latest) return '';
  // outOfReach frames don't describe the character — skip them.
  if (latest.payload?.outOfReach) return '';
  const p = latest.payload || {};
  const parts = [];
  if (p.location) parts.push(p.location);
  if (p.posture)  parts.push(p.posture);
  if (p.activity) parts.push(p.activity);
  if (parts.length === 0) return '';
  const body = parts.join(' · ');
  // Express in first person from the character's POV — they know where
  // they are and what they're doing; they don't know we know.
  return `你目前的状态:${body}。`;
}

// Camera knowledge for the character — only includes cameras the character
// could plausibly know about:
//   - open cameras (consented at placement)
//   - spy cameras AFTER discoveredAt is set (i.e. the noticed=true moment
//     in surveillance.js flipped the world state; character now knows)
// Un-discovered spy cameras are deliberately omitted: injecting them
// would tell the character about cameras the design says they don't know
// about, breaking the whole spy/open distinction (CLAUDE.md 铁律 9).
async function buildCameraLines(characterId, userName) {
  const cameras = await db.query('cameras', 'characterId', characterId);
  if (cameras.length === 0) return '';
  const u = userName || '用户';
  const lines = [];
  const openRooms = cameras
    .filter(c => c.mode === 'open')
    .map(c => c.angle ? `${c.room}(角度:${c.angle})` : c.room);
  if (openRooms.length > 0) {
    lines.push(`${u} 在你家以下位置装了公开摄像头(你同意的,知道 ta 能从镜头看到你):\n${openRooms.map(r => '- ' + r).join('\n')}`);
  }
  const discoveredSpies = cameras.filter(c => c.mode === 'spy' && c.discoveredAt);
  for (const cam of discoveredSpies) {
    const d = new Date(cam.discoveredAt);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    // Pure fact statement — no defined consequences. How the character
    // reacts (cold war / smashed the lens / let it go) is up to persona,
    // not the system prompt. CLAUDE.md 铁律 3.
    lines.push(`你曾在 ${dateStr} 发现 ${u} 在你家 ${cam.room} 偷装了一台摄像头。`);
  }
  return lines.join('\n\n');
}

// Schedule entries near current time, formatted as text lines for prompt
// injection. Returns '' if nothing relevant. Window: past 6h → next 24h.
//
// Two-layer toggle (CLAUDE.md 铁律 12):
//   - global: settings.syncScheduleToChat (default true) — turns the whole
//     # 当前行程 segment on / off
//   - per-entry: schedule.syncToChat (default true) — lets the user mute
//     specific entries without disabling the whole feature
async function buildScheduleLines(characterId) {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.syncScheduleToChat === false) return '';
  const all = await db.getAll('schedule');
  if (all.length === 0) return '';
  const now = Date.now();
  const winStart = now - 6 * 60 * 60 * 1000;
  const winEnd   = now + 24 * 60 * 60 * 1000;
  const relevant = all
    .filter(e => {
      if (e.syncToChat === false) return false;  // per-entry mute
      if (e.startTs < winStart || e.startTs > winEnd) return false;
      // user-bucket events always included; character-bucket only for THIS character
      if (e.who === 'character') return e.characterId === characterId;
      return e.who === 'user';
    })
    .sort((a, b) => a.startTs - b.startTs);
  if (relevant.length === 0) return '';
  const fmtTime = (ts) => {
    const d = new Date(ts);
    const day = d.toDateString() === new Date().toDateString() ? '今天' :
                d.toDateString() === new Date(now - 86400000).toDateString() ? '昨天' :
                d.toDateString() === new Date(now + 86400000).toDateString() ? '明天' :
                `${d.getMonth()+1}/${d.getDate()}`;
    return `${day} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const statusOf = (e) => {
    if (e.endTs && now >= e.startTs && now <= e.endTs) return '(进行中)';
    if (e.endTs && now > e.endTs) return '(已过)';
    if (!e.endTs && now > e.startTs) return '(已过)';
    return '';
  };
  return relevant.map(e => {
    const who = e.who === 'user' ? '用户' : '你';
    const status = statusOf(e);
    const desc = e.desc ? ` — ${e.desc}` : '';
    return `- ${who} ${fmtTime(e.startTs)}${status} ${e.title}${desc}`;
  }).join('\n');
}

// Pull the most recent `maxRecent` chat messages, formatted as OpenAI-style
// messages. Archived messages (compressed into a memory summary) are
// filtered out — the memory summary represents them in the system prompt.
// Adjacent same-role messages are merged so OpenAI-compat gateways that
// strictly enforce user/assistant alternation (oneapi, new-api etc.) don't
// 400 us when the user batches several user-turn messages before letting
// the AI reply.
export async function buildMessageHistory(sessionId, maxRecent = 40) {
  const all = await db.query('chatMessages', 'sessionId', sessionId);
  const active = all.filter(m => !m.archived);
  active.sort((a, b) => a.createdAt - b.createdAt);
  const recent = active.slice(-maxRecent);
  return collapseAdjacentSameRole(recent.map(toApiMessage));
}

// Merge consecutive messages with the same role into one, joined by a
// blank line. Only safe for plain string content — tool_calls / tool-role
// messages have structure that can't be flattened, so we leave them alone.
function collapseAdjacentSameRole(msgs) {
  const out = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last
        && last.role === m.role
        && typeof last.content === 'string'
        && typeof m.content === 'string'
        && !last.tool_calls
        && !m.tool_calls
        && last.role !== 'tool'
        && m.role !== 'tool') {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      out.push({ ...m });
    }
  }
  return out;
}

function toApiMessage(msg) {
  if (msg.role === 'character') {
    // Echo the model's own past JSON-array output verbatim — reinforces format.
    return { role: 'assistant', content: JSON.stringify(msg.actions ?? []) };
  }
  return {
    role: msg.role === 'system' ? 'system' : 'user',
    content: renderActionsAsText(msg.actions ?? []),
  };
}

function renderActionsAsText(actions) {
  return actions.map(a => {
    switch (a.type) {
      case 'text':   return a.content || '';
      case 'reply':  return a.content || '';  // model sees the quoted msg earlier in history
      case 'image':  return `[图片: ${a.description || a.src || ''}]`;
      case 'voice':  return `[语音: ${a.content || ''}]`;
      case 'recall': return `[撤回了一条消息]`;
      case 'unblock_request': return `[请求对方解除拉黑: ${a.content || ''}]`;
      case 'red_packet': {
        const tail = a.claimed ? ' (已领取)' : '';
        return `[红包 ¥${Number(a.amount || 0).toFixed(2)}${a.message ? ' · ' + a.message : ''}]${tail}`;
      }
      case 'transfer': {
        const tail = a.claimed ? ' (已接收)' : '';
        return `[转账 ¥${Number(a.amount || 0).toFixed(2)}${a.message ? ' · ' + a.message : ''}]${tail}`;
      }
      case 'location':
        return `[位置: ${a.name || ''}${a.desc ? ' · ' + a.desc : ''}]`;
      default:       return `[${a.type}]`;
    }
  }).filter(Boolean).join('\n');
}

// Default compression sys prompt. Author-locked default; the session-level
// memoryPromptOverride is appended below this so the user can tweak the
// *style* of the summary (e.g. "以日记体" / "用第三人称冷淡口吻") without
// having to re-specify the structural rules.
const DEFAULT_MEMORY_SYS = '你是对话压缩助手。把下面这段对话压成不超过 300 字的中文摘要,只保留关键信息(谁说了什么、做了什么、关系/情绪变化、约定、提到的人物或地点)。摘要不分段、不列表、不加任何前缀或解释,只输出摘要文本本身。';

// Compress oldest overflow messages into a memory summary, then delete them.
// Returns the new memory id, or null if nothing to compress.
// Behavior gated by settings:
//   memoryEnabled=false → no-op
//   memoryThreshold     → keep this many most-recent msgs uncompressed (default 20)
//   memoryBatchSize     → wait until at least this many msgs have overflowed
//                         before triggering a compression (default 10).
//                         Without this, threshold=20 + msg #21 would trigger
//                         an API call to compress a single message, then #22
//                         would trigger another, and so on — one API call per
//                         new msg. The batch lets overflow accumulate and
//                         compress in chunks (e.g. msgs 21-30 get squashed in
//                         one call when #30 arrives).
// Session-level override:
//   session.memoryPromptOverride → appended to DEFAULT_MEMORY_SYS as
//   「# 风格补充」 so the model keeps the structural rules but adopts the
//   user's preferred tone.
export async function maybeCompressMemory(sessionId) {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.memoryEnabled === false) return null;
  const threshold = Number.isFinite(settings.memoryThreshold) && settings.memoryThreshold > 0
    ? settings.memoryThreshold : 20;
  const batchSize = Number.isFinite(settings.memoryBatchSize) && settings.memoryBatchSize > 0
    ? settings.memoryBatchSize : 10;

  // Filter archived rows BEFORE the threshold check — without this, every
  // new message past threshold would re-include the already-archived rows
  // in `all`, picking the same overflow window and re-compressing the same
  // content into a brand new memory (and re-archive-stamping rows that
  // were already archived). The whole "compress once, hide" intent only
  // works when the threshold comparison is against active-only count.
  const all = (await db.query('chatMessages', 'sessionId', sessionId))
    .filter(m => !m.archived);
  if (all.length <= threshold) return null;
  all.sort((a, b) => a.createdAt - b.createdAt);
  // Compress everything older than the most-recent `threshold` messages,
  // but only once we've accumulated `batchSize` overflowed messages so we
  // don't burn an API call on each single new message past the threshold.
  const overflow = all.slice(0, all.length - threshold);
  if (overflow.length < batchSize) return null;

  const dump = overflow.map(m => {
    const speaker = m.role === 'user' ? '用户' : (m.role === 'character' ? '角色' : 'system');
    return `${speaker}: ${renderActionsAsText(m.actions ?? [])}`;
  }).join('\n');

  const session = await db.get('chatSessions', sessionId);
  const override = (session?.memoryPromptOverride || '').trim();
  const sys = override
    ? `${DEFAULT_MEMORY_SYS}\n\n# 风格补充\n${override}`
    : DEFAULT_MEMORY_SYS;

  const summary = await ai.callAI({
    systemPrompt: sys,
    messages: [{ role: 'user', content: dump }],
    temperature: 0.3,
  });

  const memId = db.newId();
  await db.set('memories', {
    id: memId,
    sessionId,
    tier: 1,
    summary: summary.trim(),
    fromMsgId: overflow[0].id,
    toMsgId: overflow[overflow.length - 1].id,
    createdAt: Date.now(),
  });
  // Mark messages as archived instead of deleting them. Keeping the rows
  // means:
  //   1. Scrolling up still shows the user the conversation history.
  //   2. favorites.msgId references stay valid (don't dangle).
  // buildMessageHistory filters archived out so the API still gets the
  // window-summary view rather than the full archive.
  for (const msg of overflow) {
    msg.archived = true;
    msg.archivedAt = Date.now();
    msg.archivedIntoMemoryId = memId;
    await db.set('chatMessages', msg);
  }
  // After L1 compression, check if tier-1 summaries themselves have piled
  // up enough to warrant a tier-2 rollup. Cheap when not needed.
  await maybeRollupToL2(sessionId);
  return memId;
}

// L2 rollup: when tier-1 summaries exceed L1_KEEP_RECENT, fold the oldest
// L1_BATCH of them into a single tier-2 章节 summary. The L2 prompt is
// different — it's "summary of summaries", so the framing emphasizes
// deduplication and preserving the emotional / relational arc rather than
// trying to capture every event again.
const L1_KEEP_RECENT = 8;
const L1_BATCH       = 4;
const DEFAULT_MEMORY_SYS_L2 = '你是对话章节合并助手。下面是同一段关系中按时间顺序的若干段已压缩的对话摘要。请把它们合并成一段不超过 400 字的中文综合摘要。\n\n要求:\n- 去重(同一件事不要在合并后重复出现)\n- 保留情感主线、关系演变、关键事件转折\n- 保留人名、地名、关键约定\n- 删掉细枝末节,聚焦弧线\n- 不分段、不列表、不加任何前缀或解释\n\n只输出合并后的摘要文本本身。';

async function maybeRollupToL2(sessionId) {
  const all = await db.query('memories', 'sessionId', sessionId);
  const l1 = all.filter(m => (m.tier ?? 1) === 1);
  if (l1.length <= L1_KEEP_RECENT) return null;
  l1.sort((a, b) => a.createdAt - b.createdAt);
  const toMerge = l1.slice(0, Math.min(L1_BATCH, l1.length - L1_KEEP_RECENT));
  if (toMerge.length < 2) return null;
  const dump = toMerge.map((m, i) => `[${i + 1}] ${m.summary}`).join('\n\n');
  let merged;
  try {
    merged = await ai.callAI({
      systemPrompt: DEFAULT_MEMORY_SYS_L2,
      messages: [{ role: 'user', content: dump }],
      temperature: 0.3,
    });
  } catch (e) {
    console.warn('[context] L2 rollup AI call failed (non-fatal):', e);
    return null;
  }
  const newId = db.newId();
  await db.set('memories', {
    id: newId,
    sessionId,
    tier: 2,
    summary: merged.trim(),
    fromMsgId: toMerge[0].fromMsgId,
    toMsgId: toMerge[toMerge.length - 1].toMsgId,
    createdAt: Date.now(),
  });
  for (const m of toMerge) await db.del('memories', m.id);
  return newId;
}

// Exported for the memory-manage page so it can show users the default it's
// extending when they edit the session-level override.
export { DEFAULT_MEMORY_SYS };
