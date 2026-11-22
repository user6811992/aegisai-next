// tests/mcp-registry.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const http = require('http');

require('./helpers/isolated-data');
const app = require('../server.js');
const registry = require('../server/integrations/mcp-registry');
const intConfig = require('../server/storage/integrations-config');

const FIXTURE = {
  servers: [
    {
      server: {
        name: 'io.demo/npm-server', title: 'Demo npm server', description: 'a demo', version: '1.2.3',
        packages: [{ registryType: 'npm', identifier: 'mcp-server-demo', version: '1.2.3', runtimeArguments: [{ type: 'positional', value: '--readonly' }] }],
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true } },
    },
    {
      server: {
        name: 'io.demo/pypi-server', title: 'Demo pypi server', description: 'a demo', version: '2.0.0',
        packages: [{ registryType: 'pypi', identifier: 'mcp-demo-py', version: '2.0.0' }],
      },
    },
    {
      server: {
        name: 'io.demo/remote-server', title: 'Demo remote server', description: 'a demo', version: '1.0.0',
        remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
      },
    },
    {
      server: {
        name: 'io.demo/unsafe-server', title: 'Unsafe', version: '1.0.0',
        packages: [{ registryType: 'npm', identifier: 'bad; rm -rf /', version: '1.0.0' }],
      },
    },
  ],
  metadata: { nextCursor: 'next-page', count: 4 },
};

let registryHttp;
let serverInstance;
let base;

before(async () => {
  registryHttp = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(FIXTURE));
  });
  await new Promise((resolve) => registryHttp.listen(0, '127.0.0.1', resolve));
  process.env.MCP_REGISTRY_URL = 'http://127.0.0.1:' + registryHttp.address().port;

  serverInstance = app.server;
  await new Promise((resolve) => {
    if (serverInstance.listening) return resolve();
    serverInstance.listen(0, '127.0.0.1', resolve);
  });
  base = 'http://127.0.0.1:' + serverInstance.address().port;
});

after(async () => {
  await new Promise((resolve) => serverInstance.close(resolve));
  await new Promise((resolve) => registryHttp.close(resolve));
  const dir = process.env.AEGISAI_DATA_DIR;
  if (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
});

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(base + urlPath, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    }).on('error', reject);
  });
}

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + urlPath, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('fetchRegistry normalizes entries and metadata', async () => {
  const res = await registry.fetchRegistry({ query: 'demo', limit: 10 });
  assert.equal(res.count, 4);
  assert.equal(res.nextCursor, 'next-page');
  assert.equal(res.servers.length, 4);
  assert.equal(res.servers[0].name, 'io.demo/npm-server');
  assert.equal(res.servers[0].status, 'active');
});

test('buildSpec maps npm, pypi and remote entries safely', () => {
  const list = FIXTURE.servers.map((e) => registry.normalize(e));
  const npm = registry.buildSpec(list[0], { id: 'demo-npm' });
  assert.equal(npm.id, 'demo-npm');
  assert.ok(npm.args.includes('mcp-server-demo@1.2.3'));
  assert.ok(npm.args.includes('--readonly'));
  const pypi = registry.buildSpec(list[1]);
  assert.ok(pypi.args.includes('mcp-demo-py==2.0.0'));
  const remote = registry.buildSpec(list[2]);
  assert.equal(remote.url, 'https://example.com/mcp');
  assert.throws(() => registry.buildSpec(list[3]), /invalid registry server name|unsafe/);
});

test('GET /api/integrations/mcp/registry returns search results', async () => {
  const res = await get('/api/integrations/mcp/registry?query=demo&limit=5');
  assert.equal(res.status, 200);
  assert.equal(res.body.servers.length, 4);
});

test('POST /api/integrations/mcp/registry/install installs a validated spec', async () => {
  const res = await post('/api/integrations/mcp/registry/install', { name: 'io.demo/npm-server', id: 'installed-demo' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.server.id, 'installed-demo');
  const cfg = intConfig.load();
  assert.ok(cfg.mcpServers.some((s) => s.id === 'installed-demo'));
});
