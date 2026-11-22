// server/runtime/isolation.js
// F6-1b: per-session sandbox policy for the always-on runtime. Reuses the
// existing security primitives (project-root allow-list, URL guards) so a
// long-lived session cannot escape its scope.

const security = require('../core/security');
const config = require('../core/config');

const JOB_URL_KEYS = ['url', 'target', 'endpoint', 'href', 'link'];
const DEFAULT_MAX_JOBS = 100;

// Validate + normalize a session's scope. Throws on an invalid project root.
function createSessionPolicy(opts = {}) {
  const policy = {
    root: null,
    cleanRoom: !!opts.cleanRoom,
    allowedTools: Array.isArray(opts.allowedTools) ? opts.allowedTools.slice() : null,
    deniedTools: Array.isArray(opts.deniedTools) ? opts.deniedTools.slice() : null,
    maxJobs: (typeof opts.maxJobs === 'number' && opts.maxJobs > 0) ? Math.floor(opts.maxJobs) : DEFAULT_MAX_JOBS,
  };
  if (typeof opts.root === 'string' && opts.root.trim()) {
    policy.root = security.validateProjectRoot(opts.root, config.PROJECT_ROOT_ALLOWLIST);
  }
  return policy;
}

// Check a queued job against a session policy. Returns { ok, blocked, reason }.
function checkJobAgainstPolicy(policy, job = {}) {
  if (policy && typeof policy.maxJobs === 'number' && policy.jobs >= policy.maxJobs) {
    return { ok: false, blocked: true, reason: 'session job limit reached' };
  }
  for (const key of JOB_URL_KEYS) {
    const v = job[key];
    if (typeof v === 'string' && v.trim() && !security.isSafeUrl(v)) {
      return { ok: false, blocked: true, reason: 'unsafe job target blocked by sandbox: ' + key };
    }
  }
  return { ok: true, blocked: false };
}

module.exports = { createSessionPolicy, checkJobAgainstPolicy, JOB_URL_KEYS, DEFAULT_MAX_JOBS };
