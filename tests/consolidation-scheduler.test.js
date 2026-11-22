// tests/consolidation-scheduler.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');

require('./helpers/isolated-data');
const app = require('../server.js');
const db = require('../server/storage/db');
const { createConsolidationScheduler } = require('../server/runtime/consolidation-scheduler');
const { createTimerScheduler } = require('../server/runtime/timers');

let serverInstance;
let base;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  db.saveMemory({ id: 'sched-a', text: 'Project uses SQLite for storing chat history', source: 'manual', tags: ['db'] });
  db.saveMemory({ id: 'sched-b', text: 'Project uses SQLite for storing document history', source: 'manual', tags: ['db'] });
  serverInstance = app.server;
  await new Promise((resolve) => {
    if (serverInstance.listening) return resolve();
    serverInstance.listen(0, '127.0.0.1', resolve);
  });
  base = 'http://127.0.0.1:' + serverInstance.address().port;
});

after(async () => {
  await new Promise((resolve) => serverInstance.close(resolve));
  const dir = process.env.AEGISAI_DATA_DIR;
  if (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
});

function request(urlPath, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + urlPath, { method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('scheduler runs consolidation on an interval and stops cleanly', async () => {
  let calls = 0;
  const scheduler = createTimerScheduler();
  const consolidation = createConsolidationScheduler({
    scheduler,
    consolidate: async () => { calls++; return { ok: true, mergedGroups: 0, after: 0 }; },
  });
  consolidation.start({ everyMs: 15 });
  await wait(70);
  assert.ok(calls >= 2, 'expected repeated consolidation runs, got ' + calls);
  const stopped = consolidation.stop();
  assert.equal(stopped.running, false);
  const atStop = calls;
  await wait(40);
  assert.equal(calls, atStop);
  await consolidation.runNow();
  assert.equal(consolidation.status().runs, calls);
  scheduler.clear();
});

test('runNow performs a real consolidation pass', async () => {
  const report = await app.consolidation.runNow();
  assert.ok(report.mergedGroups >= 1);
  assert.ok(report.after < report.before);
});

test('consolidation HTTP endpoints expose status, run, stop and start', async () => {
  const status = await request('/api/memory/consolidation/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.ok, true);
  assert.equal(typeof status.body.running, 'boolean');

  const run = await request('/api/memory/consolidation/run', 'POST', {});
  assert.equal(run.status, 200);
  assert.ok(run.body.report);

  const stop = await request('/api/memory/consolidation/stop', 'POST', {});
  assert.equal(stop.status, 200);
  assert.equal(stop.body.running, false);

  const start = await request('/api/memory/consolidation/start', 'POST', { everyMs: 60000, threshold: 0.6 });
  assert.equal(start.status, 200);
  assert.equal(start.body.running, true);
  assert.equal(start.body.threshold, 0.6);
  await request('/api/memory/consolidation/stop', 'POST', {});
});
