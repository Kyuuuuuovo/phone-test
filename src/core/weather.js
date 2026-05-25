// Weather adapters. User picks a provider in 设置 → 天气 API and fills their own key.
// All calls go directly from the user's browser to the provider (no proxy / no backend).
//
// Each adapter takes { lat, lon, apiKey } and returns { tempC, summary, raw }.
// `summary` is a short Chinese phrase like "多云" / "小雨" — what AI sees.

export const PROVIDERS = [
  {
    id: 'openweather',
    label: 'OpenWeather',
    keyHint: '在 openweathermap.org 注册后 → API keys 里复制',
  },
  {
    id: 'qweather',
    label: '和风天气',
    keyHint: '在 dev.qweather.com 注册后 → 控制台 → 项目里创建 KEY',
  },
  {
    id: 'seniverse',
    label: '心知天气',
    keyHint: '在 seniverse.com 注册后 → 应用管理里复制私钥',
  },
];

export async function fetchWeather({ lat, lon, provider, apiKey }) {
  if (!apiKey) throw new Error('天气 API 未配置 key — 去 设置 → 天气 API 填一下');
  if (lat == null || lon == null) throw new Error('缺少经纬度');
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`未知 weather provider: ${provider}`);
  return await adapter(lat, lon, apiKey);
}

const ADAPTERS = {
  async openweather(lat, lon, key) {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${encodeURIComponent(key)}&units=metric&lang=zh_cn`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`OpenWeather HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    const tempC = d?.main?.temp;
    const summary = d?.weather?.[0]?.description || '未知';
    if (typeof tempC !== 'number') throw new Error(`OpenWeather 响应缺 temp:${JSON.stringify(d).slice(0, 200)}`);
    return { tempC, summary, raw: d };
  },

  // QWeather: location is "lon,lat", NOT "lat,lon".
  async qweather(lat, lon, key) {
    const url = `https://devapi.qweather.com/v7/weather/now?location=${lon},${lat}&key=${encodeURIComponent(key)}&lang=zh`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`和风 HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    if (d?.code !== '200') throw new Error(`和风错误 code=${d?.code}:${JSON.stringify(d).slice(0, 200)}`);
    const tempC = parseFloat(d?.now?.temp);
    const summary = d?.now?.text || '未知';
    if (Number.isNaN(tempC)) throw new Error(`和风响应缺 temp`);
    return { tempC, summary, raw: d };
  },

  async seniverse(lat, lon, key) {
    const url = `https://api.seniverse.com/v3/weather/now.json?key=${encodeURIComponent(key)}&location=${lat}:${lon}&language=zh-Hans&unit=c`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`心知 HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    const result = d?.results?.[0];
    if (!result) throw new Error(`心知响应缺 results:${JSON.stringify(d).slice(0, 200)}`);
    const tempC = parseFloat(result?.now?.temperature);
    const summary = result?.now?.text || '未知';
    if (Number.isNaN(tempC)) throw new Error(`心知响应缺 temperature`);
    return { tempC, summary, raw: d };
  },
};
