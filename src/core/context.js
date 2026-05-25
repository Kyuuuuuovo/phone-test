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

本轮可用的动作类型如下,每种类型给出 schema:

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

// Build the system prompt for one session.
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
//   9. # 对话规范                  (humanizer constant, if non-empty)
//   ④ 动作使用规约
//  10. # 动作使用规约               (behavior constant, if non-empty — WHEN to use which action)
//  (per-turn hook)
//  11. # 用户本轮使用的功能定义     (optional featureContext arg — set per-turn)
//   ⑤ 输出格式数量约束
//  12. OUTPUT_COUNT_SPEC          (JSON-only + count constraints, always)
//   ⑥ 动作定义表
//  13. ACTION_SCHEMAS_TEXT        (per-action JSON schemas + example, always last)
export async function buildSystemPrompt(sessionId, { featureContext } = {}) {
  const session = await db.get('chatSessions', sessionId);
  if (!session) throw new Error(`buildSystemPrompt: session ${sessionId} not found`);

  const character = await db.get('characters', session.characterId);
  if (!character) throw new Error(`buildSystemPrompt: character ${session.characterId} not found`);

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
  memories.sort((a, b) => a.createdAt - b.createdAt);

  // Author-locked meta constants — NOT visible to end users. See CLAUDE.md 铁律 10.
  const humanizer = (HUMANIZER_PROMPT  ?? '').trim();
  const behavior  = (BEHAVIOR_GUIDANCE ?? '').trim();

  const parts = [];
  // 1. Framing — who you are, who you're talking to.
  const charName = character.name || '(未命名角色)';
  const userName = persona?.name || null;
  parts.push(userName
    ? `你是【${charName}】,正在与【${userName}】聊天。`
    : `你是【${charName}】,正在跟一位用户聊天。`);
  // 2. 角色设定
  // 2. 世界观(前置)
  if (wbBy.before.length > 0) {
    parts.push(`# 世界观 / 背景设定(前置)\n\n${wbBy.before.join('\n\n')}`);
  }
  // 3. 角色设定
  parts.push(`# 角色设定\n\n${character.persona || character.name || '(无设定)'}`);
  // 4. 世界观(默认)
  if (wbBy.inline.length > 0) {
    parts.push(`# 世界观 / 背景设定\n\n${wbBy.inline.join('\n\n')}`);
  }
  // 5. 用户人设
  if (persona) {
    parts.push(`# 用户人设\n\n${persona.persona || persona.name || '(未填写)'}`);
  }
  // 6. 世界观(后置) — placed AFTER the user persona, so 'after' is a
  // meaningfully different slot from 'inline' (which is right after the
  // character setting). Labelled 「用户人设后」 in the editor.
  if (wbBy.after.length > 0) {
    parts.push(`# 世界观 / 背景设定(用户人设后)\n\n${wbBy.after.join('\n\n')}`);
  }
  // 7. 过往记忆
  if (memories.length > 0) {
    parts.push(`# 过往记忆(由老到新)\n\n${memories.map(m => m.summary).join('\n\n')}`);
  }
  // 8. 当前社交状态
  if (character.blocked) {
    parts.push(`# 当前社交状态\n\n注意:你目前已被对方加入黑名单。这是该 app 内的关系状态,具体如何反应由你的人设决定。`);
  }
  // 8b. 当前行程 — schedule entries near the current time (past 6h to next 24h).
  // Two buckets: events on user's calendar (so the AI knows what you're up to)
  // and events on this character's own calendar (so the AI stays consistent
  // with its own day). Past events get marked "(已过)", current "(进行中)",
  // future just shown with time.
  const scheduleLines = await buildScheduleLines(character.id);
  if (scheduleLines) parts.push(`# 当前行程\n\n${scheduleLines}`);
  // 9. 对话规范
  if (humanizer) {
    parts.push(`# 对话规范\n\n${humanizer}`);
  }
  // 10. 动作使用规约 — WHEN / in what context to use each action.
  //     Boundary: action-context spec, NOT character-behavior steering.
  if (behavior) {
    parts.push(`# 动作使用规约\n\n${behavior}`);
  }
  // 11. 用户本轮使用的功能定义 (per-turn hook — caller passes featureContext to describe what app
  //     feature triggered this AI call, e.g. voice button / transfer button).
  const fc = (featureContext ?? '').trim();
  if (fc) {
    parts.push(`# 用户本轮使用的功能定义\n\n${fc}`);
  }
  // 12. 输出数量约束 + 只输 JSON 数组
  parts.push(OUTPUT_COUNT_SPEC);
  // 13. 动作定义表(每种动作的 JSON schema + 示例)
  parts.push(ACTION_SCHEMAS_TEXT);
  return parts.join('\n\n---\n\n');
}

// Schedule entries near current time, formatted as text lines for prompt
// injection. Returns '' if nothing relevant. Window: past 6h → next 24h.
async function buildScheduleLines(characterId) {
  const all = await db.getAll('schedule');
  if (all.length === 0) return '';
  const now = Date.now();
  const winStart = now - 6 * 60 * 60 * 1000;
  const winEnd   = now + 24 * 60 * 60 * 1000;
  const relevant = all
    .filter(e => {
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

// Pull the most recent `maxRecent` chat messages, formatted as OpenAI-style messages.
export async function buildMessageHistory(sessionId, maxRecent = 40) {
  const all = await db.query('chatMessages', 'sessionId', sessionId);
  all.sort((a, b) => a.createdAt - b.createdAt);
  const recent = all.slice(-maxRecent);
  return recent.map(toApiMessage);
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
//   memoryThreshold     → defaults to 20 if unset
// Session-level override:
//   session.memoryPromptOverride → appended to DEFAULT_MEMORY_SYS as
//   「# 风格补充」 so the model keeps the structural rules but adopts the
//   user's preferred tone.
export async function maybeCompressMemory(sessionId) {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.memoryEnabled === false) return null;
  const threshold = Number.isFinite(settings.memoryThreshold) && settings.memoryThreshold > 0
    ? settings.memoryThreshold : 20;

  const all = await db.query('chatMessages', 'sessionId', sessionId);
  if (all.length <= threshold) return null;
  all.sort((a, b) => a.createdAt - b.createdAt);
  // Compress everything older than the most-recent `threshold` messages.
  const overflow = all.slice(0, all.length - threshold);
  if (overflow.length === 0) return null;

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
    summary: summary.trim(),
    fromMsgId: overflow[0].id,
    toMsgId: overflow[overflow.length - 1].id,
    createdAt: Date.now(),
  });
  for (const msg of overflow) await db.del('chatMessages', msg.id);
  return memId;
}

// Exported for the memory-manage page so it can show users the default it's
// extending when they edit the session-level override.
export { DEFAULT_MEMORY_SYS };
