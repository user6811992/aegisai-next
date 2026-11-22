// tests/timers.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTimerScheduler } = require('../server/runtime/timers');
const { createRuntime } = require('../server/runtime/always-on');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('interval timer enqueues repeatedly until cancelled', async () => {
  const calls = [];
  const sched = createTimerScheduler({ enqueue: async (sid, job) => { calls.push({ sid, job }); } });
  const t = sched.schedule('s1', { goal: 'tick' }, { everyMs: 10 });
  await wait(55);
  sched.cancel(t.id);
  const count = calls.length;
  assert.ok(count >= 2, 'expected repeated enqueues, got ' + count);
  assert.equal(calls[0].sid, 's1');
  assert.equal(calls[0].job.scheduledBy, t.id);
  await wait(30);
  assert.equal(calls.length, count);
  assert.equal(t.active, false);
  sched.clear();
});

test('timer respects maxRuns and one-shot mode', async () => {
  let n = 0;
  const sched = createTimerScheduler({ enqueue: async () => { n++; } });
  const capped = sched.schedule('s2', { goal: 'capped' }, { everyMs: 8, maxRuns: 3 });
  const once = sched.schedule('s2', { goal: 'once' }, { everyMs: 8, once: true });
  await wait(60);
  assert.equal(capped.runs, 3);
  assert.equal(once.runs, 1);
  assert.equal(capped.active, false);
  assert.equal(once.active, false);
  sched.clear();
});

test('runtime schedules jobs and cancels timers on session teardown', async () => {
  const rt = createRuntime({ executor: async () => 'ok' });
  rt.createSession({ id: 's3' });
  const timer = rt.scheduleJob('s3', { goal: 'recurring' }, { everyMs: 10 });
  await wait(35);
  assert.ok(rt.getSession('s3').jobs.length >= 2);
  assert.equal(rt.cancelTimer(timer.id), true);
  assert.equal(rt.destroySession('s3'), true);
  assert.equal(rt.getSession('s3'), null);
  assert.equal(rt.timerScheduler.list('s3').some((t) => t.active), false);
});
