// tests/speedbench.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runBenchmark, median, createLocalAgentRunner, exportReport } = require('../server/eval/speedbench');

test('median handles odd, even, and empty inputs', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([5, 'x', null, 7]), 6);
});

test('benchmark runs each task N times and computes medians', async () => {
  let t = 0;
  const report = await runBenchmark({
    tasks: [{ id: 'bump-dep', prompt: 'bump a dependency' }],
    runs: 3,
    clock: () => (t += 10),
    runner: async () => ({ ok: true }),
  });
  assert.equal(report.records.length, 3);
  assert.equal(report.summary.totalRuns, 3);
  assert.equal(report.summary.medianMs, 10);
  assert.equal(report.summary.successRate, 1);
  assert.equal(report.tasks[0].taskId, 'bump-dep');
  assert.equal(report.tasks[0].runs, 3);
  assert.equal(report.tasks[0].medianMs, 10);
});

test('benchmark records failures and an injected runner error', async () => {
  let t = 0;
  const report = await runBenchmark({
    tasks: [{ id: 'ok' }, { id: 'bad' }],
    runs: 1,
    clock: () => (t += 5),
    runner: async (task) => {
      if (task.id === 'bad') throw new Error('runner exploded');
      return { ok: false };
    },
  });
  assert.equal(report.records.length, 2);
  assert.equal(report.summary.successRate, 0);
  const bad = report.records.find((r) => r.taskId === 'bad');
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'runner exploded');
});

test('local agent runner maps task prompts and agent results', async () => {
  const seen = [];
  const agent = { runAgent: async (opts) => { seen.push(opts); return { final: { type: 'done', final: 'done!' }, toolLog: [{ name: 'x' }] }; } };
  const runner = createLocalAgentRunner({ agent, baseOpts: { projectRoot: '/tmp/x' } });
  const out = await runner({ id: 't1', prompt: 'bump dep' }, { run: 1 });
  assert.equal(out.ok, true);
  assert.equal(out.content, 'done!');
  assert.equal(out.toolCalls, 1);
  assert.equal(seen[0].messages[0].content, 'bump dep');
  assert.equal(seen[0].projectRoot, '/tmp/x');
  const failing = createLocalAgentRunner({ agentFn: async () => { throw new Error('agent down'); } });
  const bad = await failing({ id: 't2', prompt: 'x' }, {});
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'agent down');
  assert.throws(() => createLocalAgentRunner({}), /requires/);
});

test('report export renders markdown and JSON', async () => {
  let t = 0;
  const report = await runBenchmark({
    tasks: [{ id: 'task-A' }],
    runs: 2,
    clock: () => (t += 7),
    runner: async () => ({ ok: true }),
  });
  const md = exportReport(report);
  assert.ok(md.includes('# Agent speed benchmark'));
  assert.ok(md.includes('task-A'));
  assert.ok(md.includes('Median duration: 7 ms'));
  assert.ok(md.includes('Success rate: 100%'));
  const json = exportReport(report, { format: 'json' });
  assert.equal(JSON.parse(json).summary.totalRuns, 2);
});

test('benchmark defaults to 5 runs and requires a runner', async () => {
  let t = 0;
  const report = await runBenchmark({
    tasks: [{ id: 'x' }],
    clock: () => (t += 1),
    runner: async () => ({ ok: true }),
  });
  assert.equal(report.records.length, 5);
  await assert.rejects(() => runBenchmark({ tasks: [] }), /runner/);
});
