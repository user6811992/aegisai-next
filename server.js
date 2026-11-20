// server.js - AegisAI (next) entry point. Wave 0: minimal wiring, security-first.
const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./server/core/config');
const security = require('./server/core/security');
const db = require('./server/storage/db');
const backends = require('./server/backends');
const agent = require('./server/agent/run');
const coding = require('./server/tools/coding');
const integrations = require('./server/integrations/register');
const capabilities = require('./server/core/capabilities');

const { PORT, HOST, MAX_BODY_BYTES, PROJECT_ROOT_ALLOWLIST, TOOL_BUDGET, PUBLIC_DIR, DATA_DIR } = config;

const VERSION = require('./package.json').version;
const TOKEN = process.env.LOCALAI_TOKEN || process.env.AEGISAI_TOKEN || '';

integrations.registerAll();

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
    if (url === '/api/models' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      try {
        const data = await backends.backendListModels();
        return json(res, 200, data);
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e.message || e) });
      }
    }
    if (url === '/api/integrations/status' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 200, integrations.registry.statusAll());
    }
    if (url.startsWith('/api/integrations/') && url.endsWith('/call') && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const name = url.split('/')[3];
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const intg = integrations.registry.list().find((i) => i.name === name);
      if (!intg) return json(res, 404, { ok: false, error: 'unknown integration' });
      if (typeof intg.callTool !== 'function') return json(res, 400, { ok: false, error: 'integration has no callTool' });
      try {
        const r = await intg.callTool(body.tool, body.args);
        return json(res, 200, { ok: true, result: r });
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e.message || e) });
      }
    }
    if (url === '/api/agent' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); }
      catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\\n\\n');
      // Gather external tools from available integrations.
      const avail = await integrations.registry.available();
      const ext = { ghidra: [], craft: [], are: [], rea: [] };
      for (const i of avail) {
        const ts = (typeof i.tools === 'function') ? i.tools() : [];
        if (i.name === 'ghidra') ext.ghidra = ts;
        else if (i.name === 'craft') ext.craft = ts;
        else if (i.name === 'awesome-re') ext.are = ts;
        else if (i.name === 'rea') ext.rea = ts;
      }
      // REA tools namespaced as rea_ in agent; map them into ext.rea (already).
      const result = await agent.runAgent({
        model: body.model,
        messages: body.messages || [],
        projectRoot: projectRoot,
        includeCoding: body.includeCoding !== false,
        includeRe: !!body.includeRe,
        cleanRoom: !!body.cleanRoom,
        allowedTools: body.allowedTools,
        deniedTools: body.deniedTools,
        externalTools: body.externalTools || ext,
        onEvent: send,
      });
      send({ type: 'done', final: result.final.final, toolLog: result.toolLog });
      res.end();
      return;
    }
    if (url.startsWith('/api/')) {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 404, { ok: false, error: 'not implemented in wave 1' });
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
    // Init optional integrations in the background (non-blocking).
    try { require('./server/integrations/rea').init().then(() => console.log('REA init done:', require('./server/integrations/rea').integration.status())).catch(() => {}); } catch (e) {}
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
  runAgent: agent.runAgent,
  isCleanRoomBlocked: agent.isCleanRoomBlocked,
  backends,
  coding,
};
