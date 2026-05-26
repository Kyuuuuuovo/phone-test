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

// One-shot text → vector. Reads config from settings.embedding.
// Returns null (not throw) when embedding is disabled or unconfigured —
// caller treats it as "no vector available, skip retrieval".
export async function embedText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const settings = (await db.get('settings', 'default')) || {};
  const cfg = settings.embedding || {};
  if (cfg.enabled !== true) return null;
  if (!cfg.urlTemplate || !cfg.apiKey || !cfg.modelName) return null;
  return await callEmbeddingAPI({
    urlTemplate: cfg.urlTemplate,
    apiKey:      cfg.apiKey,
    modelName:   cfg.modelName,
    input:       trimmed,
  });
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
  const id = db.newId();
  await db.set('embeddings', {
    id,
    sourceType: 'memory',
    sourceId:   memory.id,
    sessionId:  memory.sessionId,
    vector:     vec,
    dim:        vec.length,
    modelName:  settings.embedding?.modelName || '',
    createdAt:  Date.now(),
  });
  return id;
}

// Top-K most-similar memory rows for a query string, scoped to one session.
// Returns [{ memory, score }] sorted by score desc. Empty array on any
// failure / disabled state (caller should treat as no retrieval).
export async function topKMemoriesForQuery(sessionId, queryText, k) {
  const settings = (await db.get('settings', 'default')) || {};
  const cfg = settings.embedding || {};
  if (cfg.enabled !== true) return [];
  const topK = Number.isFinite(k) ? k : (Number.isFinite(cfg.topK) ? cfg.topK : 5);
  let qvec;
  try {
    qvec = await embedText(queryText);
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
  const top = scored.slice(0, topK);
  // Resolve sourceId → memory row. Some may be orphaned (memory deleted
  // post-embed). Filter those out.
  const out = [];
  for (const s of top) {
    const m = await db.get('memories', s.embedding.sourceId);
    if (m) out.push({ memory: m, score: s.score });
  }
  return out;
}

// Backfill: scan all memories in a session and embed any without a vector.
// Useful right after the user first enables vector memory (existing memories
// would otherwise never get embedded). Best-effort — failures logged, skipped.
export async function backfillSessionMemories(sessionId) {
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.embedding?.enabled !== true) return { embedded: 0, skipped: 0 };
  const memories = await db.query('memories', 'sessionId', sessionId);
  const existingEmbs = await db.query('embeddings', 'sessionId', sessionId);
  const haveEmbed = new Set(existingEmbs.map(e => e.sourceId));
  let embedded = 0, skipped = haveEmbed.size;
  for (const m of memories) {
    if (haveEmbed.has(m.id)) continue;
    const newId = await embedMemory(m);
    if (newId) embedded++;
  }
  return { embedded, skipped };
}
