// Static server for the Minjerribah Living Twin. No deps, no cache, ES modules served correctly.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4271;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav'
};

const SHOTS = path.join(ROOT, 'shots');

const server = http.createServer((req, res) => {
  // Screenshot sink. The browser pane does not always composite frames in this environment, so
  // TWIN.shot() renders offscreen and POSTs the PNG here. A critic then opens the file directly
  // and actually looks at the island rather than taking a builder's word for how it looks.
  if (req.method === 'POST' && req.url.startsWith('/__shot/')) {
    const name = decodeURIComponent(req.url.slice('/__shot/'.length)).replace(/[^a-z0-9._-]/gi, '_');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
        const b64 = body.replace(/^data:image\/\w+;base64,/, '');
        const file = path.join(SHOTS, name.endsWith('.png') ? name : name + '.png');
        fs.writeFileSync(file, Buffer.from(b64, 'base64'));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
          .end(JSON.stringify({ ok: true, file, bytes: b64.length }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e.message) }));
      }
    });
    return;
  }

  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }).end(data);
  });
});

server.listen(PORT, () => console.log('minjerribah-living-twin on http://localhost:' + PORT));
