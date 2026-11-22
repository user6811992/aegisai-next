// tests/markdown-memory.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');

require('./helpers/isolated-data');
const app = require('../server.js');
const db = require('../server/storage/db');
const mm = require('../server/storage/markdown-memory');

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

test('tokenize and jaccard ignore stopwords', () => {
  const a = mm.tokenize('The quick brown fox and the dog');
  assert.ok(a.has('quick') && a.has('brown'));
  assert.equal(a.has('the'), false);
  assert.ok(mm.jaccard(a, mm.tokenize('quick brown fox')) > 0.5);
  assert.equal(mm.jaccard(mm.tokenize(''), a), 0);
});

test('markdown export and parse round-trip', () => {
  db.saveMemory({ id: 'm1', text: 'Project uses SQLite for storage', source: 'manual', tags: ['db'] });
  const exported = mm.exportMarkdown();
  assert.equal(exported.count, 1);
  assert.ok(fs.existsSync(exported.file));
  const parsed = mm.parseMarkdown(fs.readFileSync(exported.file, 'utf8'));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'm1');
  assert.equal(parsed[0].text, 'Project uses SQLite for storage');
  assert.deepEqual(parsed[0].tags, ['db']);
});

test('consolidation merges near-duplicate memories', () => {
  db.saveMemory({ id: 'dup-a', text: 'Project uses SQLite for storage of chat data', source: 'manual', tags: ['db'] });
  db.saveMemory({ id: 'dup-b', text: 'Project uses SQLite for storage of document data', source: 'manual', tags: ['sqlite'] });
  const before = db.memoryCount();
  const report = mm.consolidate({ threshold: 0.5 });
  assert.equal(report.before, before);
  assert.equal(report.mergedGroups, 1);
  assert.ok(report.after < report.before);
  assert.ok(db.listMemories().some((m) => m.source === 'consolidated'));
  assert.equal(db.getMemory('dup-a'), null);
  assert.equal(db.getMemory('dup-b'), null);
});

test('ranked search finds relevant memories without embeddings', () => {
  const results = mm.search('SQLite storage', 5);
  assert.ok(results.length > 0);
  assert.ok(results[0].score > 0);
});

test('memory HTTP endpoints expose markdown, search and consolidation', async () => {
  const md = await get('/api/memory/markdown');
  assert.equal(md.status, 200);
  assert.ok(md.body.markdown.includes('# AegisAI memory'));
  const search = await get('/api/memory/search?q=SQLite&limit=3');
  assert.equal(search.status, 200);
  assert.ok(search.body.results.length > 0);
  const imported = await post('/api/memory/markdown/import', { markdown: '## imported-1 — manual\n\nImported fact about tokens\n\nTags: test\n' });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.imported, 1);
  const consolidated = await post('/api/memory/consolidate', { threshold: 0.55 });
  assert.equal(consolidated.status, 200);
  assert.equal(consolidated.body.ok, true);
});
