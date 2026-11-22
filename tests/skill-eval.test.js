// tests/skill-eval.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');

require('./helpers/isolated-data');
const app = require('../server.js');
const db = require('../server/storage/db');
const skillEval = require('../server/eval/skill-eval');

let serverInstance;
let base;

before(async () => {
  db.saveSkill({ name: 'good-skill', description: 'A well documented skill that reviews code for obvious problems before shipping.', code: "print('Review checklist and report findings clearly.')" });
  db.saveSkill({ name: 'risky-skill', description: 'A skill that executes a shell command for demonstration purposes here.', code: "import subprocess\nsubprocess.run('rm -rf /tmp/x', shell=True)" });
  serverInstance = app.server;
  await new Promise((resolve) => {
    if (serverInstance.listening) return resolve();
    serverInstance.listen(0, '127.0.0.1', resolve);
  });
  base = 'http://127.0.0.1:' + serverInstance.address().port;
});

after(async () => {
  await new Promise((resolve) => serverInstance.close(resolve));
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

test('security scan detects shell execution and network access', () => {
  const issues = skillEval.scanSecurity('subprocess.run("ls")\nfetch("https://example.com")');
  const ids = issues.map((i) => i.id);
  assert.ok(ids.includes('shell-exec'));
  assert.ok(ids.includes('network'));
});

test('quality and compatibility tiers score a good skill higher', () => {
  const good = skillEval.evaluateSkill({ name: 'good-skill', description: 'A well documented skill that reviews code for obvious problems before shipping.', code: "print('Review checklist and report findings clearly.')" });
  const bad = skillEval.evaluateSkill({ name: 'risky-skill', description: 'Runs shell commands for demonstration purposes in this test.', code: "import subprocess\nsubprocess.run('rm -rf /tmp/x', shell=True)" });
  assert.equal(good.decision, 'pass');
  assert.equal(bad.decision, 'fail');
  assert.ok(bad.issues.some((i) => i.id === 'shell-exec' && i.severity === 'critical'));
  assert.ok(bad.issues.some((i) => i.id === 'unknown-import'));
});

test('MCP tool descriptors are evaluated for schema and description', () => {
  const pass = skillEval.evaluateTool({ name: 'good_tool', description: 'A useful tool', inputSchema: { type: 'object', properties: {} } });
  const fail = skillEval.evaluateTool({ name: 'bad tool!', description: '', inputSchema: null });
  assert.equal(pass.decision, 'pass');
  assert.equal(fail.decision, 'fail');
  assert.ok(fail.issues.some((i) => i.id === 'tool-schema'));
});

test('evaluateAll aggregates skills and MCP tools with counts', () => {
  const report = skillEval.evaluateAll({ includeTools: false });
  assert.ok(report.total >= 2);
  assert.equal(report.counts.pass + report.counts.warn + report.counts.fail, report.total);
});

test('skill evaluation endpoints work', async () => {
  const all = await get('/api/skills/evaluate');
  assert.equal(all.status, 200);
  assert.ok(all.body.total >= 2);
  const one = await post('/api/skills/evaluate', { name: 'good-skill' });
  assert.equal(one.status, 200);
  assert.equal(one.body.name, 'good-skill');
  const missing = await post('/api/skills/evaluate', { name: 'no-such-skill' });
  assert.equal(missing.status, 404);
});
