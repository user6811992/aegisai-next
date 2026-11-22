// server/storage/markdown-memory.js
// F10-2: Markdown as a portable mirror of SQLite memory, plus a "sleep"
// consolidation pass that merges near-duplicate facts (inspired by the
// plain-Markdown memory pattern, implemented independently here).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../core/config');
const db = require('./db');

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'has', 'have', 'had', 'but', 'not', 'you', 'your', 'into', 'about', 'all', 'can', 'its', 'will', 'been']);

function memoryFile() { return path.join(config.DATA_DIR, 'memories.md'); }

function tokenize(text) {
  return new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function exportMarkdown() {
  const memories = db.listMemories();
  const lines = ['# AegisAI memory', '', 'Portable mirror of SQLite memories. Edit with care; re-import with POST /api/memory/markdown/import.', ''];
  for (const m of memories) {
    lines.push('## ' + m.id + ' — ' + (m.source || 'manual'));
    lines.push('');
    lines.push(m.text);
    lines.push('');
    lines.push('Tags: ' + (Array.isArray(m.tags) ? m.tags.join(', ') : ''));
    lines.push('');
  }
  const file = memoryFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n'), 'utf8');
  fs.renameSync(tmp, file);
  return { file, count: memories.length };
}

function parseMarkdown(text) {
  const out = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const heading = raw.match(/^##\s+(\S+)(?:\s+—\s+(.*))?$/);
    if (heading) {
      if (current) out.push(current);
      current = { id: heading[1], source: heading[2] || 'manual', lines: [], tags: [] };
      continue;
    }
    if (!current) continue;
    const tagLine = raw.match(/^Tags:\s*(.*)$/);
    if (tagLine) {
      current.tags = tagLine[1].split(',').map((t) => t.trim()).filter(Boolean);
    } else if (raw.trim() === '## AegisAI memory' || raw.startsWith('# AegisAI memory')) {
      continue;
    } else {
      current.lines.push(raw);
    }
  }
  if (current) out.push(current);
  return out.map((e) => ({
    id: e.id,
    source: e.source,
    text: e.lines.join('\n').trim(),
    tags: e.tags,
  })).filter((e) => e.text);
}

function importMarkdown(text) {
  const entries = parseMarkdown(text);
  let imported = 0;
  for (const e of entries) {
    db.saveMemory({ id: e.id, text: e.text, source: e.source, tags: e.tags });
    imported++;
  }
  return { imported };
}

function consolidate(opts = {}) {
  const threshold = (typeof opts.threshold === 'number' && opts.threshold > 0 && opts.threshold < 1) ? opts.threshold : 0.55;
  const memories = db.listMemories();
  const clusters = [];
  for (const m of memories) {
    const tokens = tokenize(m.text);
    const cluster = clusters.find((c) => jaccard(c.tokens, tokens) >= threshold);
    if (cluster) {
      cluster.members.push(m);
      for (const t of tokens) cluster.tokens.add(t);
    } else {
      clusters.push({ tokens, members: [m] });
    }
  }

  let mergedGroups = 0;
  let mergedCount = 0;
  for (const cluster of clusters) {
    if (cluster.members.length < 2) continue;
    const texts = [];
    for (const m of cluster.members) if (!texts.includes(m.text)) texts.push(m.text);
    const tags = [...new Set(cluster.members.flatMap((m) => (Array.isArray(m.tags) ? m.tags : [])))];
    const combined = texts.join('\n\n');
    const digest = crypto.createHash('sha1').update(combined).digest('hex').slice(0, 12);
    const id = 'con_' + digest;
    db.saveMemory({ id, text: combined, source: 'consolidated', tags });
    for (const m of cluster.members) if (m.id !== id) db.deleteMemory(m.id);
    mergedGroups++;
    mergedCount += cluster.members.length - 1;
  }

  const exportResult = exportMarkdown();
  return {
    before: memories.length,
    after: db.memoryCount(),
    mergedGroups,
    mergedCount,
    threshold,
    file: exportResult.file,
  };
}

function search(query, limit = 5) {
  const q = tokenize(query);
  if (!q.size) return [];
  return db.listMemories()
    .map((m) => {
      const tokens = tokenize(m.text);
      let inter = 0;
      for (const t of q) if (tokens.has(t)) inter++;
      const score = inter / (q.size + tokens.size - inter || 1);
      return { ...m, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { exportMarkdown, importMarkdown, parseMarkdown, consolidate, search, tokenize, jaccard, memoryFile };
