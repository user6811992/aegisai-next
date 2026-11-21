// server/integrations/ghidra.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const COMMON_PORTS = [8089, 8090, 8765, 9000, 8080];

function findGhidraInstall() {
  if (process.env.GHIDRA_INSTALL_DIR && fs.existsSync(process.env.GHIDRA_INSTALL_DIR)) return process.env.GHIDRA_INSTALL_DIR;
  const candidates = [
    'C:\\Users\\' + (process.env.USERNAME || '') + '\\Tools\\ghidra_12.1.4_PUBLIC',
    'C:\\Tools\\ghidra_12.1.4_PUBLIC',
    'C:\\Ghidra\\ghidra_12.1.4_PUBLIC',
    'C:\\Program Files\\ghidra_12.1.4_PUBLIC',
  ];
  // scan for any ghidra_*_PUBLIC dir
  for (const base of ['C:\\Users\\' + (process.env.USERNAME || ''), 'C:\\Tools', 'C:\\Ghidra', 'C:\\Program Files']) {
    try {
      for (const f of fs.readdirSync(base, { withFileTypes: true })) {
        if (f.isDirectory() && /^ghidra.*PUBLIC$/i.test(f.name)) candidates.push(path.join(base, f.name));
      }
    } catch (e) {}
  }
  for (const c of candidates) { if (c && fs.existsSync(c)) return c; }
  return null;
}

async function probePort(port) {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:' + port + '/', (res) => { resolve(res.statusCode >= 200 && res.statusCode < 400); });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function detectMcpUrl() {
  if (process.env.GHIDRA_MCP_URL) return process.env.GHIDRA_MCP_URL;
  for (const port of COMMON_PORTS) {
    if (await probePort(port)) return 'http://127.0.0.1:' + port;
  }
  return null;
}

let cachedUrl = null;
async function getUrl() {
  if (process.env.GHIDRA_MCP_URL) return process.env.GHIDRA_MCP_URL;
  if (cachedUrl) return cachedUrl;
  cachedUrl = await detectMcpUrl();
  if (cachedUrl) process.env.GHIDRA_MCP_URL = cachedUrl;
  return cachedUrl;
}

function getInstallDir() {
  const d = findGhidraInstall();
  if (d) process.env.GHIDRA_INSTALL_DIR = d;
  return d;
}

const integration = {
  name: 'ghidra',
  isAvailable: async () => !!(await getUrl()),
  tools: () => [],
  status: async () => {
    const url = await getUrl();
    const installDir = getInstallDir();
    return {
      ready: !!url,
      error: url ? null : (installDir ? 'Ghidra found at ' + installDir + ' but MCP not running. Open Ghidra, load a binary, and enable GhidrAssistMCP.' : 'Ghidra not found. Install Ghidra first.'),
      toolCount: 0,
      url,
      installDir,
    };
  },
};

function resetCache() { cachedUrl = null; }
module.exports = { integration, getUrl, getInstallDir, findGhidraInstall, detectMcpUrl, resetCache };
