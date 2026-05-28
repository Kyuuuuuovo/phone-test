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
// T28: prompt 简化 — user 反馈"乱七八糟的提示词,就是日期,事件,事件,不打标"。
// 输出格式改成"事件,事件"逗号串,不再要 tag,不再要"情感转折/约定"等修饰。
export const DEFAULT_TIMELINE_SYS = `把这一天的对话浓缩成 2-5 个关键事件,用逗号串起来。不超过 50 字。只输出事件本身,不解释、不加前缀。`;

// AUTHOR-LOCKED sys prompt for merging multiple days. Same style.
export const DEFAULT_TIMELINE_MERGE_SYS = `把下面这几天的事件合并成一行,用逗号串起来。不超过 50 字。只输出事件本身,不解释、不加前缀。`;

export const MAX_SUMMARY_LEN = 50;

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
      const summary = trimSummary(raw);
      if (!summary) { errors++; continue; }
      // T30: 存 fromTs/toTs 让 UI 显示带 HH:MM 的时间段(老 timeline 没这俩
      //   字段,UI 端 fallback 到 dayKey 显示)。msgs 已经按 createdAt 排序。
      await db.set('timeline', {
        id: db.newId(),
        sessionId,
        dayKey,
        summary,
        fromTs: msgs[0]?.createdAt ?? null,
        toTs:   msgs[msgs.length - 1]?.createdAt ?? null,
        createdAt: Date.now(),
      });
      generated++;
    } catch (e) {
      console.warn(`[timeline] failed for ${dayKey}:`, e);
      errors++;
    }
  }
  return { generated, skipped: todoKeys.length - generated - errors, errors, remaining };
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
  const merged = trimSummary(raw);
  if (!merged) throw new Error('合并失败:模型没返回有效文本');

  const newId = db.newId();
  const mergedDayKey = `${items[0].dayKey}~${items[items.length - 1].dayKey}`;
  await db.set('timeline', {
    id: newId,
    sessionId,
    dayKey: mergedDayKey,
    summary: merged,
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
function formatMsgForTimeline(m) {
  const speaker = m.role === 'user' ? '用户' : (m.role === 'character' ? '角色' : 'system');
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
  return `${speaker}: ${text}`;
}
