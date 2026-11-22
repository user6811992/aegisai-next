// server/eval/speedbench.js
// F7: local agent speed benchmark (speedbench-style). Runs each task N times
// through an injected runner, records wall-clock duration, and reports median
// latency and success rate. A clock can be injected for deterministic tests.

function median(values) {
  const xs = (Array.isArray(values) ? values : [])
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

async function runBenchmark(opts = {}) {
  const tasks = Array.isArray(opts.tasks) ? opts.tasks : [];
  const runs = (typeof opts.runs === 'number' && opts.runs > 0) ? Math.floor(opts.runs) : 5;
  const runner = typeof opts.runner === 'function' ? opts.runner : null;
  if (!runner) throw new Error('benchmark requires a runner function');
  const clock = typeof opts.clock === 'function' ? opts.clock : Date.now;

  const records = [];
  for (const task of tasks) {
    const taskId = (task && (task.id || task.name)) || '';
    for (let i = 1; i <= runs; i++) {
      const t0 = clock();
      let ok = false;
      let result = null;
      let error = null;
      try {
        result = await runner(task, { run: i, taskId });
        ok = !(result && result.ok === false);
      } catch (err) {
        error = String((err && err.message) || err);
        ok = false;
      }
      const t1 = clock();
      records.push({ taskId, run: i, ms: t1 - t0, ok, result, error });
    }
  }

  const grouped = new Map();
  for (const r of records) {
    if (!grouped.has(r.taskId)) grouped.set(r.taskId, []);
    grouped.get(r.taskId).push(r);
  }
  const taskStats = Array.from(grouped.entries()).map(([taskId, rs]) => ({
    taskId,
    runs: rs.length,
    medianMs: median(rs.map((r) => r.ms)),
    successRate: rs.length ? rs.filter((r) => r.ok).length / rs.length : 0,
  }));
  const successes = records.filter((r) => r.ok).length;
  return {
    records,
    tasks: taskStats,
    summary: {
      totalRuns: records.length,
      medianMs: median(records.map((r) => r.ms)),
      successRate: records.length ? successes / records.length : 0,
    },
  };
}

// Wrap a local agent function as a benchmark runner. `agentFn` defaults to
// opts.agent.runAgent (e.g. the server's exported agent module).
function createLocalAgentRunner(opts = {}) {
  const agentFn = typeof opts.agentFn === 'function'
    ? opts.agentFn
    : (opts.agent && typeof opts.agent.runAgent === 'function' ? opts.agent.runAgent : null);
  if (!agentFn) throw new Error('local agent runner requires agentFn or agent.runAgent');
  const base = opts.baseOpts || {};
  return async function localAgentRunner(task, meta) {
    const prompt = (typeof task === 'string') ? task : ((task && (task.prompt || task.goal)) || '');
    const messages = [{ role: 'user', content: prompt }];
    try {
      const r = await agentFn({
        ...base,
        messages,
        model: (task && task.model) || opts.model || base.model,
      });
      const done = !!(r && r.final && r.final.type === 'done');
      return {
        ok: done,
        content: (r && r.final && r.final.final) || '',
        toolCalls: (r && Array.isArray(r.toolLog)) ? r.toolLog.length : 0,
        run: meta && meta.run,
      };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  };
}

function exportReport(report, opts = {}) {
  const format = (typeof opts === 'string') ? opts : (opts.format || 'markdown');
  if (format === 'json') return JSON.stringify(report, null, 2);
  const s = (report && report.summary) || {};
  const lines = [
    '# Agent speed benchmark',
    '',
    '- Total runs: ' + (s.totalRuns || 0),
    '- Median duration: ' + (s.medianMs === null || s.medianMs === undefined ? 'n/a' : s.medianMs + ' ms'),
    '- Success rate: ' + (s.successRate === undefined ? 0 : Math.round(s.successRate * 100)) + '%',
    '',
    '## Per-task results',
    '',
    '| Task | Runs | Median ms | Success rate |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const t of ((report && report.tasks) || [])) {
    lines.push('| ' + t.taskId + ' | ' + t.runs + ' | ' + (t.medianMs === null ? 'n/a' : t.medianMs) + ' | ' + Math.round((t.successRate || 0) * 100) + '% |');
  }
  lines.push('', '## Runs', '');
  for (const r of ((report && report.records) || [])) {
    lines.push('- ' + r.taskId + ' run ' + r.run + ': ' + r.ms + ' ms — ' + (r.ok ? 'ok' : 'FAILED' + (r.error ? ' (' + r.error + ')' : '')));
  }
  return lines.join('\n') + '\n';
}

module.exports = { runBenchmark, median, createLocalAgentRunner, exportReport };
