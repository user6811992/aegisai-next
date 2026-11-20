// tests/wave4.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = require('../server.js');

let serverInstance;
let base;

before(async () => {
  process.env.AEGISAI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-w4-'));
  serverInstance = app.server;
  await new Promise((resolve) => serverInstance.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + serverInstance.address().port;
});

after(async () => {
  await new Promise((resolve) => serverInstance.close(resolve));
});

function req(method, url, body) {
  return fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}

test('memory save/list/delete roundtrip', async () => {
  const r = await req('POST', '/api/memory/save', { text: 'hello mem' });
  assert.equal(r.status, 200);
  const d = await r.json();
  const list = await (await req('GET', '/api/memory')).json();
  assert.ok(list.memories.some((m) => m.text === 'hello mem'));
  await req('POST', '/api/memory/delete', { id: d.id });
});

test('skills save/list/delete roundtrip', async () => {
  await req('POST', '/api/skills/save', { name: 'sk1', description: 'd', code: 'x' });
  const list = await (await req('GET', '/api/skills')).json();
  assert.ok(list.skills.some((s) => s.name === 'sk1'));
  await req('POST', '/api/skills/delete', { name: 'sk1' });
});

test('chat save/branch roundtrip', async () => {
  const r = await req('POST', '/api/chats', { title: 't', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] });
  const d = await r.json();
  const br = await req('POST', '/api/chats/branch', { id: d.id, atIndex: 1 });
  const bd = await br.json();
  assert.equal(bd.ok, true);
  const child = await (await req('GET', '/api/chats/' + bd.id)).json();
  assert.equal(child.messages.length, 1);
});

test('stats and backup endpoints', async () => {
  const s = await (await req('GET', '/api/stats')).json();
  assert.ok(typeof s.messages === 'object');
  const b = await (await req('GET', '/api/backup')).json();
  assert.ok(Array.isArray(b.chats));
  assert.ok(Array.isArray(b.memories));
});

test('settings roundtrip', async () => {
  await req('POST', '/api/settings', { foo: 'bar' });
  const s = await (await req('GET', '/api/settings')).json();
  assert.equal(s.foo, 'bar');
});
