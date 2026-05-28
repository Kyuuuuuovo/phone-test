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
  const res = await fetch(url, {
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

// 解析当前生效的 embedding cfg。两套 profile:
//   - settings.embedding(主):给 worldbook entries 用,默认所有调用 fallback
//   - settings.embeddingSummary(总结专属):给 memory 写 + memory query 用
//
// resolveSummaryCfg:summary 启用就用 summary,否则 fallback 主 embedding
//   (主 embedding 也没启用时返回 null cfg — embedText 会返回 null,跳过)
// resolveMainCfg:只看主 embedding
//
// 为啥总结要单独 cfg:summary 是"长期记忆"(写一次查很多次,精度要高)、
// worldbook 是"设定参考"(精度要求低),不同模型 trade-off 不同。两套各
// 独立 enabled toggle 给 user 灵活选(不开 summary 时仍走主端点,保留向后
// 兼容)。
function resolveSummaryCfg(settings) {
  const s = settings.embeddingSummary || {};
  if (s.enabled === true && s.urlTemplate && s.apiKey && s.modelName) return s;
  return resolveMainCfg(settings);
}
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

// One-shot text → vector,走**主 embedding**(worldbook 等场景默认入口)。
// Returns null (not throw) when embedding is disabled or unconfigured —
// caller treats it as "no vector available, skip retrieval".
export async function embedText(text) {
  const settings = (await db.get('settings', 'default')) || {};
  return await embedTextWith(resolveMainCfg(settings), text);
}

// Memory 专属入口 — 优先 settings.embeddingSummary,fallback 主 embedding。
// embedMemory + topKMemoriesForQuery 都用这条,保证写 / 查同源(同 model
// 出的向量才能 cosine 比较)。
export async function embedTextForSummary(text) {
  const settings = (await db.get('settings', 'default')) || {};
  return await embedTextWith(resolveSummaryCfg(settings), text);
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
    vec = await embedTextForSummary(memory.summary);
  } catch (e) {
    console.warn('[embedding] embedMemory failed (non-fatal):', e);
    return null;
  }
  if (!vec) return null;
  const settings = (await db.get('settings', 'default')) || {};
  const cfg = settings.embeddingSummary?.enabled === true
    ? settings.embeddingSummary
    : settings.embedding;
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
export async function topKMemoriesForQuery(sessionId, queryText, k) {
  const settings = (await db.get('settings', 'default')) || {};
  // memory query 走 summary cfg(优先 embeddingSummary,fallback 主 embedding),
  //   跟 embedMemory 写时同源 — 否则不同 model 出的向量空间不一致召不回。
  const cfg = resolveSummaryCfg(settings);
  if (!cfg) return [];
  const topK = Number.isFinite(k) ? k : (Number.isFinite(cfg.topK) ? cfg.topK : 5);
  let qvec;
  try {
    qvec = await embedTextForSummary(queryText);
  } catch (e) {
    console.warn('[embedding] query embed failed (non-fatal):', e);
    return [];
  }
  if (!qvec) return [];

  // Pull this session's memory embeddings. brute-force cosine across them
  // is fine — a session won't have thousands of memories; even 500 ×
  // 1536-dim takes well under 100ms in JS.
  const embs = await db.query('embeddings', 'sessionId', sessionId);
  const memEmbs = embs.filter(e => e.sourceType === 'memory');
  if (memEmbs.length === 0) return [];
  const scored = [];
  for (const e of memEmbs) {
    if (!e.vector || e.dim !== qvec.length) continue;
    const score = cosineSimilarity(qvec, e.vector);
    scored.push({ embedding: e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // Cut at threshold BEFORE slicing — a low-noise top-K of 0 is correct
  // when nothing is genuinely related (caller treats it as "no recall").
  const top = scored.filter(s => s.score >= MIN_SIMILARITY).slice(0, topK);
  // Resolve sourceId → memory row. Some may be orphaned (memory deleted
  // post-embed). Filter those out.
  const out = [];
  for (const s of top) {
    const m = await db.get('memories', s.embedding.sourceId);
    if (m) out.push({ memory: m, score: s.score });
  }
  return out;
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
export async function topKWorldbookEntriesForQuery(characterId, queryText, k) {
  const settings = (await db.get('settings', 'default')) || {};
  const cfg = settings.embedding || {};
  if (cfg.enabled !== true) return [];
  const topK = Number.isFinite(k) ? k : (Number.isFinite(cfg.topK) ? cfg.topK : 5);
  const threshold = Number.isFinite(cfg.worldbookThreshold) ? cfg.worldbookThreshold : MIN_SIMILARITY;
  let qvec;
  try {
    qvec = await embedText(queryText);
  } catch (e) {
    console.warn('[embedding] worldbook query embed failed (non-fatal):', e);
    return [];
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

  // 拿这些 entries 的 embeddings(getAll + filter — 数量不大,几十到几百)
  const allEmbs = await db.getAll('embeddings');
  const entryMap = new Map(allEntries.map(e => [e.id, e]));
  const wbEmbs = allEmbs.filter(e => e.sourceType === 'worldbook-entry' && entryMap.has(e.sourceId));
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
  // 任一 cfg(主 embedding 或 summary 独立端点)启用就允许 — embedMemory 内
  //   走 embedTextForSummary 自动 fallback。
  const summaryOk = settings.embeddingSummary?.enabled === true
    && settings.embeddingSummary.urlTemplate
    && settings.embeddingSummary.apiKey
    && settings.embeddingSummary.modelName;
  const mainOk = settings.embedding?.enabled === true
    && settings.embedding.urlTemplate
    && settings.embedding.apiKey
    && settings.embedding.modelName;
  if (!summaryOk && !mainOk) return { embedded: 0, skipped: 0 };
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
