import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const START_PORT = parseInt(process.env.PORT, 10) || 5173;
const MAX_PORT_TRIES = 10;  // 5173, 5174, ..., 5182
const ROOT = path.dirname(url.fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// Try START_PORT first; if it's taken (EADDRINUSE,通常因为上次跑的 server
// 没关干净),递增 port 重试 直到找到空闲的。最多试 10 个 port,避免无限
// 循环。
let port = START_PORT;
let tries = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && tries < MAX_PORT_TRIES) {
    console.log(`端口 ${port} 被占用,试下一个...`);
    port++;
    tries++;
    setTimeout(() => server.listen(port), 50);
  } else {
    console.error('server failed:', err);
    process.exit(1);
  }
});
server.listen(port, () => console.log(`dev-server on http://localhost:${port}`));
