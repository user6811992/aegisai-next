// server/integrations/mcp.js
// Generic MCP client integration: spawns configured MCP servers over stdio and
// exposes their tools to the agent loop as `mcp_<id>__<tool>`.
//
// Config lives in data/integrations.json under `mcpServers`:
//   [{ "id": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/allowed"] }]
//
// On Windows, use "cmd" with args ["/c", "npx", ...] as the MCP docs recommend.

const path = require('path');
const intConfig = require('../storage/integrations-config');
const security = require('../core/security');

const SEP = '__';
const ALLOWED_COMMANDS = new Set(['npx', 'uvx', 'node', 'python', 'python3']);
const WRITE_TOOL = /(write|edit|create|delete|remove|commit|push|reset|checkout|move|rename|apply|stage|init)/i;
const URL_ARGS = ['url', 'target', 'endpoint', 'href', 'link'];
const PATH_ARGS = ['path', 'paths', 'file_path', 'directory', 'source', 'destination'];
let initPromise = null;
let entries = new Map();

function validSpec(s) {
  if (!s || typeof s !== 'object') return false;
  if (typeof s.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(s.id)) return false;
  if (typeof s.command !== 'string' || !s.command || s.command.length > 200) return false;
  if (!Array.isArray(s.args) || s.args.length > 32 || !s.args.every((a) => typeof a === 'string')) return false;
  // Allow bare command names and absolute executable paths whose basename is
  // an allowed runtime (e.g. D:\nodejs\node.exe).
  const cmd = path.basename(s.command, path.extname(s.command)).toLowerCase();
  if (cmd === 'cmd') {
    if (s.args[0] !== '/c' && s.args[0] !== '/C') return false;
    if (!ALLOWED_COMMANDS.has(String(s.args[1] || '').toLowerCase())) return false;
    return true;
  }
  return ALLOWED_COMMANDS.has(cmd);
}

function readSpecs() {
  const cfg = intConfig.load();
  const list = Array.isArray(cfg.mcpServers) ? cfg.mcpServers : [];
  return list.filter(validSpec).filter((s) => s.enabled !== false);
}

async function loadSdk() {
  try {
    const sdk = require('@modelcontextprotocol/sdk/client');
    const stdio = require('@modelcontextprotocol/sdk/client/stdio.js');
    return { Client: sdk.Client, StdioClientTransport: stdio.StdioClientTransport };
  } catch (e) {
    const sdk = require('@modelcontextprotocol/sdk');
    return { Client: sdk.Client, StdioClientTransport: sdk.StdioClientTransport };
  }
}

async function init() {
  // Prevent an MCP server process from recursively spawning configured servers.
  if (process.env.AEGISAI_MCP_SERVER === '1') return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const { Client, StdioClientTransport } = await loadSdk();
    for (const spec of readSpecs()) {
      const entry = { spec, client: null, tools: [], error: null };
      entries.set(spec.id, entry);
      try {
        const env = Object.assign({}, process.env, spec.env && typeof spec.env === 'object' ? spec.env : {});
        const transport = new StdioClientTransport({
          command: spec.command,
          args: spec.args,
          env,
          stderr: 'pipe',
        });
        const client = new Client({ name: 'aegisai-next', version: '0.3.0' }, { capabilities: {} });
        await client.connect(transport);
        const res = await client.listTools();
        entry.client = client;
        const discovered = (res.tools || []).filter((t) => !(spec.readOnly && WRITE_TOOL.test(String(t.name))));
        entry.tools = discovered.map((t) => ({
          name: spec.id + SEP + t.name,
          description: t.description || (spec.id + ' / ' + t.name),
          inputSchema: t.inputSchema || { type: 'object', properties: {} },
          toolName: t.name,
        }));
      } catch (e) {
        entry.error = String((e && e.message) || e);
      }
    }
  })();
  return initPromise;
}

async function isAvailable() {
  await init();
  return Array.from(entries.values()).some((e) => e.tools.length > 0);
}

function tools() {
  const out = [];
  for (const entry of entries.values()) {
    for (const t of entry.tools) {
      out.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
    }
  }
  return out;
}

function validateToolArgs(args, entry) {
  const a = args && typeof args === 'object' ? args : {};
  for (const key of URL_ARGS) {
    const v = a[key];
    if (typeof v === 'string' && v.trim() && !security.isSafeUrl(v)) {
      throw new Error('MCP tool blocked: unsafe ' + key);
    }
  }
  const root = entry && entry.spec && entry.spec.scopeRoot;
  if (root) {
    for (const key of PATH_ARGS) {
      const v = a[key];
      if (typeof v === 'string' && v.trim()) security.safePath(root, v);
      if (Array.isArray(v)) for (const p of v) if (typeof p === 'string' && p.trim()) security.safePath(root, p);
    }
  }
  return a;
}

async function callTool(name, args) {
  await init();
  const idx = String(name || '').indexOf(SEP);
  if (idx < 0) throw new Error('invalid MCP tool name (expected <id>__<tool>): ' + name);
  const id = name.slice(0, idx);
  const toolName = name.slice(idx + SEP.length);
  const entry = entries.get(id);
  if (!entry || !entry.client) throw new Error('MCP server not available: ' + id + (entry && entry.error ? ' (' + entry.error + ')' : ''));
  const safeArgs = validateToolArgs(args, entry);
  const res = await entry.client.callTool({ name: toolName, arguments: safeArgs });
  return res;
}

async function status() {
  await init();
  const servers = {};
  for (const [id, e] of entries) {
    servers[id] = { ready: !!e.client, error: e.error, toolCount: e.tools.length };
  }
  return { ready: Array.from(entries.values()).some((e) => !!e.client), error: null, toolCount: tools().length, servers };
}

async function closeAll() {
  for (const entry of entries.values()) {
    if (entry.client && typeof entry.client.close === 'function') {
      try { await entry.client.close(); } catch (e) { /* best effort */ }
    }
  }
  entries = new Map();
  initPromise = null;
}

const integration = { name: 'mcp', isAvailable, tools, status, callTool, init, closeAll };

module.exports = { integration, init, callTool, closeAll, validSpec, validateToolArgs, SEP };
