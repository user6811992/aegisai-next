// Minimal stdio MCP server used by tests/mcp-search.test.js
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const server = new McpServer({ name: 'search-fixture', version: '1' });
server.registerTool('search_docs', {
  description: 'Search a tiny fixture document set',
  inputSchema: { query: z.string() },
}, async ({ query }) => ({
  content: [{ type: 'text', text: 'fixture result for ' + query }],
}));

server.connect(new StdioServerTransport()).catch((e) => {
  console.error('fixture server failed:', e && e.message ? e.message : e);
  process.exitCode = 1;
});
