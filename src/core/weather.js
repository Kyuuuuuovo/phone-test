// User-driven weather endpoint. The user fills a URL template like
//   https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={key}&units=metric&lang=zh_cn
// We substitute {lat}/{lon}/{key} and GET it; the raw response (truncated) is
// handed straight to the AI as the tool result. No field parsing — lets users
// point at any endpoint without us shipping an adapter per provider.

export const PRESET_TEMPLATES = [
  {
    id: 'openweather',
    label: 'OpenWeather',
    keyHint: '在 openweathermap.org 注册 → API keys 里复制',
    urlTemplate: 'https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={key}&units=metric&lang=zh_cn',
  },
  {
    id: 'qweather',
    label: '和风天气',
    keyHint: '在 dev.qweather.com 注册 → 控制台 → 项目里创建 KEY',
    urlTemplate: 'https://devapi.qweather.com/v7/weather/now?location={lon},{lat}&key={key}&lang=zh',
  },
  {
    id: 'seniverse',
    label: '心知天气',
    keyHint: '在 seniverse.com 注册 → 应用管理里复制私钥',
    urlTemplate: 'https://api.seniverse.com/v3/weather/now.json?key={key}&location={lat}:{lon}&language=zh-Hans&unit=c',
  },
];

const RESPONSE_MAX = 1500;

export function buildWeatherUrl(urlTemplate, { lat, lon, apiKey }) {
  if (!urlTemplate) throw new Error('未配置天气 URL 模板');
  return urlTemplate
    .replaceAll('{lat}', encodeURIComponent(lat))
    .replaceAll('{lon}', encodeURIComponent(lon))
    .replaceAll('{key}', encodeURIComponent(apiKey || ''));
}

export async function fetchWeather({ lat, lon, urlTemplate, apiKey }) {
  if (!urlTemplate) throw new Error('天气未配置 URL 模板 — 去 设置 → 天气 API');
  if (lat == null || lon == null) throw new Error('缺少经纬度');
  const url = buildWeatherUrl(urlTemplate, { lat, lon, apiKey });
  const r = await fetch(url);
  const text = await r.text();
  if (!r.ok) throw new Error(`天气 API HTTP ${r.status} — ${text.slice(0, 300)}`);
  return text.slice(0, RESPONSE_MAX);
}
