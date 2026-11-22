// server/integrations/cve.js — agent-facing wrapper for CVE reachability.
const { analyze } = require('../eval/cve-reachability');
const config = require('../core/config');
const security = require('../core/security');

async function callTool(name, args) {
  if (name !== 'scan') throw new Error('unknown CVE tool: ' + name);
  const a = args || {};
  const raw = a.projectRoot || process.env.AEGISAI_PROJECT_ROOT || config.DATA_DIR;
  let root;
  try { root = security.validateProjectRoot(raw, config.PROJECT_ROOT_ALLOWLIST); }
  catch (e) { root = raw; }
  return analyze({ projectRoot: root, seed: a.seed, apply: a.apply === true });
}

const integration = {
  name: 'cve',
  isAvailable: () => true,
  tools: () => [{
    name: 'scan',
    description: 'Check this project\'s package.json dependencies for reachable CVEs (OSV API) and propose dependency-only fixes.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string' },
        seed: { type: 'array', items: { type: 'object' } },
        apply: { type: 'boolean' },
      },
    },
  }],
  status: () => ({ ready: true, error: null, toolCount: 1 }),
  callTool,
};

module.exports = { integration, callTool };
