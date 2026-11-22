// tests/frontend-guard.test.js
// A committed index.html without hashed assets must fail loudly instead of
// serving a UI whose every asset request 404s (GitHub issue #4).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fakePublic = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-public-'));
fs.writeFileSync(path.join(fakePublic, 'index.html'), '<html>stale build</html>');
process.env.AEGISAI_PUBLIC_DIR = fakePublic;
require('./helpers/isolated-data');
const app = require('../server.js');

let serverInstance;
let base;

before(async () => {
  serverInstance = app.server;
  await new Promise((resolve) => {
    if (serverInstance.listening) return resolve();
    serverInstance.listen(0, '127.0.0.1', resolve);
  });
  base = 'http://127.0.0.1:' + serverInstance.address().port;
});

after(async () => {
  await new Promise((resolve) => serverInstance.close(resolve));
  try { fs.rmSync(fakePublic, { recursive: true, force: true }); } catch (e) {}
});

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('GET / returns 503 with a build hint when public/assets is missing', async () => {
  const r = await get(base + '/');
  assert.equal(r.status, 503);
  assert.ok(r.body.includes('npm run build'));
});

test('GET /api/health still works when the frontend is not built', async () => {
  const r = await get(base + '/api/health');
  assert.equal(r.status, 200);
});
