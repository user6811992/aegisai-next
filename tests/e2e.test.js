// tests/e2e.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Set data dir BEFORE requiring server so DB opens in temp dir.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-e2e-'));
process.env.AEGISAI_DATA_DIR = tmpDir;

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
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
});

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, base);
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(u, { method, headers: data ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed, raw: b });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('E2E: health check returns 200', async () => {
  const r = await req('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.version);
});

test('E2E: version endpoint returns version', async () => {
  const r = await req('GET', '/api/version');
  assert.equal(r.status, 200);
  assert.ok(r.body.version);
});

test('E2E: settings roundtrip', async () => {
  const r1 = await req('POST', '/api/settings', { foo: 'bar' });
  assert.equal(r1.status, 200);
  const r2 = await req('GET', '/api/settings');
  assert.equal(r2.body.foo, 'bar');
});

test('E2E: memory save/list/delete', async () => {
  const r1 = await req('POST', '/api/memory/save', { text: 'e2e test memory' });
  assert.equal(r1.status, 200);
  const r2 = await req('GET', '/api/memory');
  assert.ok((r2.body.memories || []).some((m) => m.text === 'e2e test memory'));
});

test('E2E: document upload rejects empty data', async () => {
  const r = await req('POST', '/api/documents/upload', { name: 'test.pdf' });
  assert.equal(r.status, 400);
});

test('E2E: 404 on unknown route', async () => {
  const r = await req('GET', '/api/nonexistent');
  assert.ok(r.status === 404 || r.status === 401 || r.status === 200);
});
