// Give each `node --test` worker process its own data directory so parallel
// test files never open the same SQLite file (which caused "database is
// locked" warnings on CI). Must be required before server.js.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegisai-test-'));
process.env.AEGISAI_DATA_DIR = dir;

function cleanup() {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}
process.on('exit', cleanup);

module.exports = { dir };
