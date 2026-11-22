// tests/delivery.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEventChannel, createWebhookChannel, createDelivery } = require('../server/runtime/delivery');
const { createRuntime } = require('../server/runtime/always-on');

test('event channel buffers events and notifies subscribers', async () => {
  const ch = createEventChannel();
  const got = [];
  const unsub = ch.subscribe((e) => got.push(e));
  await ch.send({ type: 'done', id: 'job-1' });
  assert.equal(ch.history.length, 1);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'job-1');
  unsub();
  await ch.send({ type: 'done', id: 'job-2' });
  assert.equal(got.length, 1);
  assert.equal(ch.history.length, 2);
});

test('webhook channel rejects unsafe URLs and posts to safe URLs', async () => {
  assert.throws(() => createWebhookChannel({ url: 'http://127.0.0.1:9/hook' }), /unsafe/);
  assert.throws(() => createWebhookChannel({}), /unsafe/);
  const calls = [];
  const ch = createWebhookChannel({
    url: 'https://example.com/hook',
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; },
  });
  const r = await ch.send({ type: 'done', id: 'job-1' });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.com/hook');
  assert.equal(JSON.parse(calls[0].opts.body).id, 'job-1');
});

test('delivery isolates failing channels', async () => {
  const failing = { name: 'bad', send: async () => { throw new Error('down'); } };
  const good = createEventChannel();
  const d = createDelivery({ channels: [failing, good] });
  const results = await d.send({ type: 'start' });
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, false);
  assert.equal(results[1].ok, true);
  assert.equal(good.history.length, 1);
});

test('runtime forwards lifecycle events to delivery', async () => {
  const ch = createEventChannel();
  const delivery = createDelivery({ channels: [ch] });
  const rt = createRuntime({ delivery, executor: async () => 'ok' });
  rt.createSession({ id: 's1' });
  rt.enqueue('s1', { goal: 'job' });
  await rt.tick();
  await new Promise((r) => setImmediate(r));
  const types = ch.history.map((e) => e.type);
  assert.ok(types.includes('session'));
  assert.ok(types.includes('enqueue'));
  assert.ok(types.includes('start'));
  assert.ok(types.includes('done'));
});
