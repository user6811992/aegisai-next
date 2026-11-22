// server/runtime/consolidation-scheduler.js
// Scheduled "sleep pass" for memory consolidation: wires F10-2 consolidation
// into the F8-3 timer scheduler so near-duplicate memories are merged on a
// configurable interval without blocking the event loop.

const { createTimerScheduler } = require('./timers');
const db = require('../storage/db');

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLD = 0.55;

function createConsolidationScheduler(opts = {}) {
  const consolidate = typeof opts.consolidate === 'function' ? opts.consolidate : null;
  const scheduler = opts.scheduler || createTimerScheduler();
  let timer = null;
  let intervalMs = DEFAULT_INTERVAL_MS;
  let threshold = DEFAULT_THRESHOLD;
  let runs = 0;
  let lastReport = null;
  let lastError = null;

  async function runNow() {
    try {
      const run = consolidate || (() => require('../storage/markdown-memory').consolidate({ threshold }));
      lastReport = await run({ threshold });
      lastError = null;
      runs++;
      try { db.logAudit('memory.consolidation.scheduled', { mergedGroups: lastReport.mergedGroups || 0, after: lastReport.after || 0 }); } catch (e) { /* audit is best effort */ }
      return lastReport;
    } catch (e) {
      lastError = String((e && e.message) || e);
      return { ok: false, error: lastError };
    }
  }

  // The timer scheduler only fires enqueue callbacks; route them into runNow.
  scheduler.setEnqueue(() => runNow());

  function start(options = {}) {
    const requested = (typeof options.everyMs === 'number' && options.everyMs > 0) ? options.everyMs : intervalMs;
    if (requested !== intervalMs || timer) stop();
    intervalMs = requested;
    if (typeof options.threshold === 'number' && options.threshold > 0 && options.threshold < 1) threshold = options.threshold;
    timer = scheduler.schedule('memory', { goal: 'consolidate-memories' }, { everyMs: intervalMs, id: 'memory-consolidation' });
    return status();
  }

  function stop() {
    if (timer) {
      scheduler.cancel(timer.id);
      timer = null;
    }
    return status();
  }

  function status() {
    return {
      running: !!timer && timer.active,
      everyMs: intervalMs,
      threshold,
      runs,
      lastRun: lastReport,
      lastError,
    };
  }

  return { start, stop, status, runNow };
}

module.exports = { createConsolidationScheduler, DEFAULT_INTERVAL_MS, DEFAULT_THRESHOLD };
