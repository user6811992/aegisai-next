// tests/mcp-integration.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

require('./helpers/isolated-data');
const config = require('../server/core/config');
const intConfig = require('../server/storage/integrations-config');
const mcp = require('../server/integrations/mcp');
const app = require('../server.js');

let root;
let fakeOllama;

function startFakeOllama() {
  return new Promise((resolve) => {
    fakeOllama = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const data = body ? JSON.parse(body) : {};
        if (req.url === '/api/tags') {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }));
        }
        if (req.url === '/api/chat') {
          const toolMsgs = (data.messages || []).filter((m) => m.role === 'tool');
          let wantTool = null;
          if (typeof data.model === 'string' && data.model.startsWith('scripted:')) {
            wantTool = JSON.parse(Buffer.from(data.model.slice('scripted:'.length), 'base64').toString('utf8'));
          }
          res.setHeader('Content-Type', 'application/x-ndjson');
          const lines = [];
          if (toolMsgs.length === 0 && wantTool) {
            lines.push({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: wantTool.name, arguments: wantTool.args } }] }, done: false });
          }
          lines.push({ message: { role: 'assistant', content: 'final answer' }, done: true });
          return res.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    fakeOllama.listen(0, '127.0.0.1', () => resolve(fakeOllama.address().port));
  });
}

before(async () => {
  const port = await startFakeOllama();
  app.backends.state.type = 'ollama';
  app.backends.state.url = 'http://127.0.0.1:' + port;
  app.backends.state.explicit = true;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-client-'));
  fs.writeFileSync(path.join(root, 'hello.txt'), 'hello');
  intConfig.save({
    mcpServers: [{
      id: 'aegis',
      command: process.execPath,
      args: [path.join(__dirname, '..', 'mcp-server.js')],
      env: {
        AEGISAI_PROJECT_ROOT: root,
        AEGISAI_PROJECT_ROOT_ALLOWLIST: root,
        AEGISAI_DATA_DIR: config.DATA_DIR,
      },
    }],
  });
  await mcp.init();
});

after(async () => {
  await mcp.closeAll();
  if (fakeOllama) await new Promise((resolve) => fakeOllama.close(resolve));
  if (root) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
});

test('MCP spec validation rejects shell and arbitrary commands', () => {
  assert.equal(mcp.validSpec({ id: 'ok', command: 'npx', args: ['-y', 'x'] }), true);
  assert.equal(mcp.validSpec({ id: 'ok2', command: 'cmd', args: ['/c', 'npx', '-y', 'x'] }), true);
  assert.equal(mcp.validSpec({ id: 'bad', command: 'bash', args: ['-c', 'x'] }), false);
  assert.equal(mcp.validSpec({ id: 'bad2', command: 'cmd', args: ['/c', 'curl', 'x'] }), false);
  assert.equal(mcp.validSpec({ id: '../oops', command: 'npx', args: [] }), false);
  assert.equal(mcp.validSpec({ id: 'x', command: 'npx', args: ['a', 3] }), false);
});

test('MCP integration lists tools from a configured server', () => {
  const names = mcp.integration.tools().map((t) => t.name);
  assert.ok(names.includes('aegis__aegisai_health'), 'got: ' + names.join(', '));
  assert.ok(names.includes('aegis__aegisai_agent'));
});

test('MCP integration calls a tool on the configured server', async () => {
  const res = await mcp.integration.callTool('aegis__aegisai_health', {});
  const data = JSON.parse(res.content[0].text);
  assert.equal(data.ok, true);
  assert.equal(data.projectRoot, root);
});

test('agent dispatches mcp_-prefixed tools through the MCP integration', async () => {
  const fakeScript = { name: 'mcp_aegis__aegisai_health', args: {} };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.runAgent({
    model,
    messages: [{ role: 'user', content: 'check health' }],
    projectRoot: root,
    includeCoding: true,
    includeRe: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    externalTools: {
      ghidra: [], craft: [], are: [], rea: [], hunt: [],
      mcp: [{ name: 'aegis__aegisai_health', description: 'health', inputSchema: { type: 'object', properties: {} } }],
    },
  });
  assert.equal(r.toolLog.length, 1);
  assert.equal(r.toolLog[0].name, 'mcp_aegis__aegisai_health');
  assert.ok(String(r.toolLog[0].resultPreview).includes('ok'));
});

test('MCP integration rejects malformed tool names', async () => {
  await assert.rejects(() => mcp.integration.callTool('no-separator', {}), /invalid MCP tool name/);
});
