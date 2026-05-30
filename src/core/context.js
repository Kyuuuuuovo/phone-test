// System prompt assembly and long-conversation memory compression.

import * as db from './db.js';
import * as ai from './ai.js';
import { HUMANIZER_PROMPT } from './humanizer.js';
import { BEHAVIOR_GUIDANCE } from './behavior.js';
import * as embedding from './embedding.js';
import * as timeline from './timeline.js';
import { parseTolerantJSON, dayKeyOf } from './util.js';
import { computePeriodStatus, findPeriodType } from './period.js';

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
// Section order (对话规范 元提示在最前,再上下文,最后 动作规约/输出/动作表):
//   ① 对话规范(元提示,放最前)
//   1. # 对话规范                  (humanizer constant, override-able)
//   ② 上下文(static setting + memory + state)
//   2. # 世界观 / 背景设定(前置)    (worldbook entries with position='before')
//   3. # 角色设定                  (always)
//   4. # 世界观 / 背景设定          (entries with position='inline', default)
//   5. # 用户人设                  (if a persona is linked)
//   6. # 世界观 / 背景设定(用户人设后) (entries with position='after')
//   7. # 过往记忆                  (if any memory summaries)
//   8. # 当前社交状态              (if character.blocked)
//   ③ 动作使用规约
//   9. # 动作使用规约               (behavior constant, override-able)
//   ④ 输出格式数量约束
//  10. OUTPUT_COUNT_SPEC          (always, override-able)
//   ⑤ 动作定义表
//  11. ACTION_SCHEMAS_TEXT        (always, override-able)
//
// `kind` values:
//   'computed' — built from app state (framing line) — not editable here
//   'data'     — user data (character/persona/worldbook/memory/schedule/...);
//                editable via editRoute, not via the inspector itself
//   'override' — author-locked source constants with optional settings override
//                (humanizer, behavior, OUTPUT_COUNT_SPEC, ACTION_SCHEMAS_TEXT)
export async function buildSystemPromptParts(sessionId, { regenHint } = {}) {
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
      // vector 模式条目只走「# 相关世界设定」语义召回段,不在这里注入 —— 否则它
      // 没 keywords,下面 kw.length===0 会被当 always 每轮无条件塞,命中时
      // buildWorldbookVectorLines 又塞第二遍(等于"向量触发"开关失效 + 双注入)。
      if (entry.activationMode === 'vector') continue;
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
  // {user} 占位符 → persona.name 真名替换。HUMANIZER_PROMPT 写「你在用手机和
  //   {user} 聊天」,持续注入到每段对话规范里;以前没做这个替换,模型读到字
  //   面「{user}」会困惑。同样替换规则也应用于 user 自定义 override,让 author
  //   和 user 都能写 {user} 占位而不必关心运行时拼接。fallback「用户」防 persona
  //   为空时拼出"你在用手机和 null 聊天"。
  const userNameForPrompt = (persona?.name || '').trim() || '用户';
  const charNameForPrompt = (character?.name || '').trim() || '角色';
  // {user}/{char} 占位符 → 真名。兼容酒馆双括号 {{user}}/{{char}} —— 先替双括号,
  // 再替单括号(否则单括号规则会把 {{user}} 里层的 {user} 吃掉、剩一对外括号)。
  // \s* 容忍 {{ user }},gi 容忍大小写。作用于对话规范 / 动作规约(作者文案)+
  // 角色设定 / 世界观 / 用户人设(用户内容)—— 酒馆素材里 {{user}}/{{char}} 满天
  // 飞,注入前统一换成真名,免得模型读到字面占位符。
  const subUser = (s) => (s || '')
    .replace(/\{\{\s*user\s*\}\}/gi, userNameForPrompt)
    .replace(/\{\{\s*char\s*\}\}/gi, charNameForPrompt)
    .replace(/\{\s*user\s*\}/gi, userNameForPrompt)
    .replace(/\{\s*char\s*\}/gi, charNameForPrompt);
  const humanizer   = subUser((ov.humanizer   ?? HUMANIZER_PROMPT   ?? '').trim());
  const behavior    = subUser((ov.behavior    ?? BEHAVIOR_GUIDANCE  ?? '').trim());
  const countSpec   = (ovo.countSpec   ?? OUTPUT_COUNT_SPEC).trim();
  const schemasText = (ovo.schemasText ?? ACTION_SCHEMAS_TEXT).trim();

  const parts = [];
  // 1. 对话规范(humanizer)— 元提示放最前,先定调「像真人在手机上聊天」,再进
  //    世界观 / 角色设定。原来开头那句「你是X,正在与Y聊天」已删:角色名在 # 角色设定
  //    里,用户名在 humanizer 的「你在用手机和 {user} 聊天」里,不必再单列一句。
  parts.push({
    key: 'humanizer',
    title: '# 对话规范',
    body: humanizer,
    kind: 'override',
    overrideScope: 'promptOverrides',
    overrideKey: 'humanizer',
    defaultValue: HUMANIZER_PROMPT,
  });
  // 2. 世界观(前置)
  parts.push({
    key: 'wb-before',
    title: '# 世界观 / 背景设定(前置)',
    body: subUser(wbBy.before.join('\n\n')),
    kind: 'data',
    editRoute: 'worldbook-list',
  });
  // 3. 角色设定
  parts.push({
    key: 'character',
    title: '# 角色设定',
    body: subUser(character.persona || character.name || '(无设定)'),
    kind: 'data',
    editRoute: 'character-detail',
    editParams: { id: character.id },
  });
  // 4. 世界观(默认)
  parts.push({
    key: 'wb-inline',
    title: '# 世界观 / 背景设定',
    body: subUser(wbBy.inline.join('\n\n')),
    kind: 'data',
    editRoute: 'worldbook-list',
  });
  // 5. 用户人设
  parts.push({
    key: 'user-persona',
    title: '# 用户人设',
    body: subUser(persona ? (persona.persona || persona.name || '(未填写)') : ''),
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
    body: subUser(statusBody),
    kind: 'data',
    editRoute: 'messaging',  // 「我」tab,但 messaging 是 tab 容器
  });
  // 6. 世界观(后置)
  parts.push({
    key: 'wb-after',
    title: '# 世界观 / 背景设定(用户人设后)',
    body: subUser(wbBy.after.join('\n\n')),
    kind: 'data',
    editRoute: 'worldbook-list',
  });
  // 6b/6c. Vector retrieval — memory + worldbook vector-mode entries. Both
  //     builders use the same query text (last 5 turns user+character
  //     interleaved). Originally each built its own query string by
  //     re-querying chatMessages then embedded separately — when the user
  //     hasn't configured a separate summary endpoint, both calls landed
  //     on the same upstream which means we were paying for the same
  //     embedding twice every turn. Build the query once here; the
  //     embedding.js LRU cache dedups the actual API call when the cfgs
  //     resolve to the same endpoint.
  //
  //     去重(excludeIds):L1+L2 memories 已经全量注入 mem-l1 / mem-l2 段,
  //     vector 召回不再重复这些 id 的卡片 — 否则同一段 summary 在 prompt 里
  //     出现两次(linear + vector),既浪费 token 也让模型重复消化。
  const recentQueryText = await buildRecentQueryText(sessionId);
  const linearMemIds = new Set([...l1Mem, ...l2Mem].map(m => m.id));
  const injectQuotes = settings.memoryInjectQuotes === true;
  const vectorRecall = recentQueryText
    ? await buildVectorRecallLines(sessionId, recentQueryText, linearMemIds, injectQuotes)
    : '';
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
  const wbVectorRecall = recentQueryText
    ? await buildWorldbookVectorLines(character.id, recentQueryText)
    : '';
  parts.push({
    key: 'wb-vector-recall',
    title: '# 相关世界设定(按语义检索)',
    body: wbVectorRecall,
    kind: 'data',
    editRoute: 'worldbook-list',
  });
  // 7. 远期 + 近期记忆
  // 7a. 时间索引(timeline v3) — 在 mem-l2 之前注入,按老→新排序。每行
  //   `YYYY-MM-DD HH:MM-HH:MM 真名 真名 事件`,作为时间锚点供模型定位
  //   "什么时候发生了什么"。注入条数 / 自动合并阈值在 settings → 记忆总结。
  parts.push({
    key: 'timeline-index',
    title: '# 时间索引(由老到新)',
    body: await buildTimelineIndexLines(sessionId),
    kind: 'data',
    editRoute: 'memory',
  });
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
    body: isFictional ? '' : currentTimeLine(persona?.name || '对方'),
    kind: 'computed',
  });
  // 7d. 当前地点 — 跟时间同性质的稳定事实(几个 token,不随对话变),改成
  //   静态注入而不是工具调用。原 get_location 工具弱模型经常 who 传反 把
  //   角色城市当成 user,或干脆不调,体验时灵时不灵。注入后白纸黑字写明
  //   双方城市,模型不用猜。Label(虚构名)优先,Key(真实城市)只给时区/
  //   天气工具用。架空模式跳过(中世纪角色不该知道"上海")。受
  //   session.{char,user}LocEnabled 双开关 + label/key 任一非空才注入。
  const locLines = [];
  if (!isFictional) {
    if (session.charLocEnabled && (session.charCityLabel || session.charCityKey)) {
      locLines.push(`你在:${session.charCityLabel || session.charCityKey}`);
    }
    if (session.userLocEnabled && (session.userCityLabel || session.userCityKey)) {
      locLines.push(`对方在:${session.userCityLabel || session.userCityKey}`);
    }
  }
  parts.push({
    key: 'current-loc',
    title: '# 当前地点',
    body: locLines.join('\n'),
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
  // 8b''. 生理状态(用户)— 双门控(cycle.enabled + cycle.visibleToChat)+ 仅
  //  在「进行中」/「浮动窗口内」才生成内容,平日 return '' 不渲染。纯事实
  //  陈述,不写行为引导(铁律 3)。架空模式下也跳过(现代生理用品 / 经期 app
  //  不一定在 in-world 存在)。
  const cycleLine = isFictional ? '' : await buildCycleStatus();
  parts.push({
    key: 'cycle',
    title: '# 生理状态(用户)',
    body: cycleLine,
    kind: 'data',
    editRoute: 'cycle',
  });
  // 8e. 关于{用户真名} — per (角色×人设) 的画像。lookup 先精确匹配 charId|
  //  personaId 再 fallback charId|(共享行)。500 字以内,渲染 likes/dislikes/
  //  discoveries 三行(空段不出现)。
  //  Section title 跟内容里的指代都用 persona.name(真名),不用"你"——
  //  prompt 里大量段落「你 = character」,这一段如果写「关于你」让模型把
  //  自己当成 user 容易出戏。直接用 user 真名最不会混淆。
  //  手动编辑入口:记忆 app → 关于你 tab。
  const userProfileName = persona?.name || '用户';
  const profileLines = await buildUserProfileLine(character.id, session.personaId, userProfileName);
  parts.push({
    key: 'user-profile',
    title: `# 关于${userProfileName}`,
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
  // 9. 动作使用规约 — WHEN / in what context to use each action.
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
  // 10a. 额外要求 — 用户在桌宠助手面板写的额外提示词。两层:全局
  //      (settings.extraPromptGlobal)+ 本会话(session.extraPrompt),全局在前。
  //      用户主动写的需求,每次生成都注入(等同 system 补充;铁律 3 禁的是 app
  //      硬塞角色行为引导,这是用户自己的指令,允许)。空则整段不注入。
  const extraGlobal  = subUser((settings.extraPromptGlobal || '').trim());
  const extraSession = subUser((session.extraPrompt || '').trim());
  const extraBody = [extraGlobal, extraSession].filter(Boolean).join('\n\n');
  if (extraBody) {
    parts.push({ key: 'extra-requirements', title: '# 额外要求', body: extraBody, kind: 'data' });
  }
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
  // 11. 本次重新生成的要求(per-call regenHint — 长按 regenerate 弹的 modal)
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
  'timeline-index':'memory',
  'mem-l2':        'memory',
  'mem-l1':        'memory',
  'current-time':  'state',
  'current-loc':   'state',
  'social':        'state',
  'schedule':      'state',
  'checkins':      'state',
  'cycle':         'state',
  'user-profile':  'state',
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
  // T15 normalize:老 V2 数据 summary 可能是整段 JSON 字符串,剥离一下
  const cleanSummary = normalizeMemorySummary(m.summary || '');
  // V4 多卡:title 简短,放在 summary 前面让模型更好定位章节(quotes 不注入
  // prompt — 给用户翻看的,模型有 summary 已够,quotes 进 prompt 翻倍 token)。
  const titlePrefix = m.title ? `[${m.title}] ` : '';
  const body = `${titlePrefix}${cleanSummary}`;
  if (!timeOn) return body;
  const fromTs = m.fromTs ?? m.createdAt;
  const toTs   = m.toTs   ?? m.createdAt;
  if (!Number.isFinite(fromTs)) return body;
  const fmt = (ts) => {
    const d = new Date(ts);
    return `${d.getMonth()+1}月${d.getDate()}日`;
  };
  const range = fmt(fromTs) === fmt(toTs) ? `【${fmt(fromTs)}】` : `【${fmt(fromTs)}–${fmt(toTs)}】`;
  return `${range} ${body}`;
}

// Anchor line for the "# 当前时间" segment. 标注成「{用户名}所处地点的当前时间」,
// 让模型分清这是对方(用户设备所在地)的时间,不是角色自己所在地的时间(角色那边
// 看 # 当前地点 + get_current_time 工具)。时间戳格式仍与 surveillance.js nowLine 一致。
function currentTimeLine(userName) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} 星期${weekday}`;
  return `${userName}所处地点的当前时间:${stamp}`;
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

// Shared query text builder — last N turns regardless of role. Including
// the most-recent assistant turn matters because short user replies like
// "对 那个" are basically useless as queries on their own; the assistant's
// preceding "上次你说想去京都" carries the topic the user is responding to.
// Extracted out so buildVectorRecallLines and buildWorldbookVectorLines can
// share the same text + downstream LRU-cached embedding call.
const VECTOR_QUERY_TURN_COUNT = 5;
async function buildRecentQueryText(sessionId) {
  const allMsgs = (await db.query('chatMessages', 'sessionId', sessionId))
    .filter(m => !m.archived && m.role !== 'system');
  if (allMsgs.length === 0) return '';
  allMsgs.sort((a, b) => a.createdAt - b.createdAt);
  const recent = allMsgs.slice(-VECTOR_QUERY_TURN_COUNT);
  return recent
    .map(m => {
      const who = m.role === 'user' ? '用户' : '角色';
      const text = (m.actions || []).map(a => a.content || a.description || '').filter(Boolean).join(' ');
      return text ? `${who}:${text}` : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

// Vector retrieval for worldbook entries — same query text as memory recall,
// embedding LRU cache dedups the API call when both builders resolve to the
// same upstream endpoint.
async function buildWorldbookVectorLines(characterId, queryText) {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.embedding?.enabled !== true) return '';
  if (!queryText) return '';
  let hits = [];
  try {
    hits = await embedding.topKWorldbookEntriesForQuery(characterId, queryText);
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
// excludeIds:跳过已经在 linear L1/L2 段全量注入的 memory ids,防止同一段
//   summary 出现两次(linear 叙事 + vector 召回)— 既省 token 又避免模型
//   重复消化。linear 段一定全注入(是骨架叙事),vector 是"补充"。
// injectQuotes:strong-match (≥0.7) 的卡片附 quotes(关键原话)。默认关 —
//   quotes 是给用户翻看的高密度信息,只在 vector 强命中时入 prompt 信息价
//   值才超过 token 成本(L1/L2 全量段一刀切不附,否则爆 token)。
const QUOTES_INJECT_THRESHOLD = 0.7;
async function buildVectorRecallLines(sessionId, queryText, excludeIds, injectQuotes) {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.embedding?.enabled !== true) return '';
  if (!queryText) return '';
  let hits = [];
  try {
    hits = await embedding.topKMemoriesForQuery(sessionId, queryText, undefined, { excludeIds });
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
    const cleanSummary = normalizeMemorySummary(memory.summary || '');
    const titlePrefix = memory.title ? `[${memory.title}] ` : '';
    let block = `(相关度 ${pct}%)${titlePrefix}${cleanSummary}`;
    if (injectQuotes && score >= QUOTES_INJECT_THRESHOLD
        && Array.isArray(memory.quotes) && memory.quotes.length > 0) {
      const lines = memory.quotes.slice(0, 5).map(q => `  · ${q}`).join('\n');
      block += `\n  关键原话:\n${lines}`;
    }
    return block;
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
  // 注入顶部加一行明示时间是用户本地时区。如果跨时区,角色读到 "今天
  // 14:00" 时知道这是用户那边的钟点,不会按自己时区误解。
  const header = '(以下时间均为用户本地时区。)';
  const body = relevant.map(e => {
    const who = e.who === 'user' ? userLabel : charLabel;
    const status = statusOf(e);
    const desc = e.desc ? ` — ${e.desc}` : '';
    return `- ${who} ${fmtTime(e.startTs)}${status} ${e.title}${desc}`;
  }).join('\n');
  return `${header}\n${body}`;
}

// 生理期状态 — 双门控:enabled + visibleToChat。仅 in-period / fluctuation
// 才生成 body(其它阶段 return '' 不渲染)。纯事实陈述,无行为引导(铁律 3)。
//   in-period:「用户目前在生理期(第 X 天 / 共约 N 天)。这是 ta 真实的身
//     体状态,具体如何反应由你的人设决定。」
//   fluctuation:「用户近期可能进入生理期(预测窗口内)。」
// T23 数据源换了 — 从 checkinTypes 里找 kind='period' 的 type,读它 cycleConfig
// 字段(双门控仍是 enabled + visibleToChat,但都挂在 type.cycleConfig 上)。
// 行为 / prompt 文案不变,只是 backing store 换了。
export async function buildCycleStatus() {
  const types = await db.getAll('checkinTypes');
  const periodType = findPeriodType(types);
  if (!periodType) return '';
  const cfg = periodType.cycleConfig || {};
  if (!cfg.enabled) return '';
  if (cfg.visibleToChat !== true) return '';
  const status = computePeriodStatus(cfg);
  if (status.phase === 'in-period') {
    return `用户目前在生理期(第 ${status.dayInPeriod} 天 · 通常持续 ${status.periodLength} 天)。这是 ta 真实的身体状态,具体如何反应由你的人设决定。`;
  }
  if (status.phase === 'fluctuation') {
    return `用户近期可能进入生理期(预测窗口 ${status.winStart} – ${status.winEnd})。这是预测,不是确定 — 仅供你参考 ta 可能的状态。`;
  }
  return '';
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
    if (t.kind === 'period') continue;  // 生理期走 buildCycleStatus(双门控),不混进通用打卡摘要泄漏经期天数
    const thisType = all.filter(c => c.typeId === t.id);
    const monthCount = thisType.filter(c => c.dayKey.startsWith(monthPrefix) && c.dayKey <= todayKey).length;
    lines.push(`- ${t.name}:本月已打 ${monthCount}/${todayDay} 天`);
  }
  return lines.join('\n');
}

// 用户画像 — per (角色×人设) 的"角色眼中的 user"。
// id = composite `${characterId}|${personaId}`,personaId 留空 = "所有人设共享"。
// Lookup:先精确匹配 charId|sessionPersonaId,落空 fallback charId|;两者皆无
// 返回 ''(prompt 注入空 → 不渲染该 part)。
// 渲染格式(空段跳过):用 user 真名指代,不用"ta" / "你"。理由:prompt
//   大量段落「你 = character」,这一段用代词会让模型混淆 user / character;
//   真名最直接。
//   {name} 喜欢:...
//   {name} 不喜欢:...
//   你发现 {name}:...
// 整段尽量简洁,不要长篇大论 — UI 已限 500 字。
//
// personaName 由 caller 传 (`persona?.name || '用户'`)。
export async function buildUserProfileLine(characterId, sessionPersonaId, personaName) {
  if (!characterId) return '';
  const exactId = `${characterId}|${sessionPersonaId || ''}`;
  const sharedId = `${characterId}|`;
  let row = await db.get('userProfiles', exactId);
  if (!row && exactId !== sharedId) row = await db.get('userProfiles', sharedId);
  if (!row) return '';
  const name = (personaName || '').trim() || '用户';
  const lines = [];
  if (row.likes && row.likes.trim())       lines.push(`${name} 喜欢:${row.likes.trim()}`);
  if (row.dislikes && row.dislikes.trim()) lines.push(`${name} 不喜欢:${row.dislikes.trim()}`);
  if (row.discoveries && row.discoveries.trim()) lines.push(`你发现 ${name}:${row.discoveries.trim()}`);
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
// V1:纯文本 summary。V2 (JSON):bundle {summary, tag} JSON 输出 — 易被 LLM 在
// summary 内容里用未 escape 的双引号破坏 JSON。V3 (行式):用 `摘要:` / `标签:`
// 两行,summary 里随便什么字符都不破坏 schema。V4 (多卡 [CARD] 块):一次压缩
// 可产出 1-3 张「故事卡」,每卡 title + summary + quotes + tag + importance。
// V4 仍 fallback 兼容 V3 老输出,parseMemoryOutput 返回 array,旧 V3 直接当 1 卡。
const DEFAULT_MEMORY_SYS = '你是对话压缩助手。把下面这段对话压成 1-3 张「故事卡」,每张卡聚焦一个独立故事段落。模型自己判断:对话明显涵盖多个独立主题(比如先吵架后和好,或先回家后出门)时切多张;单一主题就只出 1 张。**每张卡必须是一段叙事完整的故事**(有剧情内容 / 起因 / 过程 / 结果或转折),不要只写一句话标语或单独成句;同时**单卡摘要严格控制在 200 字以内**(多卡情况下各自独立计算,不共享配额)。**摘要只客观叙述发生了什么(谁说了什么、做了什么、表现了什么),不要写"这反映了…" / "可以看出…" / "这是关系的关键节点" 这类主观定性或评价句。打标和重要度交给后面的标签/重要度字段**';

const MEMORY_OUTPUT_RULES = `
**输出格式严格按下面 [CARD] 块结构,不要 JSON、不要 markdown 包裹、不要前后缀文字**:

[CARD]
标题: <8 字内,概括这段对话的主题(像章节名)>
摘要: <这一段的中文摘要,不超过 200 字。可放心使用任何标点包括双引号。**用对话双方的真名指代他们**,不要写"用户和角色"。>
关键原话: <可省略;每行一条,格式 "说话人→对方: 原话内容";1-5 条>
标签: <6 类之一>
重要度: <high 或 low>
[/CARD]

如对话明显涵盖 2-3 个独立段落,可连续输出多个 [CARD] 块,最多 3 张卡。
不确定就只出 1 张卡把所有内容压进去。

标签从下列 6 类挑 1 个:
- 转折 — 关系的关键节点(初见 / 表白 / 误会冰释 / 分别 等)
- 亲密 — 温柔、深入、暖的时刻
- 冲突 — 摩擦、争吵、紧张
- 发现 — 知道对方 / 自己的新事实
- 约定 — 计划 / 承诺
- 日常 — 闲聊、未归类(兜底)

重要度只填 high 或 low — high 仅留给关系转折 / 情感高点 / 关键约定;日常聊天填 low。拿不准就「日常 + low」。

**可选的用户画像增量(只在确实发现关于用户的新事实时输出,否则整段省略)**:
如果这段对话里**明确说出或确认了**关于用户的新事实(喜好 / 厌恶 / 职业 / 习惯 / 家庭 / 关系 等),在所有 [CARD] 之后追加一个 [PROFILE_PATCH] 块。**日常闲聊不要硬塞,凭空臆测会污染画像**。

[PROFILE_PATCH]
喜欢: <一行一条;只填这段对话里新发现的;省略整行如果没有>
不喜欢: <一行一条>
你发现: <一行一条;其它非喜好类事实 — 职业/居住/性格/关系/习惯等>
[/PROFILE_PATCH]

**时间索引(必填一行)**:
在所有上述块之后,追加一个 [TIMELINE] 块,**单行**,作为这段对话在时间轴上的索引。注入 prompt 时用,保留更长时间作为时间锚点(可能很久后还会读)。格式:
\`\`\`
[TIMELINE]
YYYY-MM-DD HH:MM-HH:MM 真名 真名 简短事件(≤30 字,中性叙述,不带"她/他",用对话双方真名)
[/TIMELINE]
\`\`\`
例子: \`2026-05-22 14:30-15:30 问影渠 渠 咖啡馆聊到她哥哥的近况\`(personaName + charName 用空格分隔,直接写真名,**不要加任何包装符号** — 没有花括号 / 方括号 / 引号)。
时间从对话里 [HH:MM] 时间戳取首末时刻;日期是这段对话的实际日期。`;

// 解析单个 CARD 块内容(不含 [CARD] / [/CARD] 标记),返回 {title?, summary,
// quotes?, tag?, importance}。各字段缺失时省略(quotes 空数组也省略)。
function parseCardBlock(block) {
  const card = { summary: '', importance: 'low' };
  // 标题
  const titleMatch = block.match(/(?:^|\n)\s*(?:标题|TITLE)[::]\s*(.+?)(?=\n|$)/);
  if (titleMatch) {
    let t = titleMatch[1].trim().replace(/^[「『"']+/, '').replace(/[」』"']+$/, '');
    if (t && t.length <= 40) card.title = t;
  }
  // 摘要 — 到下一个关键字行或块末
  const sumMatch = block.match(/(?:^|\n)\s*(?:摘要|SUMMARY)[::]\s*([\s\S]*?)(?=\n\s*(?:关键原话|标签|重要度|QUOTE|TAG|IMPORTANCE)[::]|\s*$)/);
  if (sumMatch) card.summary = sumMatch[1].trim();
  // 关键原话 — 多行收集
  const quotes = [];
  const quoteRe = /(?:^|\n)\s*(?:关键原话|QUOTE)[::]\s*(.+?)(?=\n|$)/g;
  let qm;
  while ((qm = quoteRe.exec(block)) !== null) {
    const q = qm[1].trim();
    if (q && q.length <= 200) quotes.push(q);
  }
  if (quotes.length > 0) card.quotes = quotes.slice(0, 5);
  // 标签
  const tagMatch = block.match(/(?:^|\n)\s*(?:标签|TAG)[::]\s*(\S+)/);
  if (tagMatch) {
    let tag = tagMatch[1].trim();
    const tagWord = tag.match(/^[一-龥A-Za-z]+/);
    tag = tagWord ? tagWord[0] : '';
    if (MEMORY_TAGS.includes(tag)) card.tag = tag;
  }
  // 重要度
  const impMatch = block.match(/(?:^|\n)\s*(?:重要度|IMPORTANCE)[::]\s*(\S+)/);
  if (impMatch) {
    const v = impMatch[1].trim().toLowerCase();
    if (v === 'high' || v === 'low') card.importance = v;
  }
  return card;
}

// Timeline 单行 — 从压缩输出里抽 [TIMELINE] 块,返回字符串(去前后空白)
//   或 null(模型没输出)。格式应该是 "YYYY-MM-DD HH:MM-HH:MM ${真名} ${真名} 事件",
//   但 LLM 实际可能漏掉或格式略乱 — 解析层只剥 block tag,内容原样存,
//   用户能看到就行(注入 prompt 也按原样)。
function parseTimelineBlock(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/\[TIMELINE\]([\s\S]*?)\[\/TIMELINE\]/i);
  if (!m) return null;
  const line = m[1].trim().split('\n')[0].trim();  // 单行,多吐的行只取首条
  if (!line || line.length > 200) return null;
  return line;
}

// 用户画像 patch — 从压缩输出里抽 [PROFILE_PATCH] 块,返回 { likes, dislikes,
//   discoveries }(都是字符串数组,空段不返回)。模型可能没输出整段就返回 null。
function parseProfilePatch(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/\[PROFILE_PATCH\]([\s\S]*?)\[\/PROFILE_PATCH\]/i);
  if (!m) return null;
  const block = m[1];
  const extract = (label) => {
    const re = new RegExp(`(?:^|\\n)\\s*${label}[::]\\s*([\\s\\S]*?)(?=\\n\\s*(?:喜欢|不喜欢|你发现)[::]|$)`, 'i');
    const mm = block.match(re);
    if (!mm) return [];
    return mm[1].split('\n')
      .map(s => s.trim().replace(/^[-•·]\s*/, ''))
      .filter(s => s && s.length <= 100)
      .slice(0, 5);  // cap 防模型话痨
  };
  const likes       = extract('喜欢');
  const dislikes    = extract('不喜欢');
  const discoveries = extract('你发现');
  if (likes.length === 0 && dislikes.length === 0 && discoveries.length === 0) return null;
  return { likes, dislikes, discoveries };
}

// 合并 patch 到 userProfiles。compositeId = `${charId}|${personaId}`。已有就
// append(每条新事实加一行,简单字符串包含去重);没有就新建。
//
// FIFO cap(每段独立 cap):每个字段上限默认 20 条(settings.memoryProfileCap
// 可调)。超出时从最老的几条砍掉 — append 顺序按时间走,最老的就是 split
// 后开头几条。设这个 cap 是因为长期用户的 likes / discoveries 会无限增长,
// 注入 prompt 的「# 关于你」段越来越长(同时模型也容易把不同时期的零散
// fact 混淆)。20 条一个段已经够覆盖关键 trait,旧条目自然遗忘是健康的。
async function mergeProfilePatch(characterId, personaId, patch) {
  if (!patch) return;
  const id = `${characterId}|${personaId || ''}`;
  const existing = await db.get('userProfiles', id);
  const settings = (await db.get('settings', 'default')) || {};
  const cap = Number.isFinite(settings.memoryProfileCap) && settings.memoryProfileCap > 0
    ? settings.memoryProfileCap : 20;
  const now = Date.now();
  const merge = (oldText, newLines) => {
    const oldLines = (oldText || '').split('\n').map(s => s.trim()).filter(Boolean);
    const seen = new Set(oldLines.map(s => s.toLowerCase()));
    const toAdd = newLines.filter(s => !seen.has(s.toLowerCase()));
    if (toAdd.length === 0 && oldLines.length <= cap) return oldText || '';
    const combined = [...oldLines, ...toAdd];
    // FIFO cap:超 cap 时从开头切掉(最老的优先丢)。
    const capped = combined.length > cap ? combined.slice(combined.length - cap) : combined;
    return capped.join('\n');
  };
  const next = existing || {
    id, characterId, personaId: personaId || '',
    likes: '', dislikes: '', discoveries: '',
    createdAt: now,
  };
  next.likes       = merge(next.likes,       patch.likes);
  next.dislikes    = merge(next.dislikes,    patch.dislikes);
  next.discoveries = merge(next.discoveries, patch.discoveries);
  next.updatedAt   = now;
  await db.set('userProfiles', next);
}

// V4 解析:返回一个 cards 数组。每张卡 {title?, summary, quotes?, tag?, importance}。
// 先尝试匹配 [CARD]...[/CARD] 块 → 多卡;若没匹配到尝试 V3 单卡格式;再不行
// 退回整段当 summary 一张 low 卡。模型走样输出 (markdown 包裹 / json 包裹) 都
// 自动剥离。中英文冒号都接受。
function parseMemoryOutput(raw) {
  if (typeof raw !== 'string') return [];
  const cleaned = raw.trim()
    .replace(/^```(?:json|text)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // V4 多卡
  const cards = [];
  const blockRe = /\[CARD\]([\s\S]*?)\[\/CARD\]/gi;
  let m;
  while ((m = blockRe.exec(cleaned)) !== null) {
    const card = parseCardBlock(m[1].trim());
    if (card.summary) cards.push(card);
  }
  if (cards.length > 0) return cards.slice(0, 3);

  // V3 单卡 fallback
  const single = parseCardBlock(cleaned);
  if (single.summary) return [single];

  // 兜底:整段当 summary 一张 low 卡
  return [{ summary: cleaned, importance: 'low' }];
}

// 老数据兜底:V2 时代生成的 memory.summary 字段可能存了整段 JSON 字符串
// (LLM 在 summary 内容里用未 escape 的 " 让 JSON.parse 失败 → fallback 把
// raw 整段写进 summary)。render 端调用此 helper 检测并剥离,不动 IDB
// 数据 — 跑过的 memory 不重新压,只在显示时挽救。
//
// 检测条件:summary 以 `{` 开头并含 `"summary"`。不严格 JSON 验证,因为
// 问题就出在「看起来像 JSON 但 parse 不通过」。
// 提取方式:正则匹配 `"summary":"....","tag":...` 取中间内容。
export function normalizeMemorySummary(summary) {
  if (typeof summary !== 'string') return '';
  const s = summary.trim();
  if (!s.startsWith('{') || !s.includes('"summary"')) return s;
  // 优先 JSON.parse(罕见情形:合法 JSON 因某种原因被整段当 summary 存了 —
  // 我们能正确 unescape `\"` `\\` 等转义)。
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed.summary === 'string') return parsed.summary;
  } catch (_) { /* JSON 解析失败,fall through 到 regex */ }
  // 常见情形:LLM 在 summary 内用了未 escape 的双引号,JSON.parse 炸。正则
  // 取 `"summary":"..."` 中间部分;不会 100% 正确(没可靠分隔符),但能取
  // 到 LLM 那种 bad JSON 的主体内容。
  const m = s.match(/"summary"\s*:\s*"([\s\S]*?)"\s*,\s*"tag"/);
  if (m) return m[1];
  const m2 = s.match(/"summary"\s*:\s*"([\s\S]*)"\s*\}?\s*$/);
  if (m2) return m2[1];
  return s;
}

// 扫 archived msgs 的 action 列表,生成「这次发生了」事件链 plain 文字 chip 数组。
// 跟参考酒馆站的差异化:她总结的是"戏剧章节",我们多了一层"手机事件"维度
// (红包/转账/语音/照片/撤回/位置/计划/解封)。零 AI 成本 — actions 数据已有。
//
// 聚合规则:
//   - 红包 / 转账:每笔单独列(金额 + 方向 + 状态)
//   - 位置 / 计划:每条单独列(目的地 / 计划标题)
//   - 解封请求:列一条
//   - 语音 / 照片 / 撤回:按类型计数合并("语音 4 条")
//   - text / reply:跳过(已被 summary 覆盖)
//
// 返回 string[](可能为空)。每条 plain 中文,无 emoji。
export function extractMemoryEvents(msgs) {
  const events = [];
  const counts = { voice: 0, image: 0, recall: 0 };
  let voiceDuration = 0;
  for (const msg of (msgs || [])) {
    const dir = msg.role === 'user' ? '用户→角色' : (msg.role === 'character' ? '角色→用户' : '');
    for (const a of (msg.actions || [])) {
      switch (a.type) {
        case 'voice':
          counts.voice++;
          voiceDuration += Number(a.duration) || 0;
          break;
        case 'image':
          counts.image++;
          break;
        case 'recall':
          counts.recall++;
          break;
        case 'red_packet': {
          const status = a.claimed ? '已领' : (a.returned ? '已退回' : '未领');
          events.push(`红包 ¥${a.amount || 0} ${dir} ${status}`);
          break;
        }
        case 'transfer': {
          const status = a.accepted ? '已收' : (a.returned ? '已退回' : '未收');
          events.push(`转账 ¥${a.amount || 0} ${dir} ${status}`);
          break;
        }
        case 'location':
          if (a.name) events.push(`位置 ${a.name}`);
          break;
        case 'add_schedule_entry':
          if (a.title) events.push(`定计划 ${a.title}`);
          break;
        case 'unblock_request':
          events.push('请求解除拉黑');
          break;
        // text / reply: 已被 summary 覆盖,跳过避免噪音
      }
    }
  }
  if (counts.voice > 0) {
    events.push(voiceDuration > 0 ? `语音 ${counts.voice} 条 共 ${voiceDuration}″` : `语音 ${counts.voice} 条`);
  }
  if (counts.image > 0) events.push(`照片 ${counts.image} 张`);
  if (counts.recall > 0) events.push(`撤回 ${counts.recall} 次`);
  return events;
}

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
// T17: 新规则按 dayKey 分组,每天一条 memory(取代旧的 batchSize 阶梯)。
//
// 行为:
//   - active = chatMessages 里没 archived 的,sort by createdAt
//   - normal 模式:active > threshold + buffer 时触发(memoryBuffer 默认 0 →
//     一超过 threshold 就压;设了缓冲就攒到 threshold+buffer 才压、压回
//     threshold)。把最早的溢出按 dayKey 分组,**只压最旧的一天**。
//   - force 模式:跳过 threshold buffer,把"今天以外"的活跃消息按 dayKey
//     分组压最旧一天。给 chat-info「立即提取记忆」按钮用。
//   - settings.memoryBatchSize 字段保留兼容(老用户读到不报错),但不再用
//
// 为什么每次只压一天:连续多天的 overflow 一次性 N 次 API 调用太慢,user
// 不愿意一直等。每次 AI 回复触发一次 maybeCompressMemory,渐进式消化 —
// 第一次压最旧 A 天,active 收缩,下次压 B 天,以此类推。
// 单次压缩的输入上限(估算 token)—— 防一天聊了几百条时 dump 撑爆模型上下文。
// 超了就只压最旧的一批,剩下的留到下一轮接着压(渐进分批,user 无感)。
const COMPRESS_TOKEN_BUDGET = 6000;
// 粗估 token:中文≈1.5/字,ASCII≈0.3/char(跟 chat.js token badge 同启发式)。
function estTokens(str) {
  if (!str) return 0;
  let ascii = 0, other = 0;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) < 128) ascii++; else other++;
  }
  return Math.ceil(ascii * 0.3 + other * 1.5);
}

const _compressInFlight = new Map();
// 公共入口 —— 把对同一 session 的并发压缩串行化:两个 caller(正常回复的自动
// 压缩 撞上 chat-info「立即提取」或 桌宠记忆助手)不能各自读到同一段未归档
// overflow、各写一条重复 memory + 重复 archive。镜像 requestReply 的 in-flight
// 锁,但下沉到函数本身,覆盖所有入口(之前只有 requestReply 有锁)。
export async function maybeCompressMemory(sessionId, opts = {}) {
  const existing = _compressInFlight.get(sessionId);
  if (existing) return existing;
  const p = (async () => {
    try { return await _maybeCompressMemoryImpl(sessionId, opts); }
    finally { _compressInFlight.delete(sessionId); }
  })();
  _compressInFlight.set(sessionId, p);
  return p;
}
async function _maybeCompressMemoryImpl(sessionId, opts = {}) {
  const { force = false } = opts;
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.memoryEnabled === false) return null;
  const threshold = Number.isFinite(settings.memoryThreshold) && settings.memoryThreshold > 0
    ? settings.memoryThreshold : 20;

  // Filter archived rows BEFORE the threshold check — without this, every
  // new message past threshold would re-include the already-archived rows
  // in `all`, picking the same overflow window and re-compressing the same
  // content into a brand new memory (and re-archive-stamping rows that
  // were already archived). The whole "compress once, hide" intent only
  // works when the threshold comparison is against active-only count.
  // 取全量(含 archived)一次:overflow / threshold 用 active-only(filter 后的
  // `all`),但 makeRenderContext 要用全量 —— 否则 reply 引用的消息若已在上一轮
  // 被 archive,resolveQuote 查不到 → 引用原文丢失,压缩质量下降。
  const allRows = await db.query('chatMessages', 'sessionId', sessionId);
  allRows.sort((a, b) => a.createdAt - b.createdAt);
  const all = allRows.filter(m => !m.archived);
  if (all.length === 0) return null;

  // 确定 candidate 集合(候选可压消息)
  //   normal: 只看溢出 threshold 缓冲的那部分
  //   force:  保留最近 threshold 条,其余一次全压(忽略缓冲、无天数上限)
  let candidates;
  if (force) {
    // 立即提取:留最近 threshold 条不压,其余全压。每次调用仍按 COMPRESS_TOKEN_BUDGET
    // 截断 dump → 自动分批;helper 面板的「立即提取」循环调到压完,防一次喂太多字 API 失败。
    candidates = all.length > threshold ? all.slice(0, all.length - threshold) : [];
  } else {
    // 「缓冲区」: 攒到 threshold + buffer 才触发(buffer 默认 0 → 一超过
    // threshold 就压,旧行为不变)。例:留存 100 + 缓冲 30 → 130 条才压一次、
    // 压回 100;给 user「别刚过线就压」的余量。仍保留最近 threshold 条不动。
    const buffer = Number.isFinite(settings.memoryBuffer) && settings.memoryBuffer >= 0
      ? settings.memoryBuffer : 0;
    if (all.length <= threshold + buffer) return null;
    candidates = all.slice(0, all.length - threshold);
  }
  if (candidates.length === 0) return null;

  // 按 dayKey 分组,取最旧的一天 — 单次 API 调用压一天,渐进消化
  const byDay = new Map();
  for (const m of candidates) {
    const k = dayKeyOf(m.createdAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(m);
  }
  const sortedDays = [...byDay.keys()].sort();
  const oldestDay = sortedDays[0];
  let overflow = byDay.get(oldestDay);

  const session = await db.get('chatSessions', sessionId);
  // 拿真名注入 dump + prompt context — 让模型用 personaName / charName 而非
  // 「用户」「角色」泛指。Memory app 翻看时摘要直接读「沈青舟说她...」更
  // 有"我自己的关系"感,不是 LLM 输出味儿。fallback 到泛指防止 character/
  // persona 被删后 dump 出现 undefined。
  const character = session?.characterId ? await db.get('characters', session.characterId) : null;
  const persona   = session?.personaId   ? await db.get('personas',   session.personaId)   : null;
  const personaName = (persona?.name   || '').trim() || '用户';
  const charName    = (character?.name || '').trim() || '角色';

  // Pass quote-resolver into renderActionsAsText so reply 引用原文 inlined
  // in the dump too (B#8). 用 allRows(含 archived)让跨窗口引用也能 resolve。
  const ctx = makeRenderContext(allRows);
  // 单次压缩上限:按估算 token 截断 overflow,取最旧的一批(至少 1 条),剩下
  // 的留到下一轮 —— 重的一天自动分批,不会一次 dump 撑爆上下文。
  const lines = [];
  let estSoFar = 0;
  let cut = overflow.length;
  for (let i = 0; i < overflow.length; i++) {
    const m = overflow[i];
    const speaker = m.role === 'user' ? personaName : (m.role === 'character' ? charName : 'system');
    const line = `${speaker}: ${renderActionsAsText(m.actions ?? [], ctx)}`;
    if (i > 0 && estSoFar + estTokens(line) > COMPRESS_TOKEN_BUDGET) { cut = i; break; }
    lines.push(line);
    estSoFar += estTokens(line);
  }
  if (cut < overflow.length) overflow = overflow.slice(0, cut);
  const dump = lines.join('\n');

  const override = (session?.memoryPromptOverride || '').trim();
  // 拼三段:压缩规则 + 输出格式(JSON + 6 类 tag) + 风格补充(session-level)
  const sys = [
    DEFAULT_MEMORY_SYS,
    MEMORY_OUTPUT_RULES,
    override ? `\n# 风格补充(适用于 summary 字段的语气)\n${override}` : '',
  ].filter(Boolean).join('\n');

  // user message 顶部加一行明示双方真名,辅助模型在 summary / 标题 / 关键原话
  // 里都用真名。dump 里 speaker 已经是真名,这行起强化作用。
  const userMsg = `这是「${personaName}」和「${charName}」的对话。请在「标题」「摘要」「关键原话」三处都用这两个真名指代,不要写"用户"或"角色"。\n\n${dump}`;

  // 记忆压缩 / L2 合并 / timeline 合并 都走 settings.memoryApiConfigId
  //   (可选,fallback active)。让 user 给记忆用便宜模型省 token。
  const memoryApiConfigId = settings.memoryApiConfigId || null;
  const raw = await ai.callAI({
    systemPrompt: sys,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.3,
    apiConfigId: memoryApiConfigId,
  });

  // V4 多卡解析。每张卡独立写一行 memory,共享 groupId 方便记忆 app 一起 undo。
  // 兜底:模型没产出有效卡时 parseMemoryOutput 会塞一张 raw 当 summary 的 low 卡。
  const cards = parseMemoryOutput(raw);
  if (cards.length === 0) {
    cards.push({ summary: (raw || '').trim() || '(空)', importance: 'low' });
  }

  // Phase 2 用户画像 patch — 模型在 raw 末尾若输出 [PROFILE_PATCH] 块,
  //   解析后增量 merge 到 userProfiles[charId|personaId]。新事实简单字符
  //   串包含去重,不重复添加。失败不影响 memory 写入(fire-and-forget)。
  //   session?.characterId 防御:压缩过程中会话被删的极端情况,直接读
  //   .characterId 会 TypeError(mergeProfilePatch 是 async,会进 catch
  //   不崩主流程,但日志会脏)。
  const patch = parseProfilePatch(raw);
  if (patch && session?.characterId) {
    mergeProfilePatch(session.characterId, session.personaId, patch)
      .catch(e => console.warn('[context] profile patch merge failed:', e));
  }

  // 「这次发生了」事件链 — 扫 overflow 的非 text/reply actions(零 AI 成本)。
  // 跟参考酒馆站差异化:她总结的是"戏剧章节",我们多了一层"手机事件"维度
  // (红包/转账/语音/照片/撤回/位置/计划/解封)。同 overflow 范围内只挂在
  // 第一张卡(避免多卡同一段时间显示重复的事件)。
  const events = extractMemoryEvents(overflow);

  const stamp = Date.now();

  // Timeline v3 — 模型在 raw 末尾输出 [TIMELINE] 单行块,直接写一行 timeline。
  //   跟现有 generateMissingDays 的多事件 dayKey 行格式不同(那种留作老数据
  //   兼容);新格式 = 一段对话压缩 → 一行 timeline,fromTs/toTs 共享 overflow
  //   时间窗。写完后检查总数是否超阈值,超了触发 auto merge 最老的几条。
  //   注意 stamp 必须先声明 — 顺序敏感。
  const tlLine = parseTimelineBlock(raw);
  if (tlLine) {
    const tlRow = {
      id: db.newId(),
      sessionId,
      summary: tlLine,
      fromTs: overflow[0].createdAt,
      toTs:   overflow[overflow.length - 1].createdAt,
      createdAt: stamp,
    };
    db.set('timeline', tlRow)
      .then(() => maybeAutoMergeTimeline(sessionId))
      .catch(e => console.warn('[context] timeline write failed:', e));
  }

  const groupId = cards.length > 1 ? db.newId() : null;
  const newMems = cards.map((card, cardIdx) => ({
    id: db.newId(),
    sessionId,
    tier: 1,
    ...(card.title ? { title: card.title } : {}),
    summary: card.summary,
    ...(card.quotes && card.quotes.length > 0 ? { quotes: card.quotes } : {}),
    ...(card.tag ? { tag: card.tag } : {}),
    importance: card.importance || 'low',
    ...(groupId ? { groupId } : {}),
    // events 只挂第一张卡 — 多卡共享同一 overflow 时间窗,事件链是窗口级
    // metadata 而非卡片级(每张卡的"戏剧"不同,但底层手机事件是同一批)。
    ...(cardIdx === 0 && events.length > 0 ? { events } : {}),
    fromMsgId: overflow[0].id,
    toMsgId: overflow[overflow.length - 1].id,
    // 1a: 保留这段记忆覆盖的 wall-clock 时间范围。多卡同源 → 共享同一窗口
    // (模型把对话切成 N 卡,但底层覆盖的 chatMessages 范围一致)。
    fromTs: overflow[0].createdAt,
    toTs: overflow[overflow.length - 1].createdAt,
    createdAt: stamp,
  }));

  // archivedIntoMemoryId 指向第一张卡 — UI 的「点开看被总结的 N 条聊天」
  // 只需要知道这段 overflow 折在哪个 memory id 后面,任意一张卡都行。
  for (const msg of overflow) {
    msg.archived = true;
    msg.archivedAt = stamp;
    msg.archivedIntoMemoryId = newMems[0].id;
  }
  await db.txnPut({
    memories: newMems,
    chatMessages: overflow,
  });
  // 每张卡独立 embed — 故事粒度比单大段更精准,vector recall 能命中具体段落。
  for (const m of newMems) {
    embedding.embedMemory(m).catch(e => console.warn('[context] embed failed:', e));
  }
  await maybeRollupToL2(sessionId);
  // timeline v3:在 [TIMELINE] 块解析时已经写一行 + 触发 auto merge,不再
  //   独立调 generateMissingDays(那是老逻辑,只在 memory-app 手动扫描时用)。
  return newMems[0].id;
}

// Timeline 自动压缩 —— 把「今天以外、同一天有多条」的时间线压成这天一条。
//   不跨天合并(20 天各 1 条不动),也不按总数触发,所以不调 AI:直接把当天
//   多条事件按时间拼成一条(memory app 把 \n 渲染成换行,等于这天一个条目里
//   列出当天的事件)。settings.timelineAutoMergeEnabled 关掉则跳过。
//   今天还在累积 → 不压;区间行(start~end)/ 已合并行 → 不动。
//   保留原行打 mergedInto(不删)—— 否则 generateMissingDays 的 existingKeys
//   丢了这些天的 dayKey,下次扫描会把它们当「缺失天」重新生成出重复内容。
async function maybeAutoMergeTimeline(sessionId) {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.timelineAutoMergeEnabled === false) return;
  const today = dayKeyOf(Date.now());
  const rows = (await db.query('timeline', 'sessionId', sessionId)).filter(t => !t.mergedInto);
  const byDay = new Map();
  for (const t of rows) {
    const dk = t.dayKey;
    if (!dk || dk.includes('~') || dk === today) continue;  // 无 dayKey / 区间行 / 今天 → 不压
    if (!byDay.has(dk)) byDay.set(dk, []);
    byDay.get(dk).push(t);
  }
  for (const [dk, dayRows] of byDay) {
    if (dayRows.length < 2) continue;  // 这天只有一条,不用压
    dayRows.sort((a, b) => (a.eventIdx ?? 0) - (b.eventIdx ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const newRow = {
      id: db.newId(),
      sessionId,
      dayKey: dk,
      summary: dayRows.map(t => t.summary).join('\n'),
      fromTs: dayRows[0].fromTs ?? dayRows[0].createdAt,
      toTs:   dayRows[dayRows.length - 1].toTs ?? dayRows[dayRows.length - 1].createdAt,
      mergedFrom: dayRows.map(t => t.id),
      createdAt: dayRows[0].createdAt ?? Date.now(),
    };
    await db.set('timeline', newRow);
    for (const t of dayRows) { t.mergedInto = newRow.id; await db.set('timeline', t); }
  }
}

// Timeline 注入 prompt 段 — **全部注入**,按时间升序(老→新)。
//   不再有 timelineInjectCount setting(被 auto merge 阈值替代 — 超过阈值
//   合并最老的几条,总条数被自动控制,所以"全部"也不会失控)。
async function buildTimelineIndexLines(sessionId) {
  const rows = (await db.query('timeline', 'sessionId', sessionId))
    .filter(t => !t.mergedInto)
    .sort((a, b) => (a.fromTs ?? a.createdAt ?? 0) - (b.fromTs ?? b.createdAt ?? 0));
  if (rows.length === 0) return '';
  return rows.map(t => t.summary).join('\n');
}

// L2 rollup: when tier-1 summaries exceed L1_KEEP_RECENT, fold the oldest
// L1_BATCH of them into a single tier-2 章节 summary. The L2 prompt is
// different — it's "summary of summaries", so the framing emphasizes
// deduplication and preserving the emotional / relational arc rather than
// trying to capture every event again.
const L1_KEEP_RECENT = 8;
const L1_BATCH       = 4;
// V4 化:L2 也用 [CARD] 块结构,带 title / tag / importance。让远期记忆段在
//   prompt 注入和记忆 app 渲染时有统一的卡片骨架,vector 召回也能享受 tag
//   boost(原来 L2 没 tag,boost 全部按"日常"算)。老 L2 row 没 title/tag
//   /importance 自动 fallback(formatMemoryWithDate 处理),不动老数据。
//
// 字数上限放宽到 400(L2 是章节合并,需要比 L1 更长);quotes 选填(L2 不
//   是单段对话,quotes 意义低)。tag 仍从 6 类挑,importance 默认 high(L2
//   本身就是"挑剩下值得保留的章节")。
const DEFAULT_MEMORY_SYS_L2 = `你是对话章节合并助手。下面是同一段关系中按时间顺序的若干段已压缩的对话摘要(每段一张「故事卡」)。请把它们合并成一张更高维度的「章节卡」。

要求:
- 去重(同一件事不要在合并后重复出现)
- 保留情感主线、关系演变、关键事件转折
- 保留人名、地名、关键约定
- 删掉细枝末节,聚焦弧线
- 摘要≤400 字
- title 是这一章节的标题(8 字内)
- 标签从 6 类挑 1 个,importance 默认 high

**输出格式严格按 [CARD] 块,不要 JSON、不要 markdown 包裹、不要前后缀文字**:

[CARD]
标题: <8 字内章节名>
摘要: <≤400 字的中文章节摘要>
标签: <转折/亲密/冲突/发现/约定/日常 之一>
重要度: <high 或 low>
[/CARD]`;

async function maybeRollupToL2(sessionId) {
  const all = await db.query('memories', 'sessionId', sessionId);
  const l1 = all.filter(m => (m.tier ?? 1) === 1);
  if (l1.length <= L1_KEEP_RECENT) return null;
  l1.sort((a, b) => a.createdAt - b.createdAt);
  const toMerge = l1.slice(0, Math.min(L1_BATCH, l1.length - L1_KEEP_RECENT));
  if (toMerge.length < 2) return null;
  const dump = toMerge.map((m, i) => {
    const t = m.title ? `[${m.title}] ` : '';
    return `[${i + 1}] ${t}${m.summary}`;
  }).join('\n\n');
  let raw;
  try {
    const settings = (await db.get('settings', 'default')) || {};
    raw = await ai.callAI({
      systemPrompt: DEFAULT_MEMORY_SYS_L2,
      messages: [{ role: 'user', content: dump }],
      temperature: 0.3,
      apiConfigId: settings.memoryApiConfigId || null,
    });
  } catch (e) {
    console.warn('[context] L2 rollup AI call failed (non-fatal):', e);
    return null;
  }
  // V4 解析:期望 1 张 [CARD]。模型走样(只吐 summary 没 [CARD] 块)→ 退回
  //   parseCardBlock 兜底,再失败用整段 raw 当 summary。importance 默认
  //   high — L2 本身就是被挑出来保留的章节,不该跟"日常"同级。
  const cards = parseMemoryOutput(raw);
  const card = cards[0] || { summary: (raw || '').trim() };
  const newId = db.newId();
  // 1a-fix: L2 之前漏了 fromTs/toTs,formatMemoryWithDate 退到 createdAt
  // 会显示成「L2 合并那天」而不是它覆盖的真实对话时间。从 toMerge 这批
  // L1 的 fromTs/toTs 取范围;老 L1 没这俩字段就 fallback 到 createdAt。
  const newL2 = {
    id: newId,
    sessionId,
    tier: 2,
    ...(card.title ? { title: card.title } : {}),
    summary: card.summary,
    ...(card.tag ? { tag: card.tag } : {}),
    importance: card.importance || 'high',
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
      // 连同它的 embedding 一起删,否则反复「重新生成总结」会留孤儿向量,
      // 每次召回都白算 cosine(L2 那条路径修过,这条之前漏了)。
      const embs = await db.query('embeddings', 'sourceId', mem.id);
      for (const emb of embs) await db.del('embeddings', emb.id);
      await db.del('memories', mem.id);
    }
  }
  // Re-trigger compression so the unarchived msgs get a new summary.
  return await maybeCompressMemory(sessionId);
}
