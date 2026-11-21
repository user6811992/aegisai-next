// lib/db.js - SQLite persistence for AegisAI (chats, memories, skills, settings).
// Tries better-sqlite3 (fast, native) first, then Node's built-in node:sqlite
// (Node 22.5+, no native compilation). Migrates legacy JSON files on first run.
// If neither backend is available, open() throws and server.js falls back to JSON.
let backend = null; // 'better' | 'node'
let DatabaseCtor = null;
// Prefer node:sqlite (built into Node 22.5+, no native compilation needed).
try {
  const ns = require('node:sqlite');
  DatabaseCtor = ns.DatabaseSync;
  backend = 'node';
} catch (e) {
  try {
    DatabaseCtor = require('better-sqlite3');
    backend = 'better';
  } catch (e2) {
    backend = null;
  }
}

let db = null;

function open(dbPath) {
  if (!backend) throw new Error('No SQLite backend available (install better-sqlite3 or use Node 22.5+)');
  if (backend === 'better') {
    db = new DatabaseCtor(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
  } else {
    db = new DatabaseCtor(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
  }
  // Schema version tracking for migrations.
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  const vrow = (typeof db.prepare === 'function') ? db.prepare('SELECT version FROM schema_version').get() : null;
  let currentVersion = (vrow && vrow.version) || 0;
  // Migration runner.
  const migrations = [
    // v1: base schema
    function v1() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chats (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT 'Untitled',
          updated TEXT NOT NULL,
          parent_id TEXT,
          branch_from INTEGER,
          messages TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated DESC);
        CREATE INDEX IF NOT EXISTS idx_chats_parent ON chats(parent_id);
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          source TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          created TEXT NOT NULL,
          updated TEXT,
          embedding TEXT
        );
        CREATE TABLE IF NOT EXISTS skills (
          name TEXT PRIMARY KEY,
          description TEXT,
          code TEXT,
          created TEXT NOT NULL,
          updated TEXT
        );
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS doc_chunks (
          id TEXT PRIMARY KEY,
          doc_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          text TEXT NOT NULL,
          embedding TEXT,
          FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON doc_chunks(doc_id);
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          token TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          created TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          skill_name TEXT,
          interval_minutes INTEGER NOT NULL DEFAULT 60,
          enabled INTEGER NOT NULL DEFAULT 1,
          last_run TEXT,
          created TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          action TEXT NOT NULL,
          details TEXT,
          ip TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(timestamp DESC);
      `);
    },
    // v2: add folder column to chats
    function v2() {
      try { db.exec('ALTER TABLE chats ADD COLUMN folder TEXT'); } catch (e) { /* already exists */ }
    },
    // v3: add pinned column to chats
    function v3() {
      try { db.exec('ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* already exists */ }
    },
  ];
  for (let i = currentVersion; i < migrations.length; i++) {
    migrations[i]();
    currentVersion = i + 1;
    const exists = (typeof db.prepare === 'function') ? db.prepare('SELECT version FROM schema_version').get() : null;
    if (exists) db.prepare('UPDATE schema_version SET version = ?').run(currentVersion);
    else db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(currentVersion);
  }
  return db;
}

function get() { if (!db) throw new Error('Database not opened'); return db; }
function isOpen() { return !!db; }
function close() { if (db) { db.close(); db = null; } }

// ---------- Chats ----------
function one(sql, params) { return db.prepare(sql).get(...(params || [])); }
function all(sql, params) { return db.prepare(sql).all(...(params || [])); }
function run(sql, params) { db.prepare(sql).run(...(params || [])); }

function rowToChat(r) {
  let messages = [];
  try { messages = JSON.parse(r.messages || '[]'); } catch (e) { messages = []; }
  return { id: r.id, title: r.title, updated: r.updated, parent_id: r.parent_id, branch_from: r.branch_from, folder: r.folder || null, pinned: !!r.pinned, messages };
}
function listChats() { return all('SELECT id, title, updated, parent_id, branch_from, folder, pinned FROM chats ORDER BY pinned DESC, updated DESC').map(rowToChat); }
function getChat(id) { const row = one('SELECT * FROM chats WHERE id = ?', [id]); return row ? rowToChat(row) : null; }
function saveChat(chat) {
  const id = chat.id || ('chat_' + Date.now());
  const title = chat.title || 'Untitled';
  const messages = JSON.stringify(chat.messages || []);
  const updated = new Date().toISOString();
  const parentId = chat.parent_id || null;
  const branchFrom = (chat.branch_from === undefined) ? null : chat.branch_from;
  const folder = (chat.folder === undefined) ? null : chat.folder;
  const pinned = (chat.pinned === undefined) ? null : (chat.pinned ? 1 : 0);
  const existing = one('SELECT id FROM chats WHERE id = ?', [id]);
  if (existing) {
    run('UPDATE chats SET title=?, updated=?, messages=?, parent_id=?, branch_from=?, folder=?, pinned=COALESCE(?, pinned) WHERE id=?', [title, updated, messages, parentId, branchFrom, folder, pinned, id]);
  } else {
    run('INSERT INTO chats (id, title, updated, parent_id, branch_from, folder, pinned, messages) VALUES (?,?,?,?,?,?,?,?)', [id, title, updated, parentId, branchFrom, folder, pinned || 0, messages]);
  }
  return id;
}
function deleteChat(id) { run('DELETE FROM chats WHERE id = ?', [id]); }
function listBranches(parentId) { return all('SELECT id, title, updated, branch_from, folder FROM chats WHERE parent_id = ? ORDER BY updated DESC', [parentId]).map(rowToChat); }
function chatCount() { return one('SELECT COUNT(*) AS n FROM chats').n; }

// ---------- Memories ----------
function rowToMemory(r) {
  let tags = [];
  try { tags = JSON.parse(r.tags || '[]'); } catch (e) { tags = []; }
  let embedding = null;
  try { embedding = r.embedding ? JSON.parse(r.embedding) : null; } catch (e) { embedding = null; }
  return { id: r.id, text: r.text, source: r.source, tags, created: r.created, updated: r.updated, embedding };
}
function listMemories() { return all('SELECT * FROM memories ORDER BY created DESC').map(rowToMemory); }
function getMemory(id) { const r = one('SELECT * FROM memories WHERE id = ?', [id]); return r ? rowToMemory(r) : null; }
function saveMemory(m) {
  const id = m.id || ('m_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const existing = one('SELECT id FROM memories WHERE id = ?', [id]);
  if (existing) {
    let embeddingToStore;
    if (m.embedding === undefined) {
      const cur = one('SELECT embedding FROM memories WHERE id = ?', [id]);
      embeddingToStore = cur ? cur.embedding : null;
    } else {
      embeddingToStore = m.embedding ? JSON.stringify(m.embedding) : null;
    }
    run('UPDATE memories SET text=?, source=?, tags=?, updated=?, embedding=? WHERE id=?', [m.text, m.source || 'manual', JSON.stringify(m.tags || []), new Date().toISOString(), embeddingToStore, id]);
  } else {
    run('INSERT INTO memories (id, text, source, tags, created, embedding) VALUES (?,?,?,?,?,?)', [id, m.text, m.source || 'manual', JSON.stringify(m.tags || []), m.created || new Date().toISOString(), m.embedding ? JSON.stringify(m.embedding) : null]);
  }
  return id;
}
function deleteMemory(id) { run('DELETE FROM memories WHERE id = ?', [id]); }
function memoryCount() { return one('SELECT COUNT(*) AS n FROM memories').n; }

// ---------- Skills ----------
function listSkills() { return all('SELECT name, description, code, created, updated FROM skills ORDER BY created DESC'); }
function getSkill(name) { return one('SELECT name, description, code, created, updated FROM skills WHERE name = ?', [name]) || null; }
function saveSkill(s) {
  const existing = one('SELECT name FROM skills WHERE name = ?', [s.name]);
  if (existing) {
    run('UPDATE skills SET description=?, code=?, updated=? WHERE name=?', [s.description, s.code, new Date().toISOString(), s.name]);
  } else {
    run('INSERT INTO skills (name, description, code, created) VALUES (?,?,?,?)', [s.name, s.description, s.code, s.created || new Date().toISOString()]);
  }
  return s.name;
}
function deleteSkill(name) { run('DELETE FROM skills WHERE name = ?', [name]); }

// ---------- Documents ----------
function listDocuments() { return all('SELECT id, name, created FROM documents ORDER BY created DESC'); }
function getDocument(id) { return one('SELECT id, name, created FROM documents WHERE id = ?', [id]); }
function saveDocument(doc) {
  const id = doc.id || ('doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const existing = one('SELECT id FROM documents WHERE id = ?', [id]);
  if (!existing) run('INSERT INTO documents (id, name, created) VALUES (?,?,?)', [id, doc.name, doc.created || new Date().toISOString()]);
  return id;
}
function deleteDocument(id) {
  run('DELETE FROM doc_chunks WHERE doc_id = ?', [id]);
  run('DELETE FROM documents WHERE id = ?', [id]);
}
function listDocChunks(docId) { return all('SELECT id, doc_id, chunk_index, text, embedding FROM doc_chunks WHERE doc_id = ? ORDER BY chunk_index', [docId]); }
function saveDocChunk(chunk) {
  const id = chunk.id || ('chk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  run('INSERT INTO doc_chunks (id, doc_id, chunk_index, text, embedding) VALUES (?,?,?,?,?)', [id, chunk.doc_id, chunk.chunk_index, chunk.text, chunk.embedding ? JSON.stringify(chunk.embedding) : null]);
  return id;
}
function listAllDocChunks() { return all('SELECT id, doc_id, chunk_index, text, embedding FROM doc_chunks'); }
function docCount() { return one('SELECT COUNT(*) AS n FROM documents').n; }

// ---------- Users ----------
function listUsers() { return all('SELECT id, username, role, created FROM users ORDER BY created DESC'); }
function getUser(id) { return one('SELECT id, username, token, role, created FROM users WHERE id = ?', [id]); }
function getUserByToken(token) { return one('SELECT id, username, token, role, created FROM users WHERE token = ?', [token]); }
function saveUser(u) {
  const id = u.id || ('user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const existing = one('SELECT id FROM users WHERE id = ?', [id]);
  if (existing) {
    run('UPDATE users SET username=?, role=? WHERE id=?', [u.username, u.role || 'user', id]);
  } else {
    const token = u.token || (require('crypto').randomBytes(24).toString('hex'));
    run('INSERT INTO users (id, username, token, role, created) VALUES (?,?,?,?,?)', [id, u.username, token, u.role || 'user', u.created || new Date().toISOString()]);
    return { id, token };
  }
  return { id, token: (getUser(id) || {}).token };
}
function deleteUser(id) { run('DELETE FROM users WHERE id = ?', [id]); }
function userCount() { return one('SELECT COUNT(*) AS n FROM users').n; }

// ---------- Scheduled Tasks ----------
function listTasks() { return all('SELECT * FROM scheduled_tasks ORDER BY created DESC'); }
function getTask(id) { return one('SELECT * FROM scheduled_tasks WHERE id = ?', [id]); }
function saveTask(t) {
  const id = t.id || ('task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const existing = one('SELECT id FROM scheduled_tasks WHERE id = ?', [id]);
  if (existing) {
    run('UPDATE scheduled_tasks SET name=?, skill_name=?, interval_minutes=?, enabled=? WHERE id=?', [t.name, t.skill_name || null, t.interval_minutes || 60, t.enabled ? 1 : 0, id]);
  } else {
    run('INSERT INTO scheduled_tasks (id, name, skill_name, interval_minutes, enabled, created) VALUES (?,?,?,?,?,?)', [id, t.name, t.skill_name || null, t.interval_minutes || 60, t.enabled !== false ? 1 : 0, t.created || new Date().toISOString()]);
  }
  return id;
}
function deleteTask(id) { run('DELETE FROM scheduled_tasks WHERE id = ?', [id]); }
function updateTaskLastRun(id) { run('UPDATE scheduled_tasks SET last_run=? WHERE id=?', [new Date().toISOString(), id]); }

// ---------- Audit Log ----------
function logAudit(action, details, ip) {
  try { run('INSERT INTO audit_log (timestamp, action, details, ip) VALUES (?,?,?,?)', [new Date().toISOString(), action, typeof details === 'string' ? details : JSON.stringify(details || {}), ip || null]); } catch (e) {}
}
function listAuditLog(limit) {
  const n = Math.max(1, Math.min(limit || 100, 1000));
  return all('SELECT id, timestamp, action, details, ip FROM audit_log ORDER BY id DESC LIMIT ?', [n]);
}

// ---------- Migration from JSON ----------
function migrateFromJson(dataDir) {
  const fs2 = require('fs');
  const chatsPath = require('path').join(dataDir, 'chats.json');
  if (fs2.existsSync(chatsPath) && chatCount() === 0) {
    try {
      const chats = JSON.parse(fs2.readFileSync(chatsPath, 'utf8'));
      const tx = () => { get().exec('BEGIN'); for (const c of (Array.isArray(chats) ? chats : [])) { run('INSERT OR IGNORE INTO chats (id, title, updated, messages, folder) VALUES (?,?,?,?,?)', [c.id || ('chat_' + Date.now()), c.title || 'Untitled', c.updated || new Date().toISOString(), JSON.stringify(c.messages || []), c.folder || null]); } get().exec('COMMIT'); };
      try { tx(); console.log('Migrated', Array.isArray(chats) ? chats.length : 0, 'chats from JSON to SQLite'); } catch (e) { try { get().exec('ROLLBACK'); } catch (e2) {} console.error('chat migration failed:', e.message); }
    } catch (e) { console.error('chat migration failed:', e.message); }
  }
  const memPath = require('path').join(dataDir, 'memory.json');
  if (fs2.existsSync(memPath) && memoryCount() === 0) {
    try {
      const mems = JSON.parse(fs2.readFileSync(memPath, 'utf8'));
      const tx = () => { get().exec('BEGIN'); for (const m of (Array.isArray(mems) ? mems : [])) { run('INSERT OR IGNORE INTO memories (id, text, source, tags, created, embedding) VALUES (?,?,?,?,?,?)', [m.id, m.text, m.source, JSON.stringify(m.tags || []), m.created || new Date().toISOString(), m.embedding ? JSON.stringify(m.embedding) : null]); } get().exec('COMMIT'); };
      try { tx(); console.log('Migrated', Array.isArray(mems) ? mems.length : 0, 'memories from JSON to SQLite'); } catch (e) { try { get().exec('ROLLBACK'); } catch (e2) {} console.error('memory migration failed:', e.message); }
    } catch (e) { console.error('memory migration failed:', e.message); }
  }
  const skillsPath = require('path').join(dataDir, 'skills.json');
  if (fs2.existsSync(skillsPath)) {
    try {
      const skills = JSON.parse(fs2.readFileSync(skillsPath, 'utf8'));
      const tx = () => { get().exec('BEGIN'); for (const s of (Array.isArray(skills) ? skills : [])) { run('INSERT OR IGNORE INTO skills (name, description, code, created) VALUES (?,?,?,?)', [s.name, s.description, s.code, s.created || new Date().toISOString()]); } get().exec('COMMIT'); };
      try { tx(); } catch (e) { try { get().exec('ROLLBACK'); } catch (e2) {} console.error('skills migration failed:', e.message); }
    } catch (e) { console.error('memory migration failed:', e.message); }
  }
}

module.exports = { open, get, isOpen, close, migrateFromJson, backend,
  listChats, getChat, saveChat, deleteChat, listBranches, chatCount,
  listMemories, getMemory, saveMemory, deleteMemory, memoryCount,
  listSkills, getSkill, saveSkill, deleteSkill,
  listDocuments, getDocument, saveDocument, deleteDocument, listDocChunks, saveDocChunk, listAllDocChunks, docCount,
  logAudit, listAuditLog,
  listUsers, getUser, getUserByToken, saveUser, deleteUser, userCount,
  listTasks, getTask, saveTask, deleteTask, updateTaskLastRun };
