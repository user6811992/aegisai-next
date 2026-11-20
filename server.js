// server.js - AegisAI (next) entry point. Wave 0: minimal wiring, security-first.
const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./server/core/config');
const security = require('./server/core/security');
const db = require('./server/storage/db');

const { PORT, HOST, MAX_BODY_BYTES, PROJECT_ROOT_ALLOWLIST, TOOL_BUDGET, PUBLIC_DIR, DATA_DIR } = config;

const VERSION = require('./package.json').version;
const TOKEN = process.env.LOCALAI_TOKEN || process.env.AEGISAI_TOKEN || '';

let projectRoot = null;

function getProjectRoot() { return projectRoot; }
function setProjectRoot(root) { projectRoot = root; }

// ---------- static serving ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let safe = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  if (safe === path.sep || safe === '/' || safe === '\\' || safe === '.') safe = 'index.html';
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    res.statusCode = 403; res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.statusCode = 404; res.end('not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.end(data);
  });
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function checkAuth(req) {
  if (!TOKEN) return true; // no token configured => open (dev default)
  const h = req.headers['x-auth-token'] || req.headers['authorization'] || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : h;
  return tok === TOKEN;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (url === '/api/version') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 200, { version: VERSION });
    }
    if (url === '/api/project' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); }
      catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      try {
        const resolved = security.validateProjectRoot(body.root, PROJECT_ROOT_ALLOWLIST);
        setProjectRoot(resolved);
        return json(res, 200, { ok: true, root: resolved });
      } catch (e) {
        return json(res, e.status || 400, { ok: false, error: e.message });
      }
    }
    if (url.startsWith('/api/')) {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 404, { ok: false, error: 'not implemented in wave 0' });
    }
    serveStatic(req, res);
  } catch (e) {
    res.statusCode = e.status || 500;
    res.end(String(e.message || e));
  }
});

function start() {
  server.listen(PORT, HOST, () => {
    console.log(`AegisAI (next) v${VERSION} listening on http://${HOST}:${PORT}`);
  });
}

if (require.main === module) start();

module.exports = {
  server,
  start,
  VERSION,
  MAX_BODY_BYTES,
  TOOL_BUDGET,
  getProjectRoot,
  setProjectRoot,
  validateProjectRoot: security.validateProjectRoot,
  safePath: security.safePath,
  runProcess: security.runProcess,
  isValidModelName: security.isValidModelName,
  isSafeUrl: security.isSafeUrl,
};
