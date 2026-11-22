// tests/hunt.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('./helpers/isolated-data');
const app = require('../server.js');
const taskModule = require('../server/agent/task');
const { toSubtasks, resolveRetries, resolveBudget, createSwarmSignal } = require('../server/agent/swarm');
const { searchPatterns } = require('../server/storage/vuln-patterns');

let fakeOllama;
let serverInstance;
let base;

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
            lines.push({ model: data.model, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: wantTool.name, arguments: wantTool.args } }] }, done: false });
            lines.push({ model: data.model, message: { role: 'assistant', content: '' }, done: true, eval_count: 5, prompt_eval_count: 10 });
          } else {
            lines.push({ model: data.model, message: { role: 'assistant', content: 'final answer' }, done: false });
            lines.push({ model: data.model, message: { role: 'assistant', content: '' }, done: true, eval_count: 7, prompt_eval_count: 20 });
          }
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
  process.env.OLLAMA_URL = 'http://127.0.0.1:' + port;
  process.env.BACKEND_TYPE = 'ollama';
  process.env.BACKEND_URL = 'http://127.0.0.1:' + port;
  app.backends.state.type = 'ollama';
  app.backends.state.url = 'http://127.0.0.1:' + port;
  app.backends.state.explicit = true;
  serverInstance = app.server;
  await new Promise((resolve) => serverInstance.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + serverInstance.address().port;
});

after(async () => {
  await new Promise((resolve) => serverInstance.close(resolve));
  await new Promise((resolve) => fakeOllama.close(resolve));
});

test('vuln pattern library search returns matching patterns', () => {
  const res = searchPatterns('sql', { limit: 5 });
  assert.ok(Array.isArray(res));
  assert.ok(res.length > 0);
  assert.ok(typeof res[0].className === 'string');
});

test('agent dispatches hunt_vuln_search to the hunt integration', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-hunt-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  app.setProjectRoot(dir);
  const fakeScript = { name: 'hunt_vuln_search', args: { query: 'sql', limit: 5 } };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.runAgent({
    model,
    messages: [{ role: 'user', content: 'go' }],
    projectRoot: dir,
    includeCoding: true,
    includeRe: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    externalTools: {
      ghidra: [],
      craft: [],
      are: [],
      rea: [],
      hunt: [{ name: 'vuln_search', description: 'Search the disclosed-vulnerability pattern library.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } }],
    },
  });
  assert.equal(r.final.type, 'done');
  assert.equal(r.toolLog.length, 1);
  assert.equal(r.toolLog[0].name, 'hunt_vuln_search');
  assert.ok(String(r.toolLog[0].resultPreview).includes('patterns'));
});

test('clean room blocks hunt_vuln_search', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-hunt-cr-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  app.setProjectRoot(dir);
  const fakeScript = { name: 'hunt_vuln_search', args: { query: 'sql', limit: 5 } };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.runAgent({
    model,
    messages: [{ role: 'user', content: 'go' }],
    projectRoot: dir,
    includeCoding: true,
    includeRe: true,
    cleanRoom: true,
    toolBudget: 64,
    onEvent: () => {},
    externalTools: {
      ghidra: [],
      craft: [],
      are: [],
      rea: [],
      hunt: [{ name: 'vuln_search', description: 'Search the disclosed-vulnerability pattern library.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } }],
    },
  });
  assert.equal(r.toolLog.length, 1);
  assert.ok(String(r.toolLog[0].resultPreview).startsWith('BLOCKED'), 'got: ' + r.toolLog[0].resultPreview);
});

test('runHunt stops after the report phase fires hunt_report', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-hunt-wave-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  app.setProjectRoot(dir);
  const fakeScript = { name: 'hunt_report', args: { findings: [{ title: 'XSS', severity: 'high', cwe: 'CWE-79' }], title: 'Hunt Report' } };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.runHunt({
    model,
    messages: [{ role: 'user', content: 'go' }],
    projectRoot: dir,
    includeCoding: true,
    includeRe: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    externalTools: {
      ghidra: [],
      craft: [],
      are: [],
      rea: [],
      hunt: [{ name: 'report', description: 'Render a bug-hunting report from findings and persist it.', inputSchema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'object' } }, title: { type: 'string' }, huntId: { type: 'string' } } } }],
    },
    target: 'http://example.com',
    maxWaves: 3,
  });
  assert.equal(r.final.type, 'done');
  assert.equal(r.waves.length, 1);
  assert.equal(r.waves[0].phase, 'recon');
  assert.equal(r.final.final, 'final answer');
});

test('runTask drives task phases plan->execute->verify', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-task-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  app.setProjectRoot(dir);
  const fakeScript = { name: 'list_files', args: { path: '.' } };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.task({
    model,
    messages: [{ role: 'user', content: 'do the task' }],
    projectRoot: dir,
    includeCoding: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    externalTools: { ghidra: [], craft: [], are: [], rea: [], hunt: [] },
    goal: 'fix the login bug',
    maxWaves: 3,
  });
  assert.equal(r.final.type, 'done');
  assert.equal(r.waves.length, 3);
  assert.deepEqual(r.waves.map((w) => w.phase), ['plan', 'execute', 'verify']);
});

test('task sandbox blocks unsafe URL steps', () => {
  const blocked = taskModule.sandboxTaskStep({ name: 'web_fetch', args: { url: 'http://169.254.169.254/latest/meta-data' } });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked, true);
  const allowed = taskModule.sandboxTaskStep({ name: 'web_fetch', args: { url: 'https://api.github.com/repos/x/y' } });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.blocked, false);
});

test('task sandbox blocks unsafe task context', async () => {
  const r = await taskModule.runTask({ taskCtx: { url: 'http://127.0.0.1:9/admin' }, maxWaves: 1 });
  assert.equal(r.final.type, 'done');
  assert.ok(String(r.final.final).includes('sandbox blocked'));
});

test('runSwarm fans out subtasks and aggregates results', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-swarm-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  app.setProjectRoot(dir);
  const fakeScript = { name: 'list_files', args: { path: '.' } };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.swarm({
    model,
    messages: [{ role: 'user', content: 'go' }],
    projectRoot: dir,
    includeCoding: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    subtasks: [{ id: 'sub-1', prompt: 'task one' }, { id: 'sub-2', prompt: 'task two' }],
    perTask: { model, maxWaves: 1 },
    maxWaves: 1,
  });
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].id, 'sub-1');
  assert.equal(r.results[1].id, 'sub-2');
  assert.equal(r.final.type, 'done');
  assert.ok(String(r.final.final).includes('## Subtask 1'));
});

test('runSwarm accepts plan-driven subtask decomposition', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-swarm-plan-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  app.setProjectRoot(dir);
  const fakeScript = { name: 'list_files', args: { path: '.' } };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.swarm({
    model,
    messages: [{ role: 'user', content: 'go' }],
    projectRoot: dir,
    includeCoding: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    plan: ['task one', 'task two'],
    perTask: { model, maxWaves: 1 },
    maxWaves: 1,
  });
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].id, 'sub-1');
  assert.equal(r.results[1].id, 'sub-2');
  assert.equal(r.final.type, 'done');
});

test('runSwarm accepts plan-driven subtask overrides', () => {
  const subs = toSubtasks([{ id: 'sub-1', prompt: 'find x', cleanRoom: true, maxWaves: 2 }]);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, 'sub-1');
  assert.equal(subs[0].cleanRoom, true);
  assert.equal(subs[0].maxWaves, 2);
  const subs2 = toSubtasks(['plain task']);
  assert.equal(subs2.length, 1);
  assert.equal(subs2[0].prompt, 'plain task');
  assert.equal(subs2[0].id, 'sub-1');
});

test('subtask retry policy resolves subtask > perTask > default', () => {
  assert.equal(resolveRetries({ retries: 3 }, { retries: 1 }), 3);
  assert.equal(resolveRetries({ retries: 0 }, { retries: 1 }), 0);
  assert.equal(resolveRetries({}, { retries: 2 }), 2);
  assert.equal(resolveRetries({}, {}), 0);
  assert.equal(resolveRetries({ retries: -1 }, { retries: 2 }), 2);
});

test('subtask budget propagates subtask > perTask > swarm', () => {
  assert.equal(resolveBudget({ toolBudget: 8 }, { toolBudget: 32 }, { toolBudget: 64 }), 8);
  assert.equal(resolveBudget({}, { toolBudget: 32 }, { toolBudget: 64 }), 32);
  assert.equal(resolveBudget({}, {}, { toolBudget: 64 }), 64);
  assert.equal(resolveBudget({}, {}, {}), undefined);
  assert.equal(resolveBudget({ toolBudget: -1 }, { toolBudget: 32 }, {}), 32);
});

test('runSwarm exposes resolved per-subtask tool budgets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-swarm-budget-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  app.setProjectRoot(dir);
  const model = 'scripted:' + Buffer.from(JSON.stringify({ name: 'list_files', args: { path: '.' } })).toString('base64');
  const r = await app.swarm({
    model,
    messages: [{ role: 'user', content: 'go' }],
    projectRoot: dir,
    includeCoding: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    externalTools: { ghidra: [], craft: [], are: [], rea: [], hunt: [] },
    subtasks: [{ id: 's1', prompt: 'one', toolBudget: 8 }, { id: 's2', prompt: 'two' }],
    perTask: { model, maxWaves: 1, toolBudget: 32 },
    maxWaves: 1,
  });
  assert.equal(r.results[0].toolBudget, 8);
  assert.equal(r.results[1].toolBudget, 32);
});

test('runSwarm falls back to swarm-wide tool budget', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-swarm-budget-fb-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  app.setProjectRoot(dir);
  const model = 'scripted:' + Buffer.from(JSON.stringify({ name: 'list_files', args: { path: '.' } })).toString('base64');
  const r = await app.swarm({
    model,
    messages: [{ role: 'user', content: 'go' }],
    projectRoot: dir,
    includeCoding: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    externalTools: { ghidra: [], craft: [], are: [], rea: [], hunt: [] },
    subtasks: [{ id: 's1', prompt: 'one' }],
    maxWaves: 1,
  });
  assert.equal(r.results[0].toolBudget, 64);
});

test('swarm cancellation signal combines external abort and timeout', () => {
  const ac = new AbortController();
  const a = createSwarmSignal({ signal: ac.signal });
  assert.equal(a.signal.aborted, false);
  ac.abort();
  assert.equal(a.signal.aborted, true);
  a.cleanup();
  const b = createSwarmSignal({ timeoutMs: 5 });
  assert.equal(b.signal.aborted, false);
  b.cleanup();
});

test('runSwarm honours a pre-aborted cancellation signal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-swarm-cancel-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  app.setProjectRoot(dir);
  const ac = new AbortController();
  ac.abort();
  const r = await app.swarm({
    model: 'scripted:' + Buffer.from(JSON.stringify({ name: 'list_files', args: { path: '.' } })).toString('base64'),
    messages: [{ role: 'user', content: 'go' }],
    projectRoot: dir,
    includeCoding: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    externalTools: { ghidra: [], craft: [], are: [], rea: [], hunt: [] },
    subtasks: [{ id: 'sub-1', prompt: 'task one' }],
    maxWaves: 1,
    signal: ac.signal,
  });
  assert.equal(r.cancelled, true);
  assert.equal(r.results.length, 0);
  assert.ok(String(r.final.final).includes('cancelled'));
});

test('runSwarm accepts plan-driven subtask decomposition', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-swarm-plan-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  app.setProjectRoot(dir);
  const fakeScript = { name: 'list_files', args: { path: '.' } };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.swarm({
    model,
    messages: [{ role: 'user', content: 'go' }],
    projectRoot: dir,
    includeCoding: true,
    cleanRoom: false,
    toolBudget: 64,
    onEvent: () => {},
    plan: [{ id: 'sub-1', prompt: 'task one' }, { id: 'sub-2', prompt: 'task two' }],
    perTask: { model, maxWaves: 1 },
    maxWaves: 1,
  });
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].id, 'sub-1');
  assert.equal(r.results[1].id, 'sub-2');
});
