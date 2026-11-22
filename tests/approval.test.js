// tests/approval.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApprovalGate, requiresApproval } = require('../server/runtime/approval');
const { createRuntime } = require('../server/runtime/always-on');

const settle = () => new Promise((r) => setImmediate(r));

test('approval heuristics detect risky jobs', () => {
  assert.equal(requiresApproval({ goal: 'x' }, {}), false);
  assert.equal(requiresApproval({ requiresApproval: true }, {}), true);
  assert.equal(requiresApproval({ tool: 'run_process' }, {}), true);
  assert.equal(requiresApproval({ tools: [{ name: 'delete_file' }] }, {}), true);
  assert.equal(requiresApproval({ goal: 'x' }, { requireApproval: true }), true);
});

test('gate resolves approved, rejected and timed-out decisions', async () => {
  const gate = createApprovalGate({ pollMs: 5, timeoutMs: 100 });
  const p1 = gate.authorize({ id: 'j1', goal: 'a' }, { id: 's1' });
  await settle();
  gate.actions[0].status = 'approved';
  assert.equal(await p1, true);

  const p2 = gate.authorize({ id: 'j2', goal: 'b' }, { id: 's1' });
  await settle();
  gate.actions[1].status = 'rejected';
  assert.equal(await p2, false);

  const p3 = gate.authorize({ id: 'j3', goal: 'c' }, { id: 's1' });
  assert.equal(await p3, false);
});

test('runtime gates high-risk jobs and resumes after approval', async () => {
  let executed = 0;
  let action = null;
  const events = [];
  const gate = createApprovalGate({ pollMs: 5, timeoutMs: 500, onRequest: (a) => { action = a; } });
  const rt = createRuntime({ approvalGate: gate, executor: async () => { executed++; return 'ok'; } });
  rt.on('approvalRequired', () => events.push('approvalRequired'));
  rt.on('approved', () => events.push('approved'));
  rt.createSession({ id: 's1' });
  const job = rt.enqueue('s1', { id: 'risky', goal: 'delete stuff requiresApproval', requiresApproval: true });
  const p = rt.tick();
  await settle();
  assert.ok(action);
  assert.equal(action.jobId, 'risky');
  assert.equal(executed, 0);
  action.status = 'approved';
  assert.equal(await p, true);
  assert.equal(job.status, 'done');
  assert.equal(executed, 1);
  assert.deepEqual(events, ['approvalRequired', 'approved']);
});

test('runtime rejects a gated job without executing it', async () => {
  let executed = 0;
  let action = null;
  const gate = createApprovalGate({ pollMs: 5, timeoutMs: 500, onRequest: (a) => { action = a; } });
  const rt = createRuntime({ approvalGate: gate, executor: async () => { executed++; return 'ok'; } });
  rt.createSession({ id: 's1' });
  const job = rt.enqueue('s1', { id: 'risky-2', goal: 'needs approval', requiresApproval: true });
  const p = rt.tick();
  await settle();
  action.status = 'rejected';
  await p;
  assert.equal(job.status, 'rejected');
  assert.equal(executed, 0);
  assert.equal(rt.getSession('s1').status, 'idle');
});
