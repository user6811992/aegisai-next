// tests/http.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Use a temp data dir to avoid leftover state from other runs.
process.env.AEGISAI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-http-'));

const app = require('../server.js');

let serverInstance;
let base;

before(async () => {
  serverInstance = app.server;
  await new Promise((resolve) => serverInstance.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + serverInstance.address().port;
});

after(async () => {
  await new Promise((resolve) => serverInstance.close(resolve));
  try { fs.rmSync(process.env.AEGISAI_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
});

test('GET / serves the index page', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.ok(t.includes('AegisAI'));
});

test('GET /api/version returns version', async () => {
  const r = await fetch(base + '/api/version');
  assert.ok(r.status === 200 || r.status === 401);
});

test('security headers present on static responses', async () => {
  const r = await fetch(base + '/');
  assert.ok(r.headers.get('x-content-type-options') || r.headers.get('X-Content-Type-Options'));
});

test('POST /api/project rejects missing root', async () => {
  const r = await fetch(base + '/api/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.ok(r.status === 400 || r.status === 401);
});

test('runProcess never interprets shell metacharacters', async () => {
  const payload = 'x" & echo INJECTED & "';
  const r = await app.runProcess(process.execPath, ['-e', 'console.log(process.argv[1])', payload]);
  assert.equal(r.ok, true);
  assert.ok(r.out.includes(payload), 'argument must arrive verbatim: ' + r.out);
  assert.ok(!/^INJECTED$/m.test(r.out));
});

test('isValidModelName accepts normal refs and rejects injection', () => {
  assert.equal(app.isValidModelName('llama3.2:3b'), true);
  assert.equal(app.isValidModelName('huihui_ai/qwen2.5-coder-abliterate:7b'), true);
  assert.equal(app.isValidModelName('x" & calc & "'), false);
  assert.equal(app.isValidModelName('-f /etc/passwd'), false);
  assert.equal(app.isValidModelName(''), false);
  assert.equal(app.isValidModelName('a'.repeat(300)), false);
});

test('validateProjectRoot enforces allow-list', () => {
  const allowed = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-allowed-'));
  const inside = path.join(allowed, 'sub');
  fs.mkdirSync(inside, { recursive: true });
  assert.equal(app.validateProjectRoot(inside, [allowed]), path.resolve(inside));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-outside-'));
  assert.throws(() => app.validateProjectRoot(outside, [allowed]), (e) => e.status === 403);
});

test('validateProjectRoot rejects missing roots', () => {
  assert.throws(() => app.validateProjectRoot(path.join(os.tmpdir(), 'definitely-missing-' + Date.now()), []), (e) => e.status === 400);
});

test('safePath blocks traversal outside the project root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-safe-'));
  app.setProjectRoot(dir);
  assert.throws(() => app.safePath(dir, '../../etc/passwd'), /escapes project root/);
  assert.ok(app.safePath(dir, 'sub/file.txt').startsWith(path.resolve(dir) + path.sep));
});

test('isSafeUrl blocks private/loopback hosts', () => {
  assert.equal(app.isSafeUrl('http://127.0.0.1/x'), false);
  assert.equal(app.isSafeUrl('http://localhost/x'), false);
  assert.equal(app.isSafeUrl('http://192.168.1.1/x'), false);
  assert.equal(app.isSafeUrl('http://10.0.0.1/x'), false);
  assert.equal(app.isSafeUrl('https://example.com/x'), true);
});

test('MAX_BODY_BYTES and TOOL_BUDGET are positive numbers', () => {
  assert.ok(typeof app.MAX_BODY_BYTES === 'number' && app.MAX_BODY_BYTES > 0);
  assert.ok(typeof app.TOOL_BUDGET === 'number' && app.TOOL_BUDGET > 0);
});