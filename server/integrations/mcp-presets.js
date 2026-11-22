// server/integrations/mcp-presets.js
// Curated, safe-by-default configurations for the official MCP reference
// servers. These are config entries only — no reference server code is copied
// into this project (their licenses are mixed MIT/Apache-2.0).
//
// Filesystem is pinned to the validated project root, Git tools are filtered
// to read-only names, and all URL/path arguments are re-checked at call time
// by server/integrations/mcp.js.

const { validateProjectRoot } = require('../core/security');
const { PROJECT_ROOT_ALLOWLIST } = require('../core/config');

const PRESETS = {
  fs: {
    label: 'Filesystem (scoped to project root)',
    runtime: 'npx',
    args: (ctx) => ['-y', '@modelcontextprotocol/server-filesystem', ctx.root],
    scopeRoot: true,
  },
  git: {
    label: 'Git (read-only tools, project repository)',
    runtime: 'uvx',
    args: (ctx) => ['mcp-server-git', '--repository', ctx.root],
    readOnly: true,
  },
  fetch: {
    label: 'Fetch (URLs re-checked against the SSRF guard)',
    runtime: 'uvx',
    args: () => ['mcp-server-fetch'],
  },
  memory: {
    label: 'Memory (knowledge graph)',
    runtime: 'npx',
    args: () => ['-y', '@modelcontextprotocol/server-memory'],
  },
  seq: {
    label: 'Sequential Thinking',
    runtime: 'npx',
    args: () => ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
  time: {
    label: 'Time / timezone conversion',
    runtime: 'uvx',
    args: () => ['mcp-server-time'],
  },
};

function wrap(command, args) {
  if (process.platform === 'win32') return { command: 'cmd', args: ['/c', command, ...args] };
  return { command, args };
}

function buildPresets(ids, projectRoot) {
  const root = validateProjectRoot(projectRoot, PROJECT_ROOT_ALLOWLIST);
  const wanted = Array.isArray(ids) && ids.length ? ids : Object.keys(PRESETS);
  const out = [];
  for (const id of wanted) {
    const def = PRESETS[id];
    if (!def) continue;
    const run = wrap(def.runtime, def.args({ root }));
    const spec = { id: 'preset-' + id, description: def.label, enabled: true, ...run };
    if (def.scopeRoot) spec.scopeRoot = root;
    if (def.readOnly) spec.readOnly = true;
    out.push(spec);
  }
  return out;
}

module.exports = { buildPresets, PRESETS, wrap };
