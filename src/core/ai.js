// Unified AI call + action dispatch.
// callAIOnce: low-level single HTTP round-trip, returns the assistant message object.
// callAI:     compat shim that returns the content string (used by memory compression + test connection).
// requestReply: high-level entry — pulls context, may loop through tool calls, persists final reply.

import * as db from './db.js';
import * as context from './context.js';
import { fetchWeather } from './weather.js';
import { getCityByKey } from './cities.js';

const handlers = new Map();   // action type -> async (action, ctx) => void

// In-flight reply lock keyed by sessionId. Prevents two concurrent
// requestReply calls on the same session (e.g. two tabs sharing the same
// IndexedDB both pressing 「让 AI 回复」 within the same instant) from
// running maybeCompressMemory in parallel and double-archiving the same
// overflow window into two separate memory rows. Second caller awaits the
// in-flight promise instead of starting another HTTP round-trip.
const inFlight = new Map();

export function registerHandler(type, fn) {
  handlers.set(type, fn);
}

// Resolve the currently active apiConfig row by reading settings.activeApiConfigId.
export async function getActiveApiConfig() {
  const settings = await db.get('settings', 'default');
  if (!settings?.activeApiConfigId) return null;
  return (await db.get('apiConfig', settings.activeApiConfigId)) || null;
}

// Single round-trip. Returns the choice's message object verbatim so callers can
// inspect tool_calls. Optional `tools` enables OpenAI function calling.
export async function callAIOnce({ systemPrompt, messages, temperature, tools }) {
  const config = await getActiveApiConfig();
  if (!config || !config.apiUrl || !config.apiKey || !config.modelName) {
    throw new Error('ai.callAIOnce: 没有可用的 API 配置 — 去 设置 → API 设置 创建一组并选中');
  }
  // URL: users frequently paste the full ".../v1/chat/completions" endpoint
  // into apiUrl instead of just the base. If we always appended again, the
  // request would hit ".../chat/completions/chat/completions" → 404. So
  // detect and only append when not already present.
  const apiUrlClean = config.apiUrl.replace(/\/+$/, '');
  const url = apiUrlClean.endsWith('/chat/completions')
    ? apiUrlClean
    : `${apiUrlClean}/chat/completions`;
  const body = {
    model: config.modelName,
    messages: systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : [...messages],
    temperature: temperature ?? config.temperature ?? 0.8,
  };
  // Optional per-config max_tokens. Important for action-array replies:
  // multi-action JSON arrays can be long, and providers with a stingy
  // default completion cap will truncate mid-array → parseActions throws.
  // Left unset by default so providers' own defaults still apply.
  if (Number.isFinite(config.maxTokens) && config.maxTokens > 0) {
    body.max_tokens = config.maxTokens;
  }
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
  }
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
    throw new Error(`ai.callAIOnce: HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  if (!message || typeof message !== 'object') {
    throw new Error(`ai.callAIOnce: 响应缺 choices[0].message — ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { message, raw: data };
}

// Back-compat: text-only callers (memory compression, test connection).
// Throws if the model returned tool_calls instead of plain text.
export async function callAI({ systemPrompt, messages, temperature }) {
  const { message } = await callAIOnce({ systemPrompt, messages, temperature });
  if (typeof message.content !== 'string') {
    throw new Error('ai.callAI: 期望文本回复但收到 tool_calls / 空内容');
  }
  return message.content;
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

// Build a tools array based on what the session opted into.
function buildToolsForSession(session, character) {
  // 阶段 0: 架空世界模式 — 真实时间/天气/地点工具一律不暴露(角色调了也只
  // 拿到现实数据,跟架空设定冲突)。session 的 per-direction toggle 仍然可
  // 以独立 disable 某个方向,但 worldMode='fictional' 是一刀切。
  if (character?.worldMode === 'fictional') return [];
  const tools = [];
  const timeEnums = [];
  if (session.charTzEnabled) timeEnums.push('character');
  if (session.userTzEnabled) timeEnums.push('user');
  if (timeEnums.length > 0) {
    tools.push({
      type: 'function',
      function: {
        name: 'get_current_time',
        description: '获取当前时间。who=character 是角色所在城市的本地时间;who=user 是玩家(用户)所在城市的本地时间。',
        parameters: {
          type: 'object',
          properties: {
            who: { type: 'string', enum: timeEnums, description: 'character 或 user' },
          },
          required: ['who'],
        },
      },
    });
  }
  const locEnums = [];
  if (session.charLocEnabled) locEnums.push('character');
  if (session.userLocEnabled) locEnums.push('user');
  if (locEnums.length > 0) {
    tools.push({
      type: 'function',
      function: {
        name: 'get_location',
        description: '获取当前所在地名(只是城市/地名,不查任何 API)。返回 { city }。who=character 是角色所在地,who=user 是玩家所在地。',
        parameters: {
          type: 'object',
          properties: {
            who: { type: 'string', enum: locEnums, description: 'character 或 user' },
          },
          required: ['who'],
        },
      },
    });
  }

  const wxEnums = [];
  if (session.charWeatherEnabled) wxEnums.push('character');
  if (session.userWeatherEnabled) wxEnums.push('user');
  if (wxEnums.length > 0) {
    tools.push({
      type: 'function',
      function: {
        name: 'get_weather',
        description: '获取当前天气。返回 { city, response },response 是用户在「设置 → 天气 API」配置的接口的原始响应文本(JSON 字符串),你需要自己解析里面的温度 / 天气描述等字段。who=character 是角色所在城市,who=user 是玩家所在城市。',
        parameters: {
          type: 'object',
          properties: {
            who: { type: 'string', enum: wxEnums, description: 'character 或 user' },
          },
          required: ['who'],
        },
      },
    });
  }
  return tools;
}

function pickWhoFields(session, who) {
  if (who === 'character') {
    return { key: session.charCityKey, label: session.charCityLabel };
  }
  if (who === 'user') {
    return { key: session.userCityKey, label: session.userCityLabel };
  }
  return { key: '', label: '' };
}

function getCurrentTimeFor(session, who) {
  const { key, label } = pickWhoFields(session, who);
  const c = getCityByKey(key);
  if (!c) return JSON.stringify({ error: `${who} 的城市未配置` });
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: c.tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  return JSON.stringify({ city: label || c.name, timezone: c.tz, localTime: fmt.format(new Date()) });
}

async function getWeatherFor(session, who) {
  const { key, label } = pickWhoFields(session, who);
  const c = getCityByKey(key);
  if (!c) return JSON.stringify({ error: `${who} 的城市未配置` });
  const sett = await db.get('settings', 'default');
  const wcfg = sett?.weatherApi;
  if (!wcfg?.urlTemplate) return JSON.stringify({ error: '天气未配置 URL 模板,去 设置 → 天气 API' });
  try {
    const raw = await fetchWeather({
      lat: c.lat, lon: c.lon,
      urlTemplate: wcfg.urlTemplate, apiKey: wcfg.apiKey,
    });
    // Raw response straight from the user's chosen endpoint — let the AI parse it.
    return JSON.stringify({ city: label || c.name, response: raw });
  } catch (e) {
    return JSON.stringify({ error: String(e).slice(0, 200) });
  }
}

function getLocationFor(session, who) {
  const { key, label } = pickWhoFields(session, who);
  if (!key && !label) return JSON.stringify({ error: `${who} 的所在地未配置` });
  return JSON.stringify({ city: label || key });
}

async function executeToolCall(tc, session) {
  const fn = tc.function?.name;
  let args = {};
  try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (_) {}
  const who = args.who;
  if (fn === 'get_current_time') return getCurrentTimeFor(session, who);
  if (fn === 'get_weather')      return await getWeatherFor(session, who);
  if (fn === 'get_location')     return getLocationFor(session, who);
  return JSON.stringify({ error: `unknown tool: ${fn}` });
}

// High-level entry. Triggered by the user's "let AI reply" button.
// If the session has any tool toggles on, registers tools and loops on tool_calls
// (up to MAX_ROUNDS). Final message must be text (containing the JSON-action array).
const MAX_TOOL_ROUNDS = 5;

export async function requestReply(sessionId, opts = {}) {
  const existing = inFlight.get(sessionId);
  if (existing) return existing;
  const promise = (async () => {
    try {
      return await _requestReplyImpl(sessionId, opts);
    } finally {
      inFlight.delete(sessionId);
    }
  })();
  inFlight.set(sessionId, promise);
  return promise;
}

async function _requestReplyImpl(sessionId, { featureContext, regenHint } = {}) {
  const systemPrompt = await context.buildSystemPrompt(sessionId, { featureContext, regenHint });
  const baseMessages = await context.buildMessageHistory(sessionId);
  const session = await db.get('chatSessions', sessionId);
  const character = session ? await db.get('characters', session.characterId) : null;

  const tools = buildToolsForSession(session || {}, character);
  const convo = [...baseMessages];

  let finalMessage = null;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { message } = await callAIOnce({
      systemPrompt,
      messages: convo,
      tools: tools.length > 0 ? tools : undefined,
    });
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      convo.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });
      for (const tc of message.tool_calls) {
        const result = await executeToolCall(tc, session || {});
        convo.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        });
      }
      continue;
    }
    finalMessage = message;
    break;
  }

  if (!finalMessage) {
    throw new Error(`AI 连续 ${MAX_TOOL_ROUNDS} 轮都在调工具,没给出文字回复`);
  }
  if (typeof finalMessage.content !== 'string') {
    throw new Error('AI 最终回复 content 不是字符串 — 模型可能不支持 tools / function calling');
  }
  const rawText = finalMessage.content;
  // Parse-fallback: if the model didn't return a valid JSON array (e.g.
  // truncated by max_tokens, wrapped in prose, broke format on a small
  // model), surface the raw text to the user as a single text action
  // rather than failing the whole reply. The user can then re-roll or
  // adjust prompt without losing visibility into what the model said.
  let actions;
  try {
    actions = parseActions(rawText);
  } catch (e) {
    console.warn('[ai] parseActions failed, surfacing raw text as a single text action:', e);
    actions = [{
      type: 'text',
      content: `[模型回复格式异常 · 已显示原文]\n\n${rawText}`,
    }];
  }

  const now = Date.now();
  const messageId = db.newId();
  await db.set('chatMessages', {
    id: messageId,
    sessionId,
    role: 'character',
    actions,
    createdAt: now,
  });

  if (session) {
    session.lastMessageAt = now;
    await db.set('chatSessions', session);
  }

  await dispatchActions(actions, { sessionId, messageId });

  // Long-conversation memory compression — wired here so it actually runs
  // (the function has existed since the first commit but was never called).
  // Run after the reply is persisted so the compressed summary covers turns
  // before this one; failures must not break the reply flow.
  try {
    await context.maybeCompressMemory(sessionId);
  } catch (e) {
    console.warn('[ai] memory compression failed (non-fatal):', e);
  }

  return { messageId, actions, rawText };
}
