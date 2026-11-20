// server/integrations/ghidra.js
const fs = require('fs');
function ghidraAvailable() {
  // GhidrAssistMCP runs as an HTTP MCP inside Ghidra; probe its port if configured.
  const url = process.env.GHIDRA_MCP_URL;
  return !!url;
}
const integration = {
  name: 'ghidra',
  isAvailable: () => ghidraAvailable(),
  tools: () => [],
  status: () => ({ ready: ghidraAvailable(), error: ghidraAvailable() ? null : 'GHIDRA_MCP_URL not set', toolCount: 0 }),
};
module.exports = { integration };
