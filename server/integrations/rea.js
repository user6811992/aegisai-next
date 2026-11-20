// server/integrations/rea.js
// REA (reverse engineering agent) integration via MCP (stdio).

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let client = null;
let tools = [];
let ready = false;
let error = null;

function resolveReaBin() {
  if (process.env.REA_BIN && fs.existsSync(process.env.REA_BIN)) return process.env.REA_BIN;
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'rea.cmd'),
    path.join(process.env.APPDATA || '', 'npm', 'rea'),
    'C:\\Program Files\\rea\\rea.exe',
  ];
  for (const c of candidates) { if (c && fs.existsSync(c)) return c; }
  try {
    const { execSync } = require('child_process');
    const out = execSync('where rea', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = (out || '').trim().split(/\r?\n/)[0];
    if (first && fs.existsSync(first)) return first;
  } catch (e) {}
  return 'rea';
}

async function init() {
  try {
    let Client, StdioClientTransport;
    try {
      const sdk = require('@modelcontextprotocol/sdk/client');
      Client = sdk.Client;
      const stdio = require('@modelcontextprotocol/sdk/client/stdio.js');
      StdioClientTransport = stdio.StdioClientTransport;
    } catch (e) {
      const sdk = require('@modelcontextprotocol/sdk');
      Client = sdk.Client;
      StdioClientTransport = sdk.StdioClientTransport;
    }
    const reaBin = resolveReaBin();
    const transport = new StdioClientTransport({
      command: reaBin,
      args: ['--mcp'],
      env: Object.assign({}, process.env, { PATH: (process.env.PATH || '') + path.delimiter + path.dirname(reaBin) }),
      stderr: 'pipe',
    });
    client = new Client({ name: 'aegisai-next', version: '0.3.0' }, { capabilities: {} });
    await client.connect(transport);
    const res = await client.listTools();
    tools = res.tools || [];
    ready = true;
    error = null;
  } catch (e) {
    error = e && e.message ? e.message : String(e);
    ready = false;
    client = null;
    tools = [];
  }
}

async function callTool(name, args) {
  if (!ready || !client) throw new Error('REA not ready: ' + (error || 'unknown'));
  const res = await client.callTool({ name, arguments: args || {} });
  return res;
}

const integration = {
  name: 'rea',
  isAvailable: () => ready,
  tools: () => tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  status: () => ({ ready, error, toolCount: tools.length }),
  init,
  callTool,
};

module.exports = { integration, init, callTool, resolveReaBin };
