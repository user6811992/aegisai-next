// server/integrations/patch.js — agent-facing wrapper for dependency patches.
const { proposePatch } = require('../agent/patch');
const config = require('../core/config');

async function callTool(name, args) {
  if (name !== 'propose') throw new Error('unknown patch tool: ' + name);
  const a = args || {};
  const root = a.projectRoot || process.env.AEGISAI_PROJECT_ROOT || config.DATA_DIR;
  return proposePatch({
    projectRoot: root,
    dependency: a.dependency,
    fixedVersion: a.fixedVersion,
    kind: a.kind,
    dryRun: a.dryRun !== false,
  });
}

const integration = {
  name: 'patch',
  isAvailable: () => true,
  tools: () => [{
    name: 'propose',
    description: 'Propose a dependency-only patch for a vulnerability finding. Defaults to dry-run; set dryRun:false to write package.json.',
    inputSchema: {
      type: 'object',
      properties: {
        dependency: { type: 'string' },
        fixedVersion: { type: 'string' },
        kind: { type: 'string', enum: ['dependencies', 'dev'] },
        dryRun: { type: 'boolean' },
      },
      required: ['dependency', 'fixedVersion'],
    },
  }],
  status: () => ({ ready: true, error: null, toolCount: 1 }),
  callTool,
};

module.exports = { integration, callTool };
