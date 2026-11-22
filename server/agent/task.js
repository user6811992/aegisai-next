// server/agent/task.js
// Long-horizon task orchestration: goal -> plan -> execute -> verify -> deliver,
// driven through the same agent-wave loop used by the bug-hunting flow.

const security = require('../core/security');
const { runHunt } = require('./run');

const TASK_PHASES = ['plan', 'execute', 'verify', 'deliver'];
const TASK_STEP_URL_KEYS = ['url', 'target', 'endpoint', 'href', 'link'];
const TASK_CTX_URL_KEYS = ['url', 'target', 'endpoint', 'href'];

function taskPhasePrompt(phase, ctx) {
  const goal = (ctx && ctx.goal) || 'the task';
  switch (phase) {
    case 'plan':
      return 'TASK_PHASE=plan. You are planning task: ' + goal + '. Produce a structured, ordered plan with explicit steps and acceptance criteria.';
    case 'execute':
      return 'TASK_PHASE=execute. You are executing task plan for: ' + goal + '. Work through each plan step using available tools; record partial results.';
    case 'verify':
      return 'TASK_PHASE=verify. You are verifying task: ' + goal + '. Run validation / checks and confirm the task objective is met before delivery.';
    case 'deliver':
      return 'TASK_PHASE=deliver. You are delivering task: ' + goal + '. Produce the final delivery report with outcome and evidence.';
    case 'decompose':
      return 'TASK_PHASE=decompose. You are decomposing task: ' + goal + ' into concrete subtasks. Output a numbered list of subtask goals, each independently actionable.';
    default:
      return 'TASK_PHASE=' + phase + '. Work on task: ' + goal + '.';
  }
}

function sandboxTaskContext(ctx) {
  const c = ctx || {};
  for (const k of TASK_CTX_URL_KEYS) {
    const v = c[k];
    if (typeof v === 'string' && v.trim() && !security.isSafeUrl(v)) {
      return { ok: false, blocked: true, reason: 'unsafe task context target blocked by sandbox: ' + k };
    }
  }
  return { ok: true, blocked: false };
}

function sandboxTaskStep(step) {
  const s = step || {};
  const name = String(s.name || '');
  const args = s.args || {};
  for (const k of TASK_STEP_URL_KEYS) {
    const v = args[k];
    if (typeof v === 'string' && v.trim() && !security.isSafeUrl(v)) {
      return { ok: false, blocked: true, tool: name, reason: 'unsafe url blocked by task sandbox: ' + k };
    }
  }
  return { ok: true, blocked: false, tool: name };
}

async function runTask(opts) {
  const maxWaves = (typeof opts.maxWaves === 'number' && opts.maxWaves > 0) ? opts.maxWaves : 4;
  const blockedCtx = sandboxTaskContext(opts.taskCtx || {});
  if (blockedCtx.blocked) {
    return { final: { type: 'done', final: 'sandbox blocked: ' + blockedCtx.reason }, toolLog: [], waves: [], blocked: true };
  }
  const taskOpts = { ...opts, phases: TASK_PHASES, phasePrompt: taskPhasePrompt, maxWaves, taskCtx: { ...(opts.taskCtx || {}), goal: opts.goal } };
  return runHunt(taskOpts);
}

module.exports = { runTask, TASK_PHASES, taskPhasePrompt, TASK_STEP_URL_KEYS, TASK_CTX_URL_KEYS, sandboxTaskContext, sandboxTaskStep };
