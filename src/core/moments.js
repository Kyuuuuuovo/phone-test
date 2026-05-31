// 朋友圈 (Moments) core —— AI 生成逻辑,懒生成(仿 bottle.js)。
//
// 朋友圈是「熟人圈」:只有你和你的非拉黑角色(好友)参与,没有陌生人
// (陌生人是推特要做的)。两类 AI 生成,都 LAZY,只在打开朋友圈 app 时跑
// (scanDueMoments),不调聊天管线、不进 chatMessages —— 数据单独存在
// `moments` store,跟 bottles / keepsakes 一样自成一块:
//
//   1. 反应:你发的动态到期后(reactDueAt <= now)→ 随机挑 1-3 个好友,各自
//      按完整 persona 决定点赞 / 评论。你在某条动态下评论后,页面会把这条的
//      reactDueAt 重新 arm,好友 / 作者下次打开时能回你。
//   2. 好友自己发动态:节流地(距上次 ≥3h)让某个好友按 persona 发一条,
//      让 feed 不只有你自己。
//
// prompt 是中性骨架(怎么点赞评论 / 怎么发一条),语气交给 character.persona
// (CLAUDE.md 铁律 3 —— 不给具体角色塞行为引导)。

import { HUMANIZER_PROMPT } from './humanizer.js';
import { parseTolerantJSON } from './util.js';

// 好友看到你发的动态后多久会有反应。比漂流瓶短 —— 朋友圈反应更即时。
const REACT_DELAY_MIN_MS = 1  * 60 * 1000;   // 1 分钟
const REACT_DELAY_MAX_MS = 20 * 60 * 1000;   // 20 分钟
export function randomReactDelay() {
  return REACT_DELAY_MIN_MS + Math.floor(Math.random() * (REACT_DELAY_MAX_MS - REACT_DELAY_MIN_MS));
}

// 距上次「好友自己发动态」至少隔这么久,scan 才允许再生成一条(防刷屏)。
const CHAR_POST_THROTTLE_MS = 3 * 60 * 60 * 1000;  // 3 小时
// 你发的一条动态,单轮反应最多动用几个好友(控制 API 调用数)。
const MAX_REACTORS_PER_PASS = 3;

// ── prompt 骨架(中性,语气交给 persona)──────────────────────────────────

const REACT_SYS = `
你正在刷朋友圈,看到一条动态。按你的人设决定要不要点赞、要不要评论。
- 只输出 JSON:{"like": true/false, "comment": "评论内容,不想评论就空字符串"}
- comment 是一句朋友圈评论:口语、简短(≤30 字),贴合你的人设和你跟发布者的关系。
- 如果动态下已经有别人的评论,你可以接着聊 / 回应发布者或别人,但不要复读已有的话。
- 可以只点赞不评论,也可以都不做(like=false 且 comment 空)。
- 不要解释、不要写"作为AI",只输出那一行 JSON。
`.trim();

const COMPOSE_SYS = `
你要发一条朋友圈动态。按你的人设,写一条你此刻会发的朋友圈。
- 一段话,口语,像真人发朋友圈:日常、心情、吐槽、分享、感慨都行。
- 20-80 字,不分段、不列点、不加话题标签(#)、不加抬头或署名。
- 贴合你的人设,别千篇一律、别太甜。
- 只输出动态正文,不要任何额外说明。
`.trim();

// ── scan(打开朋友圈 app 时调用)───────────────────────────────────────────

// 模块级锁:tab 切换可能重复触发,防并发对同一条 moment 各生成一次反应。
let _scanning = false;
export async function scanDueMoments(db, ai) {
  if (_scanning) return 0;
  _scanning = true;
  try {
    const all = await db.getAll('moments');
    const now = Date.now();
    const due = all.filter(m => Number.isFinite(m.reactDueAt) && m.reactDueAt > 0 && m.reactDueAt <= now);
    for (const m of due) {
      try { await generateReactions(db, ai, m); }
      catch (e) { console.warn(`[moments] 反应生成失败 ${m.id} — 保留待下次:`, e); }
    }
    try { await maybeGenerateCharacterMoment(db, ai); }
    catch (e) { console.warn('[moments] 好友发动态生成失败:', e); }
    return due.length;
  } finally {
    _scanning = false;
  }
}

async function friendRoster(db) {
  const all = await db.getAll('characters');
  return all.filter(c => !c.blocked && c.id !== '__bear__');
}

// Fisher–Yates 取前 n 个(不依赖 sort 的稳定性,洗牌更均匀)。
function pickN(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, n));
}

async function generateReactions(db, ai, moment) {
  if (!Array.isArray(moment.likes)) moment.likes = [];
  if (!Array.isArray(moment.comments)) moment.comments = [];

  const friends = await friendRoster(db);
  if (friends.length === 0) {
    moment.reactDueAt = null;
    moment.reactedAt = Date.now();
    await db.set('moments', moment);
    return;
  }

  // 选反应者:
  //   角色自己发的动态 → 作者优先(这样你在 ta 的动态下评论能被 ta 回)+ 至多再来 1 个;
  //   你发的动态 → 随机 1-3 个好友。
  let reactors;
  if (moment.authorType === 'character') {
    const author = friends.find(c => c.id === moment.authorId);
    const others = pickN(friends.filter(c => c.id !== moment.authorId), 1);
    reactors = [author, ...others].filter(Boolean);
  } else {
    reactors = pickN(friends, 1 + Math.floor(Math.random() * MAX_REACTORS_PER_PASS));  // 1..3
  }

  for (const c of reactors) {
    try {
      const res = await reactOnce(ai, c, moment);
      if (res.like && !moment.likes.some(l => l.by === c.id)) {
        moment.likes.push({ by: c.id, name: c.name || '' });
      }
      if (res.comment) {
        moment.comments.push({ id: db.newId(), by: c.id, name: c.name || '', text: res.comment, at: Date.now() });
      }
    } catch (e) {
      console.warn('[moments] 单个好友反应失败', c.id, e);
    }
  }

  moment.reactDueAt = null;
  moment.reactedAt = Date.now();
  await db.set('moments', moment);
}

async function reactOnce(ai, character, moment) {
  const existing = (moment.comments || []).length
    ? moment.comments.map(cm => `${cm.name || '某人'}:${cm.text}`).join('\n')
    : '(还没有评论)';
  const authorLabel = moment.authorType === 'user'
    ? '你的好友(就是正在看朋友圈的用户)'
    : (moment.authorName || '一个好友');
  const sys = [
    HUMANIZER_PROMPT,
    '',
    '# 你的人设',
    character.persona || '(无设定)',
    '',
    '# 朋友圈反应规约',
    REACT_SYS,
  ].join('\n').trim();
  const userMsg = [
    `这条朋友圈是 ${authorLabel} 发的:`,
    `「${moment.text || ''}」`,
    '',
    '已有的评论:',
    existing,
    '',
    '请按你的人设输出 JSON:{"like": true/false, "comment": "..."}',
  ].join('\n');
  const raw = await ai.callAI({
    systemPrompt: sys,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.85,
  });
  const parsed = parseTolerantJSON(raw, { expect: 'object' }) || {};
  return {
    like: parsed.like === true,
    comment: typeof parsed.comment === 'string' ? parsed.comment.trim().slice(0, 60) : '',
  };
}

async function maybeGenerateCharacterMoment(db, ai) {
  const settings = await db.get('settings', 'default');
  const last = Number(settings?.lastCharMomentAt) || 0;
  const now = Date.now();
  if (now - last < CHAR_POST_THROTTLE_MS) return;

  const friends = await friendRoster(db);
  if (friends.length === 0) return;
  const author = friends[Math.floor(Math.random() * friends.length)];

  const sys = [
    HUMANIZER_PROMPT,
    '',
    '# 你的人设',
    author.persona || '(无设定)',
    '',
    '# 发朋友圈规约',
    COMPOSE_SYS,
  ].join('\n').trim();
  const text = await ai.callAI({
    systemPrompt: sys,
    messages: [{ role: 'user', content: '请按你的人设,发一条你此刻会发的朋友圈。' }],
    temperature: 0.95,
  });
  const clean = (text || '').trim();
  if (!clean) return;

  await db.set('moments', {
    id: db.newId(),
    authorType: 'character',
    authorId: author.id,
    authorName: author.name || '好友',
    authorAvatar: author.avatar || null,
    text: clean.slice(0, 280),
    images: [],
    likes: [],
    comments: [],
    visibility: 'all-friends',
    reactDueAt: null,   // 好友自己发的不自动引一堆反应;你评论后页面再 arm
    reactedAt: null,
    createdAt: now,
  });
  await db.updateSettings(s => { s.lastCharMomentAt = now; });
}
