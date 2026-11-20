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
    // ---------- Memory ----------
    if (url === '/api/memory' && req.method === 'GET') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 200, { memories: db.listMemories() });
    }
    if (url === '/api/memory/save' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      if (!body.text) return json(res, 400, { ok: false, error: 'text required' });
      const id = db.saveMemory({ text: body.text, source: body.source || 'manual', tags: body.tags || [] });
      return json(res, 200, { ok: true, id });
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
    if (url === '/api/rag/reindex' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      return json(res, 200, { ok: true, message: 'reindex scheduled (stub)' });
    }
    const cfgMatch = url.match(/^\/api\/integrations\/([^/]+)\/configure$/);
    if (cfgMatch && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const name = cfgMatch[1];
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const cfg = intConfig.load();
      if (body.envKey) { cfg[body.envKey] = body.value || ''; intConfig.save(cfg); intConfig.apply({ [body.envKey]: body.value || '' }); }
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
      const { runProcess } = require('./server/core/security');
      const rustupPath = path.join(DATA_DIR, 'rustup-init.exe');
      try {
        if (!fs.existsSync(rustupPath)) {
          await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(rustupPath);
            https.get('https://win.rustup.rs/x86_64', (res) => {
              res.pipe(file);
              file.on('finish', () => { file.close(); resolve(); });
            }).on('error', (e) => { fs.unlink(rustupPath, () => {}); reject(e); });
          });
        }
        const r = await runProcess(rustupPath, ['-y', '--default-toolchain', 'stable'], { timeout: 600000, shell: true });
        return json(res, 200, { ok: r.ok, output: (r.out || '').slice(-500), error: r.err });
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e.message || e) });
      }
    }
    if (url === '/api/integrations/craft/install' && req.method === 'POST') {
      if (!checkAuth(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
      const { runProcess } = require('./server/core/security');
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
          const ok = await new Promise((resolve) => {
            const file = fs.createWriteStream(dest);
            https.get(url, { headers: { 'User-Agent': 'AegisAI' } }, (res) => {
              if (res.statusCode !== 200) { file.close(); fs.unlink(dest, () => {}); resolve(false); return; }
              res.pipe(file);
              file.on('finish', () => { file.close(); resolve(true); });
            }).on('error', () => { file.close(); fs.unlink(dest, () => {}); resolve(false); });
          });
          if (ok && fs.existsSync(dest)) {
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
        if (asset) { assetUrl = asset.browser_download_url; assetName = asset.name; }
      } catch (e) {}
      if (!assetUrl) {
        const st = await integrations.registry.statusAll();
        return json(res, 200, { ok: false, error: 'Could not find release asset. Visit https://github.com/symgraph/GhidrAssistMCP/releases manually.', status: st.ghidra });
      }
      const zipPath = path.join(DATA_DIR, assetName);
      const extractDir = path.join(DATA_DIR, 'tools', 'ghidra-mcp');
      fs.mkdirSync(path.dirname(zipPath), { recursive: true });
      // Download
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(zipPath);
        https.get(assetUrl, { headers: { 'User-Agent': 'AegisAI' } }, (res) => {
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', (e) => { fs.unlink(zipPath, () => {}); reject(e); });
      });
      // Extract using PowerShell Expand-Archive
      const { runProcess } = require('./server/core/security');
      const psBin = process.platform === 'win32' ? 'powershell.exe' : 'powershell';
      fs.mkdirSync(extractDir, { recursive: true });
      const r = await runProcess(psBin, ['-Command', 'Expand-Archive -Path \"' + zipPath + '\" -DestinationPath \"' + extractDir + '\" -Force'], { timeout: 300000, shell: true });
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
  try { await backends.detectBackend(); } catch (e) {}
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
