// server/integrations/hunt.js
// Bug-hunting integration: hunt session start, disclosed-vulnerability pattern lookup, report rendering.

const { searchPatterns } = require('../storage/vuln-patterns');

const HUNT_TOOLS = [
  {
    name: 'start',
    description: 'Start an authorized bug-hunting run against a target.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Target scope (url or domain).' },
        scope: { type: 'string' },
        maxSteps: { type: 'number' },
      },
      required: ['target'],
    },
  },
  {
    name: 'vuln_search',
    description: 'Search the disclosed-vulnerability pattern library.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
    },
  },
  {
    name: 'report',
    description: 'Render a bug-hunting report from findings and persist it.',
    inputSchema: {
      type: 'object',
      properties: { findings: { type: 'array', items: { type: 'object' } }, title: { type: 'string' }, huntId: { type: 'string' } },
    },
  },
  { name: 'list', description: 'List persisted bug-hunting reports.', inputSchema: { type: 'object', properties: {} } },
];

const hunts = new Map();
const reports = [];
let huntSeq = 0;

function renderReport(findings, opts) {
  opts = opts || {};
  const title = (opts.title || (findings && findings[0] && findings[0].title) || 'Bug Hunt Report');
  const lines = ['# ' + title, '', '## Findings'];
  if (!Array.isArray(findings) || findings.length === 0) {
    lines.push('', '_No findings recorded._', '');
    return lines.join('\n');
  }
  findings.forEach((f, i) => {
    lines.push('', '### ' + (i + 1) + '. ' + (f.title || 'Finding ' + (i + 1)), '');
    if (f.severity) lines.push('- Severity: ' + f.severity);
    if (f.cwe) lines.push('- CWE: ' + f.cwe);
    if (f.description) lines.push('- Description: ' + f.description);
    if (f.evidence) lines.push('- Evidence: ' + f.evidence);
    if (f.remediation) lines.push('- Remediation: ' + f.remediation);
  });
  lines.push('', '## Summary', '', (findings.length) + ' finding(s) recorded.');
  return lines.join('\n');
}

async function callTool(name, args) {
  args = args || {};
  if (name === 'start') {
    const target = String(args.target || '').trim();
    if (!target) return { ok: false, error: 'target required' };
    const id = 'hunt-' + (++huntSeq);
    hunts.set(id, { id, target, status: 'started', steps: [], findings: [], createdAt: Date.now() });
    return { ok: true, result: { huntId: id, target, status: 'started', note: 'hunt session registered; agent-wave orchestration lands in a follow-up milestone' } };
  }
  if (name === 'vuln_search') {
    const patterns = searchPatterns(String(args.query || ''), { limit: (args.limit === undefined || args.limit === null) ? 20 : args.limit });
    return { ok: true, result: { patterns } };
  }
  if (name === 'report') {
    const findings = Array.isArray(args.findings) ? args.findings : [];
    const title = args.title || (findings && findings[0] && findings[0].title) || 'Bug Hunt Report';
    const md = renderReport(findings, { title });
    const sessions = [...hunts.values()].sort((a, b) => b.createdAt - a.createdAt);
    const sid = args.huntId || (sessions.length > 0 ? sessions[0].id : null);
    if (sid) {
      const session = hunts.get(sid);
      if (session) { session.report = md; session.findings = findings; session.status = 'reported'; session.updatedAt = Date.now(); }
    }
    const rid = 'rpt-' + (++huntSeq);
    reports.push({ id: rid, huntId: sid, title, report: md, createdAt: Date.now() });
    return { ok: true, result: { reportId: rid, huntId: sid, report: md, status: 'reported' } };
  }
  if (name === 'list') {
    const out = reports.map((r) => ({ id: r.id, huntId: r.huntId, title: r.title, createdAt: r.createdAt }));
    return { ok: true, result: { reports: out } };
  }
  throw new Error('unknown hunt tool: ' + name);
}

const integration = {
  name: 'hunt',
  isAvailable: () => true,
  tools: () => HUNT_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  status: () => ({ ready: true, error: null, toolCount: HUNT_TOOLS.length }),
  callTool,
};

module.exports = { integration, callTool, HUNT_TOOLS, renderReport, hunts, reports };
