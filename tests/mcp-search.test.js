// tests/mcp-search.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

require('./helpers/isolated-data');
const intConfig = require('../server/storage/integrations-config');
const mcp = require('../server/integrations/mcp');
const mcpSearch = require('../server/integrations/mcp-search');
const app = require('../server.js');

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

  intConfig.save({
    mcpServers: [{
      id: 'docs',
      command: process.execPath,
      args: [path.join(__dirname, 'fixtures', 'search-mcp-server.js')],
      role: 'search',
    }],
  });
  await mcp.init();
});

after(async () => {
  await mcp.closeAll();
  if (fakeOllama) await new Promise((resolve) => fakeOllama.close(resolve));
  const dir = process.env.AEGISAI_DATA_DIR;
  if (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
});

test('search candidates come from role=search MCP servers', () => {
  const names = mcpSearch.candidates().map((c) => c.fullName);
  assert.ok(names.includes('docs__search_docs'), 'got: ' + names.join(', '));
});

test('unified search fans out to the configured MCP search tool', async () => {
  const res = await mcpSearch.search('roadmap', { limit: 3 });
  assert.equal(res.ok, true);
  assert.equal(res.sources.length, 1);
  assert.ok(res.sources[0].text.includes('fixture result for roadmap'));
});

test('search integration exposes search_external and rejects other names', async () => {
  assert.equal(await mcpSearch.integration.isAvailable(), true);
  assert.equal(mcpSearch.integration.tools()[0].name, 'external');
  await assert.rejects(() => mcpSearch.integration.callTool('other', {}), /unknown search tool/);
  const res = await mcpSearch.integration.callTool('external', { query: 'hello' });
  assert.ok(res.sources[0].text.includes('fixture result for hello'));
});

test('agent dispatches search_external through the search integration', async () => {
  const fakeScript = { name: 'search_external', args: { query: 'dispatch' } };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.runAgent({
    model,
    messages: [{ role: 'user', content: 'search for dispatch' }],
    projectRoot: process.env.AEGISAI_DATA_DIR,
    includeCoding: true,
    includeRe: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    externalTools: {
      ghidra: [], craft: [], are: [], rea: [], hunt: [], mcp: [],
      search: [{ name: 'external', description: 'external search', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }],
    },
  });
  assert.equal(r.toolLog.length, 1);
  assert.equal(r.toolLog[0].name, 'search_external');
  assert.ok(String(r.toolLog[0].resultPreview).includes('fixture result for dispatch'));
});
