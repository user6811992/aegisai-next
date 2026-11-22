// tests/patch.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

require('./helpers/isolated-data');
const app = require('../server.js');
const { proposePatch, simpleDiff } = require('../server/agent/patch');

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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-patch-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { leftpad: '1.0.0' } }, null, 2));
});

after(async () => {
  if (fakeOllama) await new Promise((resolve) => fakeOllama.close(resolve));
  if (root) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
});

test('simpleDiff shows removed and added lines', () => {
  const diff = simpleDiff('a\nb\nc', 'a\nd\nc');
  assert.ok(diff.includes('-b'));
  assert.ok(diff.includes('+d'));
});

test('proposePatch is a dry run by default and emits a version diff', () => {
  const r = proposePatch({ projectRoot: root, dependency: 'leftpad', fixedVersion: '1.0.1' });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.equal(r.from, '1.0.0');
  assert.equal(r.to, '1.0.1');
  assert.ok(r.diff.includes('-    "leftpad": "1.0.0"'));
  assert.ok(r.diff.includes('+    "leftpad": "1.0.1"'));
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(onDisk.dependencies.leftpad, '1.0.0');
});

test('proposePatch can apply the bump and refuses unsafe inputs', () => {
  const applied = proposePatch({ projectRoot: root, dependency: 'leftpad', fixedVersion: '1.0.1', dryRun: false });
  assert.equal(applied.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies.leftpad, '1.0.1');
  assert.equal(proposePatch({ projectRoot: root, dependency: 'leftpad; rm -rf', fixedVersion: '2.0.0' }).ok, false);
  assert.equal(proposePatch({ projectRoot: root, dependency: 'leftpad', fixedVersion: '$(curl x)' }).ok, false);
  assert.equal(proposePatch({ projectRoot: root, dependency: 'missing-pkg', fixedVersion: '2.0.0' }).ok, false);
  assert.equal(proposePatch({ projectRoot: root, dependency: 'leftpad', fixedVersion: '1.0.1' }).ok, false);
});

test('agent dispatches patch_propose through the patch integration', async () => {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { vulnerable: '1.0.0' } }, null, 2));
  const fakeScript = { name: 'patch_propose', args: { dependency: 'vulnerable', fixedVersion: '1.0.2', projectRoot: root } };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.runAgent({
    model,
    messages: [{ role: 'user', content: 'propose a patch' }],
    projectRoot: root,
    includeCoding: true,
    includeRe: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    externalTools: {
      ghidra: [], craft: [], are: [], rea: [], hunt: [], mcp: [], search: [],
      patch: [{ name: 'propose', description: 'patch', inputSchema: { type: 'object', properties: { dependency: { type: 'string' }, fixedVersion: { type: 'string' } } } }],
    },
  });
  assert.equal(r.toolLog.length, 1);
  assert.equal(r.toolLog[0].name, 'patch_propose');
  assert.ok(String(r.toolLog[0].resultPreview).includes('vulnerable'));
});

test('runHunt default phases include patch before report', async () => {
  const r = await app.runHunt({
    projectRoot: root,
    messages: [{ role: 'user', content: 'hunt' }],
    includeCoding: true,
    includeRe: false,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    externalTools: { ghidra: [], craft: [], are: [], rea: [], hunt: [], mcp: [], search: [], patch: [] },
    target: 'example.com',
    maxWaves: 5,
  });
  assert.deepEqual(r.waves.map((w) => w.phase), ['recon', 'probe', 'verify', 'patch', 'report']);
});
