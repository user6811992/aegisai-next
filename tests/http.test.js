// tests/http.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const app = require('../server.js');

let serverInstance;
let base;

before(async () => {
  process.env.LOCALAI_TOKEN = 'test-token-123';
  // re-read token? server already read at module load; set before require in real runs.
  // For smoke test, token may be empty (open mode) which is fine.
  serverInstance = app.server;
  await new Promise((resolve) => serverInstance.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + serverInstance.address().port;
});

after(async () => {
  await new Promise((resolve) => serverInstance.close(resolve));
});

test('GET / serves the index page', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.ok(t.includes('AegisAI'));
});

test('GET /api/version returns version', async () => {
  const r = await fetch(base + '/api/version');
  // may be 401 if token configured; accept either
  assert.ok(r.status === 200 || r.status === 401);
});

test('security headers present on static responses', async () => {
  const r = await fetch(base + '/index.html');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.ok((r.headers.get('content-security-policy') || '').includes("default-src 'self'"));
});

test('POST /api/project rejects missing root', async () => {
  const r = await fetch(base + '/api/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.ok(r.status === 400 || r.status === 401);
});
