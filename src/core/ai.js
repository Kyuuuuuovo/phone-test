// Unified AI call + action dispatch.
// callAI: low-level POST to user-configured OpenAI-compatible endpoint.
// requestReply: high-level entry — pulls context, calls AI, parses, persists, dispatches.

import * as db from './db.js';
import * as context from './context.js';

const handlers = new Map();   // action type -> async (action, ctx) => void

export function registerHandler(type, fn) {
  handlers.set(type, fn);
}

// Low-level: POST to apiConfig.apiUrl/chat/completions, return raw assistant text.
export async function callAI({ systemPrompt, messages, temperature }) {
  const config = await db.get('apiConfig', 'default');
  if (!config || !config.apiUrl || !config.apiKey || !config.modelName) {
    throw new Error('ai.callAI: apiConfig.default not set — fill apiUrl / apiKey / modelName first');
  }
  const url = `${config.apiUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: config.modelName,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    temperature: temperature ?? config.temperature ?? 0.8,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ai.callAI: HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`ai.callAI: unexpected response shape — ${JSON.stringify(data).slice(0, 300)}`);
  }
  return content;
}

// Extract JSON array from raw model output. Tolerant of ```json fences and surrounding prose.
export function parseActions(rawText) {
  if (typeof rawText !== 'string') throw new Error('ai.parseActions: input not a string');
  const stripped = rawText.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) { /* fall through to regex extract */ }
  const match = stripped.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) { /* fall through */ }
  }
  throw new Error(`ai.parseActions: no valid JSON array found in: ${stripped.slice(0, 200)}`);
}

// Dispatch actions to registered side-effect handlers (in order).
// Unknown types are no-ops — UI rendering reads actions[] directly.
export async function dispatchActions(actions, ctx) {
  for (const action of actions) {
    const handler = handlers.get(action.type);
    if (!handler) continue;
    await handler(action, ctx);
  }
}

// High-level entry. Triggered by the user's "let AI reply" button.
// Pulls context, calls AI, parses actions, persists the turn as one chatMessage,
// updates session.lastMessageAt, then dispatches actions for side effects.
export async function requestReply(sessionId) {
  const systemPrompt = await context.buildSystemPrompt(sessionId);
  const messages    = await context.buildMessageHistory(sessionId);
  const rawText     = await callAI({ systemPrompt, messages });
  const actions     = parseActions(rawText);

  const now = Date.now();
  const messageId = db.newId();
  await db.set('chatMessages', {
    id: messageId,
    sessionId,
    role: 'character',
    actions,
    createdAt: now,
  });

  const session = await db.get('chatSessions', sessionId);
  if (session) {
    session.lastMessageAt = now;
    await db.set('chatSessions', session);
  }

  await dispatchActions(actions, { sessionId, messageId });

  return { messageId, actions, rawText };
}
