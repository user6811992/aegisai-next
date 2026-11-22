// tests/durable.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/isolated-data');
require('../server.js'); // opens this worker's isolated SQLite database
const durable = require('../server/runtime/durable');
const { createRuntime } = require('../server/runtime/always-on');

const uid = () => 'dur-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

test('durable runtime persists sessions, jobs and outbox events', async () => {
  const id = uid();
  const rt = createRuntime({ durable: true, executor: async () => 'ok' });
  const s = rt.createSession({ id, goal: 'persist me' });
  rt.enqueue(id, { id: id + '-job', goal: 'do work' });
  await rt.tick();

  const sessions = durable.loadSessions().filter((x) => x.id === id);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].goal, 'persist me');
  assert.equal(sessions[0].status, 'idle');
  const jobs = durable.loadJobs(id);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'done');
  assert.equal(jobs[0].result, 'ok');
  const outbox = durable.listOutbox(id);
  assert.ok(outbox.some((e) => e.type === 'done'));
  assert.equal(s.lastResult, 'ok');
});

test('restore rehydrates sessions and requeues in-flight jobs', () => {
  const id = uid();
  const rt = createRuntime({ durable: true, executor: async () => 'x' });
  rt.createSession({ id, goal: 'resume me' });
  const job = rt.enqueue(id, { id: id + '-inflight', goal: 'interrupted' });
  job.status = 'running';
  durable.saveJob(id, job);

  const fresh = createRuntime();
  const restored = fresh.restore();
  assert.ok(restored >= 1);
  const s = fresh.getSession(id);
  assert.ok(s);
  assert.equal(s.goal, 'resume me');
  assert.equal(s.queue.length, 1);
  assert.equal(s.queue[0].id, id + '-inflight');
  assert.equal(s.queue[0].status, 'queued');
  assert.equal(s.status, 'queued');
});

test('durable helpers are safe when persistence is unused', () => {
  const rt = createRuntime({ durable: false, executor: async () => 'ok' });
  rt.createSession({ id: uid() });
  assert.equal(durable.enabled(), true);
});
