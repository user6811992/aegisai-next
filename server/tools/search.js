// server/tools/search.js
// Web search with multiple engines. Ported (subset) from original AegisAI.

const http = require('http');
const https = require('https');

function httpGet(url, headers) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: headers || {} }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', (e) => resolve({ status: 0, data: 'ERROR: ' + e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, data: 'TIMEOUT' }); });
  });
}

const ENGINES = ['duckduckgo', 'wikipedia', 'searxng', 'google-html', 'internet-archive', 'langsearch'];

function loadConfig() {
  try {
    const fs = require('fs');
    const path = require('path');
    const { DATA_DIR } = require('../core/config');
    const p = path.join(DATA_DIR, 'search-config.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { return {}; }
}

function saveConfig(cfg) {
  const fs = require('fs');
  const path = require('path');
  const { DATA_DIR } = require('../core/config');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'search-config.json'), JSON.stringify(cfg, null, 2), 'utf8');
}

async function webSearch(query, opts) {
  opts = opts || {};
  const cfg = loadConfig();
  const engine = (cfg && cfg.engine) || 'duckduckgo';
  const max = opts.max_results || 8;
  let result = '';

  if (engine === 'duckduckgo') {
    const r = await httpGet('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=0', {});
    try {
      const j = JSON.parse(r.data);
      const out = [];
      if (j.AbstractText) out.push('Abstract: ' + j.AbstractText + (j.AbstractURL ? '\n' + j.AbstractURL : ''));
      if (j.Answer) out.push('Answer: ' + j.Answer);
      if (Array.isArray(j.RelatedTopics)) {
        for (const t of j.RelatedTopics.slice(0, max)) {
          if (t.Text) out.push('- ' + t.Text + (t.FirstURL ? ' (' + t.FirstURL + ')' : ''));
          if (t.Topics) for (const st of t.Topics.slice(0, 3)) if (st.Text) out.push('  - ' + st.Text);
        }
      }
      result = out.length ? out.join('\n') : 'No instant results. Try fetch_url with a specific URL.';
    } catch (e) { result = 'ERROR parsing: ' + e.message; }
  } else if (engine === 'wikipedia') {
    const r = await httpGet('https://en.wikipedia.org/w/api.php?action=opensearch&search=' + encodeURIComponent(query) + '&limit=' + max + '&namespace=0&format=json', { 'User-Agent': 'LocalAI' });
    try {
      const j = JSON.parse(r.data);
      const titles = j[1] || [], descs = j[2] || [], urls = j[3] || [];
      const out = [];
      for (let i = 0; i < titles.length && i < max; i++) out.push('- ' + titles[i] + ' (' + urls[i] + ')' + (descs[i] ? '\n  ' + descs[i] : ''));
      result = out.length ? out.join('\n') : 'No results.';
    } catch (e) { result = 'ERROR parsing: ' + e.message; }
  } else if (engine === 'searxng') {
    const instance = (cfg && cfg.searxngInstance) || 'https://searx.be';
    const r = await httpGet(instance.replace(/\/$/, '') + '/search?q=' + encodeURIComponent(query) + '&format=json', { 'User-Agent': 'LocalAI', 'Accept': 'application/json' });
    try {
      const j = JSON.parse(r.data);
      const out = [];
      for (const it of (j.results || []).slice(0, max)) out.push('- ' + (it.title || '') + ' (' + (it.url || '') + ')' + (it.content ? '\n  ' + it.content : ''));
      result = out.length ? out.join('\n') : 'No results.';
    } catch (e) { result = 'ERROR parsing: ' + e.message; }
  } else if (engine === 'google-html') {
    const r = await httpGet('https://www.google.com/search?q=' + encodeURIComponent(query) + '&hl=en&num=' + max, { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' });
    const out = [];
    const re = /<a[^>]*href="\/url\?q=([^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    let m;
    while ((m = re.exec(r.data)) && out.length < max) {
      try {
        const url = decodeURIComponent(m[1]);
        const title = m[2].replace(/<[^>]+>/g, '').trim();
        if (title && url.startsWith('http')) out.push('- ' + title + ' (' + url + ')');
      } catch (e) {}
    }
    result = out.length ? out.join('\n') : 'No results (Google may have blocked the request).';
  } else if (engine === 'internet-archive') {
    const r = await httpGet('https://archive.org/advancedsearch.php?q=' + encodeURIComponent(query) + '&fl[]=title&fl[]=identifier&fl[]=description&rows=' + max + '&output=json', { 'User-Agent': 'LocalAI' });
    try {
      const j = JSON.parse(r.data);
      const docs = (j.response && j.response.docs) || [];
      const out = [];
      for (const d of docs.slice(0, max)) {
        const title = d.title || d.identifier || '';
        const id = d.identifier || '';
        const desc = (d.description || '').toString().slice(0, 200);
        out.push('- ' + title + ' (https://archive.org/details/' + id + ')' + (desc ? '\n  ' + desc : ''));
      }
      result = out.length ? out.join('\n') : 'No results.';
    } catch (e) { result = 'ERROR parsing: ' + e.message; }
  } else if (engine === 'langsearch') {
    const apiKey = (cfg && cfg.langsearchApiKey) || process.env.LANGSEARCH_API_KEY || '';
    if (!apiKey) { result = 'LangSearch API key not configured. Set LANGSEARCH_API_KEY or configure in settings.'; }
    else {
      const body = JSON.stringify({ query, count: max });
      const r = await new Promise((resolve) => {
        https.request('https://api.langsearch.com/v1/web/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
          let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, data }));
        }).on('error', e => resolve({ status: 0, data: 'ERROR: ' + e.message })).end(body);
      });
      try {
        const j = JSON.parse(r.data);
        const out = [];
        for (const it of (j.data || j.results || []).slice(0, max)) {
          out.push('- ' + (it.title || '') + ' (' + (it.url || '') + ')' + (it.snippet ? '\n  ' + it.snippet : ''));
        }
        result = out.length ? out.join('\n') : 'No results.';
      } catch (e) { result = 'ERROR parsing: ' + e.message; }
    }
  } else {
    result = 'Unknown engine: ' + engine + '. Available: ' + ENGINES.join(', ');
  }
  return result;
}

module.exports = { webSearch, loadConfig, saveConfig, ENGINES, httpGet };
