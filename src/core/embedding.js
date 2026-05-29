// Vector memory — embedding API client + cosine retrieval.
//
// Architecture (per the user's brief + CLAUDE.md 铁律 12):
//   - Users configure a separate embedding endpoint (settings.embedding —
//     URL template + key + model + enabled toggle + topK). Keeping it
//     separate from the chat API config matters: embedding models tend to
//     be cheaper / different providers (Qwen embedding via DashScope,
//     OpenAI text-embedding-3-small, BGE via SiliconFlow, etc.).
//   - After every successful memory compression, fire-and-forget embed
//     the new summary and store the vector. Failures don't block reply.
//   - On the next reply, embed the last few user messages as a query →
//     cosine top-K across this session's memory vectors → inject as
//     "# 相关记忆(按语义检索)" alongside (not replacing) the existing
//     L1/L2 linear summaries. Linear summary preserves narrative arc;
//     vector recall surfaces specific facts mentioned long ago.
//
// Defaults conservative: enabled=false (opt-in, extra API spend per turn),
// topK=5 (small enough to not crowd the prompt). Failure path always
// degrades gracefully — empty result, prompt continues without the section.
//
// IDB stores the Float32Array directly via structured clone — no
// serialization round-trip needed.

import * as db from './db.js';
import { fetchWithTimeout } from './util.js';

// Default request shape — OpenAI-compatible /v1/embeddings.
// The user can paste either the full ".../v1/embeddings" path or just the
// base "https://api.openai.com/v1" — see embedText() for normalization.
async function callEmbeddingAPI({ urlTemplate, apiKey, modelName, input }) {
  if (!urlTemplate) throw new Error('embedding URL 未配置');
  if (!apiKey)      throw new Error('embedding apiKey 未配置');
  if (!modelName)   throw new Error('embedding modelName 未配置');
  const apiUrlClean = urlTemplate.replace(/\/+$/, '');
  const url = apiUrlClean.endsWith('/embeddings')
    ? apiUrlClean
    : `${apiUrlClean}/embeddings`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: modelName, input }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`embedding HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  // OpenAI shape: { data: [{ embedding: [...] }, ...] }
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) {
    throw new Error('embedding 响应缺 data[0].embedding');
  }
  return new Float32Array(vec);
}

// 解析当前生效的 embedding cfg。只有一套:settings.embedding(主)。所有
// 调用(memory 写 / memory query / worldbook 查)走同一 endpoint,LRU
// cache 自动 dedup 跨 caller 的同 text 调用。
//
// 历史:曾经有过 `settings.embeddingSummary` 子端点,设计意图是让 user
// 给 memory 总结挑高精度模型 / worldbook 用便宜模型。user 后来定下"向量
// 模型始终一个"的方向,这条路径删了。老 user 写入的 `embeddingSummary`
// row 留在 IDB 里不动也不读,以后想恢复也方便。
function resolveMainCfg(settings) {
  const m = settings.embedding || {};
  if (m.enabled === true && m.urlTemplate && m.apiKey && m.modelName) return m;
  return null;
}

// 通用 helper — 给 cfg 直接调 API,无 cfg 返回 null。供两条路径共用。
async function embedTextWith(cfg, text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  if (!cfg) return null;
  return await callEmbeddingAPI({
    urlTemplate: cfg.urlTemplate,
    apiKey:      cfg.apiKey,
    modelName:   cfg.modelName,
    input:       trimmed,
  });
}

// In-memory LRU cache for query embeddings — same (text + model + url) hits
// the API once and reuses the vector across both vector-recall builders
// (memory + worldbook) AND across retries when the user hasn't changed
// the recent messages. Cap kept small since most reuse happens within a
// few seconds (the two builders in the same turn). 50 entries × ~6KB
// (1536-dim Float32Array) ≈ 300KB peak — negligible.
//
// Key construction includes model+url so two different embedding backends
// (different vector spaces) never collide on the same query text.
const QUERY_CACHE_CAP = 50;
const _queryCache = new Map();
function _cacheKey(cfg, text) {
  return `${cfg.urlTemplate}|${cfg.modelName}|${text}`;
}
function _cacheGet(cfg, text) {
  const key = _cacheKey(cfg, text);
  if (!_queryCache.has(key)) return null;
  // LRU bump: re-set moves to insertion-end in Map
  const v = _queryCache.get(key);
  _queryCache.delete(key);
  _queryCache.set(key, v);
  return v;
}
function _cacheSet(cfg, text, vec) {
  const key = _cacheKey(cfg, text);
  if (_queryCache.has(key)) _queryCache.delete(key);
  _queryCache.set(key, vec);
  while (_queryCache.size > QUERY_CACHE_CAP) {
    const firstKey = _queryCache.keys().next().value;
    _queryCache.delete(firstKey);
  }
}

// One-shot text → vector,走主 embedding(memory 写 / memory query / worldbook
// 查统一这个入口)。Returns null (not throw) when embedding is disabled or
// unconfigured — caller treats it as "no vector available, skip retrieval".
// LRU-cached: same text + cfg returns the cached vector (no API call).
export async function embedText(text) {
  const settings = (await db.get('settings', 'default')) || {};
  const cfg = resolveMainCfg(settings);
  if (!cfg) return null;
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const cached = _cacheGet(cfg, trimmed);
  if (cached) return cached;
  const vec = await embedTextWith(cfg, trimmed);
  if (vec) _cacheSet(cfg, trimmed, vec);
  return vec;
}

// Memory 专属入口 — 历史上指过 embeddingSummary 独立端点,user 后来统一
// 改成单一 embedding 模型。仍保留这个 export 防止 caller 大改;内部等同
// embedText。如果以后又分,这一层是统一的接入点。
export async function embedTextForSummary(text) {
  return embedText(text);
}

// Cosine similarity. Assumes both vectors are same length and not zero.
// Returns NaN-safe number in [-1, 1].
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na  += x * x;
    nb  += y * y;
  }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Embed a memory row and persist the vector. Idempotent — if an embedding
// already exists for this memoryId, skips. Returns the embedding id or null
// when disabled / failed.
export async function embedMemory(memory) {
  if (!memory?.id || !memory?.summary) return null;
  // Dedup: if there's already an embedding for this source, don't double up.
  const existing = await db.query('embeddings', 'sourceId', memory.id);
  if (existing.length > 0) return existing[0].id;
  let vec;
  try {
    vec = await embedText(memory.summary);
  } catch (e) {
    console.warn('[embedding] embedMemory failed (non-fatal):', e);
    return null;
  }
  if (!vec) return null;
  const settings = (await db.get('settings', 'default')) || {};
  const cfg = settings.embedding;
  const id = db.newId();
  await db.set('embeddings', {
    id,
    sourceType: 'memory',
    sourceId:   memory.id,
    sessionId:  memory.sessionId,
    vector:     vec,
    dim:        vec.length,
    modelName:  cfg?.modelName || '',
    createdAt:  Date.now(),
  });
  return id;
}

// Minimum similarity for a result to be considered "relevant" enough to
// inject. 0.35 is empirical: top-of-distribution cosine for unrelated
// text on common embedding models sits around 0.1-0.3, while genuinely
// related content reliably scores 0.4+. Below 0.35 is noise — surfacing
// it as 「相关记忆」 wastes tokens and mildly poisons the prompt.
const MIN_SIMILARITY = 0.35;

// Top-K most-similar memory rows for a query string, scoped to one session.
// Returns [{ memory, score }] sorted by score desc. Empty array on any
// failure / disabled state (caller should treat as no retrieval).
//
// opts.excludeIds — Set/Array of memory ids to filter OUT of results. Used
//   by context.js to skip memories already linearly injected in `mem-l1`
//   / `mem-l2` segments, so the prompt doesn't carry duplicate summaries.
// opts.queryVec — optional pre-computed query vector. When the caller has
//   already embedded the same query text (e.g. shared between the memory
//   and worldbook vector-recall builders within one turn), passing the
//   vec skips the LRU lookup entirely and avoids one extra await.
export async function topKMemoriesForQuery(sessionId, queryText, k, opts = {}) {
  const settings = (await db.get('settings', 'default')) || {};
  // 单一 embedding 端点 — embedMemory 写 vector 和这里 query embed 同源,
  // 同 model 出的向量才能 cosine 比较。
  const cfg = resolveMainCfg(settings);
  if (!cfg) return [];
  const topK = Number.isFinite(k) ? k : (Number.isFinite(cfg.topK) ? cfg.topK : 5);
  let qvec = opts.queryVec;
  if (!qvec) {
    try {
      qvec = await embedText(queryText);
    } catch (e) {
      console.warn('[embedding] query embed failed (non-fatal):', e);
      return [];
    }
  }
  if (!qvec) return [];

  // Pull this session's memory embeddings. brute-force cosine across them
  // is fine — a session won't have thousands of memories; even 500 ×
  // 1536-dim takes well under 100ms in JS.
  const embs = await db.query('embeddings', 'sessionId', sessionId);
  const memEmbs = embs.filter(e => e.sourceType === 'memory');
  if (memEmbs.length === 0) {
    // Cheap heuristic: this session has memories but no vectors yet — fire
    // a background backfill so they become retrievable next time. Doesn't
    // block this call. Limited to 2 per invocation so a fresh-enabled
    // session doesn't burst-call the embedding API.
    _scheduleBackfill(sessionId, 2);
    return [];
  }

  const excludeSet = opts.excludeIds instanceof Set
    ? opts.excludeIds
    : new Set(opts.excludeIds || []);

  const scored = [];
  for (const e of memEmbs) {
    if (!e.vector || e.dim !== qvec.length) continue;
    if (excludeSet.has(e.sourceId)) continue;
    const score = cosineSimilarity(qvec, e.vector);
    scored.push({ embedding: e, score });
  }
  if (scored.length === 0) return [];

  // 阶段 4 向量打标 boost — 用 memory.tag 给 cosine score 加权,让"戏剧性"
  // 片段(转折/冲突/亲密)在召回排序上优于"日常"。原来 N 次串行 db.get 拿
  // memory.tag,改成一次 db.query('memories', 'sessionId') 建 Map,boost
  // 阶段 O(1) lookup。session memories 几百条以内,一次 query 比串行多次
  // get 快一个数量级。
  const BOOST = { '转折': 0.06, '冲突': 0.06, '亲密': 0.04, '发现': 0.02, '约定': 0.02 };
  scored.sort((a, b) => b.score - a.score);
  const preWindow = scored.slice(0, Math.max(topK * 3, topK + 5));
  const allMems = await db.query('memories', 'sessionId', sessionId);
  const memById = new Map(allMems.map(m => [m.id, m]));
  const boosted = [];
  for (const s of preWindow) {
    const m = memById.get(s.embedding.sourceId);
    if (!m) continue;
    const tagBoost = BOOST[m.tag] || 0;
    // high importance 再加一点(关系关键节点是 user 标记过的"重要")
    const impBoost = m.importance === 'high' ? 0.05 : 0;
    boosted.push({
      memory: m,
      rawScore: s.score,
      score: s.score + tagBoost + impBoost,
    });
  }
  boosted.sort((a, b) => b.score - a.score);
  // 用 boosted score 做阈值过滤(boost 把弱相关 + 戏剧性 tag 抬过线是 OK 的,
  // 那种"很久前提过的关键转折"正是向量召回的价值)。
  const top = boosted.filter(s => s.score >= MIN_SIMILARITY).slice(0, topK);

  // 顺便检查:有没有 memory 还没 embed(早期 embed fire-and-forget 失败的孤儿)?
  // 异步补齐 1-2 条,不影响本次返回。下一轮 vector recall 就能召回到。
  const haveEmbedSet = new Set(memEmbs.map(e => e.sourceId));
  const orphans = allMems.filter(m => !haveEmbedSet.has(m.id));
  if (orphans.length > 0) {
    _scheduleBackfillFor(orphans.slice(0, 2));
  }

  return top.map(s => ({ memory: s.memory, score: s.score }));
}

// In-flight backfill dedup — same session won't queue twice. Cleared when
// the backfill promise settles.
const _backfillInflight = new Set();
function _scheduleBackfill(sessionId, limit = 2) {
  if (_backfillInflight.has(sessionId)) return;
  _backfillInflight.add(sessionId);
  (async () => {
    try {
      const mems = await db.query('memories', 'sessionId', sessionId);
      const embs = await db.query('embeddings', 'sessionId', sessionId);
      const have = new Set(embs.filter(e => e.sourceType === 'memory').map(e => e.sourceId));
      const todo = mems.filter(m => !have.has(m.id)).slice(0, limit);
      for (const m of todo) {
        try { await embedMemory(m); } catch (_) { /* fire-and-forget */ }
      }
    } finally {
      _backfillInflight.delete(sessionId);
    }
  })();
}
function _scheduleBackfillFor(memories) {
  (async () => {
    for (const m of memories) {
      try { await embedMemory(m); } catch (_) { /* fire-and-forget */ }
    }
  })();
}

// Embed a worldbook entry. 类似 embedMemory 但 sourceType='worldbook-entry',
// sessionId=null(世界书不绑 session,绑 character via characterWorldbooks)。
// Idempotent — 已存就 skip。
export async function embedWorldbookEntry(entry) {
  if (!entry?.id || !(entry?.content || '').trim()) return null;
  const existing = await db.query('embeddings', 'sourceId', entry.id);
  if (existing.length > 0) return existing[0].id;
  let vec;
  try {
    vec = await embedText(entry.content);
  } catch (e) {
    console.warn('[embedding] embedWorldbookEntry failed (non-fatal):', e);
    return null;
  }
  if (!vec) return null;
  const settings = (await db.get('settings', 'default')) || {};
  const id = db.newId();
  await db.set('embeddings', {
    id,
    sourceType: 'worldbook-entry',
    sourceId:   entry.id,
    sessionId:  null,
    vector:     vec,
    dim:        vec.length,
    modelName:  settings.embedding?.modelName || '',
    createdAt:  Date.now(),
  });
  return id;
}

// Delete embedding for a worldbook entry — called when user changes the
// entry's activationMode away from 'vector' or edits its content (the old
// vector is now stale).
export async function deleteWorldbookEmbedding(entryId) {
  const existing = await db.query('embeddings', 'sourceId', entryId);
  for (const e of existing) await db.del('embeddings', e.id);
}

// Top-K vector-mode worldbook entries for this character + query string.
// Loads all entries from character's bound worldbooks, filters to
// activationMode='vector' + enabled, cosine top-K with threshold.
// threshold comes from settings.embedding.worldbookThreshold (default 0.35).
//
// opts.queryVec — optional pre-computed query vector (shared with the
//   memory vector-recall builder in the same turn to save one API call).
export async function topKWorldbookEntriesForQuery(characterId, queryText, k, opts = {}) {
  const settings = (await db.get('settings', 'default')) || {};
  const cfg = settings.embedding || {};
  if (cfg.enabled !== true) return [];
  const topK = Number.isFinite(k) ? k : (Number.isFinite(cfg.topK) ? cfg.topK : 5);
  const threshold = Number.isFinite(cfg.worldbookThreshold) ? cfg.worldbookThreshold : MIN_SIMILARITY;
  let qvec = opts.queryVec;
  if (!qvec) {
    try {
      qvec = await embedText(queryText);
    } catch (e) {
      console.warn('[embedding] worldbook query embed failed (non-fatal):', e);
      return [];
    }
  }
  if (!qvec) return [];

  // 收集该 character 挂载的所有 worldbook 的 vector-mode entries
  const bindings = await db.query('characterWorldbooks', 'characterId', characterId);
  const wbIds = [...new Set(bindings.map(b => b.worldbookId))];
  const allEntries = [];
  for (const wbId of wbIds) {
    const entries = await db.query('worldbookEntries', 'worldbookId', wbId);
    for (const e of entries) {
      if (e.enabled !== false && e.activationMode === 'vector') allEntries.push(e);
    }
  }
  if (allEntries.length === 0) return [];

  // v16: use the sourceType index instead of db.getAll('embeddings'). The
  // old code pulled the entire embeddings store every turn — that includes
  // every session's accumulated memory vectors, growing unbounded on
  // heavy users. The index lets us scope to just worldbook-entry rows
  // (typically a few dozen to a few hundred even for elaborate setups).
  const entryMap = new Map(allEntries.map(e => [e.id, e]));
  const wbEmbsAll = await db.query('embeddings', 'sourceType', 'worldbook-entry');
  const wbEmbs = wbEmbsAll.filter(e => entryMap.has(e.sourceId));
  if (wbEmbs.length === 0) return [];

  const scored = [];
  for (const e of wbEmbs) {
    if (!e.vector || e.dim !== qvec.length) continue;
    const score = cosineSimilarity(qvec, e.vector);
    const entry = entryMap.get(e.sourceId);
    if (!entry) continue;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score >= threshold).slice(0, topK);
}

// Delay between embedding requests during backfill — keeps the run from
// hammering rate limits when a fresh-enabled user has hundreds of old
// memories to catch up on. 150ms = ~6 req/s, well under most provider caps.
const BACKFILL_DELAY_MS = 150;

// Backfill: scan all memories in a session and embed any without a vector.
// Useful right after the user first enables vector memory (existing memories
// would otherwise never get embedded). Best-effort — failures logged, skipped.
// Serial (one at a time) + paced — providers rate-limit hard on bursts.
export async function backfillSessionMemories(sessionId) {
  const settings = (await db.get('settings', 'default')) || {};
  const mainOk = settings.embedding?.enabled === true
    && settings.embedding.urlTemplate
    && settings.embedding.apiKey
    && settings.embedding.modelName;
  if (!mainOk) return { embedded: 0, skipped: 0 };
  const memories = await db.query('memories', 'sessionId', sessionId);
  const existingEmbs = await db.query('embeddings', 'sessionId', sessionId);
  const haveEmbed = new Set(existingEmbs.map(e => e.sourceId));
  let embedded = 0, skipped = haveEmbed.size, first = true;
  for (const m of memories) {
    if (haveEmbed.has(m.id)) continue;
    // Sleep between requests (skip before the very first one).
    if (!first) await new Promise(r => setTimeout(r, BACKFILL_DELAY_MS));
    first = false;
    const newId = await embedMemory(m);
    if (newId) embedded++;
  }
  return { embedded, skipped };
}
