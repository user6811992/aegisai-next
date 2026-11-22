// server/integrations/mcp-registry.js
// Browser + install flow for registry.modelcontextprotocol.io (F9-4).
//
// Registry entries are third-party and untrusted: only package identifiers
// and remote URLs that pass strict validation can be turned into a config
// spec, and the resulting spec is re-checked by mcp.validSpec before saving.

const intConfig = require('../storage/integrations-config');
const { validSpec, validMcpUrl } = require('./mcp');
const { wrap } = require('./mcp-presets');

const DEFAULT_REGISTRY = 'https://registry.modelcontextprotocol.io';
const SAFE_IDENTIFIER = /^[a-zA-Z0-9@/._=-]{1,120}$/;
const SAFE_VERSION = /^[a-zA-Z0-9._+-]{1,40}$/;
const SAFE_ARG = /^-?[a-zA-Z0-9._/@:=+-]{1,80}$/;
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

function registryUrl() {
  return (process.env.MCP_REGISTRY_URL || DEFAULT_REGISTRY).replace(/\/$/, '');
}

function normalize(entry) {
  const s = (entry && entry.server) || {};
  const official = (entry && entry._meta && entry._meta['io.modelcontextprotocol.registry/official']) || {};
  return {
    name: typeof s.name === 'string' ? s.name : '',
    title: typeof s.title === 'string' ? s.title : '',
    description: typeof s.description === 'string' ? s.description : '',
    version: typeof s.version === 'string' ? s.version : '',
    status: official.status || 'unknown',
    isLatest: official.isLatest !== false,
    packages: Array.isArray(s.packages) ? s.packages : [],
    remotes: Array.isArray(s.remotes) ? s.remotes : [],
    repositoryUrl: (s.repository && typeof s.repository.url === 'string') ? s.repository.url : '',
  };
}

async function fetchRegistry(opts = {}) {
  const query = typeof opts.query === 'string' ? opts.query.slice(0, 120) : '';
  const limit = (typeof opts.limit === 'number' && opts.limit > 0) ? Math.min(Math.floor(opts.limit), 50) : 20;
  const cursor = typeof opts.cursor === 'string' ? opts.cursor.slice(0, 300) : '';
  const url = new URL(registryUrl() + '/v0/servers');
  url.searchParams.set('limit', String(limit));
  if (query) url.searchParams.set('search', query);
  if (cursor) url.searchParams.set('cursor', cursor);

  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : fetch;
  const res = await fetchImpl(url.toString(), {
    headers: { 'User-Agent': 'aegisai-next', Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('MCP registry returned HTTP ' + res.status);
  const data = await res.json();
  const value = {
    servers: (Array.isArray(data.servers) ? data.servers : []).map(normalize),
    nextCursor: (data.metadata && data.metadata.nextCursor) || '',
    count: (data.metadata && data.metadata.count) || 0,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

function positionalArgs(pkg) {
  const args = [];
  for (const a of (Array.isArray(pkg.runtimeArguments) ? pkg.runtimeArguments : [])) {
    if (!a || a.type !== 'positional' || typeof a.value !== 'string') continue;
    if (!SAFE_ARG.test(a.value) || args.length >= 16) throw new Error('unsafe runtime argument in registry entry');
    args.push(a.value);
  }
  return args;
}

function buildSpec(entry, opts = {}) {
  const s = normalize({ server: entry, _meta: entry && entry._meta });
  if (!s.name || !SAFE_IDENTIFIER.test(s.name)) throw new Error('invalid registry server name');

  let spec = null;
  let skippedUnsafe = false;
  for (const pkg of s.packages) {
    if (typeof pkg.identifier !== 'string' || !SAFE_IDENTIFIER.test(pkg.identifier)) {
      skippedUnsafe = true;
      continue;
    }
    const version = typeof pkg.version === 'string' && SAFE_VERSION.test(pkg.version) ? pkg.version : '';
    const extra = positionalArgs(pkg);
    if (pkg.registryType === 'npm') {
      const id = version ? pkg.identifier + '@' + version : pkg.identifier;
      if (!SAFE_IDENTIFIER.test(id)) continue;
      spec = { ...wrap('npx', ['-y', id, ...extra]) };
    } else if (pkg.registryType === 'pypi') {
      const id = version ? pkg.identifier + '==' + version : pkg.identifier;
      if (!SAFE_IDENTIFIER.test(id)) continue;
      spec = { ...wrap('uvx', [id, ...extra]) };
    }
    if (spec) break;
  }
  if (!spec && !s.remotes.length) {
    throw new Error(skippedUnsafe ? 'unsafe package identifier in registry entry' : 'registry entry has no installable npm/pypi package or remote URL');
  }
  if (!spec) {
    const remote = s.remotes.find((r) => r && ['streamable-http', 'http'].includes(r.type) && validMcpUrl(r.url));
    if (!remote) throw new Error('no safe streamable-http remote URL in registry entry');
    spec = { url: remote.url };
  }

  const id = (typeof opts.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(opts.id))
    ? opts.id
    : 'reg-' + Buffer.from(s.name).toString('hex').slice(0, 24);
  const candidate = { id, description: s.title || s.name, enabled: true, ...spec };
  if (!validSpec(candidate)) throw new Error('generated spec failed validation');
  return candidate;
}

function install(spec) {
  if (!validSpec(spec)) throw new Error('invalid MCP server spec');
  const cfg = intConfig.load();
  const list = Array.isArray(cfg.mcpServers) ? cfg.mcpServers.filter((s) => !(s && s.id === spec.id)) : [];
  cfg.mcpServers = list.concat([spec]);
  intConfig.save(cfg);
  return spec;
}

module.exports = { fetchRegistry, normalize, buildSpec, install, registryUrl, DEFAULT_REGISTRY };
