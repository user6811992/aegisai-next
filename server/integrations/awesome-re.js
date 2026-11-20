// server/integrations/awesome-re.js
const fs = require('fs');
const path = require('path');
const https = require('https');
const { DATA_DIR } = require('../core/config');

const ARE_DATA_URL = 'https://raw.githubusercontent.com/alexgaoth/awesome-reverse-engineered/main/data/entries.json';
const CACHE_FILE = path.join(DATA_DIR, 'are-data.json');

let data = null;
let loading = false;

function loadCached() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) { data = null; }
}

async function refresh() {
  if (loading) return data;
  loading = true;
  try {
    const buf = await new Promise((resolve, reject) => {
      const headers = { 'User-Agent': 'AegisAI' };
      if (process.env.GITHUB_TOKEN) headers['Authorization'] = 'token ' + process.env.GITHUB_TOKEN;
      https.get(ARE_DATA_URL, { headers }, (r) => {
        let b = '';
        r.on('data', (c) => { if (b.length > 50 * 1024 * 1024) { reject(new Error('too large')); r.destroy(); return; } b += c; });
        r.on('end', () => resolve(b));
      }).on('error', reject);
    });
    data = JSON.parse(buf);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, buf, 'utf8');
  } catch (e) {
    // keep stale data if any
  } finally {
    loading = false;
  }
  return data;
}

function search(query, opts) {
  opts = opts || {};
  if (!data || !Array.isArray(data)) return [];
  const limit = (opts.limit === undefined || opts.limit === null) ? 20 : opts.limit;
  if (limit <= 0) return [];
  const q = String(query || '').toLowerCase();
  const category = opts.category || '';
  const language = opts.language || '';
  const minStars = opts.minStars || 0;
  const results = [];
  for (const entry of data) {
    if (!entry) continue;
    if (category && (entry.category || '').toLowerCase() !== category.toLowerCase()) continue;
    const entryLang = entry.lang || entry.language || '';
    if (language && entryLang.toLowerCase() !== language.toLowerCase()) continue;
    if (minStars && (entry.stars || 0) < minStars) continue;
    const topics = Array.isArray(entry.topics) ? entry.topics : [];
    const entryDesc = entry.desc || entry.description || '';
    const searchable = ((entry.name || '') + ' ' + entryDesc + ' ' + topics.join(' ') + ' ' + (entry.category || '')).toLowerCase();
    if (q && !searchable.includes(q)) continue;
    results.push(entry);
    if (results.length >= limit) break;
  }
  return results;
}

const integration = {
  name: 'awesome-re',
  isAvailable: () => true,
  tools: () => [{ name: 'search_reverse_engineered', description: 'Search reverse-engineered projects.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } }],
  status: () => ({ ready: true, error: data ? null : 'index not loaded (click Update)', toolCount: 1, count: data ? data.length : 0 }),
  loadCached,
  refresh,
  search,
};

loadCached();

module.exports = { integration, search, loadCached, refresh };
