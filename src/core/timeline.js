// Per-session timeline — one-line-per-day summaries for the USER to skim.
//
// Distinct from `memories` (which feed the AI as L1/L2 summaries):
//   - timeline is NOT injected into system prompt
//   - timeline is keyed by calendar day, not by message-count window
//   - timeline summaries are deliberately tight (≤50 chars / 一句话)
//   - users can merge multiple days into a single combined entry, and
//     undo the merge later
//
// Generation is LAZY but multi-pronged:
//   - chat-internal memory-manage's timeline tab has an explicit button
//   - memory-app's timeline tab also has a「扫描并生成缺失天」button
//   - context.maybeCompressMemory fires it for the current session after
//     each successful memory compression (fire-and-forget)
//   - today is never summarized (the day isn't over)
//   - each dayKey is summarized at most once; if a row already exists for
//     a day, that day is skipped — no re-summarization unless the user
//     deletes the row first
//
// The 50-char cap is enforced two ways: prompt instruction + post-trim
// truncation. The truncation is a backstop (cheap) rather than a retry
// (expensive) — a model that overshoots gets a slightly clipped line
// with an ellipsis, not another API call.

import * as db from './db.js';
import * as ai from './ai.js';

// AUTHOR-LOCKED sys prompt for daily summaries. Edit voice / tone here.
// T28: prompt 简化 — user 反馈"就是日期,事件,事件,不打标"。
// T31: 改成多行,每行一个事件 — 朋友的酒馆站参考,一天 N 行比"逗号串成 50 字
//   一行"更适合翻阅。每条事件 ≤25 字,2-5 条。生成端 split('\n') 写多行,带 eventIdx。
// T32: 每行加 HH:MM 前缀 — dump 给消息时已带 [HH:MM] 时间戳,模型据此标记
//   该事件主要发生的时刻。前缀格式严格 `HH:MM 事件内容`(空格分隔),解析端
//   的去编号正则避开 HH:MM,渲染端直接显示。
export const DEFAULT_TIMELINE_SYS = `把这一天的对话拆成 2-5 个独立事件,每行一个事件。
**每行必须以 HH:MM 时间开头,空格后接事件内容**(时间从对话里的 [HH:MM] 时间戳取该事件主要发生的时刻)。
事件内容不超过 25 字。
只输出事件本身,**每行一个事件**,不要编号、不要日期前缀、不要解释、不要任何包裹。
事件按时间顺序由早到晚。

示例:
09:23 收到她的红包
14:50 一起去吃午饭
22:10 道晚安`;

// AUTHOR-LOCKED sys prompt for merging multiple days. Same multi-line shape.
// T32: 合并跨天事件,前缀改 `MM-DD HH:MM` — 跨天事件没法只用 HH:MM 标位。
export const DEFAULT_TIMELINE_MERGE_SYS = `把下面这几天的事件压缩到一起,提取 3-6 个关键事件,每行一个。
**每行以 MM-DD HH:MM 开头,空格后接事件内容**(若原行已带时间则沿用,否则按上下文推断)。
事件内容不超过 25 字。
只输出事件本身,**每行一个事件**,不要编号、不要解释。`;

export const MAX_SUMMARY_LEN = 25;

// Local-time YYYY-MM-DD from a timestamp. We use local date so the user's
// sense of "today" matches the timeline's day boundaries.
export function dayKeyOf(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const todayKey = () => dayKeyOf(Date.now());

// Find days that have messages but no timeline row yet, then generate one
// summary per missing day. Returns { generated, skipped, errors, remaining }
// — remaining 是被 maxDays cap 截掉的天数,UI 可据此提示用户「还有 N 天,
// 再点一次继续生成」。
//
// T16: 之前跳过当天(`k !== t`)— 默认假设 user 今天还在聊不要急着定稿。
// 现在改成"当天也总结" — 跟 user 的明确意愿对齐:每次 memory 压缩自动跑
// 一次 timeline,user 想看到当天有变化的反馈,即使后面继续聊会被覆盖。
// 副作用:同一天可能被多次总结,但每 dayKey 只一行(existingKeys 守门),
// 第一次跑写入后,后续 dayKey 命中就 skip 不会重复。要"用最新的对话刷新
// 今天"得手动删 timeline 行再扫(memory app 的删按钮在)。
//
// maxDays(默认 30)防一次点扫描就 fire 200 个 API 请求 — 新用户开记忆 app
// 点扫描,session 有 200 天历史就 200 次 callAI 串行,可能跑 5-10 分钟还烧
// 钱。改成分批,一次最多 maxDays 天。已生成的有 timeline 行不再重做,下次
// 点会接着干。
export async function generateMissingDays(sessionId, { onProgress, maxDays = 30 } = {}) {
  const allMsgs = await db.query('chatMessages', 'sessionId', sessionId);
  if (allMsgs.length === 0) return { generated: 0, skipped: 0, errors: 0, remaining: 0 };

  const byDay = new Map();
  for (const m of allMsgs) {
    const k = dayKeyOf(m.createdAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(m);
  }

  const existing = await db.query('timeline', 'sessionId', sessionId);
  // Existing keys include both single-day rows AND original rows that have
  // been merged. We DON'T want to regenerate an original day even if it's
  // now hidden behind a merged row — that would create a duplicate.
  const existingKeys = new Set(existing.map(t => t.dayKey));

  const allTodoKeys = [...byDay.keys()]
    .filter(k => !existingKeys.has(k))
    .sort();
  // 取最近 maxDays 天优先生成(用户更可能关心近期的)。
  const todoKeys = allTodoKeys.slice(-maxDays);
  const remaining = allTodoKeys.length - todoKeys.length;

  let generated = 0, errors = 0;
  for (const dayKey of todoKeys) {
    const msgs = byDay.get(dayKey);
    msgs.sort((a, b) => a.createdAt - b.createdAt);
    const dump = msgs.map(formatMsgForTimeline).filter(Boolean).join('\n');
    if (onProgress) onProgress({ dayKey, total: todoKeys.length, done: generated });
    try {
      const raw = await ai.callAI({
        systemPrompt: DEFAULT_TIMELINE_SYS,
        messages: [{ role: 'user', content: `日期:${dayKey}\n\n这天的对话:\n${dump}` }],
        temperature: 0.4,
      });
      // T31 多事件/天:按 \n 拆,过滤空/前缀号,每行 trim + clamp 到 25 字。
      // 模型偶尔回逗号串(老 prompt 习惯) — 用 splitTimelineEvents 兜底也拆开。
      const events = splitTimelineEvents(raw);
      if (events.length === 0) { errors++; continue; }
      const fromTs = msgs[0]?.createdAt ?? null;
      const toTs   = msgs[msgs.length - 1]?.createdAt ?? null;
      const now = Date.now();
      const rows = events.map((summary, idx) => ({
        id: db.newId(),
        sessionId,
        dayKey,
        summary,
        eventIdx: idx,
        fromTs,
        toTs,
        createdAt: now + idx,  // +idx 让 createdAt 严格递增,任何按 createdAt 排序的视图同天内顺序稳定
      }));
      for (const r of rows) await db.set('timeline', r);
      generated++;
    } catch (e) {
      console.warn(`[timeline] failed for ${dayKey}:`, e);
      errors++;
    }
  }
  return { generated, skipped: todoKeys.length - generated - errors, errors, remaining };
}

// 把模型输出拆成多个事件。优先按行(\n)拆,行内若还残留全角/半角逗号串
// (老 prompt 输出习惯)再 fallback 按逗号拆。每条 trim + clamp 25 字 + 去
// 前缀编号(1. / 1、 / - 之类)。空行 / 拆完空字符串自动 filter 掉。
function splitTimelineEvents(raw) {
  if (typeof raw !== 'string') return [];
  const cleaned = raw.trim()
    .replace(/^```(?:json|text)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (!cleaned) return [];
  let lines = cleaned.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  // 模型把多事件挤一行用逗号分,fallback 拆
  if (lines.length === 1 && /[,,、]/.test(lines[0])) {
    lines = lines[0].split(/[,,、]/).map(s => s.trim()).filter(Boolean);
  }
  const out = [];
  for (let s of lines) {
    // 去前缀编号 / 项目符号 — T32 保留 HH:MM 时间戳前缀(原正则 `\d+[:.、)]?` 会
    // 吃掉 `09:` 把 `09:23 xxx` 砍成 `23 xxx`),改成只匹配明显的编号格式。
    s = s.replace(/^(?:[-*•·]|\(\s*\d+\s*\)|\d+\s*[.、)]\s*)/, '').trim();
    s = s.replace(/^[「『"'\s]+/, '').replace(/[」』"'\s]+$/, '');
    if (!s) continue;
    // clamp 25 字 — 时间戳前缀(HH:MM 5 字 或 MM-DD HH:MM 11 字)不算在 25 字
    //   预算内,只对事件内容部分截断,否则带前缀的事件会被腰斩。
    const timeMatch = s.match(/^(\d{1,2}:\d{2}\s+|\d{2}-\d{2}\s+\d{1,2}:\d{2}\s+)/);
    if (timeMatch) {
      const prefix = timeMatch[0];
      const body = s.slice(prefix.length);
      const trimmed = body.length > MAX_SUMMARY_LEN ? body.slice(0, MAX_SUMMARY_LEN - 1) + '…' : body;
      s = prefix + trimmed;
    } else if (s.length > MAX_SUMMARY_LEN) {
      s = s.slice(0, MAX_SUMMARY_LEN - 1) + '…';
    }
    out.push(s);
    if (out.length >= 5) break;
  }
  return out;
}

// Merge multiple timeline entries into one combined row. Originals are
// preserved with `mergedInto` set, so unmerge can restore them.
//   - entryIds: array of timeline row ids to merge (must be 2+)
// Returns the new row id.
export async function mergeDays(sessionId, entryIds) {
  if (!Array.isArray(entryIds) || entryIds.length < 2) {
    throw new Error('mergeDays 需要至少两条 timeline 条目');
  }
  const all = await db.query('timeline', 'sessionId', sessionId);
  const items = entryIds.map(id => all.find(t => t.id === id)).filter(Boolean);
  if (items.length < 2) {
    throw new Error('找不到足够的 timeline 条目');
  }
  // Already-merged rows shouldn't be re-merged (mergedInto already set);
  // refuse, and let the UI clear them first.
  for (const it of items) {
    if (it.mergedInto) {
      throw new Error(`条目 ${it.dayKey} 已被合并,先取消那次合并`);
    }
  }
  items.sort((a, b) => (a.dayKey || '').localeCompare(b.dayKey || ''));
  const dump = items.map(it => `[${it.dayKey}] ${it.summary}`).join('\n');
  const raw = await ai.callAI({
    systemPrompt: DEFAULT_TIMELINE_MERGE_SYS,
    messages: [{ role: 'user', content: dump }],
    temperature: 0.4,
  });
  // T31: 合并行也是多事件 — splitTimelineEvents 拆完用 \n join 存进单行 summary,
  //   渲染端按 \n split 显示。merged 行不写 eventIdx(它本身是聚合行)。
  const events = splitTimelineEvents(raw);
  if (events.length === 0) throw new Error('合并失败:模型没返回有效文本');
  const mergedSummary = events.join('\n');

  const newId = db.newId();
  const mergedDayKey = `${items[0].dayKey}~${items[items.length - 1].dayKey}`;
  await db.set('timeline', {
    id: newId,
    sessionId,
    dayKey: mergedDayKey,
    summary: mergedSummary,
    mergedFrom: items.map(it => it.id),
    createdAt: Date.now(),
  });
  for (const it of items) {
    it.mergedInto = newId;
    await db.set('timeline', it);
  }
  return newId;
}

// Undo a merge: delete the merged row, clear `mergedInto` on the originals.
export async function unmerge(sessionId, mergedId) {
  const merged = await db.get('timeline', mergedId);
  if (!merged || !Array.isArray(merged.mergedFrom)) return false;
  for (const origId of merged.mergedFrom) {
    const orig = await db.get('timeline', origId);
    if (orig && orig.mergedInto === mergedId) {
      delete orig.mergedInto;
      await db.set('timeline', orig);
    }
  }
  await db.del('timeline', mergedId);
  return true;
}

// Strip surrounding quotes / whitespace and clamp to MAX_SUMMARY_LEN.
// Truncation backstop only — the prompt already asks for ≤40 chars; this
// catches the case where the model overshoots, without burning a retry.
function trimSummary(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.trim()
    .replace(/^[「『"'\s]+/, '')
    .replace(/[」』"'\s]+$/, '');
  if (s.length > MAX_SUMMARY_LEN) {
    s = s.slice(0, MAX_SUMMARY_LEN - 1) + '…';
  }
  return s;
}

// Same convention as context.renderActionsAsText, but compact for daily
// dumps where token budget matters more than fidelity.
// T32: 拼上 [HH:MM] 时间戳让模型知道每条消息发生的时刻,prompt 要求按这个
//   时间标记事件 hh:mm。
function formatMsgForTimeline(m) {
  const speaker = m.role === 'user' ? '用户' : (m.role === 'character' ? '角色' : 'system');
  const d = new Date(m.createdAt || 0);
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const text = (m.actions || []).map(a => {
    switch (a.type) {
      case 'text':       return a.content || '';
      case 'reply':      return a.content || '';
      case 'voice':      return `[语音] ${a.content || ''}`;
      case 'image':      return `[图片] ${a.description || ''}`;
      case 'recall':     return '[撤回]';
      case 'red_packet': return `[红包 ¥${a.amount || 0}]`;
      case 'transfer':   return `[转账 ¥${a.amount || 0}]`;
      case 'location':   return `[位置 ${a.name || ''}]`;
      case 'unblock_request': return `[请求解除拉黑]`;
      default: return `[${a.type}]`;
    }
  }).filter(Boolean).join(' / ');
  if (!text) return '';
  return `[${hhmm}] ${speaker}: ${text}`;
}
