// Desk pet (bear) — constants only. The pet has two layers:
//   1. Ambient bubble: rule-driven, NEVER calls the API. Picks a line from
//      AMBIENT_LINES below based on app state + time of day.
//   2. Real chat: tapping the floating orb opens a normal chat session
//      against the reserved character `__bear__` (persona = BEAR_PERSONA).
//      Goes through the existing chat pipeline — no new action types.
//
// IMPORTANT — author-written prompt content lives here:
//   - BEAR_PERSONA: the bear's character setting (its persona, voice,
//     tone, what it knows about, how it talks).
//   - AMBIENT_LINES: short ambient one-liners grouped by trigger key,
//     picked at random when that trigger condition is met.
// Both are stubbed below with placeholders. Claude does NOT fill these in;
// the author writes them. See CLAUDE.md 铁律 3 + 10: voice / wording is
// author work, not codegen.

// TODO(作者填写): 写小熊的人设。它是谁,什么语气,怎么称呼用户,知不知道
// 这是个 app 模拟器,会不会自称小熊,有什么口头禅,跟用户的关系预设是什么。
// 这条会塞进 chat 的 character.persona,经过现成 buildSystemPrompt 链路
// 进入系统提示。
//
// 示例(替换掉,别留着):
export const BEAR_PERSONA = `我是一只蓝色的小熊,陪着用户的桌宠。
温和,话不多,关心用户的日常。
看到用户长时间没说话会主动问一句,但不黏。`;

// TODO(作者填写): 氛围气泡文案。按触发条件分组,每组若干条,每次随机挑一句。
// 不要写得太长(气泡放不下) — 建议 8-20 字一句。语气跟 BEAR_PERSONA 一致。
//
// triggerKey 含义(规则,别动顺序):
//   no_api      — 没填 API 配置 / 没有活跃 config
//   no_chars    — 没有任何非内置角色(还没创建过角色)
//   stale_chat  — 距最近会话 lastMessageAt 超过 N 小时(默认 24h)
//   morning     — 本地 5:00 - 11:00
//   afternoon   — 本地 11:00 - 18:00
//   evening     — 本地 18:00 - 23:00
//   late_night  — 本地 23:00 - 5:00
//
// 至少给每个 key 一条;多条会随机挑。
export const AMBIENT_LINES = {
  no_api:      [/* TODO */ '记得先去设置里填 API 哦,不然我们都不能说话。'],
  no_chars:    [/* TODO */ '还没人能陪你聊天?要不创建一个角色?'],
  stale_chat:  [/* TODO */ '好像很久没聊天了。'],
  morning:     [/* TODO */ '早。'],
  afternoon:   [/* TODO */ '今天还顺利吗?'],
  evening:     [/* TODO */ '辛苦啦。'],
  late_night:  [/* TODO */ '这么晚还没睡?'],
};

// Reserved IDs. These are stable across sessions — DO NOT regenerate on
// boot. They're checked-for-existence and created once if missing.
export const BEAR_CHARACTER_ID = '__bear__';
export const BEAR_SESSION_ID   = '__bear_session__';

// Default avatar — author-provided URL, can be replaced by the user in
// 设置 → 桌宠. Stored on characters[__bear__].avatar like any character.
export const DEFAULT_BEAR_AVATAR = 'https://files.catbox.moe/en5v7n.png';

// Ambient bubble cooldown after the user dismisses a given trigger.
export const AMBIENT_DISMISS_COOLDOWN_MS = 6 * 60 * 60 * 1000;  // 6 hours

// Stale-chat threshold for the stale_chat trigger.
export const STALE_CHAT_THRESHOLD_MS = 24 * 60 * 60 * 1000;  // 24 hours

// Pick the highest-priority ambient trigger that's currently active and
// hasn't been dismissed within the cooldown. Returns { triggerKey, line }
// or null if nothing applicable.
export async function pickAmbientLine(deps) {
  const { db, getActiveApiConfig } = deps;
  const settings = (await db.get('settings', 'default')) || {};
  const dismissed = settings.petDismissed || {};
  const now = Date.now();

  function active(key) {
    const ts = dismissed[key];
    if (!ts) return true;
    return now - ts > AMBIENT_DISMISS_COOLDOWN_MS;
  }
  function pickOne(key) {
    const lines = AMBIENT_LINES[key];
    if (!lines || lines.length === 0) return null;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  // 1. No API config
  if (active('no_api')) {
    const cfg = await getActiveApiConfig();
    if (!cfg || !cfg.apiUrl || !cfg.apiKey || !cfg.modelName) {
      const line = pickOne('no_api');
      if (line) return { triggerKey: 'no_api', line };
    }
  }
  // 2. No non-bear characters
  if (active('no_chars')) {
    const chars = await db.getAll('characters');
    const real = chars.filter(c => c.id !== BEAR_CHARACTER_ID);
    if (real.length === 0) {
      const line = pickOne('no_chars');
      if (line) return { triggerKey: 'no_chars', line };
    }
  }
  // 3. Stale chat — last non-bear session lastMessageAt > N hours ago
  if (active('stale_chat')) {
    const sessions = (await db.getAll('chatSessions'))
      .filter(s => s.id !== BEAR_SESSION_ID);
    if (sessions.length > 0) {
      const newest = Math.max(...sessions.map(s => s.lastMessageAt || 0));
      if (newest > 0 && (now - newest) > STALE_CHAT_THRESHOLD_MS) {
        const line = pickOne('stale_chat');
        if (line) return { triggerKey: 'stale_chat', line };
      }
    }
  }
  // 4. Time-of-day greeting (always-on if nothing above hit)
  const h = new Date().getHours();
  let tod;
  if (h >= 5  && h < 11) tod = 'morning';
  else if (h >= 11 && h < 18) tod = 'afternoon';
  else if (h >= 18 && h < 23) tod = 'evening';
  else tod = 'late_night';
  if (active(tod)) {
    const line = pickOne(tod);
    if (line) return { triggerKey: tod, line };
  }
  return null;
}

// Idempotent: ensures the reserved bear character + session exist. Safe to
// call repeatedly (on every boot). Doesn't overwrite persona/avatar if the
// user has customized them.
export async function ensureBearExists(db, getActiveApiConfig) {
  let bear = await db.get('characters', BEAR_CHARACTER_ID);
  if (!bear) {
    bear = {
      id: BEAR_CHARACTER_ID,
      name: '小熊',
      persona: BEAR_PERSONA,
      avatar: DEFAULT_BEAR_AVATAR,
      notes: '',
      blocked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.set('characters', bear);
  }
  let sess = await db.get('chatSessions', BEAR_SESSION_ID);
  if (!sess) {
    const settings = await db.get('settings', 'default');
    sess = {
      id: BEAR_SESSION_ID,
      characterId: BEAR_CHARACTER_ID,
      personaId: settings?.activePersonaId || null,
      title: bear.name || '小熊',
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
      isPinned: true,
    };
    await db.set('chatSessions', sess);
  }
}
