// Unified AI call + action dispatch.
// callAIOnce: low-level single HTTP round-trip, returns the assistant message object.
// callAI:     compat shim that returns the content string (used by memory compression + test connection).
// requestReply: high-level entry — pulls context, may loop through tool calls, persists final reply.

import * as db from './db.js';
import * as context from './context.js';
import { fetchWeather } from './weather.js';
import { getCityByKey } from './cities.js';

const handlers = new Map();   // action type -> async (action, ctx) => void

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
  const url = `${config.apiUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: config.modelName,
    messages: systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : [...messages],
    temperature: temperature ?? config.temperature ?? 0.8,
  };
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
function buildToolsForSession(session) {
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
  const wxEnums = [];
  if (session.charWeatherEnabled) wxEnums.push('character');
  if (session.userWeatherEnabled) wxEnums.push('user');
  if (wxEnums.length > 0) {
    tools.push({
      type: 'function',
      function: {
        name: 'get_weather',
        description: '获取当前天气。返回 { city, tempC, summary }。who=character 是角色所在城市,who=user 是玩家所在城市。',
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
  if (!wcfg?.apiKey) return JSON.stringify({ error: '天气 API 未配置 key,去 设置 → 天气 API' });
  try {
    const w = await fetchWeather({ lat: c.lat, lon: c.lon, provider: wcfg.provider, apiKey: wcfg.apiKey });
    return JSON.stringify({ city: label || c.name, tempC: w.tempC, summary: w.summary });
  } catch (e) {
    return JSON.stringify({ error: String(e).slice(0, 200) });
  }
}

async function executeToolCall(tc, session) {
  const fn = tc.function?.name;
  let args = {};
  try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (_) {}
  const who = args.who;
  if (fn === 'get_current_time') return getCurrentTimeFor(session, who);
  if (fn === 'get_weather')      return await getWeatherFor(session, who);
  return JSON.stringify({ error: `unknown tool: ${fn}` });
}

// High-level entry. Triggered by the user's "let AI reply" button.
// If the session has any tool toggles on, registers tools and loops on tool_calls
// (up to MAX_ROUNDS). Final message must be text (containing the JSON-action array).
const MAX_TOOL_ROUNDS = 5;

export async function requestReply(sessionId, { featureContext } = {}) {
  const systemPrompt = await context.buildSystemPrompt(sessionId, { featureContext });
  const baseMessages = await context.buildMessageHistory(sessionId);
  const session = await db.get('chatSessions', sessionId);

  const tools = buildToolsForSession(session || {});
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
  const actions = parseActions(rawText);

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

  return { messageId, actions, rawText };
}
