// server/storage/settings.js
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../core/config');

const FILE = path.join(DATA_DIR, 'settings.json');
function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; }
}
function save(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2), 'utf8');
}
module.exports = { load, save, FILE };
