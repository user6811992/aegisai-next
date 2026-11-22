// server/runtime/durable.js
// F8-1: persist always-on runtime state in SQLite so restarts resume work.

const db = require('../storage/db');

function enabled() { return db.isOpen(); }

function safeParse(text, fallback) {
  if (text === null || text === undefined) return fallback;
  try { return JSON.parse(text); } catch (e) { return fallback; }
}

function saveSession(session) {
  if (!enabled()) return;
  db.run(
    `INSERT INTO runtime_sessions (id, goal, status, policy, created, last_result)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET goal=excluded.goal, status=excluded.status,
       policy=excluded.policy, last_result=excluded.last_result`,
    [
      session.id,
      session.goal || '',
      session.status || 'idle',
      JSON.stringify(session.policy || {}),
      session.createdAt || Date.now(),
      session.lastResult === null || session.lastResult === undefined ? null : JSON.stringify(session.lastResult),
    ],
  );
}

function deleteSession(sessionId) {
  if (!enabled()) return;
  db.run('DELETE FROM runtime_sessions WHERE id = ?', [sessionId]);
}

function saveJob(sessionId, job) {
  if (!enabled()) return;
  db.run(
    `INSERT INTO runtime_jobs (id, session_id, goal, status, payload, result, error, attempts, created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload=excluded.payload,
       result=excluded.result, error=excluded.error, attempts=excluded.attempts`,
    [
      job.id,
      sessionId,
      job.goal || '',
      job.status || 'queued',
      JSON.stringify(job),
      job.result === undefined ? null : JSON.stringify(job.result),
      job.error || null,
      job.attempts || 0,
      job.createdAt || Date.now(),
    ],
  );
}

function saveOutboxEvent(event) {
  if (!enabled()) return;
  // `session` may be an id string or the session object itself, depending on
  // which lifecycle event produced this record.
  const s = event.session;
  const sessionId = (s && typeof s === 'object') ? s.id : (s || event.sessionId || null);
  db.run(
    'INSERT INTO runtime_outbox (session_id, job_id, type, payload, created) VALUES (?, ?, ?, ?, ?)',
    [sessionId || null, (event.job && event.job.id) || event.jobId || null, event.type || 'event', JSON.stringify(event), Date.now()],
  );
}

function loadSessions() {
  if (!enabled()) return [];
  return db.all('SELECT id, goal, status, policy, created, last_result FROM runtime_sessions ORDER BY created').map((r) => ({
    id: r.id,
    goal: r.goal,
    status: r.status,
    policy: safeParse(r.policy, {}),
    createdAt: r.created,
    lastResult: safeParse(r.last_result, null),
    queue: [],
    jobs: [],
  }));
}

function loadJobs(sessionId) {
  if (!enabled()) return [];
  return db.all('SELECT payload FROM runtime_jobs WHERE session_id = ? ORDER BY created', [sessionId])
    .map((r) => safeParse(r.payload, null))
    .filter(Boolean);
}

function listOutbox(sessionId, limit = 50) {
  if (!enabled()) return [];
  return db.all('SELECT payload FROM runtime_outbox WHERE session_id = ? ORDER BY id DESC LIMIT ?', [sessionId, limit])
    .map((r) => safeParse(r.payload, null))
    .filter(Boolean);
}

// Rehydrate sessions and their queued/in-flight jobs into a runtime instance.
// Jobs that were 'running' at shutdown are re-queued so they resume.
function restoreRuntime(runtime) {
  const sessions = loadSessions();
  for (const session of sessions) {
    const jobs = loadJobs(session.id);
    session.jobs = jobs.slice();
    session.queue = jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => ({ ...j, status: 'queued' }));
    session.status = session.queue.length ? 'queued' : 'idle';
    runtime.sessions.set(session.id, session);
  }
  return sessions.length;
}

module.exports = { enabled, saveSession, deleteSession, saveJob, saveOutboxEvent, loadSessions, loadJobs, listOutbox, restoreRuntime };
