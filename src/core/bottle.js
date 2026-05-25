// Drift-bottle (漂流瓶) core.
//
// This is a NETWORK drift bottle — the "drift" / "bottle" / "sea" wording
// is metaphor; the app does NOT pretend you're fishing physical bottles
// out of the ocean. Whoever replies is an internet user (or one of your
// own contacts in `contacts` mode).
//
// Two audience modes (one reply per bottle, no threading either way):
//   - audience='contacts':  an existing non-blocked character replies.
//     Anonymity is the soul of the feature: that character does NOT know
//     who the user is — only the bottle's text. Reply via the bear/
//     character's own persona + ANONYMITY_FRAMING_FOR_CONTACTS.
//   - audience='strangers': synthesize a brand-new stranger persona via
//     STRANGER_PERSONA_GENERATOR_SYS, then have *that* persona reply.
//     Persona is stored on the bottle as generatedPersona so the user can
//     later "add as friend" to promote it into a real characters row.
//
// User-initiated "随机收一条" (fish a stranger's bottle) follows the
// stranger path: AI generates BOTH a fresh persona AND a fresh bottle
// content from that persona. User can reply once or add-as-friend.
//
// Generation is LAZY: bottles created with castAt/replyDueAt only become
// `replied` when scanDueBottles runs (boot + opening the bottle app) and
// finds replyDueAt <= now. Until then no API call happens — the bottle is
// just a row with status='drifting'. This is what makes the "回信几小时
// 后才来" feel cheap and credible.
//
// Author-written prompt content lives below at the // TODO(作者填写) markers.
// Claude does NOT fill these in (CLAUDE.md 铁律 3 + 10). Structure +
// placeholder examples only.

import { HUMANIZER_PROMPT } from './humanizer.js';

// Delay before a cast bottle gets a reply. Randomized to make it feel
// unpredictable rather than scheduled. 30min–4h is the design target.
const REPLY_DELAY_MIN_MS = 30 * 60 * 1000;
const REPLY_DELAY_MAX_MS = 4  * 60 * 60 * 1000;

export function randomReplyDelay() {
  const range = REPLY_DELAY_MAX_MS - REPLY_DELAY_MIN_MS;
  return REPLY_DELAY_MIN_MS + Math.floor(Math.random() * range);
}

// TODO(作者填写): 匿名漂流瓶的事实框架 — 联系人模式下,要让回信的角色知道
// 这是一封匿名漂流瓶,ta 不知道作者是谁(年龄/性别/跟自己的关系都未知),只能
// 凭瓶子内容反应。还要告诉模型这是一次性回信,不是聊天的开头。
//
// 这条注入到 system prompt,与 character.persona 并列。语气作者写。
const ANONYMITY_FRAMING_FOR_CONTACTS = `
// TODO(作者填写)
这是一封匿名漂流瓶。你不知道瓶子的主人是谁(年龄、性别、跟你的关系都未知)。
你只能凭瓶子里写的那段话来反应。
你的回信只有这一条,之后不会再有续聊。
按你的人设回应这段话即可,不要假设你认识对方。
`.trim();

// TODO(作者填写): 陌生人人格生成器的系统提示。这是 *网络* 漂流瓶,所以另一端
// 可能是任何人 — 不同国家不同时区、各种年龄段、各种身份职业、各种心情。强调
// 多样性 — 温柔大姐 / 冷淡哲学家 / 话很冲的初中生 / 失眠的程序员 / 喝醉的人 /
// 答非所问的怪咖 都可能出现。不要每次都温柔好人,不要默认中文母语者(也可能是
// 在国外凌晨刷手机的人)。
//
// 必须只输出 JSON: { "name": "...", "persona": "...", "vibe": "..." }
const STRANGER_PERSONA_GENERATOR_SYS = `
// TODO(作者填写)
你是网络漂流瓶陌生人生成器。这是一个网络平台上的匿名漂流瓶,任何在线的人
都可能捞到。基于读到的瓶子内容,凭空想象一个会捞到这条瓶子的网友。

要求:
- 多样性最重要 — 这个网友的国家、时区、年龄段、职业、性格、口吻、对瓶子的
  反应方式都可以差很多。可能是凌晨值班的护士、可能是答非所问的中学生、可能
  是话很冲的怪人、可能是冷淡的哲学家、可能是醉酒后乱回的中年人、可能是国外
  时区刚醒来的留学生。不要每次都来个温柔好人。
- persona 字段要"完整人设" — 不只是为了回这一条,而是日后这个人可能被"加好友"
  变成正式联系人,所以背景、关系、口头禅都应该有,~80-200 字。
- vibe 是一句概括 ta 的态度(给前端调底色用,可以是"温和"/"刻薄"/"游离"/"醉醺醺"等)。

只输出 JSON 对象,不要任何 JSON 以外的文字、不要 markdown 包裹。
格式:{"name": "...", "persona": "...", "vibe": "..."}
`.trim();

// TODO(作者填写): 陌生人写回信的系统提示 — 这条注入时已经带上了生成出来的
// persona,所以这里只写"框架":一次性匿名回信、保持口吻、只回一段、不要"嗨我是
// XXX"自报家门等。
const STRANGER_REPLY_FRAMING = `
// TODO(作者填写)
你刚捞到一封漂流瓶。按你的人设回信。
要求:
- 一段话,不分段、不列点。
- 不要自报家门(漂流瓶是匿名的)。
- 这是一次性回信,之后不会再有续聊。
- 不要假设你认识瓶子的主人。
`.trim();

// TODO(作者填写): 陌生人写"我自己扔出来的瓶子内容"的系统提示。要求模型现造
// 一段值得读到的瓶子内容(可以是某段心事、某个问题、一句感慨、某个观察 — 总之
// 是 ta 此刻想丢进海里的话),长度 30-120 字,一段话不分段。
const STRANGER_CAST_BOTTLE_SYS = `
// TODO(作者填写)
你刚写了一封漂流瓶扔进海里。按你的人设写这段话(就是用户即将读到的瓶子内容)。
要求:
- 30-120 字,一段话,不分段、不列点。
- 不要写"亲爱的陌生人"这种俗套抬头,也不要末尾署名。
- 内容可以是心事、感慨、问题、一段观察 — 是 ta 想丢进海里的话。
- 别太温柔甜美,别千篇一律,跟你的人设对得上。
`.trim();

// ── Scan + lazy reply generation ───────────────────────────────────────

// Find all drifting bottles whose replyDueAt has elapsed and generate
// replies for each in serial. Best-effort: failures log a warning and the
// bottle stays drifting (will retry on next scan).
export async function scanDueBottles(db, ai) {
  const drifting = await db.query('bottles', 'status', 'drifting');
  const now = Date.now();
  const due = drifting.filter(b => (b.replyDueAt ?? 0) <= now);
  for (const b of due) {
    try {
      await generateReply(db, ai, b);
    } catch (e) {
      console.warn(`[bottle] reply gen failed for ${b.id} — leaving drifting:`, e);
    }
  }
  return due.length;
}

async function generateReply(db, ai, bottle) {
  if (bottle.audience === 'contacts') {
    await replyAsContact(db, ai, bottle);
  } else {
    await replyAsStranger(db, ai, bottle);
  }
}

async function replyAsContact(db, ai, bottle) {
  const all = await db.getAll('characters');
  const candidates = all.filter(c => !c.blocked && c.id !== '__bear__');
  if (candidates.length === 0) {
    // No one available — leave drifting; next scan retries. UX-wise: the
    // bottle simply hasn't been seen by anyone yet.
    return;
  }
  const replier = candidates[Math.floor(Math.random() * candidates.length)];
  const sys = [
    HUMANIZER_PROMPT,
    '',
    '# 角色设定',
    replier.persona || '(无设定)',
    '',
    '# 匿名漂流瓶框架',
    ANONYMITY_FRAMING_FOR_CONTACTS,
  ].join('\n').trim();
  const userMsg = `瓶子里写的内容:\n\n${bottle.content}\n\n请你按你的人设,以匿名漂流瓶的形式回一条(只回一段话,不分段)。`;
  const reply = await ai.callAI({
    systemPrompt: sys,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.8,
  });
  bottle.status = 'replied';
  bottle.replierCharacterId = replier.id;
  bottle.reply = reply.trim();
  bottle.repliedAt = Date.now();
  await db.set('bottles', bottle);
}

async function replyAsStranger(db, ai, bottle) {
  const personaJson = await ai.callAI({
    systemPrompt: STRANGER_PERSONA_GENERATOR_SYS,
    messages: [{ role: 'user', content: `瓶子里写的:\n${bottle.content}` }],
    temperature: 0.95,
  });
  const persona = parsePersonaJSON(personaJson);
  if (!persona) {
    throw new Error('陌生人人格 JSON 解析失败:' + personaJson.slice(0, 200));
  }
  const sys = [
    HUMANIZER_PROMPT,
    '',
    '# 角色设定(陌生人)',
    `名字:${persona.name}`,
    persona.persona || '',
    '',
    '# 漂流瓶回信框架',
    STRANGER_REPLY_FRAMING,
  ].join('\n').trim();
  const userMsg = `瓶子里写的内容:\n\n${bottle.content}\n\n请按你的人设,以漂流瓶的形式回一条(只回一段话)。`;
  const reply = await ai.callAI({
    systemPrompt: sys,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.85,
  });
  bottle.status = 'replied';
  bottle.generatedPersona = persona;
  bottle.reply = reply.trim();
  bottle.repliedAt = Date.now();
  await db.set('bottles', bottle);
}

// User fishes a bottle. Generate persona first, then have it write a
// fresh bottle from that persona. Bottle is stored as authorIsUser=false,
// status='read' (no reply due — user can choose to send back, that's a
// separate one-shot stored as bottle.reply).
export async function fishBottle(db, ai) {
  const personaJson = await ai.callAI({
    systemPrompt: STRANGER_PERSONA_GENERATOR_SYS,
    messages: [{ role: 'user', content: '凭空想象一个会扔漂流瓶的陌生人 — 多样化,什么底色都可以。' }],
    temperature: 0.95,
  });
  const persona = parsePersonaJSON(personaJson);
  if (!persona) {
    throw new Error('陌生人人格 JSON 解析失败:' + personaJson.slice(0, 200));
  }
  const sys = [
    HUMANIZER_PROMPT,
    '',
    '# 角色设定(陌生人)',
    `名字:${persona.name}`,
    persona.persona || '',
    '',
    '# 写漂流瓶的框架',
    STRANGER_CAST_BOTTLE_SYS,
  ].join('\n').trim();
  const content = await ai.callAI({
    systemPrompt: sys,
    messages: [{ role: 'user', content: '请按你的人设,写一段你想丢进海里的话。' }],
    temperature: 0.95,
  });
  const now = Date.now();
  const bottle = {
    id: db.newId(),
    content: content.trim(),
    authorIsUser: false,
    audience: 'strangers',
    status: 'read',
    generatedPersona: persona,
    reply: null,
    castAt: now,
    replyDueAt: null,
    repliedAt: null,
  };
  await db.set('bottles', bottle);
  return bottle;
}

// Promote a generatedPersona on a bottle into a real characters row, so
// the user can chat with this stranger normally afterward. Returns the
// new character row, or the existing one if already promoted (the bottle
// stores promotedCharacterId).
export async function promoteStrangerToFriend(db, bottle) {
  if (bottle.promotedCharacterId) {
    const existing = await db.get('characters', bottle.promotedCharacterId);
    if (existing) return existing;
  }
  const p = bottle.generatedPersona;
  if (!p) throw new Error('没有可升格的 generatedPersona');
  const now = Date.now();
  const character = {
    id: db.newId(),
    name: p.name || '匿名',
    persona: p.persona || '',
    avatar: p.avatar || null,
    notes: `来自漂流瓶(${new Date(bottle.castAt).toLocaleDateString('zh-CN')})`,
    blocked: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.set('characters', character);
  bottle.promotedCharacterId = character.id;
  await db.set('bottles', bottle);
  return character;
}

function parsePersonaJSON(raw) {
  if (typeof raw !== 'string') return null;
  const stripped = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === 'object' && parsed.name && parsed.persona) return parsed;
  } catch (_) {}
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (parsed && typeof parsed === 'object' && parsed.name && parsed.persona) return parsed;
    } catch (_) {}
  }
  return null;
}
