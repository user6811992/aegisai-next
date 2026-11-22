// server/integrations/mcp-search.js
// F10-1: unified external search over search-capable MCP servers (e.g. a
// locally hosted xerj search/MCP endpoint). Exposes `search_external` to the
// agent loop, fanning out to MCP tools marked with role:"search" or whose
// names look like search/query/find tools. No reference server code is used.

const mcp = require('./mcp');

const SEARCH_HINT = /(search|query|find|grep|explore|lookup)/i;
const WRITE_HINT = /(write|edit|create|delete|remove|commit|push|reset|checkout|rename|stage|init)/i;
const MAX_CHARS_PER_SOURCE = 4000;

function candidates() {
  const out = [];
  for (const entry of mcp.getEntries()) {
    if (!entry.ready) continue;
    for (const name of entry.tools) {
      const short = name.slice(name.indexOf(mcp.SEP) + mcp.SEP.length);
      if (WRITE_HINT.test(short)) continue;
      if (entry.role === 'search' || SEARCH_HINT.test(short)) {
        out.push({ fullName: name, serverId: entry.id, tool: short });
      }
    }
  }
  return out;
}

function extractText(res) {
  if (!res) return '';
  if (Array.isArray(res.content)) {
    return res.content.filter((c) => c && c.type === 'text').map((c) => String(c.text || '')).join('\n');
  }
  return typeof res === 'string' ? res : JSON.stringify(res);
}

async function search(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('query is required');
  const limit = (typeof opts.limit === 'number' && opts.limit > 0) ? Math.min(Math.floor(opts.limit), 20) : 8;
  const tools = candidates().slice(0, limit);
  if (!tools.length) return { ok: false, query: q, sources: [], note: 'no search-capable MCP tools available' };

  const results = await Promise.all(tools.map(async (t) => {
    try {
      const res = await mcp.callTool(t.fullName, { query: q, limit });
      return { source: t.serverId, tool: t.tool, ok: true, text: extractText(res).slice(0, MAX_CHARS_PER_SOURCE) };
    } catch (e) {
      return { source: t.serverId, tool: t.tool, ok: false, error: String((e && e.message) || e) };
    }
  }));
  return { ok: results.some((r) => r.ok), query: q, sources: results };
}

const integration = {
  name: 'search',
  isAvailable: async () => candidates().length > 0,
  tools: () => [{
    name: 'external',
    description: 'Search across external search-capable MCP servers (e.g. a local xerj index). Returns per-source text.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
    },
  }],
  status: () => ({ ready: candidates().length > 0, error: null, toolCount: candidates().length, tools: candidates().map((c) => c.fullName) }),
  callTool: async (name, args) => {
    if (name !== 'external') throw new Error('unknown search tool: ' + name);
    return search(args && args.query, args || {});
  },
};

module.exports = { integration, search, candidates, extractText };
