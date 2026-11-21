// server/core/plugins.js
// Minimal plugin loader. Plugins live in <DATA_DIR>/plugins/<name>/ with a
// manifest.json ({ name, version, description, entry }) and an entry module
// exporting init(app) and optionally tools().
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const PLUGINS_DIR = path.join(DATA_DIR, 'plugins');
const loaded = [];

function loadPlugins(app) {
  try { fs.mkdirSync(PLUGINS_DIR, { recursive: true }); } catch (e) {}
  let entries;
  try { entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true }); } catch (e) { return loaded; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(PLUGINS_DIR, e.name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const entry = path.join(dir, manifest.entry || 'index.js');
      if (!fs.existsSync(entry)) continue;
      const mod = require(entry);
      if (typeof mod.init === 'function') mod.init(app);
      loaded.push({ name: manifest.name || e.name, version: manifest.version || '0.0.0', description: manifest.description || '', dir, tools: typeof mod.tools === 'function' ? mod.tools() : [] });
      console.log('Plugin loaded:', manifest.name || e.name);
    } catch (err) {
      console.error('Plugin load failed (' + e.name + '):', err.message);
    }
  }
  return loaded;
}

function listPlugins() { return loaded.map((p) => ({ name: p.name, version: p.version, description: p.description, toolCount: p.tools.length })); }

module.exports = { loadPlugins, listPlugins, PLUGINS_DIR };
