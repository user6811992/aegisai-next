// tests/always-on-eval.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAlwaysOn, hasOutput } = require('../server/eval/always-on-eval');

test('hasOutput treats empty collections and strings as no output', () => {
  assert.equal(hasOutput(null), false);
  assert.equal(hasOutput(''), false);
  assert.equal(hasOutput('   '), false);
  assert.equal(hasOutput([]), false);
  assert.equal(hasOutput([1]), true);
  assert.equal(hasOutput(0), true);
});

test('evaluation reports stage connectivity across scenarios', async () => {
  const report = await evaluateAlwaysOn({
    scenarios: [{ id: 'a', input: 'x' }, { id: 'b', input: 'y' }],
    sense: async (x) => 'obs:' + x,
    remember: async (x) => 'mem:' + x,
    act: async (x) => 'act:' + x,
    judge: async () => ({ success: true }),
  });
  assert.equal(report.learned.records.length, 2);
  assert.equal(report.summary.sensingRate, 1);
  assert.equal(report.summary.memoryRate, 1);
  assert.equal(report.summary.actionRate, 1);
  assert.equal(report.summary.connectivity, 1);
  assert.equal(report.summary.successRate, 1);
  assert.equal(report.summary.learningGain, 0);
});

test('ablation measures learning gain from outcome feedback', async () => {
  const report = await evaluateAlwaysOn({
    scenarios: [{ id: 'a', input: 'x' }, { id: 'b', input: 'y' }],
    rounds: 2,
    makeState: () => ({ learned: new Set() }),
    sense: async (x) => x,
    remember: async (x) => x,
    act: async (x, ctx) => ({ ok: ctx.state.learned.has(ctx.scenario.id) }),
    judge: async (outcome) => ({ success: outcome.ok === true }),
    learn: async (_feedback, ctx) => { ctx.state.learned.add(ctx.scenario.id); },
  });
  assert.ok(report.summary.learningGain > 0, 'expected improvement with learning');
  assert.equal(report.ablated.records.length, 4);
  assert.ok(report.learned.successRate > report.ablated.successRate);
});

test('evaluation handles empty scenarios and skippable ablation', async () => {
  const report = await evaluateAlwaysOn({ scenarios: [], ablation: false });
  assert.equal(report.summary.connectivity, 0);
  assert.equal(report.summary.learningGain, null);
  assert.equal(report.ablated, null);
});
