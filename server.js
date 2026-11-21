// server.js - AegisAI (next) entry point. Wave 0: minimal wiring, security-first.
const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./server/core/config');
const security = require('./server/core/security');
const db = require('./server/storage/db');
const settings = require('./server/storage/settings');
if (!global.__aegisDbOpened) {
  try { require('fs').mkdirSync(config.DATA_DIR, { recursive: true }); db.open(require('path').join(config.DATA_DIR, 'aegisai.db')); db.migrateFromJson(config.DATA_DIR); global.__aegisDbOpened = true; } catch (e) { console.error('DB open failed:', e.message); }
}
// Seed default skills after a short delay
setTimeout(() => { try { require('./server/storage/default-skills').ensureDefaultSkills(); } catch (e) { console.error('Skill seed failed:', e.message); } }, 3000);
const backends = require('./server/backends');
const agent = require('./server/agent/run');
const coding = require('./server/tools/coding');
const integrations = require('./server/integrations/register');
const capabilities = require('./server/core/capabilities');

const { PORT, HOST, MAX_BODY_BYTES, PROJECT_ROOT_ALLOWLIST, TOOL_BUDGET, PUBLIC_DIR, DATA_DIR } = config;

const VERSION = require('./package.json').version;
const TOKEN = process.env.LOCALAI_TOKEN || process.env.AEGISAI_TOKEN || '';

const intConfig = require('./server/storage/integrations-config');
intConfig.apply(intConfig.load());

integrations.registerAll();

let projectRoot = null;

// Pending actions (human-in-the-loop)
const pendingActions = [];
function queueAction(action) { const a = { id: 'pa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), status: 'pending', created: new Date().toISOString(), ...action }; pendingActions.push(a); return a; }

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
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.statusCode = 400; res.end('bad request'); return; }
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
    if (url === '/api/versions' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const { runProcess } = require('./server/core/security');
      let ollamaVersion = 'unknown';
      try {
        const r = await runProcess(process.platform === 'win32' ? 'ollama.exe' : 'ollama', ['--version'], { timeout: 10000, shell: true });
        ollamaVersion = (r.out || r.err || '').trim();
      } catch (e) {}
      const st = await integrations.registry.statusAll();
      return json(res, 200, { aegisai: VERSION, node: process.version, ollama: ollamaVersion, rea: st.rea });
    }
    if (url === '/api/backend' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const b = require('./server/backends');
      return json(res, 200, { type: b.getType(), url: b.getUrl(), isOpenaiCompat: b.isOpenaiCompat() });
    }
    if (url === '/api/backend' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      if (body.url) {
        let parsed;
        try { parsed = new URL(body.url); } catch (e) { return json(res, 400, { ok: false, error: 'invalid backend url' }); }
        if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
          return json(res, 400, { ok: false, error: 'invalid backend url' });
        }
      }
      const b = require('./server/backends');
      b.setBackend(body.type, body.url);
      // persist
      const cfg = intConfig.load();
      if (body.type) cfg.BACKEND_TYPE = body.type;
      if (body.url) cfg.BACKEND_URL = body.url;
      intConfig.save(cfg);
      return json(res, 200, { ok: true, type: b.getType(), url: b.getUrl() });
    }
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
      return json(res, 200, await integrations.registry.statusAll());
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
      if (body.messages !== undefined && !Array.isArray(body.messages)) {
        return json(res, 400, { ok: false, error: 'messages must be an array' });
      }
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
      const s = settings.load();
      const reqBudget = parseInt(body.toolBudget, 10);
      const toolBudget = (Number.isFinite(reqBudget) && reqBudget > 0) ? reqBudget : (s.toolBudget || config.TOOL_BUDGET);
      // Server-Sent Events stream
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} };
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      const signal = (typeof AbortSignal.any === 'function')
        ? AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60 * 1000)])
        : controller.signal;
      try {
        const result = await agent.runAgent({
          model: body.model,
          messages: body.messages || [],
          projectRoot: projectRoot,
          includeCoding: body.includeCoding !== false,
          includeRe: !!body.includeRe,
          cleanRoom: !!body.cleanRoom,
          toolBudget: toolBudget,
          allowedTools: body.allowedTools,
          deniedTools: body.deniedTools,
          externalTools: body.externalTools || ext,
          onEvent: (e) => send(e),
          signal,
        });
        send({ type: 'done', ok: true, final: result.final.final, thinking: result.final.thinking || '', toolLog: result.toolLog });
      } catch (e) {
        send({ type: 'error', ok: false, error: String(e && e.message ? e.message : e) });
        send({ type: 'done', ok: false, final: '', thinking: '', toolLog: [] });
      }
      res.end();
      return;
    }
    // ---------- Memory ----------
    if (url === '/api/memory' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 200, { memories: db.listMemories() });
    }
    if (url === '/api/memory/save' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      if (!body.text) return json(res, 400, { ok: false, error: 'text required' });
      const id = db.saveMemory({ id: body.id, text: body.text, source: body.source || 'manual', tags: body.tags || [] });
      return json(res, 200, { ok: true, id });
    }
    if (url === '/api/memory/extract' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const msgs = body.messages || [];
      const text = msgs.map((m) => (m.role + ': ' + (m.content || ''))).join('\\n').slice(0, 8000);
      const model = body.model || 'llama3.2:3b';
      const prompt = 'Extract durable facts about the user or project from this conversation. Return a JSON array of short strings. Only include non-obvious, reusable facts.\\n\\nConversation:\\n' + text + '\\n\\nJSON array:';
      try {
        const r = await backends.backendChat({ model, messages: [{ role: 'user', content: prompt }], stream: false }, () => {});
        const d = r && r.data ? r.data : r;
        const content = (d && d.message && d.message.content) || '';
        let facts = [];
        try {
          const m = content.match(/\\[[\\s\\S]*\\]/);
          facts = m ? JSON.parse(m[0]) : [];
        } catch (e) { facts = []; }
        return json(res, 200, { ok: true, facts: Array.isArray(facts) ? facts : [] });
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e.message || e) });
      }
    }
    if (url === '/api/memory/delete' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      db.deleteMemory(body.id);
      return json(res, 200, { ok: true });
    }
    // ---------- Skills ----------
    if (url === '/api/skills' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 200, { skills: db.listSkills() });
    }
    if (url === '/api/skills/save' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      if (!body.name) return json(res, 400, { ok: false, error: 'name required' });
      db.saveSkill({ name: body.name, description: body.description || '', code: body.code || '' });
      return json(res, 200, { ok: true });
    }
    if (url === '/api/skills/run' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const skill = db.getSkill(body.name);
      if (!skill) return json(res, 404, { ok: false, error: 'skill not found' });
      try {
        const fn = new Function('args', skill.code || '');
        const result = fn(body.args || {});
        return json(res, 200, { ok: true, result: (result === undefined ? null : result) });
      } catch (e) {
        return json(res, 200, { ok: false, error: String(e.message || e) });
      }
    }
    if (url === '/api/skills/delete' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      db.deleteSkill(body.name);
      return json(res, 200, { ok: true });
    }
    // ---------- Chats ----------
    if (url === '/api/chats' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 200, { chats: db.listChats() });
    }
    if (url.startsWith('/api/chats/') && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const id = url.split('/')[3];
      const chat = db.getChat(id);
      if (!chat) return json(res, 404, { ok: false, error: 'not found' });
      return json(res, 200, chat);
    }
    if (url === '/api/chats' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const id = db.saveChat(body);
      return json(res, 200, { ok: true, id });
    }
    if (url === '/api/chats/delete' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      db.deleteChat(body.id);
      return json(res, 200, { ok: true });
    }
    if (url === '/api/chats/branch' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const parent = db.getChat(body.id);
      if (!parent) return json(res, 404, { ok: false, error: 'parent not found' });
      const idx = (typeof body.atIndex === 'number') ? body.atIndex : parent.messages.length;
      const childMsgs = parent.messages.slice(0, idx);
      const newId = 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      db.saveChat({ id: newId, title: (parent.title || 'Untitled') + ' (branch)', messages: childMsgs, parent_id: parent.id, branch_from: idx });
      return json(res, 200, { ok: true, id: newId, parent_id: parent.id, branch_from: idx });
    }
    if (url === '/api/chats/branches' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      return json(res, 200, { branches: db.listBranches(body.id) });
    }
    // ---------- Stats ----------
    if (url === '/api/stats' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const chats = db.listChats();
      let total = 0, user = 0, assistant = 0, prompt = 0, gen = 0;
      for (const c of chats) {
        const full = db.getChat(c.id);
        for (const m of (full.messages || [])) {
          if (m.role === 'user' || m.role === 'assistant') { total++; if (m.role === 'user') user++; else assistant++; }
          if (m.role === 'assistant' && m.tokenStats) { prompt += m.tokenStats.prompt || 0; gen += m.tokenStats.generated || 0; }
        }
      }
      return json(res, 200, { messages: { total, user, assistant }, tokenUsage: { prompt, generated: gen }, chats: chats.length, memories: db.memoryCount(), skills: db.listSkills().length });
    }
    // ---------- Settings ----------
    if (url === '/api/settings' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 200, settings.load());
    }
    if (url === '/api/settings' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      settings.save(body);
      return json(res, 200, { ok: true });
    }
    // ---------- Backup ----------
    if (url === '/api/backup' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const chats = db.listChats().map((c) => db.getChat(c.id));
      return json(res, 200, { version: VERSION, chats, memories: db.listMemories(), skills: db.listSkills(), settings: settings.load() });
    }
    if (url === '/api/backup/import' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      for (const c of (body.chats || [])) db.saveChat(c);
      for (const m of (body.memories || [])) db.saveMemory(m);
      for (const s of (body.skills || [])) db.saveSkill(s);
      if (body.settings) settings.save(body.settings);
      return json(res, 200, { ok: true });
    }
    // ---------- RAG reindex (stub) ----------
    if (url === '/api/are-search' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const ar = require('./server/integrations/awesome-re');
      const data = ar.loadCached() || (await ar.refresh());
      if (!data) { return json(res, 503, { ok: false, message: 'ARE data not loaded yet.' }); }
      const results = ar.search(body.query, { category: body.category, language: body.language, minStars: body.minStars, limit: body.limit });
      return json(res, 200, { ok: true, count: results.length, results: results.map((e) => ({ name: e.name, description: e.desc || e.description || '', stars: e.stars, language: e.lang || e.language || '', category: e.category, url: e.url, health: e.health })) });
    }
    if (url === '/api/are-data-status' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const ar = require('./server/integrations/awesome-re');
      const d = ar.loadCached();
      return json(res, 200, { loaded: !!d, count: Array.isArray(d) ? d.length : 0 });
    }
    if (url === '/api/are-readme' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const u = body.url;
      if (!u) return json(res, 400, { ok: false, error: 'url required' });
      const m = u.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!m) return json(res, 400, { ok: false, error: 'Not a GitHub URL' });
      const owner = m[1], repo = m[2].replace(/\.git$/, '');
      const https = require('https');
      const fetchReadme = (branch) => new Promise((resolve, reject) => {
        const apiUrl = 'https://api.github.com/repos/' + owner + '/' + repo + '/readme' + (branch ? '?ref=' + branch : '');
        const headers = { 'User-Agent': 'AegisAI', 'Accept': 'application/vnd.github.v3.raw' };
        if (process.env.GITHUB_TOKEN) headers['Authorization'] = 'token ' + process.env.GITHUB_TOKEN;
        https.get(apiUrl, { headers }, (r) => {
          let buf = ''; r.on('data', (c) => (buf += c));
          r.on('end', () => { if (r.statusCode === 200) resolve(buf); else reject(new Error('HTTP ' + r.statusCode)); });
        }).on('error', reject);
      });
      let content = '';
      try { content = await fetchReadme(''); }
      catch (e) { try { content = await fetchReadme('main'); } catch (e2) { try { content = await fetchReadme('master'); } catch (e3) { content = 'Could not fetch README: ' + e3.message; } } }
      if (content.length > 3000) content = content.slice(0, 3000) + '\n... (truncated)';
      return json(res, 200, { ok: true, content });
    }
    if (url === '/api/are-data-refresh' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const ar = require('./server/integrations/awesome-re');
      const data = await ar.refresh();
      return json(res, 200, { ok: true, count: Array.isArray(data) ? data.length : 0 });
    }
    if (url === '/api/pull-model' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const name = (body.name || '').trim();
      if (!name) return json(res, 400, { ok: false, error: 'Model name required' });
      if (!security.isValidModelName(name)) return json(res, 400, { ok: false, error: 'Invalid model name' });
      const backends = require('./server/backends');
      if (backends.getType() !== 'ollama') return json(res, 400, { ok: false, error: 'Model pulling only supported for Ollama backend' });
      const { runProcess } = require('./server/core/security');
      const ollamaBin = process.platform === 'win32' ? (process.env.OLLAMA_BIN || 'ollama') : 'ollama';
      const r = await runProcess(ollamaBin, ['pull', name], { timeout: 1800000, maxBuffer: 10 * 1024 * 1024, shell: true });
      // Strip terminal spinner/ANSI/progress characters
      const clean = (s) => (s || '')
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')  // ANSI escape sequences
        .replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏▕█▏]/g, '')  // spinner + progress bar chars
        .replace(/\r/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return json(res, 200, r.ok ? { ok: true, message: clean(r.out || 'done').slice(-300) } : { ok: false, message: clean(r.out || r.err || ('exit code ' + r.code)).slice(-300) });
    }
    if (url === '/api/model-search' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const q = (body.query || '').trim();
      if (!q) return json(res, 200, { ok: true, results: [] });
      const https = require('https');
      const results = [];
      // HuggingFace search (GGUF models)
      try {
        const hfUrl = 'https://huggingface.co/api/models?search=' + encodeURIComponent(q) + '&filter=gguf&sort=downloads&direction=-1&limit=15';
        const data = await new Promise((resolve, reject) => {
          https.get(hfUrl, { headers: { 'User-Agent': 'AegisAI' } }, (r) => {
            let b = ''; r.on('data', c => b += c); r.on('end', () => resolve(b));
          }).on('error', reject);
        });
        const arr = JSON.parse(data);
        for (const m of (Array.isArray(arr) ? arr : [])) {
          results.push({ source: 'huggingface', name: m.id, downloads: m.downloads, likes: m.likes, url: 'https://huggingface.co/' + m.id });
        }
      } catch (e) {}
      // Ollama library: suggest ollama pull format (name:tag)
      // Common Ollama models matching query
      const ollamaSuggestions = ['llama3.2', 'qwen2.5', 'qwen2.5-coder', 'mistral', 'gemma2', 'phi3', 'deepseek-coder', 'codellama', 'llava', 'moondream'].filter((m) => m.includes(q.toLowerCase()));
      for (const m of ollamaSuggestions) {
        results.unshift({ source: 'ollama', name: m, url: 'https://ollama.com/library/' + m });
      }
      return json(res, 200, { ok: true, results });
    }
    if (url === '/api/scan-models' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const fs = require('fs');
      const path = require('path');
      const home = process.env.USERPROFILE || process.env.HOME || '';
      const found = [];
      // Ollama model store
      const ollamaModels = path.join(home, '.ollama', 'models');
      try {
        if (fs.statSync(ollamaModels).isDirectory()) {
          found.push({ type: 'ollama-store', path: ollamaModels, label: 'Ollama model store' });
          const manifestsDir = path.join(ollamaModels, 'manifests');
          const walkManifests = (dir) => {
            try {
              for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) walkManifests(full);
                else {
                  const parts = full.replace(manifestsDir + path.sep, '').split(path.sep);
                  const tag = parts.pop();
                  const model = parts.join('/');
                  if (model && tag) found.push({ type: 'ollama-model', path: full, label: model + ':' + tag });
                }
              }
            } catch (e2) {}
          };
          try { walkManifests(manifestsDir); } catch (e2) {}
        }
      } catch (e) {}
      // LM Studio model store
      const lmStudioDirs = [path.join(home, '.cache', 'lm-studio', 'models'), path.join(home, '.lmstudio', 'models')];
      for (const lmDir of lmStudioDirs) {
        try {
          if (fs.statSync(lmDir).isDirectory()) {
            found.push({ type: 'lmstudio-store', path: lmDir, label: 'LM Studio model store' });
            const walkLm = (dir, depth) => {
              if (depth > 6) return;
              try {
                for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                  if (f.name === 'node_modules' || f.name === '.git') continue;
                  const full = path.join(dir, f.name);
                  if (f.isDirectory()) walkLm(full, depth + 1);
                  else if (f.isFile() && f.name.toLowerCase().endsWith('.gguf')) {
                    try { const st2 = fs.statSync(full); found.push({ type: 'gguf', path: full, label: f.name, size: st2.size }); } catch (_) {}
                  }
                }
              } catch (e) {}
            };
            walkLm(lmDir, 0);
          }
        } catch (e) {}
      }
      // Scan common dirs for GGUF
      const scanDirs = [home, 'C:\\Models', 'D:\\Models'];
      const walk = (dir, depth) => {
        if (depth > 3) return;
        try {
          for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, f.name);
            if (f.isDirectory() && !f.name.startsWith('.') && f.name !== 'node_modules') walk(full, depth + 1);
            else if (f.isFile() && f.name.endsWith('.gguf')) found.push({ type: 'gguf', path: full, label: f.name });
          }
        } catch (e) {}
      };
      for (const d of scanDirs) { try { if (fs.statSync(d).isDirectory()) walk(d, 0); } catch (e) {} }
      return json(res, 200, { found });
    }
    if (url === '/api/rag/search' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const q = body.query || '';
      // embed query
      let qEmb = null;
      try {
        const er = await fetch((backends.getUrl() || 'http://127.0.0.1:11434') + '/api/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: body.embedModel || 'nomic-embed-text', prompt: q }) });
        const ed = await er.json();
        qEmb = ed.embedding;
      } catch (e) {}
      const mems = db.listMemories();
      if (!qEmb) { return json(res, 200, { ok: true, results: mems.slice(0, 10) }); }
      const scored = mems.map((m) => {
        if (!m.embedding) return { m, score: 0 };
        const a = qEmb, b = m.embedding;
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
        const score = (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
        return { m, score };
      const limit = Math.max(0, Math.min(parseInt(body.limit, 10) || 10, 100));
      }).sort((x, y) => y.score - x.score).slice(0, limit);
      return json(res, 200, { ok: true, results: scored.map((s) => ({ ...s.m, score: s.score })) });
    }
    if (url === '/api/squeeze' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      let text = body.text || '';
      if (body.url) {
        if (!security.isSafeUrl(body.url)) return json(res, 400, { ok: false, error: 'unsafe url' });
        try {
          const r = await fetch(body.url);
          text = await r.text();
        } catch (e) { return json(res, 400, { ok: false, error: 'fetch failed: ' + (e.message || e) }); }
      }
      text = text.slice(0, 30000);
      const model = body.model || 'llama3.2:3b';
      const prompt = 'Answer the following question based ONLY on the provided text. Be concise.\\n\\nQuestion: ' + (body.question || '') + '\\n\\nText:\\n' + text;
      try {
        const r = await backends.backendChat({ model, messages: [{ role: 'user', content: prompt }], stream: false }, () => {});
        const d = r && r.data ? r.data : r;
        const answer = (d && d.message && d.message.content) || '';
        return json(res, 200, { ok: true, answer });
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e.message || e) });
      }
    }
    if (url === '/api/pending-actions' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 200, { actions: pendingActions });
    }
    if (url === '/api/pending-actions/queue' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const a = queueAction(body);
      return json(res, 200, { ok: true, action: a });
    }
    if (url === '/api/pending-actions/approve' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const a = pendingActions.find((x) => x.id === body.id);
      if (a) a.status = 'approved';
      return json(res, 200, { ok: true });
    }
    if (url === '/api/pending-actions/reject' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const a = pendingActions.find((x) => x.id === body.id);
      if (a) a.status = 'rejected';
      return json(res, 200, { ok: true });
    }
    if (url === '/api/error-log' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const fs = require('fs');
      const p = path.join(config.DATA_DIR, 'error.log');
      try { return json(res, 200, { content: fs.readFileSync(p, 'utf8') }); }
      catch (e) { return json(res, 200, { content: '' }); }
    }
    if (url === '/api/search-config' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const s = require('./server/tools/search');
      return json(res, 200, s.loadConfig());
    }
    if (url === '/api/search-config' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const s = require('./server/tools/search');
      const cfg = s.loadConfig();
      Object.assign(cfg, body);
      s.saveConfig(cfg);
      return json(res, 200, { ok: true, config: cfg });
    }
    if (url === '/api/rag/reindex' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const model = body.embedModel || 'nomic-embed-text';
      const mems = db.listMemories();
      let count = 0;
      for (const m of mems) {
        try {
          const er = await fetch((backends.getUrl() || 'http://127.0.0.1:11434') + '/api/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt: m.text }) });
          const ed = await er.json();
          if (ed.embedding) { db.saveMemory({ ...m, embedding: ed.embedding }); count++; }
        } catch (e) {}
      }
      return json(res, 200, { ok: true, reindexed: count, total: mems.length });
    }
    const cfgMatch = url.match(/^\/api\/integrations\/([^/]+)\/configure$/);
    if (cfgMatch && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const name = cfgMatch[1];
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const ALLOWED_ENV_KEYS = new Set(['BACKEND_TYPE','BACKEND_URL','OLLAMA_URL','BACKEND_API_KEY','STT_URL','TTS_URL','GITHUB_TOKEN','GHIDRA_MCP_URL','CRAFT_BIN','REA_BIN','OLLAMA_BIN']);
      const cfg = intConfig.load();
      if (body.envKey) {
        if (!ALLOWED_ENV_KEYS.has(body.envKey)) return json(res, 400, { ok: false, error: 'env key not allowed' });
        cfg[body.envKey] = body.value || '';
        intConfig.save(cfg);
        intConfig.apply({ [body.envKey]: body.value || '' });
      }
      const st = await integrations.registry.statusAll();
      return json(res, 200, { ok: true, status: st[name] });
    }
    if (url === '/api/integrations/awesome-re/update' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const ar = require('./server/integrations/awesome-re');
      const data = await ar.refresh();
      const st = await integrations.registry.statusAll();
      return json(res, 200, { ok: !!data, count: data ? data.length : 0, status: st['awesome-re'] });
    }
    if (url === '/api/integrations/craft/install-rust' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const https = require('https');
      const fs = require('fs');
      const path = require('path');
      const { runProcess, downloadToFile } = require('./server/core/security');
      const rustupPath = path.join(DATA_DIR, 'rustup-init.exe');
      try {
        if (!fs.existsSync(rustupPath)) {
          await downloadToFile('https://win.rustup.rs/x86_64', rustupPath);
        }
        const r = await runProcess(rustupPath, ['-y', '--default-toolchain', 'stable'], { timeout: 600000, shell: true });
        return json(res, 200, { ok: r.ok, output: (r.out || '').slice(-500), error: r.err });
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e.message || e) });
      }
    }
    if (url === '/api/integrations/craft/install' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const { runProcess, downloadToFile } = require('./server/core/security');
      const fs = require('fs');
      const path = require('path');
      const dir = path.join(DATA_DIR, 'tools', 'craft-anything');
      const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const gitBin = process.platform === 'win32' ? 'git.exe' : 'git';
      const cargoBin = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
      // check cargo
      const https = require('https');
      const binDir = path.join(DATA_DIR, 'tools');
      fs.mkdirSync(binDir, { recursive: true });
      // Try pre-built binary from GitHub releases first
      const candidates = [
        'https://github.com/storytold/craft-anything/releases/latest/download/craft-anything-cli-x86_64-pc-windows-msvc.exe',
        'https://github.com/storytold/craft-anything/releases/latest/download/craft.exe',
        'https://github.com/storytold/craft-anything/releases/latest/download/craft-anything-cli.exe',
      ];
      for (const url of candidates) {
        try {
          const dest = path.join(binDir, 'craft-anything-cli.exe');
          await downloadToFile(url, dest);
          if (fs.existsSync(dest)) {
            const cfg = intConfig.load();
            cfg.CRAFT_BIN = dest;
            intConfig.save(cfg);
            intConfig.apply({ CRAFT_BIN: dest });
            const st = await integrations.registry.statusAll();
            return json(res, 200, { ok: true, binary: dest, status: st.craft });
          }
        } catch (e) {}
      }
      // Fall back to cargo build
      const cargoCheck = await runProcess(cargoBin, ['--version'], { timeout: 10000, shell: true });
      if (!cargoCheck.ok) {
        const st = await integrations.registry.statusAll();
        return json(res, 200, { ok: false, error: 'No pre-built binary found and Rust/cargo is not installed. Install Rust from https://rustup.rs (or click "Install Rust") then retry.', status: st.craft });
      }
      let log = '';
      if (!fs.existsSync(dir)) {
        const r = await runProcess(gitBin, ['clone', 'https://github.com/storytold/craft-anything', dir], { timeout: 300000 });
        log += r.out + '\\n';
        if (!r.ok) { const st = await integrations.registry.statusAll(); return json(res, 200, { ok: false, error: r.err || 'clone failed', log: log.slice(-1000), status: st.craft }); }
      }
      const r2 = await runProcess(cargoBin, ['build', '--release'], { cwd: dir, timeout: 600000, shell: true });
      log += r2.out + '\\n';
      if (!r2.ok) { const st = await integrations.registry.statusAll(); return json(res, 200, { ok: false, error: 'build failed', log: log.slice(-1000), status: st.craft }); }
      // find craft binary
      let found = null;
      const walk = (d) => {
        try {
          for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, f.name);
            if (f.isDirectory()) walk(full);
            else if (/craft/i.test(f.name) && (f.name.endsWith('.exe') || f.name === 'craft' || f.name === 'craft-anything-cli')) found = found || full;
          }
        } catch (e) {}
      };
      walk(dir);
      if (found) {
        const cfg = intConfig.load();
        cfg.CRAFT_BIN = found;
        intConfig.save(cfg);
        intConfig.apply({ CRAFT_BIN: found });
        // reset cached
        delete require.cache[require.resolve('./server/integrations/craft')];
      }
      const st = await integrations.registry.statusAll();
      return json(res, 200, { ok: !!found, binary: found, log: log.slice(-1000), status: st.craft });
    }
    if (url === '/api/integrations/ghidra/install-mcp' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const ghidra = require('./server/integrations/ghidra');
      const installDir = ghidra.findGhidraInstall();
      if (!installDir) {
        const st = await integrations.registry.statusAll();
        return json(res, 200, { ok: false, error: 'Ghidra not found. Install Ghidra first (https://ghidra-sre.org).', status: st.ghidra });
      }
      const https = require('https');
      const fs = require('fs');
      const path = require('path');
      const extDir = path.join(installDir, 'Extensions');
      fs.mkdirSync(extDir, { recursive: true });
      // Fetch latest release to get the actual asset URL
      let assetUrl = null, assetName = null;
      try {
        const releaseJson = await new Promise((resolve, reject) => {
          https.get('https://api.github.com/repos/symgraph/GhidrAssistMCP/releases/latest', { headers: { 'User-Agent': 'AegisAI' } }, (res) => {
            let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(b));
          }).on('error', reject);
        });
        const rel = JSON.parse(releaseJson);
        const asset = (rel.assets || []).find(a => a.name.endsWith('.zip'));
        const sec = require('./server/core/security');
        if (asset && /^[A-Za-z0-9._-]+\.zip$/.test(asset.name) && sec.isSafeUrl(asset.browser_download_url)) {
          assetUrl = asset.browser_download_url; assetName = asset.name;
        }
      } catch (e) {}
      if (!assetUrl) {
        const st = await integrations.registry.statusAll();
        return json(res, 200, { ok: false, error: 'Could not find release asset. Visit https://github.com/symgraph/GhidrAssistMCP/releases manually.', status: st.ghidra });
      }
      const zipPath = path.join(DATA_DIR, assetName);
      const extractDir = path.join(DATA_DIR, 'tools', 'ghidra-mcp');
      fs.mkdirSync(path.dirname(zipPath), { recursive: true });
      // Download (follows redirects; rejects non-200)
      await sec.downloadToFile(assetUrl, zipPath);
      // Extract using PowerShell Expand-Archive
      const { runProcess } = require('./server/core/security');
      const psBin = process.platform === 'win32' ? 'powershell.exe' : 'powershell';
      fs.mkdirSync(extractDir, { recursive: true });
      const r = await runProcess(psBin, ['-NoProfile', '-Command', 'Expand-Archive -Path "' + zipPath + '" -DestinationPath "' + extractDir + '" -Force'], { timeout: 300000 });
      // Find ghidraRun in extracted dir
      let ghidraDir = null;
      const walk = (d) => {
        try {
          for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, f.name);
            if (f.isDirectory()) {
              if (fs.existsSync(path.join(full, 'ghidraRun.bat')) || fs.existsSync(path.join(full, 'ghidraRun'))) ghidraDir = ghidraDir || full;
              walk(full);
            }
          }
        } catch (e) {}
      };
      walk(extractDir);
      if (ghidraDir) {
        process.env.GHIDRA_INSTALL_DIR = ghidraDir;
        const ghidra = require('./server/integrations/ghidra');
        // reset cached url
      }
      const st = await integrations.registry.statusAll();
      return json(res, 200, { ok: true, extracted: ghidraDir || extractDir, zip: zipPath, status: st.ghidra });
    }
    if (url === '/api/integrations/ghidra/detect' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const ghidra = require('./server/integrations/ghidra');
      ghidra.resetCache();
      const url2 = await ghidra.detectMcpUrl();
      if (url2) { process.env.GHIDRA_MCP_URL = url2; ghidra.cachedUrl = url2; }
      const st = await integrations.registry.statusAll();
      return json(res, 200, { ok: !!url2, url: url2, status: st.ghidra });
    }
    if (url === '/api/integrations/rea/update' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const { runProcess } = require('./server/core/security');
      const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const r = await runProcess(npmBin, ['install', '-g', 'rea-agents'], { timeout: 300000, shell: true });
      if (!r.ok) {
        // fallback: try npx
        const r2 = await runProcess(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'rea-agents', '--version'], { timeout: 60000 });
      }
      // re-init
      try { await require('./server/integrations/rea').init(); } catch (e) {}
      const st2 = await integrations.registry.statusAll();
      return json(res, 200, { ok: r.ok, output: (r.out || '').slice(-500), error: r.err, status: st2.rea });
    }
    if (url.startsWith('/api/')) {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 404, { ok: false, error: 'not implemented in wave 4' });
    }
    serveStatic(req, res);
  } catch (e) {
    res.statusCode = e.status || 500;
    res.end(String(e.message || e));
  }
});

async function start() {
  if (!db.isOpen()) {
    console.error('Refusing to start: database could not be opened. Check AEGISAI_DATA_DIR and file permissions.');
    process.exit(1);
  }
  try { await backends.detectBackend(); } catch (e) {}
  const isLoopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
  if (!isLoopback && !TOKEN) {
    console.error('Refusing to start: binding to a non-loopback address (' + HOST + ') without an auth token. Set LOCALAI_TOKEN/AEGISAI_TOKEN.');
    process.exit(1);
  }
  server.listen(PORT, HOST, () => {
    console.log(`AegisAI (next) v${VERSION} listening on http://${HOST}:${PORT}`);
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
