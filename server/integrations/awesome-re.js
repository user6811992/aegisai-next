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

function search(query, limit) {
  if (!data || !Array.isArray(data)) return [];
  const q = String(query || '').toLowerCase();
  return data.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)).slice(0, limit || 20);
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
