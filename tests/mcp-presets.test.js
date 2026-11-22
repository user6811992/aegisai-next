// tests/mcp-presets.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-presets-'));
process.env.AEGISAI_PROJECT_ROOT_ALLOWLIST = root;
require('./helpers/isolated-data');
const app = require('../server.js');
const presets = require('../server/integrations/mcp-presets');
const { validateToolArgs } = require('../server/integrations/mcp');
const intConfig = require('../server/storage/integrations-config');

let serverInstance;
let base;

before(async () => {
  serverInstance = app.server;
  await new Promise((resolve) => {
    if (serverInstance.listening) return resolve();
    serverInstance.listen(0, '127.0.0.1', resolve);
  });
  base = 'http://127.0.0.1:' + serverInstance.address().port;
});

after(async () => {
  await new Promise((resolve) => serverInstance.close(resolve));
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

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

test('buildPresets scopes filesystem and marks git read-only', () => {
  const specs = presets.buildPresets(['fs', 'git', 'fetch', 'memory', 'seq', 'time'], root);
  assert.equal(specs.length, 6);
  const fsSpec = specs.find((s) => s.id === 'preset-fs');
  const gitSpec = specs.find((s) => s.id === 'preset-git');
  assert.equal(fsSpec.scopeRoot, path.resolve(root));
  assert.equal(gitSpec.readOnly, true);
  assert.ok(gitSpec.args.includes('--repository'));
  assert.ok(gitSpec.args.includes(path.resolve(root)));
  for (const s of specs) {
    if (process.platform === 'win32') {
      assert.equal(s.command, 'cmd');
      assert.equal(s.args[0], '/c');
    } else {
      assert.ok(['npx', 'uvx'].includes(s.command));
    }
  }
  assert.throws(() => presets.buildPresets(['fs'], path.join(root, '..', 'escape')), /allow|root|escap/i);
});

test('buildPresets rejects unknown preset ids', () => {
  const specs = presets.buildPresets(['not-a-preset'], root);
  assert.equal(specs.length, 0);
});

test('tool argument guard blocks unsafe URLs and out-of-root paths', () => {
  const scoped = { spec: { scopeRoot: path.resolve(root) } };
  assert.throws(() => validateToolArgs({ url: 'http://169.254.169.254/latest/meta-data' }, {}), /unsafe url/i);
  assert.doesNotThrow(() => validateToolArgs({ url: 'https://api.github.com/repos/x/y' }, {}));
  assert.throws(() => validateToolArgs({ path: '../../secret.txt' }, scoped));
  assert.doesNotThrow(() => validateToolArgs({ path: 'sub/file.txt' }, scoped));
  assert.throws(() => validateToolArgs({ paths: ['ok.txt', '../bad.txt'] }, scoped));
});

test('POST /api/integrations/mcp/presets installs curated specs', async () => {
  const res = await post('/api/integrations/mcp/presets', { presets: ['fs', 'time'], root });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.servers.map((s) => s.id).sort(), ['preset-fs', 'preset-time']);
  const cfg = intConfig.load();
  assert.equal(cfg.mcpServers.length, 2);
  assert.ok(cfg.mcpServers.every((s) => s.id.startsWith('preset-')));
});
