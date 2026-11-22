// tests/security.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('./helpers/isolated-data');
const app = require('../server.js');

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
