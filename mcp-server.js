#!/usr/bin/env node
// Expose AegisAI (next) capabilities as Model Context Protocol tools over
// stdio. Intended for Claude Code / OpenCode / Codex / other MCP clients.
//
//   AEGISAI_PROJECT_ROOT=/path/to/allowed/root node mcp-server.js
//
// Stdio is reserved for the MCP protocol: never write to stdout here.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

// This process is itself an MCP server; never spawn configured MCP clients
// from here (that would recursively launch more copies of this server).
process.env.AEGISAI_MCP_SERVER = '1';

const config = require('./server/core/config');
const security = require('./server/core/security');
const integrations = require('./server/integrations/register');
const agent = require('./server/agent/run');
const task = require('./server/agent/task');
const swarm = require('./server/agent/swarm');
const { VERSION } = (() => {
  try { return { VERSION: require('./package.json').version }; } catch (e) { return { VERSION: 'unknown' }; }
})();

integrations.registerAll();

function resolveRoot() {
  const raw = process.env.AEGISAI_PROJECT_ROOT;
  if (!raw) return null;
  try { return security.validateProjectRoot(raw, config.PROJECT_ROOT_ALLOWLIST); }
  catch (e) { return null; }
}

function requireRoot() {
  const root = resolveRoot();
  if (!root) {
    throw new Error('AEGISAI_PROJECT_ROOT is not set or is outside AEGISAI_PROJECT_ROOT_ALLOWLIST');
  }
  return root;
}

function baseOpts(overrides = {}) {
  return {
    projectRoot: resolveRoot(),
    includeCoding: true,
    includeRe: false,
    cleanRoom: false,
    toolBudget: config.TOOL_BUDGET,
    onEvent: () => {},
    externalTools: { ghidra: [], craft: [], are: [], rea: [], hunt: [] },
    ...overrides,
  };
}

function textResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(err) {
  return {
    content: [{ type: 'text', text: 'AegisAI error: ' + String((err && err.message) || err) }],
    isError: true,
  };
}

function summarize(result) {
  return {
    final: (result && result.final && result.final.final) || '',
    type: (result && result.final && result.final.type) || 'done',
    toolCalls: (result && result.toolLog && result.toolLog.length) || 0,
    waves: (result && result.waves && result.waves.map((w) => w.phase)) || [],
  };
}

async function main() {
  const server = new McpServer({ name: 'aegisai-next', version: VERSION });

  server.registerTool('aegisai_health', {
    description: 'Report AegisAI (next) version and whether a project root is configured.',
  }, async () => textResult({
    ok: true,
    version: VERSION,
    projectRootConfigured: !!resolveRoot(),
    projectRoot: resolveRoot(),
  }));

  server.registerTool('aegisai_agent', {
    description: 'Run one AegisAI agent turn with the configured local model and coding tools.',
    inputSchema: {
      prompt: z.string().min(1),
      model: z.string().optional(),
      cleanRoom: z.boolean().optional(),
      includeRe: z.boolean().optional(),
    },
  }, async ({ prompt, model, cleanRoom, includeRe }) => {
    try {
      const result = await agent.runAgent(baseOpts({
        projectRoot: requireRoot(),
        messages: [{ role: 'user', content: prompt }],
        model,
        cleanRoom: !!cleanRoom,
        includeRe: !!includeRe,
      }));
      return textResult(summarize(result));
    } catch (e) { return errorResult(e); }
  });

  server.registerTool('aegisai_hunt', {
    description: 'Run the multi-phase autonomous bug-hunting pipeline against an authorized target.',
    inputSchema: {
      target: z.string().min(1),
      scope: z.string().optional(),
      model: z.string().optional(),
      maxWaves: z.number().int().min(1).max(10).optional(),
    },
  }, async ({ target, scope, model, maxWaves }) => {
    try {
      const result = await agent.runHunt(baseOpts({
        projectRoot: requireRoot(),
        model,
        target,
        scope: scope || 'authorized scope only',
        maxWaves: maxWaves || 3,
      }));
      return textResult(summarize(result));
    } catch (e) { return errorResult(e); }
  });

  server.registerTool('aegisai_task', {
    description: 'Run a long-horizon task through plan -> execute -> verify -> deliver waves.',
    inputSchema: {
      goal: z.string().min(1),
      model: z.string().optional(),
      maxWaves: z.number().int().min(1).max(10).optional(),
    },
  }, async ({ goal, model, maxWaves }) => {
    try {
      const result = await task.runTask(baseOpts({
        projectRoot: requireRoot(),
        model,
        goal,
        maxWaves: maxWaves || 4,
      }));
      return textResult(summarize(result));
    } catch (e) { return errorResult(e); }
  });

  server.registerTool('aegisai_swarm', {
    description: 'Fan a goal out across subtasks and aggregate the results.',
    inputSchema: {
      goal: z.string().min(1),
      subtasks: z.array(z.any()).min(1),
      model: z.string().optional(),
      maxConcurrent: z.number().int().min(1).max(8).optional(),
    },
  }, async ({ goal, subtasks, model, maxConcurrent }) => {
    try {
      const result = await swarm.runSwarm(baseOpts({
        projectRoot: requireRoot(),
        model,
        goal,
        subtasks,
        maxConcurrent: maxConcurrent || 1,
      }));
      return textResult(summarize(result));
    } catch (e) { return errorResult(e); }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  // stderr is safe on stdio transports.
  console.error('AegisAI MCP server failed to start:', (e && e.message) || e);
  process.exitCode = 1;
});
