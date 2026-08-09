// Tiny always-up server for the live progress page, so it stays watchable even while
// agents are restarting or breaking the main app server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4272;
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/progress/index.html';
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(f, (e, d) => {
    if (e) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(d);
  });
}).listen(PORT, () => console.log('progress on http://localhost:' + PORT));
