// tests/mcp-server.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

let client;
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'mcp-server.js')],
    env: {
      ...process.env,
      AEGISAI_PROJECT_ROOT: dir,
      AEGISAI_PROJECT_ROOT_ALLOWLIST: dir,
      AEGISAI_DATA_DIR: dir,
    },
    stderr: 'pipe',
  });
  client = new Client({ name: 'aegisai-test', version: '1' }, { capabilities: {} });
  await client.connect(transport);
});

after(async () => {
  if (client) await client.close();
  if (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
});

test('MCP server lists the AegisAI tool set', async () => {
  const res = await client.listTools();
  const names = res.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['aegisai_agent', 'aegisai_health', 'aegisai_hunt', 'aegisai_swarm', 'aegisai_task']);
});

test('MCP health reports version and configured project root', async () => {
  const res = await client.callTool({ name: 'aegisai_health', arguments: {} });
  assert.equal(res.isError, undefined);
  const data = JSON.parse(res.content[0].text);
  assert.equal(data.ok, true);
  assert.equal(data.projectRoot, dir);
  assert.ok(data.version);
});
