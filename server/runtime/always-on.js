// server/runtime/always-on.js
// Minimal always-on agent runtime core — persistent sessions with a durable
// job queue, per-session isolation, and pluggable delivery of lifecycle events.

const { EventEmitter } = require('events');
const { createSessionPolicy, checkJobAgainstPolicy } = require('./isolation');
const durable = require('./durable');
const { requiresApproval } = require('./approval');
const { createTimerScheduler } = require('./timers');

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

class AlwaysOnRuntime extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.sessions = new Map();
    this.executor = typeof opts.executor === 'function' ? opts.executor : (async (job) => job);
    this.intervalMs = (typeof opts.intervalMs === 'number' && opts.intervalMs > 0) ? opts.intervalMs : 1000;
    this.timer = null;
    this.delivery = opts.delivery || null;
    this.durable = !!opts.durable;
    this.approvalGate = opts.approvalGate || null;
    this.timerScheduler = opts.timerScheduler || createTimerScheduler({
      enqueue: (sessionId, job) => this.enqueue(sessionId, job),
    });
  }

  scheduleJob(sessionId, job, options) {
    return this.timerScheduler.schedule(sessionId, job, options);
  }

  cancelTimer(timerId) {
    return this.timerScheduler.cancel(timerId);
  }

  destroySession(sessionId) {
    this.timerScheduler.cancelSession(sessionId);
    if (this.durable) durable.deleteSession(sessionId);
    return this.sessions.delete(sessionId);
  }

  // Rehydrate persisted sessions/jobs into this runtime instance.
  restore() {
    return durable.restoreRuntime(this);
  }

  // Emit locally and forward to the delivery layer (if any). Delivery failures
  // are isolated by createDelivery, so they never break the runtime loop.
  emitEvent(type, payload = {}) {
    this.emit(type, payload);
    if (this.durable) durable.saveOutboxEvent({ type, ...payload });
    if (this.delivery && typeof this.delivery.send === 'function') {
      Promise.resolve(this.delivery.send({ type, ...payload })).catch(() => {});
    }
  }

  createSession(opts = {}) {
    const id = opts.id || makeId('ses');
    const session = {
      id,
      goal: opts.goal || '',
      status: 'idle',
      queue: [],
      jobs: [],
      createdAt: Date.now(),
      lastResult: null,
      policy: createSessionPolicy(opts),
    };
    this.sessions.set(id, session);
    if (this.durable) durable.saveSession(session);
    this.emitEvent('session', { session });
    return session;
  }

  getSession(id) {
    return this.sessions.get(id) || null;
  }

  enqueue(sessionId, job = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const item = {
      ...job,
      id: job.id || makeId('job'),
      status: 'queued',
      createdAt: Date.now(),
    };
    const policyCheck = checkJobAgainstPolicy({ ...session.policy, jobs: session.jobs.length }, item);
    if (!policyCheck.ok) {
      item.status = 'blocked';
      item.blocked = true;
      item.error = policyCheck.reason;
      this.emitEvent('jobBlocked', { session: session.id, job: item, reason: policyCheck.reason });
      return item;
    }
    session.queue.push(item);
    session.jobs.push(item);
    session.status = session.status === 'running' ? 'running' : 'queued';
    if (this.durable) { durable.saveJob(session.id, item); durable.saveSession(session); }
    this.emitEvent('enqueue', { session: session.id, job: item });
    return item;
  }

  // Drain at most one queued job across all sessions. Returns true if a job
  // was started, false if every session was idle or already running.
  async tick() {
    for (const session of this.sessions.values()) {
      if (session.status === 'running' || session.queue.length === 0) continue;
      const job = session.queue.shift();
      session.status = 'running';
      job.status = 'running';
      this.emitEvent('start', { session: session.id, job });
      if (this.approvalGate && requiresApproval(job, session.policy)) {
        job.status = 'awaiting_approval';
        if (this.durable) durable.saveJob(session.id, job);
        this.emitEvent('approvalRequired', { session: session.id, job });
        const approved = await this.approvalGate.authorize(job, session);
        if (!approved) {
          job.status = 'rejected';
          job.error = 'approval rejected or timed out';
          session.status = session.queue.length ? 'queued' : 'idle';
          this.emitEvent('rejected', { session: session.id, job });
          if (this.durable) { durable.saveJob(session.id, job); durable.saveSession(session); }
          return true;
        }
        this.emitEvent('approved', { session: session.id, job });
      }
      try {
        const result = await this.executor({ ...job, session: session.id, goal: job.goal || session.goal, policy: session.policy });
        job.status = 'done';
        job.result = result;
        session.lastResult = result;
        this.emitEvent('done', { session: session.id, job, result });
      } catch (err) {
        job.status = 'failed';
        job.error = String((err && err.message) || err);
        this.emitEvent('jobError', { session: session.id, job, error: job.error });
      } finally {
        session.status = session.queue.length ? 'queued' : 'idle';
      }
      if (this.durable) { durable.saveJob(session.id, job); durable.saveSession(session); }
      return true;
    }
    return false;
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.emitEvent('startRuntime');
    return this;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.emitEvent('stopRuntime');
    }
    return this;
  }
}

function createRuntime(opts) {
  return new AlwaysOnRuntime(opts);
}

module.exports = { AlwaysOnRuntime, createRuntime, makeId };
