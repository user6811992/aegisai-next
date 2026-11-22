// tests/runtime.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AlwaysOnRuntime, createRuntime } = require('../server/runtime/always-on');
const { createSessionPolicy, checkJobAgainstPolicy } = require('../server/runtime/isolation');

test('runtime creates a session and exposes it by id', () => {
  const rt = createRuntime();
  const s = rt.createSession({ id: 's1', goal: 'watch builds' });
  assert.equal(s.id, 's1');
  assert.equal(s.goal, 'watch builds');
  assert.equal(s.status, 'idle');
  assert.equal(rt.getSession('s1'), s);
  assert.equal(rt.getSession('missing'), null);
});

test('runtime drains one queued job per tick through the executor', async () => {
  const seen = [];
  const rt = new AlwaysOnRuntime({ executor: async (job) => { seen.push(job.id); return 'ok:' + job.id; } });
  const s = rt.createSession({ id: 's1' });
  const j1 = rt.enqueue('s1', { goal: 'first' });
  const j2 = rt.enqueue('s1', { goal: 'second' });
  assert.equal(s.status, 'queued');
  assert.equal(j1.status, 'queued');
  assert.equal(j2.status, 'queued');
  assert.equal(await rt.tick(), true);
  assert.equal(seen.length, 1);
  assert.equal(j1.status, 'done');
  assert.equal(j1.result, 'ok:' + j1.id);
  assert.equal(s.status, 'queued');
  assert.equal(await rt.tick(), true);
  assert.equal(seen.length, 2);
  assert.equal(j2.status, 'done');
  assert.equal(s.status, 'idle');
  assert.equal(await rt.tick(), false);
});

test('runtime passes session goal into executor jobs', async () => {
  let got = null;
  const rt = new AlwaysOnRuntime({ executor: async (job) => { got = job; return 'done'; } });
  rt.createSession({ id: 's1', goal: 'monitor things' });
  rt.enqueue('s1', { goal: 'check now' });
  await rt.tick();
  assert.equal(got.session, 's1');
  assert.equal(got.goal, 'check now');
});

test('runtime marks a failed job and keeps the session usable', async () => {
  const events = [];
  const rt = new AlwaysOnRuntime({ executor: async () => { throw new Error('boom'); } });
  rt.on('jobError', (e) => events.push(e));
  const s = rt.createSession({ id: 's1' });
  const j = rt.enqueue('s1', { goal: 'bad job' });
  await rt.tick();
  assert.equal(j.status, 'failed');
  assert.equal(j.error, 'boom');
  assert.equal(s.status, 'idle');
  assert.equal(events.length, 1);
  assert.equal(await rt.tick(), false);
});

test('runtime enqueue on unknown session returns null', () => {
  const rt = createRuntime();
  assert.equal(rt.enqueue('nope', { goal: 'x' }), null);
});

test('session policy normalizes sandbox settings', () => {
  const p = createSessionPolicy({ cleanRoom: true, allowedTools: ['read'], deniedTools: ['run_python'], maxJobs: 3 });
  assert.equal(p.cleanRoom, true);
  assert.deepEqual(p.allowedTools, ['read']);
  assert.deepEqual(p.deniedTools, ['run_python']);
  assert.equal(p.maxJobs, 3);
  assert.equal(createSessionPolicy({}).maxJobs > 0, true);
});

test('session policy blocks unsafe job URLs and job-limit overflow', () => {
  const blocked = checkJobAgainstPolicy({ maxJobs: 5, jobs: 0 }, { url: 'http://169.254.169.254/latest/meta-data' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked, true);
  const allowed = checkJobAgainstPolicy({ maxJobs: 5, jobs: 0 }, { url: 'https://api.github.com/repos/x/y' });
  assert.equal(allowed.ok, true);
  const full = checkJobAgainstPolicy({ maxJobs: 2, jobs: 2 }, { goal: 'x' });
  assert.equal(full.ok, false);
  assert.ok(String(full.reason).includes('job limit'));
});

test('runtime rejects jobs that violate session isolation', async () => {
  let executed = 0;
  const events = [];
  const rt = new AlwaysOnRuntime({ executor: async () => { executed++; return 'ok'; } });
  rt.on('jobBlocked', (e) => events.push(e));
  const s = rt.createSession({ id: 's1', maxJobs: 1 });
  const bad = rt.enqueue('s1', { goal: 'probe', url: 'http://127.0.0.1:9/admin' });
  assert.equal(bad.status, 'blocked');
  assert.equal(bad.blocked, true);
  assert.equal(s.queue.length, 0);
  assert.equal(events.length, 1);
  const first = rt.enqueue('s1', { goal: 'one' });
  const over = rt.enqueue('s1', { goal: 'two' });
  assert.equal(first.status, 'queued');
  assert.equal(over.status, 'blocked');
  assert.equal(await rt.tick(), true);
  assert.equal(executed, 1);
  assert.equal(await rt.tick(), false);
});

test('runtime start and stop manage the interval', () => {
  const rt = createRuntime({ intervalMs: 10 });
  rt.start();
  assert.ok(rt.timer);
  rt.start();
  assert.ok(rt.timer);
  rt.stop();
  assert.equal(rt.timer, null);
});
