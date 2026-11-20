// server/integrations/awesome-re.js
// Searchable index of reverse-engineered projects (awesome-reverse-engineered).
const fs = require('fs');
const path = require('path');
const https = require('https');

let data = null;
let lastLoad = 0;
const CACHE_FILE = path.join(process.env.AEGISAI_DATA_DIR || '.', 'are-data.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function loadCached() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      data = raw;
      lastLoad = fs.statSync(CACHE_FILE).mtimeMs;
    }
  } catch (e) {}
}

function search(query, limit) {
  if (!data || !Array.isArray(data)) return [];
  const q = String(query || '').toLowerCase();
  return data.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)).slice(0, limit || 20);
}

const integration = {
  name: 'awesome-re',
  isAvailable: () => true,
  tools: () => [{ name: 'search_reverse_engineered', description: 'Search reverse-engineered projects.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } }],
  status: () => ({ ready: !!data, error: data ? null : 'not loaded (run refresh)', toolCount: data ? 1 : 0, count: data ? data.length : 0 }),
  loadCached,
  search,
};

loadCached();

module.exports = { integration, search, loadCached };
