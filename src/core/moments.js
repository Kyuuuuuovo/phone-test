// 朋友圈 (Moments) core —— AI 生成逻辑,**纯按钮驱动**(用户按键才调 API,
// 跟聊天「让 AI 回复」一致 — 铁律 2「积攒后触发」)。没有任何自动/定时生成:
//
//   - generateCharacterMoment(db, ai):随机挑一个好友,按 ta 的完整 persona
//     现写一条朋友圈。页面顶部「让好友发条动态」按钮触发。
//   - generateReactionsFor(db, ai, momentId):给某条动态生成好友反应 —— 你发的
//     动态由随机 1-3 个好友点赞/评论;角色发的动态由作者(+1 个其他好友)反应,
//     这样你在 ta 的动态下评论后,按一下就能让 ta 回你。每条动态上的「让好友回应」
//     按钮触发。
//
// 都不进 chatMessages、不调聊天管线;数据单独存在 `moments` store(同 bottles /
// keepsakes)。prompt 是中性骨架(怎么发、怎么反应),语气/内容交给 character.persona
// (CLAUDE.md 铁律 3 —— 不给具体角色塞行为引导)。

import { HUMANIZER_PROMPT } from './humanizer.js';
import { parseTolerantJSON } from './util.js';

// 一条动态一次反应最多动用几个好友(控制 API 调用数)。
const MAX_REACTORS_PER_PASS = 3;

// ── prompt 骨架(中性,语气/内容交给 persona)──────────────────────────────

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
- **内容要贴合你的身份、处境和最近的生活,别硬凑跟你身份不搭的琐事**;别千篇一律、别太甜。
- 只输出动态正文,不要任何额外说明。
`.trim();

// ── 共享小工具 ──────────────────────────────────────────────────────────

async function friendRoster(db) {
  const all = await db.getAll('characters');
  return all.filter(c => !c.blocked && c.id !== '__bear__');
}

// Fisher–Yates 取前 n 个。
function pickN(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, n));
}

// ── 按钮:让某个好友发一条朋友圈 ───────────────────────────────────────────
export async function generateCharacterMoment(db, ai) {
  const friends = await friendRoster(db);
  if (friends.length === 0) return { ok: false, reason: 'no-friends' };
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
  if (!clean) return { ok: false, reason: 'empty' };
  const moment = {
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
    reactedAt: null,
    createdAt: Date.now(),
  };
  await db.set('moments', moment);
  return { ok: true, moment, author: author.name || '好友' };
}

// ── 按钮:给某条动态生成好友反应(点赞 / 评论 / 回你的评论)────────────────
export async function generateReactionsFor(db, ai, momentId) {
  const moment = await db.get('moments', momentId);
  if (!moment) return { ok: false, reason: 'not-found' };
  if (!Array.isArray(moment.likes)) moment.likes = [];
  if (!Array.isArray(moment.comments)) moment.comments = [];

  const friends = await friendRoster(db);
  if (friends.length === 0) return { ok: false, reason: 'no-friends' };

  // 角色发的动态 → 作者优先(好回你的评论)+ 至多再来 1 个;你发的动态 → 随机 1-3 个。
  let reactors;
  if (moment.authorType === 'character') {
    const author = friends.find(c => c.id === moment.authorId);
    const others = pickN(friends.filter(c => c.id !== moment.authorId), 1);
    reactors = [author, ...others].filter(Boolean);
  } else {
    reactors = pickN(friends, 1 + Math.floor(Math.random() * MAX_REACTORS_PER_PASS));
  }

  let likesAdded = 0, commentsAdded = 0;
  for (const c of reactors) {
    try {
      const res = await reactOnce(ai, c, moment);
      if (res.like && !moment.likes.some(l => l.by === c.id)) {
        moment.likes.push({ by: c.id, name: c.name || '' });
        likesAdded++;
      }
      if (res.comment) {
        moment.comments.push({ id: db.newId(), by: c.id, name: c.name || '', text: res.comment, at: Date.now() });
        commentsAdded++;
      }
    } catch (e) {
      console.warn('[moments] 单个好友反应失败', c.id, e);
    }
  }
  moment.reactedAt = Date.now();
  await db.set('moments', moment);
  return { ok: true, likesAdded, commentsAdded };
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
