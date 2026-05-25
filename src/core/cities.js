// Built-in city table — what shows up in the "common city" picker.
// Each row carries IANA timezone + lat/lon so timezone lookup is local
// (Intl.DateTimeFormat) and weather can hit the API by coords.
//
// User-typed cities (real or fictional) live in chatSessions directly;
// fictional cities pick one entry from here as their "real-world counterpart"
// for tz/weather lookup.

export const CITIES = [
  // 中国大陆
  { key: 'beijing',    name: '北京',     tz: 'Asia/Shanghai',     lat: 39.9, lon: 116.4 },
  { key: 'shanghai',   name: '上海',     tz: 'Asia/Shanghai',     lat: 31.2, lon: 121.5 },
  { key: 'guangzhou',  name: '广州',     tz: 'Asia/Shanghai',     lat: 23.1, lon: 113.3 },
  { key: 'shenzhen',   name: '深圳',     tz: 'Asia/Shanghai',     lat: 22.5, lon: 114.1 },
  { key: 'chengdu',    name: '成都',     tz: 'Asia/Shanghai',     lat: 30.7, lon: 104.1 },
  { key: 'hangzhou',   name: '杭州',     tz: 'Asia/Shanghai',     lat: 30.3, lon: 120.2 },
  { key: 'wuhan',      name: '武汉',     tz: 'Asia/Shanghai',     lat: 30.6, lon: 114.3 },
  { key: 'xian',       name: '西安',     tz: 'Asia/Shanghai',     lat: 34.3, lon: 108.9 },
  // 大中华其他
  { key: 'hongkong',   name: '香港',     tz: 'Asia/Hong_Kong',    lat: 22.3, lon: 114.2 },
  { key: 'taipei',     name: '台北',     tz: 'Asia/Taipei',       lat: 25.0, lon: 121.5 },
  // 亚洲其他
  { key: 'tokyo',      name: '东京',     tz: 'Asia/Tokyo',        lat: 35.7, lon: 139.7 },
  { key: 'seoul',      name: '首尔',     tz: 'Asia/Seoul',        lat: 37.6, lon: 127.0 },
  { key: 'singapore',  name: '新加坡',   tz: 'Asia/Singapore',    lat: 1.4,  lon: 103.8 },
  // 欧洲
  { key: 'london',     name: '伦敦',     tz: 'Europe/London',     lat: 51.5, lon: -0.1  },
  { key: 'paris',      name: '巴黎',     tz: 'Europe/Paris',      lat: 48.9, lon: 2.3   },
  { key: 'berlin',     name: '柏林',     tz: 'Europe/Berlin',     lat: 52.5, lon: 13.4  },
  // 美洲
  { key: 'newyork',    name: '纽约',     tz: 'America/New_York',  lat: 40.7, lon: -74.0 },
  { key: 'losangeles', name: '洛杉矶',   tz: 'America/Los_Angeles', lat: 34.1, lon: -118.2 },
  { key: 'sanfrancisco', name: '旧金山', tz: 'America/Los_Angeles', lat: 37.8, lon: -122.4 },
  // 大洋洲
  { key: 'sydney',     name: '悉尼',     tz: 'Australia/Sydney',  lat: -33.9, lon: 151.2 },
];

export function getCityByKey(key) {
  return CITIES.find(c => c.key === key) || null;
}

// "UTC+08:00" / "UTC-05:00" — computed live so DST is honored.
export function cityOffsetLabel(city) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: city.tz,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date());
    const raw = parts.find(p => p.type === 'timeZoneName')?.value || '';
    return raw.replace(/^GMT/, 'UTC') || 'UTC';
  } catch (_) {
    return 'UTC';
  }
}

// Numeric offset in minutes (for sorting), parsed from "UTC±HH:MM".
function offsetMinutes(label) {
  const m = label.match(/UTC([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  return (m[1] === '+' ? 1 : -1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

// Group CITIES by current UTC offset, sorted east-to-west.
export function citiesGroupedByOffset() {
  const groups = new Map();
  for (const c of CITIES) {
    const off = cityOffsetLabel(c);
    if (!groups.has(off)) groups.set(off, []);
    groups.get(off).push(c);
  }
  return [...groups.entries()]
    .sort((a, b) => offsetMinutes(b[0]) - offsetMinutes(a[0]))
    .map(([offset, cities]) => ({ offset, cities }));
}
