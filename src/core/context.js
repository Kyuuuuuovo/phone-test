// System prompt assembly and long-conversation memory compression.

import * as db from './db.js';
import * as ai from './ai.js';
import { HUMANIZER_PROMPT } from './humanizer.js';

// Output format constraint appended to every system prompt.
// Forces model to return ONLY a JSON array of action objects.
export const OUTPUT_FORMAT_SPEC = `# 输出格式严格约束

你必须只返回一个合法的 JSON 数组,数组里每个元素是一个动作对象,绝对不要返回任何 JSON 数组以外的文本(无解释、无 markdown 代码块包裹、无前后多余字符)。

允许的动作类型如下,每种类型给出 schema:

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

你可以在一个数组里发多条动作(用来断句、补刀、撤回等)。

# 数量约束

至少 1 条,通常 1-5 条,如有必要可以更多。

示例(只是示例,不要照抄):
[
  { "type": "text", "content": "在的" },
  { "type": "text", "content": "刚去倒了杯水,你说" }
]

再次强调:只输出 JSON 数组本身,不输出任何其他字符,也不要用 \`\`\`json 包裹。`;

// Build the system prompt for one session.
// Section order:
//   1. Framing line              "你是【char】,正在与【user】聊天。" (always)
//   2. # 角色设定                  (always)
//   3. # 世界观 / 背景设定(前置)    (worldbook entries with position='before')
//   4. # 世界观 / 背景设定          (entries with position='inline', default — vibes next to character)
//   5. # 世界观 / 背景设定(后置)    (entries with position='after')
//   6. # 用户人设                  (if a persona is linked)
//   7. # 过往记忆                  (if any memory summaries)
//   8. # 当前社交状态              (if character.blocked)
//   9. # 对话规范                  (humanizer constant, if non-empty)
//  10. # 用户本轮使用的功能定义     (optional featureContext arg — set per-turn from outside)
//  11. OUTPUT_FORMAT_SPEC          (always last)
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
    enabled.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const entry of enabled) {
      const pos = (entry.position === 'before' || entry.position === 'after') ? entry.position : 'inline';
      wbBy[pos].push(`【${entry.title || '条目'}】\n${entry.content || ''}`);
    }
  }

  const memories = await db.query('memories', 'sessionId', sessionId);
  memories.sort((a, b) => a.createdAt - b.createdAt);

  // Global humanizer / conversation conventions. App-level meta constraint,
  // authored in src/core/humanizer.js (NOT visible to end users).
  // See CLAUDE.md 铁律 10.
  const humanizer = (HUMANIZER_PROMPT ?? '').trim();

  const parts = [];
  // 1. Framing — who you are, who you're talking to.
  const charName = character.name || '(未命名角色)';
  const userName = persona?.name || null;
  parts.push(userName
    ? `你是【${charName}】,正在与【${userName}】聊天。`
    : `你是【${charName}】,正在跟一位用户聊天。`);
  // 2. 角色设定
  parts.push(`# 角色设定\n\n${character.persona || character.name || '(无设定)'}`);
  // 3. 世界观(前置)
  if (wbBy.before.length > 0) {
    parts.push(`# 世界观 / 背景设定(前置)\n\n${wbBy.before.join('\n\n')}`);
  }
  // 4. 世界观(默认)
  if (wbBy.inline.length > 0) {
    parts.push(`# 世界观 / 背景设定\n\n${wbBy.inline.join('\n\n')}`);
  }
  // 5. 世界观(后置)
  if (wbBy.after.length > 0) {
    parts.push(`# 世界观 / 背景设定(后置)\n\n${wbBy.after.join('\n\n')}`);
  }
  // 6. 用户人设
  if (persona) {
    parts.push(`# 用户人设\n\n${persona.persona || persona.name || '(未填写)'}`);
  }
  // 7. 过往记忆
  if (memories.length > 0) {
    parts.push(`# 过往记忆(由老到新)\n\n${memories.map(m => m.summary).join('\n\n')}`);
  }
  // 8. 当前社交状态
  if (character.blocked) {
    parts.push(`# 当前社交状态\n\n注意:你目前已被对方加入黑名单。这是该 app 内的关系状态,具体如何反应由你的人设决定。`);
  }
  // 9. 对话规范
  if (humanizer) {
    parts.push(`# 对话规范\n\n${humanizer}`);
  }
  // 10. 用户本轮使用的功能定义 (per-turn hook — caller passes featureContext to describe what app
  //     feature triggered this AI call, e.g. voice button / transfer button).
  const fc = (featureContext ?? '').trim();
  if (fc) {
    parts.push(`# 用户本轮使用的功能定义\n\n${fc}`);
  }
  // 11. 输出格式
  parts.push(OUTPUT_FORMAT_SPEC);
  return parts.join('\n\n---\n\n');
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
      default:       return `[${a.type}]`;
    }
  }).filter(Boolean).join('\n');
}

// Compress oldest overflow messages into a memory summary, then delete them.
// Returns the new memory id, or null if nothing to compress.
export async function maybeCompressMemory(sessionId, threshold = 40) {
  const all = await db.query('chatMessages', 'sessionId', sessionId);
  if (all.length <= threshold) return null;
  all.sort((a, b) => a.createdAt - b.createdAt);
  const overflow = all.slice(0, all.length - threshold);
  if (overflow.length === 0) return null;

  const dump = overflow.map(m => {
    const speaker = m.role === 'user' ? '用户' : (m.role === 'character' ? '角色' : 'system');
    return `${speaker}: ${renderActionsAsText(m.actions ?? [])}`;
  }).join('\n');

  const sys = '你是对话压缩助手。把下面这段对话压成不超过 300 字的中文摘要,只保留关键信息(谁说了什么、做了什么、关系/情绪变化、约定、提到的人物或地点)。摘要不分段、不列表、不加任何前缀或解释,只输出摘要文本本身。';
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
