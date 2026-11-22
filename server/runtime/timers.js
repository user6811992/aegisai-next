// server/runtime/timers.js
// F8-3: interval/one-shot triggers that enqueue jobs into an always-on
// session. Timers are unref'd so they never keep a Node process alive, and
// are cancelled on session teardown.

const DEFAULT_POLL_MS = 1000;

function createTimerScheduler(opts = {}) {
  const enqueue = typeof opts.enqueue === 'function' ? opts.enqueue : () => null;
  const timers = new Map();
  let seq = 0;

  function stop(timer) {
    if (timer.handle) {
      clearInterval(timer.handle);
      timer.handle = null;
    }
    timer.active = false;
  }

  function schedule(sessionId, job = {}, options = {}) {
    const everyMs = (typeof options.everyMs === 'number' && options.everyMs > 0) ? options.everyMs : DEFAULT_POLL_MS;
    const maxRuns = (typeof options.maxRuns === 'number' && options.maxRuns > 0) ? Math.floor(options.maxRuns) : null;
    const once = !!options.once;
    const timer = {
      id: options.id || ('tmr-' + Date.now().toString(36) + '-' + (++seq)),
      sessionId,
      job: { ...job },
      everyMs,
      maxRuns,
      once,
      runs: 0,
      active: true,
      inFlight: false,
      handle: null,
    };
    timers.set(timer.id, timer);
    timer.handle = setInterval(async () => {
      if (!timer.active || timer.inFlight) return;
      if (timer.maxRuns !== null && timer.runs >= timer.maxRuns) { stop(timer); return; }
      timer.inFlight = true;
      try {
        await enqueue(timer.sessionId, { ...timer.job, scheduledBy: timer.id });
        timer.runs++;
        if (once || (timer.maxRuns !== null && timer.runs >= timer.maxRuns)) stop(timer);
      } catch (e) {
        // A failed enqueue leaves the timer active for the next tick.
      } finally {
        timer.inFlight = false;
      }
    }, everyMs);
    if (typeof timer.handle.unref === 'function') timer.handle.unref();
    return timer;
  }

  function cancel(timerId) {
    const timer = timers.get(timerId);
    if (!timer) return false;
    stop(timer);
    return true;
  }

  function cancelSession(sessionId) {
    let n = 0;
    for (const timer of timers.values()) {
      if (timer.sessionId === sessionId && timer.active) { stop(timer); n++; }
    }
    return n;
  }

  function list(sessionId) {
    const all = Array.from(timers.values());
    return sessionId ? all.filter((t) => t.sessionId === sessionId) : all;
  }

  function clear() {
    for (const timer of timers.values()) stop(timer);
    timers.clear();
  }

  return { schedule, cancel, cancelSession, list, clear, timers };
}

module.exports = { createTimerScheduler, DEFAULT_POLL_MS };
