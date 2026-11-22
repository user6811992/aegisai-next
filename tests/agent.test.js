// tests/agent.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('./helpers/isolated-data');
const app = require('../server.js');

let fakeOllama;
let fakeLog = [];
let serverInstance;
let base;

function startFakeOllama() {
  return new Promise((resolve) => {
    fakeOllama = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const data = body ? JSON.parse(body) : {};
        fakeLog.push({ url: req.url, data });
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
  // re-init backend state by requiring fresh? state already loaded from env at module load (before env set).
  // Manually set via backends.state
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

test('clean room blocks dangerous tool names and keeps safe ones', () => {
  assert.equal(app.isCleanRoomBlocked('read_file'), true);
  assert.equal(app.isCleanRoomBlocked('run_python'), true);
  assert.equal(app.isCleanRoomBlocked('memory_search'), false);
});

test('agent executes a coding tool and returns the final answer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-agent-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  app.setProjectRoot(dir);
  const fakeScript = { name: 'list_files', args: { path: '.' } };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.runAgent({
    model,
    messages: [{ role: 'user', content: 'go' }],
    projectRoot: dir,
    includeCoding: true,
    cleanRoom: false,
    onEvent: () => {},
  });
  assert.equal(r.final.type, 'done');
  assert.equal(r.final.final, 'final answer');
  assert.equal(r.toolLog.length, 1);
  assert.equal(r.toolLog[0].name, 'list_files');
  assert.ok(r.toolLog[0].resultPreview.includes('hello.txt'));
});

test('clean room mode refuses run_python even when the model asks for it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cr-'));
  app.setProjectRoot(dir);
  const fakeScript = { name: 'run_python', args: { code: 'print(1)' } };
  const model = 'scripted:' + Buffer.from(JSON.stringify(fakeScript)).toString('base64');
  const r = await app.runAgent({
    model,
    messages: [{ role: 'user', content: 'go' }],
    projectRoot: dir,
    includeCoding: true,
    cleanRoom: true,
    onEvent: () => {},
  });
  assert.equal(r.toolLog.length, 1);
  assert.ok(r.toolLog[0].resultPreview.startsWith('BLOCKED'), 'got: ' + r.toolLog[0].resultPreview);
});

test('backendListModels returns models from fake backend', async () => {
  const data = await app.backends.backendListModels();
  assert.ok(Array.isArray(data.models));
  assert.equal(data.models[0].name, 'llama3.2:3b');
});
