// server/storage/integrations-config.js
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../core/config');
const FILE = path.join(DATA_DIR, 'integrations.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; }
}
function save(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), 'utf8');
}
const ALLOWED_KEYS = new Set([
  'REA_BIN', 'CRAFT_BIN', 'GHIDRA_INSTALL_DIR', 'GHIDRA_MCP_URL',
  'OLLAMA_BIN', 'OLLAMA_URL', 'STT_URL', 'TTS_URL', 'GITHUB_TOKEN',
  'LANGSEARCH_API_KEY', 'BACKEND_TYPE', 'BACKEND_URL', 'BACKEND_API_KEY',
]);
function apply(cfg) {
  for (const [k, v] of Object.entries(cfg || {})) {
    if (v && ALLOWED_KEYS.has(k)) process.env[k] = v;
  }
}
module.exports = { load, save, apply, FILE };
