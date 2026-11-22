// server/runtime/approval.js
// F8-2: human-in-the-loop gate for high-risk always-on jobs. Actions are
// queued through the existing pendingActions flow (when supplied) and the
// decision is polled from that record, so the normal /api/pending-actions
// approve/reject endpoints work without changes.

const RISKY_TOOLS = ['run_process', 'shell', 'execute', 'delete_file', 'write_file', 'run_python'];
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_MS = 50;

function requiresApproval(job = {}, policy = {}) {
  if (job.requiresApproval === true || policy.requireApproval === true) return true;
  const tools = Array.isArray(job.tools) ? job.tools : (job.tool ? [job.tool] : []);
  return tools.some((t) => RISKY_TOOLS.includes(String(t && (t.name || t))));
}

function createApprovalGate(opts = {}) {
  const local = [];
  const queueAction = typeof opts.queueAction === 'function'
    ? opts.queueAction
    : (action) => {
        const a = { id: 'pa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), status: 'pending', created: new Date().toISOString(), ...action };
        local.push(a);
        return a;
      };
  const getAction = typeof opts.getAction === 'function'
    ? opts.getAction
    : (id) => local.find((a) => a.id === id) || null;
  const onRequest = typeof opts.onRequest === 'function' ? opts.onRequest : () => {};
  const timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const pollMs = (typeof opts.pollMs === 'number' && opts.pollMs > 0) ? opts.pollMs : DEFAULT_POLL_MS;

  async function authorize(job = {}, session = {}) {
    const action = queueAction({
      type: 'runtime_job_approval',
      session: session.id,
      jobId: job.id,
      goal: job.goal || '',
    });
    onRequest(action);
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const current = getAction(action.id) || action;
        if (current.status === 'approved' || current.status === 'rejected') {
          clearInterval(timer);
          resolve(current.status === 'approved');
        } else if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          action.status = 'rejected';
          resolve(false);
        }
      }, pollMs);
      if (typeof timer.unref === 'function') timer.unref();
    });
  }

  return { authorize, getAction, actions: local, RISKY_TOOLS };
}

module.exports = { createApprovalGate, requiresApproval, RISKY_TOOLS };
