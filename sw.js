// Service Worker — minimal cache layer + update detection for iOS PWA standalone.
//
// 为什么要 SW:iOS 把网站添加到主屏幕后,standalone 模式没有刷新按钮。
// 用户切后台再回来 / 关 app 重开,缓存策略由系统决定,不一定拿最新版。
// SW 让我们能 (a) 控制缓存逻辑,(b) detect 新版本主动通知用户重启。
//
// Strategy:
//   - install: skipWaiting 让新 SW 立刻接管,不等老 tab 关闭
//   - activate: clean 老 cache 版本 + claim 所有 clients
//   - fetch: network-first(拿新版优先,失败 fallback cache → 离线兜底)
//
// 更新流程:
//   1. user 打开 app,浏览器在后台 fetch sw.js itself
//   2. sw.js 字节有变 → updatefound 事件
//   3. 新 SW install + activate(skipWaiting),刷新 cache
//   4. main.js 收到 statechange → 显示「有新版」banner
//   5. user 点重启 → location.reload(),新 SW 接管,所有资源拿新版
//
// ⚠️ DEPLOY 流程关键:**每次 commit 前把 CACHE 字符串里的 vN 加 1**
// (vN → vN+1)。.githooks/pre-commit 已经自动做这件事,只要 staged 文件里
// 除 sw.js 之外还有别的,commit 时它会跑 sed +1。理由:
//   1. sw.js 字节变化才触发浏览器 updatefound 事件 → 弹「有新版,重启」banner
//   2. 老 cache (vN) 在新 SW activate 时被删,fetch 重新拉新版 js/css
// 不改 vN 的话:即使你改了 base.css / chat.js,user 的 SW 仍然给老 cache,
// 看不到新版。只改 sw.js 注释也不行 — 改 CACHE 字符串(用户能看到的视觉
// 变化:cache key 名变了)是最稳的触发方式。

const CACHE = 'phone-app-v83';

self.addEventListener('install', () => {
  // 不预 cache 任何文件 — 让 runtime 边用边缓存,免维护 asset manifest
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 只处理同 origin GET — cross-origin(Google Fonts / catbox 头像)透传,
  // 避免 cache 别人 CDN 的内容引入 stale 风险。
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        // 200 才 cache;304 / 5xx / opaque 不存(避免缓存坏数据)
        if (resp.ok && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
