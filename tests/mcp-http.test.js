// tests/mcp-http.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

require('./helpers/isolated-data');
const intConfig = require('../server/storage/integrations-config');
const mcp = require('../server/integrations/mcp');

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

let httpServer;
let httpTransport;
let mcpServer;
let url;

before(async () => {
  mcpServer = new McpServer({ name: 'http-test-server', version: '1' });
  mcpServer.registerTool('ping_http', { description: 'ping over HTTP', inputSchema: {} }, async () => ({
    content: [{ type: 'text', text: 'pong-http' }],
  }));
  httpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => 'http-test-session' });
  await mcpServer.connect(httpTransport);
  httpServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed;
      try { parsed = body ? JSON.parse(body) : undefined; } catch (e) { /* ignore */ }
      httpTransport.handleRequest(req, res, parsed);
    });
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + httpServer.address().port + '/mcp';

  intConfig.save({ mcpServers: [{ id: 'httpsrv', url }] });
  await mcp.init();
});

after(async () => {
  await mcp.closeAll();
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  if (mcpServer) await mcpServer.close();
  const dir = process.env.AEGISAI_DATA_DIR;
  if (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
});

test('Streamable HTTP MCP URL validation allows loopback, blocks metadata and credentials', () => {
  assert.equal(mcp.validMcpUrl('http://127.0.0.1:3001/mcp'), true);
  assert.equal(mcp.validMcpUrl('http://localhost:3001/mcp'), true);
  assert.equal(mcp.validMcpUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(mcp.validMcpUrl('http://user:pass@example.com/mcp'), false);
  assert.equal(mcp.validMcpUrl('file:///etc/passwd'), false);
  assert.equal(mcp.validSpec({ id: 'h', url }), true);
  assert.equal(mcp.validSpec({ id: 'h', url, command: 'npx', args: [] }), false);
});

test('MCP client connects over Streamable HTTP and calls a remote tool', async () => {
  const names = mcp.integration.tools().map((t) => t.name);
  assert.ok(names.includes('httpsrv__ping_http'), 'got: ' + names.join(', ') + ' status: ' + JSON.stringify(await mcp.integration.status()));
  const res = await mcp.integration.callTool('httpsrv__ping_http', {});
  assert.equal(res.content[0].text, 'pong-http');
});
