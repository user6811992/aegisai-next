// server/integrations/ghidra.js
const http = require('http');

const COMMON_PORTS = [8089, 8090, 8765, 9000];

async function detectGhidraUrl() {
  if (process.env.GHIDRA_MCP_URL) return process.env.GHIDRA_MCP_URL;
  for (const port of COMMON_PORTS) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get('http://127.0.0.1:' + port + '/', (res) => { resolve(res.statusCode < 500); });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => { req.destroy(); resolve(false); });
      });
      if (ok) return 'http://127.0.0.1:' + port;
    } catch (e) {}
  }
  return null;
}

let cachedUrl = null;
async function getUrl() {
  if (cachedUrl) return cachedUrl;
  cachedUrl = await detectGhidraUrl();
  if (cachedUrl) process.env.GHIDRA_MCP_URL = cachedUrl;
  return cachedUrl;
}

const integration = {
  name: 'ghidra',
  isAvailable: async () => !!(await getUrl()),
  tools: () => [],
  status: async () => {
    const url = await getUrl();
    return { ready: !!url, error: url ? null : 'GHIDRA_MCP_URL not set (no GhidrAssistMCP detected)', toolCount: 0, url };
  },
};

module.exports = { integration, getUrl, detectGhidraUrl };
