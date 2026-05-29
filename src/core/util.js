// 全局工具函数收口。三个函数原来在多处复制粘贴(esc 在 ~10 个 feature
// 文件里都有一份;dayKeyOf 在 timeline / memory-app / schedule-list 各一份;
// parseTolerantJSON 是 ai / schedule-list / surveillance×2 / bottle 五份正则
// 容错解析的共性抽出)。这里是 canonical 版本,新写代码用 import,旧文件
// 顺手碰到了再迁(一次性大改风险高,且旧 copy 行为一致)。

// HTML 转义 — 只处理 attribute / textContent 注入场景的 4 个字符。
// String(s ?? '') 防 null / undefined 报 TypeError。
export function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}

// `YYYY-MM-DD` 格式的本地日期 key。所有按天分组的地方(timeline / memory /
// checkin / milestones)都用这个,保证 IndexedDB 里跨表 join 时 key 一致。
export function dayKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 容错解析模型返回的 JSON。LLM 经常在 JSON 前后多吐几句"好的,这是结果:"
// 或者用 ```json 包起来,直接 JSON.parse 会炸。这里先剥 fence,再尝试直
// parse,失败就用括号匹配扫描提取第一段合法 JSON。
//
// 关键改进(相对原五份 copy):用 stack-balanced 扫描而非贪婪正则
// `/\[[\s\S]*\]/`。原正则会匹配到字符串中最后一个 `]`,如果模型在数组
// 之后又附了一段说明文字带 `]`(常见于 "[注:see ref [1]]" 这种),正则
// 会一路扩到那个外层 `]`,夹了非 JSON 的内容,parse 必炸。balanced 扫描
// 一遇到 depth=0 就 stop,精确切到第一段完整 JSON 块。
//
// 用法:
//   parseTolerantJSON(raw)                       // 默认 expect='array'
//   parseTolerantJSON(raw, { expect: 'object' }) // 期望对象
//   parseTolerantJSON(raw, { expect: 'any' })    // 不限形状
// 返回:成功 → parsed value;失败 → null。caller 自己 if (!result) 处理。
export function parseTolerantJSON(raw, { expect = 'array' } = {}) {
  if (typeof raw !== 'string') return null;
  const stripped = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const v = JSON.parse(stripped);
    if (matchesExpected(v, expect)) return v;
  } catch (_) { /* fall through */ }
  const open  = expect === 'object' ? '{' : '[';
  const close = expect === 'object' ? '}' : ']';
  const inner = extractBalanced(stripped, open, close);
  if (inner) {
    try {
      const v = JSON.parse(inner);
      if (matchesExpected(v, expect)) return v;
    } catch (_) { /* fall through */ }
  }
  return null;
}

function matchesExpected(v, expect) {
  if (expect === 'array')  return Array.isArray(v);
  if (expect === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  return v !== undefined;
}

// stack-balanced 第一个 open / close 配对的子串。带字符串字面量保护:`"`
// 之间的 open/close 不计深度,`\"` 不算字符串结束。深度归零即返回切片。
// 没找到匹配返回 null。
function extractBalanced(str, open, close) {
  const start = str.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc2 = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (esc2) { esc2 = false; continue; }
    if (inStr && ch === '\\') { esc2 = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

// fetch + 超时 —— 用户填的 endpoint(天气 / embedding)可能挂起,默认 fetch
// 永不超时会吊死调用方(embedding 在每轮回复路径上,卡住 = 整轮回复卡死)。
// ms 后 abort,抛 AbortError,调用方按失败处理(降级 / 提示)。
export async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
