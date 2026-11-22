// server/eval/skill-eval.js
// F10-4: quality gates, security scanning and harness-compatibility checks for
// agent skills and MCP tool descriptors. Independent implementation inspired
// by multi-tier skill evaluators; no external evaluator code is used.

const db = require('../storage/db');
const mcp = require('../integrations/mcp');

const SECURITY_PATTERNS = [
  { id: 'shell-exec', severity: 'critical', re: /\b(?:os\.system|subprocess\.(?:call|run|Popen|check_output)|child_process\.exec|\bexec\s*\(|\beval\s*\()/i },
  { id: 'dynamic-code', severity: 'high', re: /\b(?:new\s+Function\s*\(|\bFunction\s*\()/ },
  { id: 'network', severity: 'high', re: /\b(?:fetch\s*\(|requests\.(?:get|post)|urllib\.|http\.request\b|XMLHttpRequest)/i },
  { id: 'credential-access', severity: 'medium', re: /\b(?:process\.env|os\.environ|os\.getenv|getenv\s*\()/i },
  { id: 'filesystem-write', severity: 'high', re: /\b(?:fs\.writeFile|writeFileSync|shutil\.rmtree|rm\s+-rf|open\s*\([^)]*['"]w)/i },
  { id: 'obfuscation', severity: 'medium', re: /\b(?:atob\s*\(|Buffer\.from\([^)]*['"]base64|fromCharCode)/i },
];
const ALLOWED_IMPORTS = new Set(['os', 'sys', 'json', 're', 'math', 'pathlib', 'typing', 'datetime', 'textwrap']);
const SEVERITY_WEIGHT = { critical: 0.5, high: 0.3, medium: 0.15, low: 0.05 };

function clamp(n) { return Math.max(0, Math.min(1, n)); }

function scoreTier(issues) {
  const penalty = issues.reduce((sum, i) => sum + (SEVERITY_WEIGHT[i.severity] || 0.1), 0);
  return clamp(1 - penalty);
}

function scanSecurity(code) {
  const text = String(code || '');
  const issues = [];
  for (const p of SECURITY_PATTERNS) {
    if (p.re.test(text)) issues.push({ tier: 'security', severity: p.severity, id: p.id, message: 'potential ' + p.id });
  }
  return issues;
}

function checkQuality(skill) {
  const issues = [];
  const name = String(skill.name || '');
  const description = String(skill.description || '');
  const code = String(skill.code || '');
  if (!/^[a-z0-9][a-z0-9_-]{1,60}$/.test(name)) issues.push({ tier: 'quality', severity: 'medium', id: 'name-format', message: 'skill name should be lowercase kebab/snake case' });
  if (description.trim().length < 20) issues.push({ tier: 'quality', severity: 'medium', id: 'short-description', message: 'description shorter than 20 characters' });
  if (description.length > 500) issues.push({ tier: 'quality', severity: 'low', id: 'long-description', message: 'description longer than 500 characters' });
  if (code.trim().length < 10) issues.push({ tier: 'quality', severity: 'medium', id: 'empty-code', message: 'code is empty or trivial' });
  if (/\b(?:TODO|FIXME|XXX|placeholder)\b/i.test(code)) issues.push({ tier: 'quality', severity: 'low', id: 'placeholder', message: 'code contains placeholder markers' });
  return issues;
}

function checkCompatibility(skill) {
  const issues = [];
  const code = String(skill.code || '');
  const imports = [...code.matchAll(/^\s*(?:import|from)\s+([A-Za-z0-9_.]+)/gm)].map((m) => m[1].split('.')[0]);
  for (const mod of new Set(imports)) {
    if (!ALLOWED_IMPORTS.has(mod)) issues.push({ tier: 'compatibility', severity: 'medium', id: 'unknown-import', message: 'import not in the skill runtime allow-list: ' + mod });
  }
  const opens = (code.match(/[\(\[\{]/g) || []).length;
  const closes = (code.match(/[\)\]\}]/g) || []).length;
  if (opens !== closes) issues.push({ tier: 'compatibility', severity: 'high', id: 'unbalanced-delimiters', message: 'unbalanced brackets/parentheses' });
  return issues;
}

function evaluateSkill(skill, opts = {}) {
  const thresholds = {
    pass: (opts.pass === undefined) ? 0.85 : opts.pass,
    warn: (opts.warn === undefined) ? 0.6 : opts.warn,
  };
  const issues = [
    ...checkQuality(skill),
    ...scanSecurity(skill.code),
    ...checkCompatibility(skill),
  ];
  const byTier = (tier) => issues.filter((i) => i.tier === tier);
  const scores = {
    quality: scoreTier(byTier('quality')),
    security: scoreTier(byTier('security')),
    compatibility: scoreTier(byTier('compatibility')),
  };
  const overall = (scores.quality + scores.security + scores.compatibility) / 3;
  const critical = issues.some((i) => i.severity === 'critical');
  const decision = (critical || overall < thresholds.warn) ? 'fail' : (overall < thresholds.pass ? 'warn' : 'pass');
  return { name: skill.name, scores, score: clamp(overall), decision, issues };
}

function evaluateTool(tool, opts = {}) {
  const issues = [];
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(tool.name || ''))) issues.push({ tier: 'quality', severity: 'medium', id: 'tool-name', message: 'invalid MCP tool name' });
  if (!tool.description || String(tool.description).trim().length < 8) issues.push({ tier: 'quality', severity: 'low', id: 'tool-description', message: 'tool description missing or short' });
  if (!tool.inputSchema || typeof tool.inputSchema !== 'object') issues.push({ tier: 'compatibility', severity: 'critical', id: 'tool-schema', message: 'tool inputSchema missing' });
  const scores = {
    quality: scoreTier(issues.filter((i) => i.tier === 'quality')),
    security: 1,
    compatibility: scoreTier(issues.filter((i) => i.tier === 'compatibility')),
  };
  const overall = (scores.quality + scores.security + scores.compatibility) / 3;
  return {
    name: 'mcp:' + tool.name,
    scores,
    score: clamp(overall),
    decision: (issues.some((i) => i.severity === 'critical') || overall < 0.6) ? 'fail' : (overall < 0.85 ? 'warn' : 'pass'),
    issues,
  };
}

function evaluateAll(opts = {}) {
  const skills = db.listSkills().map((s) => evaluateSkill(s, opts));
  const tools = (opts.includeTools === false ? [] : mcp.integration.tools()).map((t) => evaluateTool(t, opts));
  const evaluated = [...skills, ...tools];
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const e of evaluated) counts[e.decision]++;
  return { evaluated, counts, total: evaluated.length, thresholds: { pass: opts.pass === undefined ? 0.85 : opts.pass, warn: opts.warn === undefined ? 0.6 : opts.warn } };
}

module.exports = { evaluateSkill, evaluateTool, evaluateAll, scanSecurity, checkQuality, checkCompatibility, SECURITY_PATTERNS };
