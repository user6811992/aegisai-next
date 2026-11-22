// server/eval/always-on-eval.js
// F8-4: HALO-style evaluation for always-on agents. Checks that Sensing,
// Memory and Action are connected across scenarios and measures the gain from
// learning outcomess via an ablation (with vs without the learn hook).

function hasOutput(v) {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

function rate(items, key) {
  if (!items.length) return 0;
  return items.filter((x) => x[key]).length / items.length;
}

async function evaluateAlwaysOn(opts = {}) {
  const scenarios = Array.isArray(opts.scenarios) ? opts.scenarios : [];
  const sense = typeof opts.sense === 'function' ? opts.sense : async (x) => x;
  const remember = typeof opts.remember === 'function' ? opts.remember : async (x) => x;
  const act = typeof opts.act === 'function' ? opts.act : async (x) => x;
  const learn = typeof opts.learn === 'function' ? opts.learn : null;
  const judge = typeof opts.judge === 'function'
    ? opts.judge
    : async (outcome) => ({ success: outcome === true || (outcome && outcome.success === true) });
  const makeState = typeof opts.makeState === 'function' ? opts.makeState : () => ({});
  const rounds = (typeof opts.rounds === 'number' && opts.rounds > 0) ? Math.floor(opts.rounds) : 1;

  async function runPass(withLearning) {
    const state = makeState();
    const records = [];
    for (const scenario of scenarios) {
      for (let round = 1; round <= rounds; round++) {
        const ctx = { scenario, round, state };
        const sensed = await sense(scenario.input, ctx);
        const remembered = await remember(sensed, ctx);
        const acted = await act(remembered, ctx);
        const verdict = (await judge(acted, ctx)) || {};
        const success = verdict.success === true;
        records.push({
          scenarioId: scenario.id || '',
          round,
          sensing: hasOutput(sensed),
          memory: hasOutput(remembered),
          action: hasOutput(acted),
          success,
        });
        // HALO-style: learn from every outcome, not just successful ones.
        if (withLearning && learn) await learn({ acted, verdict, success }, ctx);
      }
    }
    return {
      records,
      sensingRate: rate(records, 'sensing'),
      memoryRate: rate(records, 'memory'),
      actionRate: rate(records, 'action'),
      sensingToMemory: rate(records.map((r) => ({ v: r.sensing && r.memory })), 'v'),
      memoryToAction: rate(records.map((r) => ({ v: r.memory && r.action })), 'v'),
      successRate: rate(records, 'success'),
    };
  }

  const learned = await runPass(true);
  const ablated = opts.ablation === false ? null : await runPass(false);
  return {
    learned,
    ablated,
    summary: {
      sensingRate: learned.sensingRate,
      memoryRate: learned.memoryRate,
      actionRate: learned.actionRate,
      connectivity: (learned.sensingToMemory + learned.memoryToAction) / 2,
      successRate: learned.successRate,
      learningGain: ablated ? learned.successRate - ablated.successRate : null,
    },
  };
}

module.exports = { evaluateAlwaysOn, hasOutput };
