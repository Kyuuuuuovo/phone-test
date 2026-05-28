// System prompt assembly and long-conversation memory compression.

import * as db from './db.js';
import * as ai from './ai.js';
import { HUMANIZER_PROMPT } from './humanizer.js';
import { BEHAVIOR_GUIDANCE } from './behavior.js';
import * as embedding from './embedding.js';
import * as timeline from './timeline.js';
import { parseTolerantJSON } from './util.js';

// 向量打标 6 类固定 enum — 转折 / 亲密 / 冲突 / 发现 / 约定 / 日常。每条 L1
// memory 生成时随 summary 同步打标(单次 AI 调用,不双倍 token)。enum 内
// 模型容易选,UI 上 chip 颜色固定。Phase 4 加 boost 时用 tag 加权 cosine。
const MEMORY_TAGS = ['转折', '亲密', '冲突', '发现', '约定', '日常'];

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

10. add_schedule_entry — 把对话里提到的"之后要做的事"自动写进你自己的行程(who=character,会用当前会话的 character 自动绑定)。
    { "type": "add_schedule_entry", "title": "开会", "startTs": "2026-05-28T15:00:00", "endTs": "2026-05-28T16:00:00", "desc": "可选" }
    startTs / endTs 用 ISO 本地时间字符串(YYYY-MM-DDTHH:MM:SS,无时区后缀,按你的本地时区解析)。endTs 可省。这条不显示气泡 — 前端只渲染一个小卡片提示"已添加到行程"。**只在对话里明确提到时间 + 事件时用**(比如「明天下午 3 点要去开会」「礼拜五我去取快递」)— 模糊语义如「以后再说」「有空了来」不要触发。

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
export async function buildSystemPromptParts(sessionId, { featureContext, regenHint } = {}) {
  const session = await db.get('chatSessions', sessionId);
  if (!session) throw new Error(`buildSystemPromptParts: session ${sessionId} not found`);

  const character = await db.get('characters', session.characterId);
  if (!character) throw new Error(`buildSystemPromptParts: character ${session.characterId} not found`);

  const persona = session.personaId ? await db.get('personas', session.personaId) : null;

  // Group worldbook entries by injection position.
  // 关键词触发(SillyTavern lorebook 风格):entry.keywords 是 string[]。
  //   - 空 / 缺失 → entry 一直注入(默认,向后兼容)
  //   - 有值 → 在最近 RECENT_KW_WINDOW 条消息任一里命中其中一个 keyword 才注入
  // 匹配:大小写不敏感,substring(包含即触发,不要求整词)。中文不分词所以
  // 整字面匹配最稳。检查范围:user + character 消息的 action.content/desc/
  // name 拼出来的文本,archived 也包含(被压缩进 memory 的也算上下文)。
  const RECENT_KW_WINDOW = 10;
  let recentText = '';  // 懒计算 — 只有 entries 用了 keywords 才需要拼
  async function getRecentText() {
    if (recentText !== '') return recentText;
    const msgs = (await db.query('chatMessages', 'sessionId', sessionId))
      .filter(m => m.role !== 'system');
    msgs.sort((a, b) => a.createdAt - b.createdAt);
    const slice = msgs.slice(-RECENT_KW_WINDOW);
    recentText = slice
      .map(m => (m.actions || []).map(a => a.content || a.description || a.name || '').join(' '))
      .join('\n')
      .toLowerCase();
    return recentText;
  }
  function matchesKeywords(text, keywords) {
    const lc = text.toLowerCase();
    return keywords.some(k => lc.includes(String(k).toLowerCase()));
  }

  const wbBy = { before: [], inline: [], after: [] };
  const bindings = await db.query('characterWorldbooks', 'characterId', character.id);
  bindings.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  for (const binding of bindings) {
    const entries = await db.query('worldbookEntries', 'worldbookId', binding.worldbookId);
    const enabled = entries.filter(e => e.enabled !== false);
    enabled.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    for (const entry of enabled) {
      // 关键词过滤
      const kw = Array.isArray(entry.keywords) ? entry.keywords.filter(Boolean) : [];
      if (kw.length > 0) {
        const txt = await getRecentText();
        if (!matchesKeywords(txt, kw)) continue;  // 没命中 → skip
      }
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
      : `你是【${charName}】,正在跟用户聊天。`,
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
  // 5b. 用户当前状态 — per-persona,跟 session.personaId 走(切到不同的"我"
  //     看到不同状态)。空就不注入。setAt 转成相对时间提示「几小时前」让角色
  //     能感知"这条状态是当下的还是几天前留的"。
  const statusBody = persona?.statusText
    ? `${persona.statusText}${Number.isFinite(persona.statusSetAt) ? `\n(设于 ${humanGap(Date.now() - persona.statusSetAt)}前)` : ''}`
    : '';
  parts.push({
    key: 'user-status',
    title: '# 用户当前状态',
    body: statusBody,
    kind: 'data',
    editRoute: 'messaging',  // 「我」tab,但 messaging 是 tab 容器
  });
  // 6. 世界观(后置)
  parts.push({
    key: 'wb-after',
    title: '# 世界观 / 背景设定(用户人设后)',
    body: wbBy.after.join('\n\n'),
    kind: 'data',
    editRoute: 'worldbook-list',
  });
  // 6b. 相关记忆 — 按语义检索(if vector memory is enabled). Goes BEFORE
  //     the linear L1/L2 summaries so the most-relevant facts are primed
  //     first. Uses the last few user messages as the query text.
  //     Linear memory preserves narrative arc; vector recall surfaces
  //     specific facts mentioned long ago and possibly forgotten by the
  //     linear compression. They coexist, slight overlap is OK.
  const vectorRecall = await buildVectorRecallLines(sessionId);
  parts.push({
    key: 'vector-recall',
    title: '# 相关记忆(按语义检索)',
    body: vectorRecall,
    kind: 'data',
    editRoute: 'settings-embedding',
  });
  // 6c. 相关世界设定 — vector mode 的 worldbook entries,按语义跟最近对话
  //     检索。跟 6b 同套机制不同 source:6b 是 memories,6c 是 worldbook
  //     entries(activationMode='vector')。分开注入让模型清楚区分"对话记忆"
  //     和"世界设定"。
  const wbVectorRecall = await buildWorldbookVectorLines(character.id, sessionId);
  parts.push({
    key: 'wb-vector-recall',
    title: '# 相关世界设定(按语义检索)',
    body: wbVectorRecall,
    kind: 'data',
    editRoute: 'worldbook-list',
  });
  // 7. 远期 + 近期记忆
  // 1a: 时间感知 on (默认) 时,每条 memory 前缀【M月D日–M月D日】给模型时
  // 间锚点。session.timeAwareness === 'off' 时退回 m.summary 裸文本。
  // 老 memory 没 fromTs/toTs → 用 createdAt fallback(单点而不是范围)。
  const memTimeOn = session?.timeAwareness !== 'off';
  parts.push({
    key: 'mem-l2',
    title: '# 远期记忆(章节,由老到新)',
    body: l2Mem.map(m => formatMemoryWithDate(m, memTimeOn)).join('\n\n'),
    kind: 'data',
    editRoute: 'memory-manage',
    editParams: { sessionId },
  });
  parts.push({
    key: 'mem-l1',
    title: '# 近期记忆(由老到新)',
    body: l1Mem.map(m => formatMemoryWithDate(m, memTimeOn)).join('\n\n'),
    kind: 'data',
    editRoute: 'memory-manage',
    editParams: { sessionId },
  });
  // 7c. 当前时间 — anchor for relative time references. SKIPPED in fictional
  //     world mode (架空 character 不应该知道现实日期 — 比如中世纪扮演场景
  //     给模型注入 "2026 年 5 月 27 日" 会出戏)。架空模式下用户可以在
  //     character.persona 里写 "in-world 时间感:春末" 之类的。
  //     现实模式下 anchor 行为不变。
  // worldMode 现在是 per-session(session.worldMode);未显式 set 时 fallback
  // 到 character.worldMode(老数据兼容),最终 default 'real'。
  const isFictional = (session.worldMode ?? character.worldMode) === 'fictional';
  parts.push({
    key: 'current-time',
    title: '# 当前时间',
    body: isFictional ? '' : currentTimeLine(),
    kind: 'computed',
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
  const scheduleLines = await buildScheduleLines(character.id, session.personaId, {
    userName: persona?.name,
    charName: character.name,
  });
  parts.push({
    key: 'schedule',
    title: '# 当前行程',
    body: scheduleLines,
    kind: 'data',
    editRoute: 'schedule',
  });
  // 8b'. 当前打卡(用户)— 紧跟行程,二者同源(日级别事件)。仅 user,
  //  character 没有打卡概念。空 body → prompt-inspector 显示「未注入」、
  //  最终 prompt 不出现该 section。
  const checkinLines = await buildCheckinLines();
  parts.push({
    key: 'checkins',
    title: '# 当前打卡(用户)',
    body: checkinLines,
    kind: 'data',
    editRoute: 'schedule',
  });
  // 8e. 关于你 — per (角色×人设) 的画像。lookup 先精确匹配 charId|personaId
  //  再 fallback charId|(共享行)。500 字以内,渲染 likes/dislikes/discoveries
  //  三行(空段不出现)。手动编辑入口:记忆 app → 关于你 tab。
  const profileLines = await buildUserProfileLine(character.id, session.personaId);
  parts.push({
    key: 'user-profile',
    title: '# 关于你',
    body: profileLines,
    kind: 'data',
    editRoute: 'memory',
  });
  // 8c. 摄像头 — SKIPPED in fictional mode(架空里没有 IoT 摄像头这种现代设定,
  //     除非角色 persona 主动声明)。
  const cameraLines = isFictional ? '' : await buildCameraLines(character.id, persona?.name);
  parts.push({
    key: 'cameras',
    title: '# 摄像头',
    body: cameraLines,
    kind: 'data',
    editRoute: 'monitor',
  });
  // 8d. 角色当前活动 — 同上,架空模式下 monitor 数据没意义。
  const activityLine = isFictional ? '' : await buildActivityLine(character.id);
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
  // 10b. 翻译模式 — per-session toggle。开启时让模型可以用任意语言对话,
  //      非中文输出时在 text / reply 动作里加 translation 字段提供中文翻译。
  //      action schema 本身没改(避免影响关闭模式),这里以规约形式注入。
  const translateBody = session.translateMode === true
    ? '当前对话开启了翻译模式。你可以用任何语言说话(英语、日语、法语、文言文等)。当你输出非中文的 text 或 reply 动作时,**必须**在该动作对象里加一个 `translation` 字段提供中文翻译,例如:\n{ "type": "text", "content": "Bonjour", "translation": "你好" }\n中文输出可以不加 translation。这个字段是 UI 给用户看的辅助显示,不影响动作 schema 的其他字段。'
    : '';
  parts.push({
    key: 'translate-mode',
    title: '# 翻译模式',
    body: translateBody,
    kind: 'computed',
  });
  // 11. 用户本轮使用的功能定义 (per-turn featureContext)
  const fc = (featureContext ?? '').trim();
  parts.push({
    key: 'feature',
    title: '# 用户本轮使用的功能定义',
    body: fc,
    kind: 'computed',
  });
  // 11b. 本次重新生成的要求(per-call regenHint — 长按 regenerate 弹的 modal)
  //      只此一次,不进 chat history、不存 memory。用户的"这次给我换个角度"
  //      "这次短一点"之类的临时指示。空字符串就不注入。
  const rh = (regenHint ?? '').trim();
  parts.push({
    key: 'regen-hint',
    title: '# 本次重新生成的要求(只此一次,后续不影响)',
    body: rh,
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
  // Tag each part with its presentation group for the prompt-inspector UI.
  // 用户在调试页希望能按"世界观/记忆/状态/规范/输出"分类看,而不是 20 段
  // 平铺。这里集中映射,避免每个 parts.push 都重复写 group 字段。
  // 注入顺序在 group 内部保留。
  for (const p of parts) p.group = PART_GROUPS[p.key] || 'misc';
  return parts;
}

// 单源映射:part.key → 调试页用的分组。新增 part 时记得在这里加一行,否则
// 它会落到 'misc' 桶。
const PART_GROUPS = {
  'framing':       'worldview',
  'wb-before':     'worldview',
  'character':     'worldview',
  'wb-inline':     'worldview',
  'user-persona':  'worldview',
  'user-status':   'state',
  'wb-after':      'worldview',
  'vector-recall': 'memory',
  'wb-vector-recall': 'worldview',
  'mem-l2':        'memory',
  'mem-l1':        'memory',
  'current-time':  'state',
  'social':        'state',
  'schedule':      'state',
  'cameras':       'state',
  'activity':      'state',
  'humanizer':     'spec',
  'behavior':      'spec',
  'translate-mode':'spec',
  'feature':       'spec',
  'regen-hint':    'spec',
  'output-count':  'output',
  'output-schemas':'output',
};
export const GROUP_LABELS = {
  worldview: '世界观 / 人设',
  memory:    '记忆',
  state:     '当前状态',
  spec:      '对话 / 动作规范',
  output:    '输出格式',
  misc:      '其他',
};

// 1a: 给 memory summary 拼时间范围前缀。fromTs/toTs 是 chat msg createdAt
// 范围;同一天显示「【M月D日】」,跨天显示「【M月D日–M月D日】」。timeOn
// false 时直接返回 summary 不拼时间(架空场景 / 用户关掉时间感知 toggle)。
// 老 memory 没 fromTs/toTs 时退回 createdAt 作单点。
function formatMemoryWithDate(m, timeOn) {
  if (!timeOn) return m.summary || '';
  const fromTs = m.fromTs ?? m.createdAt;
  const toTs   = m.toTs   ?? m.createdAt;
  if (!Number.isFinite(fromTs)) return m.summary || '';
  const fmt = (ts) => {
    const d = new Date(ts);
    return `${d.getMonth()+1}月${d.getDate()}日`;
  };
  const range = fmt(fromTs) === fmt(toTs) ? `【${fmt(fromTs)}】` : `【${fmt(fromTs)}–${fmt(toTs)}】`;
  return `${range} ${m.summary || ''}`;
}

// Anchor line for the "# 当前时间" segment. Mirrors surveillance.js's
// nowLine format so cross-feature debugging shows consistent strings;
// kept here as a private helper to avoid a cross-module dependency for
// a 4-line function.
function currentTimeLine() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} 星期${weekday}`;
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

// Vector retrieval for worldbook entries — 跟 buildVectorRecallLines 同套
// query 拼装(最近 5 条对话),但检索范围是这 character 挂载的 worldbook
// 里 activationMode='vector' 的 entries。命中后注入「# 相关世界设定」段。
async function buildWorldbookVectorLines(characterId, sessionId) {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.embedding?.enabled !== true) return '';
  const QUERY_TURN_COUNT = 5;
  const allMsgs = (await db.query('chatMessages', 'sessionId', sessionId))
    .filter(m => !m.archived && m.role !== 'system');
  if (allMsgs.length === 0) return '';
  allMsgs.sort((a, b) => a.createdAt - b.createdAt);
  const recent = allMsgs.slice(-QUERY_TURN_COUNT);
  const query = recent
    .map(m => {
      const who = m.role === 'user' ? '用户' : '角色';
      const text = (m.actions || []).map(a => a.content || a.description || '').filter(Boolean).join(' ');
      return text ? `${who}:${text}` : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!query) return '';
  let hits = [];
  try {
    hits = await embedding.topKWorldbookEntriesForQuery(characterId, query);
  } catch (e) {
    console.warn('[context] worldbook vector recall failed (non-fatal):', e);
    return '';
  }
  if (hits.length === 0) return '';
  return hits.map(({ entry, score }) => {
    const pct = Math.round(Math.max(0, score) * 100);
    return `(相关度 ${pct}%)${entry.content}`;
  }).join('\n\n');
}

// Vector retrieval — embed the last few turns as a query, cosine top-K
// across this session's memory embeddings. Returns the formatted lines
// (or '' when disabled / no hits / unconfigured).
//
// Query construction: last N messages regardless of role (user + character
// interleaved). Including the most-recent assistant turn matters because
// short user replies like "对 那个" are basically useless as queries on
// their own — the assistant's preceding "上次你说想去京都" carries the
// topic the user is responding to.
async function buildVectorRecallLines(sessionId) {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.embedding?.enabled !== true) return '';
  const QUERY_TURN_COUNT = 5;
  const allMsgs = (await db.query('chatMessages', 'sessionId', sessionId))
    .filter(m => !m.archived && m.role !== 'system');
  if (allMsgs.length === 0) return '';
  allMsgs.sort((a, b) => a.createdAt - b.createdAt);
  const recent = allMsgs.slice(-QUERY_TURN_COUNT);
  const query = recent
    .map(m => {
      const who = m.role === 'user' ? '用户' : '角色';
      const text = (m.actions || []).map(a => a.content || a.description || '').filter(Boolean).join(' ');
      return text ? `${who}:${text}` : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!query) return '';
  let hits = [];
  try {
    hits = await embedding.topKMemoriesForQuery(sessionId, query);
  } catch (e) {
    console.warn('[context] vector recall failed (non-fatal):', e);
    return '';
  }
  if (hits.length === 0) return '';
  // Format as ranked list with similarity hint. The percentage lets the
  // model see how strong the match is — it can de-weight a weak match
  // ("相关度 31%") versus a strong one ("相关度 87%").
  return hits.map(({ memory, score }) => {
    const pct = Math.round(Math.max(0, score) * 100);
    return `(相关度 ${pct}%)${memory.summary}`;
  }).join('\n\n');
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
//
// Per-persona(user 行程):e.personaId 空 = 所有 persona 共享(向后兼容);
//   有值 = 只对 sessionPersonaId 匹配的会话注入。sessionPersonaId 由 caller
//   传入(来自 session.personaId)。
//
// Exported so surveillance.js can reuse the same window logic for camera
// snapshots without duplicating the formatter.
export async function buildScheduleLines(characterId, sessionPersonaId, names = {}) {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.syncScheduleToChat === false) return '';
  const all = await db.getAll('schedule');
  if (all.length === 0) return '';
  // 注入窗口:前 3 天 + 当天 + 后 3 天 = 7 天。user 想让 AI 看到更宽时间
  // 范围的行程,知道"昨天做了 X 今天接着做 Y"这种连续性,也能在角色提
  // "下周二开会"时记得没忘。过 3 天以上的行程仍在 IDB 但不注入。
  const now = Date.now();
  const winStart = now - 3 * 24 * 60 * 60 * 1000;
  const winEnd   = now + 3 * 24 * 60 * 60 * 1000;
  const relevant = all
    .filter(e => {
      if (e.syncToChat === false) return false;  // per-entry mute
      // 区间重叠判定:跨天事件(startTs 在窗口左外但 endTs 仍在窗口内)也算
      // 相关。原来只看 startTs 会丢"4 天前开始今天还没结束"的长事件,
      // schedule-list.js 三日视图早就是双端判定,这里同步过来。
      const ee = e.endTs || (e.startTs + 3600000);
      if (ee < winStart || e.startTs > winEnd) return false;
      // character-bucket: 只注入到对应角色 prompt
      if (e.who === 'character') return e.characterId === characterId;
      // user-bucket: 默认所有角色可见,visibleTo 字段限制(1b 共享逻辑)
      //   undefined / missing  → 全可见
      //   []                   → 谁都看不到(等同 muted,但语义清晰)
      //   ['c1', 'c2']         → 只对列出的角色可见
      // per-persona 过滤(e.personaId):空 = 所有 persona 共享;有值 = 只对
      //   匹配的 session.personaId 注入。
      if (e.who === 'user') {
        if (e.personaId && e.personaId !== sessionPersonaId) return false;
        if (!Array.isArray(e.visibleTo)) return true;
        return e.visibleTo.includes(characterId);
      }
      return false;
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
  const userLabel = names.userName || '用户';
  const charLabel = names.charName || '你';
  return relevant.map(e => {
    const who = e.who === 'user' ? userLabel : charLabel;
    const status = statusOf(e);
    const desc = e.desc ? ` — ${e.desc}` : '';
    return `- ${who} ${fmtTime(e.startTs)}${status} ${e.title}${desc}`;
  }).join('\n');
}

// 打卡紧凑摘要 — 本月已打 N/M 天。跟 schedule 同源(都是日级别事件),所以
// 共用 settings.syncScheduleToChat 全局开关:不想让 AI 看到行程的人通常也
// 不想让 AI 看到打卡习惯。types 为空或整体关掉 → return ''(caller 通过空
// body 不渲染该 part)。
//
// 输出形如:
//   - 跑步:本月已打 18/28 天
//   - 喝水:本月已打 27/28 天
//
// T6: 早期版本带 streak「连续 N 天」+ targetFreq「目标每天 / 目标每周 N 次」,
// 用户反馈不需要 — 打卡只是单纯记录,不是 habit 追踪 app,去掉连续天数和目标
// 频率维度。老数据里的 targetFreq 字段保留但不渲染,新建 type 也不再写入。
export async function buildCheckinLines() {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.syncScheduleToChat === false) return '';
  const types = await db.getAll('checkinTypes');
  if (types.length === 0) return '';
  const all = await db.getAll('checkins');
  const now = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const todayDay = now.getDate();
  const pad2 = (n) => String(n).padStart(2, '0');
  const monthPrefix = `${year}-${pad2(month + 1)}-`;
  const todayKey = `${year}-${pad2(month + 1)}-${pad2(todayDay)}`;
  const lines = [];
  for (const t of types) {
    const thisType = all.filter(c => c.typeId === t.id);
    const monthCount = thisType.filter(c => c.dayKey.startsWith(monthPrefix) && c.dayKey <= todayKey).length;
    lines.push(`- ${t.name}:本月已打 ${monthCount}/${todayDay} 天`);
  }
  return lines.join('\n');
}

// 用户画像 — per (角色×人设) 的"角色眼中的 ta"。
// id = composite `${characterId}|${personaId}`,personaId 留空 = "所有人设共享"。
// Lookup:先精确匹配 charId|sessionPersonaId,落空 fallback charId|;两者皆无
// 返回 ''(prompt 注入空 → 不渲染该 part)。
// 渲染格式(空段跳过):
//   ta 喜欢:...
//   ta 不喜欢:...
//   你发现 ta:...
// 整段尽量简洁,不要长篇大论 — UI 已限 500 字。
export async function buildUserProfileLine(characterId, sessionPersonaId) {
  if (!characterId) return '';
  const exactId = `${characterId}|${sessionPersonaId || ''}`;
  const sharedId = `${characterId}|`;
  let row = await db.get('userProfiles', exactId);
  if (!row && exactId !== sharedId) row = await db.get('userProfiles', sharedId);
  if (!row) return '';
  const lines = [];
  if (row.likes && row.likes.trim())       lines.push(`ta 喜欢:${row.likes.trim()}`);
  if (row.dislikes && row.dislikes.trim()) lines.push(`ta 不喜欢:${row.dislikes.trim()}`);
  if (row.discoveries && row.discoveries.trim()) lines.push(`你发现 ta:${row.discoveries.trim()}`);
  return lines.join('\n');
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
  // B#8: reply 动作渲染时要把引用原文塞进去 — 之前只写 content,模型完全不知
  // 道用户引用的是哪条。pre-build msgId→原文 lookup,reply case 拼成
  // 「[引用「原文」]\n回复内容」。注意:不截断,user 明确说不要前 N 字
  // (如果引用太长以后再加 truncate)。
  const ctx = makeRenderContext(all);
  // 1a: 稀疏时间标记 — session.timeAwareness === 'off' 时不插任何 gap 标记
  // (架空场景用,真实间隔在 in-world 无意义)。默认 on。
  const session = await db.get('chatSessions', sessionId);
  const enableGaps = session?.timeAwareness !== 'off';
  return collapseAdjacentSameRole(recent.map(m => toApiMessage(m, ctx)), { enableGaps });
}

// Build a render-context with resolveQuote so renderActionsAsText can inline
// the original message text for `reply` actions. `all` should include archived
// rows too — a reply to an old message that's already been compressed into
// memory still needs its quote resolved when rendered before compression.
function makeRenderContext(allMessages) {
  const byId = new Map(allMessages.map(m => [m.id, m]));
  return {
    // T3: actionIdx 来源 reply action 上新加的 quoteActionIdx 字段。老数据
    // 没这个字段 → fallback 0(等同旧行为)。
    resolveQuote(msgId, actionIdx = 0) {
      const m = byId.get(msgId);
      if (!m) return '';
      const a = m.actions?.[actionIdx] ?? m.actions?.[0];
      if (!a) return '';
      return String(a.content || a.description || a.name || `[${a.type}]`);
    },
  };
}

// Merge consecutive messages with the same role into one, joined by a
// blank line. Only safe for plain string content — tool_calls / tool-role
// messages have structure that can't be flattened, so we leave them alone.
//
// Time-aware (1a): inject gap markers at two granularities.
//  - Same-role gap > 5min: 「[过了 N]」 inside the merged content
//  - Cross-role gap > 30min: prepend「[过了 N]\n\n」to the next message's
//    content (can't be a separate row — would break OpenAI strict
//    user/assistant alternation). 这一条是修 chat 报的 bug — 之前只在合
//    并同 role 时插标记,正常 user→character→user 永远不触发,模型完全
//    看不到"用户隔了一天才回"这种最关键的时间结构。
// opts.enableGaps = false → 两种 gap 标记都不插(架空模式 / 用户关掉
// 时间感知 toggle 时用)。
function collapseAdjacentSameRole(msgs, opts = {}) {
  const enableGaps = opts.enableGaps !== false;
  const sameRoleGapMs  = 5  * 60 * 1000;
  const crossRoleGapMs = 30 * 60 * 1000;
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
      // Same-role merge — 在 join 处插标记
      const gap = (m._ts ?? 0) - (last._lastTs ?? 0);
      const sep = (enableGaps && gap > sameRoleGapMs)
        ? `\n\n[过了 ${humanGap(gap)}]\n\n`
        : '\n\n';
      last.content = `${last.content}${sep}${m.content}`;
      last._lastTs = m._ts;
    } else {
      // Cross-role 或首条 — 在 m.content 前面 prepend 标记
      let content = m.content;
      if (enableGaps && last && typeof content === 'string') {
        const gap = (m._ts ?? 0) - (last._lastTs ?? 0);
        if (gap > crossRoleGapMs) {
          content = `[过了 ${humanGap(gap)}]\n\n${content}`;
        }
      }
      out.push({ ...m, content, _lastTs: m._ts });
    }
  }
  // Strip the internal _ts / _lastTs fields before handing to the API.
  return out.map(m => { const { _ts, _lastTs, ...rest } = m; return rest; });
}

function humanGap(ms) {
  const mins = Math.round(ms / 60_000);
  if (mins < 60)   return `${mins} 分钟`;
  const hours = Math.round(mins / 60);
  if (hours < 24)  return `${hours} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

function toApiMessage(msg, ctx) {
  // _ts is internal — collapseAdjacentSameRole uses it for gap-detection,
  // then strips before sending to the API.
  if (msg.role === 'character') {
    // Echo the model's own past JSON-array output verbatim — reinforces format.
    return { role: 'assistant', content: JSON.stringify(msg.actions ?? []), _ts: msg.createdAt };
  }
  let content = renderActionsAsText(msg.actions ?? [], ctx);
  // 用户心声(msg.innerVoice)— 拼在正文后面,带明显标记让模型知道这是真
  // 实情绪。BEHAVIOR_GUIDANCE 告诉模型「据此调整态度但不要复述」。
  if (msg.innerVoice) {
    content = `${content}\n[心声:${msg.innerVoice}]`;
  }
  return {
    role: msg.role === 'system' ? 'system' : 'user',
    content,
    _ts: msg.createdAt,
  };
}

function renderActionsAsText(actions, ctx) {
  return actions.map(a => {
    switch (a.type) {
      case 'text':   return a.content || '';
      case 'reply': {
        // B#8: 拿被引用的原话拼进 prompt,模型才能看到上下文。如果 ctx 没传
        // (compatibility / direct caller),退回到只输出 reply 内容。
        const qIdx = Number.isFinite(a.quoteActionIdx) ? a.quoteActionIdx : 0;
        const quote = ctx?.resolveQuote ? ctx.resolveQuote(a.quoteMsgId, qIdx) : '';
        return quote
          ? `[引用「${quote}」]\n${a.content || ''}`
          : (a.content || '');
      }
      case 'image': {
        // C1: 用户真实图片 src 是 base64 dataurl,塞 prompt 会爆 token。
        // 真图模式给占位文字 + description(用户可能没描述);AI 主动发图
        // 用 description 字段,模型完全能看到。
        const isRealImage = !!a.src && /^(data:image|https?:|blob:)/i.test(a.src);
        if (isRealImage) {
          return a.description
            ? `[用户上传的图片: ${a.description}]`
            : `[用户上传的图片(未配文字描述)]`;
        }
        return `[图片: ${a.description || ''}]`;
      }
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
      case 'add_schedule_entry':
        return `[已加进行程: ${a.title || ''} · ${a.startTs || ''}]`;
      default:       return `[${a.type}]`;
    }
  }).filter(Boolean).join('\n');
}

// Default compression sys prompt. Author-locked default; the session-level
// memoryPromptOverride is appended below this so the user can tweak the
// *style* of the summary (e.g. "以日记体" / "用第三人称冷淡口吻") without
// having to re-specify the structural rules.
// V1:纯文本 summary。V2:bundle 进 JSON {summary, tag},tag 用于检索 boost。
// 切回 V1 的话:把 MEMORY_OUTPUT_RULES 留空 + 解析逻辑 fallback 到 plain text。
const DEFAULT_MEMORY_SYS = '你是对话压缩助手。把下面这段对话压成不超过 300 字的中文摘要,只保留关键信息(谁说了什么、做了什么、关系/情绪变化、约定、提到的人物或地点)。';
const MEMORY_OUTPUT_RULES = `
**输出格式严格 JSON**(不加 markdown 包裹、不加前后缀文字):
{ "summary": "...摘要文本...", "tag": "<6 类之一>" }

tag 从下列 6 类挑 1 个:
- 转折 — 关系的关键节点(初见 / 表白 / 误会冰释 / 分别 等)
- 亲密 — 温柔、深入、暖的时刻
- 冲突 — 摩擦、争吵、紧张
- 发现 — 知道对方 / 自己的新事实
- 约定 — 计划 / 承诺
- 日常 — 闲聊、未归类(兜底)

拿不准就选「日常」。`;

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

  // Pass quote-resolver into renderActionsAsText so reply 引用原文 inlined
  // in the dump too (B#8).
  const ctx = makeRenderContext(all);
  const dump = overflow.map(m => {
    const speaker = m.role === 'user' ? '用户' : (m.role === 'character' ? '角色' : 'system');
    return `${speaker}: ${renderActionsAsText(m.actions ?? [], ctx)}`;
  }).join('\n');

  const session = await db.get('chatSessions', sessionId);
  const override = (session?.memoryPromptOverride || '').trim();
  // 拼三段:压缩规则 + 输出格式(JSON + 6 类 tag) + 风格补充(session-level)
  const sys = [
    DEFAULT_MEMORY_SYS,
    MEMORY_OUTPUT_RULES,
    override ? `\n# 风格补充(适用于 summary 字段的语气)\n${override}` : '',
  ].filter(Boolean).join('\n');

  const raw = await ai.callAI({
    systemPrompt: sys,
    messages: [{ role: 'user', content: dump }],
    temperature: 0.3,
  });

  // 容错解析:JSON 失败 → 把 raw 当 summary 用,tag 留空(后续 memory-app 的
  // 启发式 fallback 处理 / 用户可手动补)。
  let summary = '', tag = '';
  const parsed = parseTolerantJSON(raw, { expect: 'object' });
  if (parsed && typeof parsed.summary === 'string' && parsed.summary.trim()) {
    summary = parsed.summary.trim();
    if (typeof parsed.tag === 'string' && MEMORY_TAGS.includes(parsed.tag.trim())) {
      tag = parsed.tag.trim();
    }
  } else {
    summary = String(raw || '').trim();
  }

  const memId = db.newId();
  const newMem = {
    id: memId,
    sessionId,
    tier: 1,
    summary,
    ...(tag ? { tag } : {}),
    fromMsgId: overflow[0].id,
    toMsgId: overflow[overflow.length - 1].id,
    // 1a: 保留这段记忆覆盖的 wall-clock 时间范围。注入时拼成日期前缀
    // 【M月D日–M月D日】(同一天就显示一次),模型有时间锚点对应每段记忆。
    // 老 memory 没这俩字段 → buildSystemPromptParts 里 fallback 到 createdAt。
    fromTs: overflow[0].createdAt,
    toTs: overflow[overflow.length - 1].createdAt,
    createdAt: Date.now(),
  };
  // Stamp every overflow row with the archive metadata so the atomic
  // multi-store write below puts memory + archived msgs together. If
  // the tx aborts partway, none of them commit — so the next
  // maybeCompressMemory sees the same overflow set and retries, instead
  // of finding "5 of 10 archived" and silently leaving the rest unarchived.
  const stamp = Date.now();
  for (const msg of overflow) {
    msg.archived = true;
    msg.archivedAt = stamp;
    msg.archivedIntoMemoryId = memId;
  }
  await db.txnPut({
    memories: [newMem],
    chatMessages: overflow,
  });
  // Fire-and-forget embed of the new memory. Failures don't block the
  // reply flow; embedding.embedMemory returns null when disabled /
  // unconfigured / failing.
  embedding.embedMemory(newMem).catch(e => console.warn('[context] embed failed:', e));
  // (the per-row archive stamping + db.txnPut above replaced the old
  // per-row await db.set loop. Reason in CLAUDE.md polish notes.)
  // After L1 compression, check if tier-1 summaries themselves have piled
  // up enough to warrant a tier-2 rollup. Cheap when not needed.
  await maybeRollupToL2(sessionId);
  // Timeline: when a memory just got compressed, the archived msgs span
  // some past days that now warrant a per-day one-line summary. Fire-
  // and-forget so the (potentially several) timeline API calls never
  // block the reply path. Errors are logged, not surfaced.
  timeline.generateMissingDays(sessionId).catch(e =>
    console.warn('[context] timeline gen failed (non-fatal):', e));
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
  // 1a-fix: L2 之前漏了 fromTs/toTs,formatMemoryWithDate 退到 createdAt
  // 会显示成「L2 合并那天」而不是它覆盖的真实对话时间。从 toMerge 这批
  // L1 的 fromTs/toTs 取范围;老 L1 没这俩字段就 fallback 到 createdAt。
  const newL2 = {
    id: newId,
    sessionId,
    tier: 2,
    summary: merged.trim(),
    fromMsgId: toMerge[0].fromMsgId,
    toMsgId: toMerge[toMerge.length - 1].toMsgId,
    fromTs: toMerge[0].fromTs ?? toMerge[0].createdAt,
    toTs:   toMerge[toMerge.length - 1].toTs ?? toMerge[toMerge.length - 1].createdAt,
    createdAt: Date.now(),
  };
  await db.set('memories', newL2);
  for (const m of toMerge) {
    // Drop the embedding row for the L1 memory we're about to delete —
    // otherwise the embeddings table grows unbounded and topKMemoriesForQuery
    // sees orphans (which we filter, but the cosine math runs on them first).
    const orphanEmbs = await db.query('embeddings', 'sourceId', m.id);
    for (const e of orphanEmbs) await db.del('embeddings', e.id);
    await db.del('memories', m.id);
  }
  // L2 also gets a vector — semantic retrieval should be able to find a
  // chapter-summary just as well as a fine-grained one. Fire-and-forget.
  embedding.embedMemory(newL2).catch(e => console.warn('[context] L2 embed failed:', e));
  return newId;
}

// Exported for the memory-manage page so it can show users the default it's
// extending when they edit the session-level override.
export { DEFAULT_MEMORY_SYS };

// "Redo summary from this msg onward". Triggered from a user-msg's bubble menu
// when the existing summaries got something wrong and the user wants the AI
// to re-compress that range.
//
// Behavior:
//   1. Find the target msg's createdAt (T).
//   2. Unarchive any msg in this session with createdAt >= T (clear archived /
//      archivedAt / archivedIntoMemoryId).
//   3. Delete any memory whose toMsgId points to a msg with createdAt >= T —
//      that's the set of memories whose coverage overlaps the redo window.
//      Memories that are entirely older than T stay (they cover content the
//      user is NOT redoing).
//   4. Run maybeCompressMemory once so fresh L1 summaries get generated for
//      the newly-unarchived overflow.
//
// L2 caveat: an L2 row's fromMsgId/toMsgId points to the chatMsgs it summarized
// transitively (via its source L1s). So step 3 catches L2s whose toMsgId is in
// the redo window — they get deleted, the new L1s will roll up to a fresh L2
// on the next compression that triggers L2 (see maybeRollupToL2's gate).
export async function resummarizeFrom(sessionId, fromMsgId) {
  const target = await db.get('chatMessages', fromMsgId);
  if (!target) throw new Error(`resummarizeFrom: msg ${fromMsgId} not found`);
  const T = target.createdAt;
  // Unarchive
  const allMsgs = await db.query('chatMessages', 'sessionId', sessionId);
  for (const m of allMsgs) {
    if (m.archived && m.createdAt >= T) {
      delete m.archived;
      delete m.archivedAt;
      delete m.archivedIntoMemoryId;
      await db.set('chatMessages', m);
    }
  }
  // Drop overlapping memories
  const allMems = await db.query('memories', 'sessionId', sessionId);
  // Build a quick lookup: msgId → createdAt
  const tsOf = new Map(allMsgs.map(m => [m.id, m.createdAt]));
  for (const mem of allMems) {
    const toTs = tsOf.get(mem.toMsgId);
    // If we can't resolve the to-msg (orphan), be conservative: drop the
    // memory, since we can't tell what it covered.
    if (toTs == null || toTs >= T) {
      await db.del('memories', mem.id);
    }
  }
  // Re-trigger compression so the unarchived msgs get a new summary.
  return await maybeCompressMemory(sessionId);
}
