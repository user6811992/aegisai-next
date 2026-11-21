// server/tools/coding.js
// Coding tools available to the agent. Ported (subset) from legacy execCodingTool.
// All file operations are confined to the project root via security.safePath.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const security = require('../core/security');

function isDangerousCmd(cmd) {
  if (typeof cmd !== 'string') return true;
  const bad = [/\brm\s+-rf\b/i, /\bdel\s+\/[sqf]/i, /\bformat\b/i, /\bmkfs\b/i, /:\(\)\s*\{/, /\bshutdown\b/i, /\breboot\b/i];
  return bad.some((r) => r.test(cmd));
}

async function execCodingTool(name, args, projectRoot) {
  const a = args || {};
  switch (name) {
    case 'list_files': {
      const dir = security.safePath(projectRoot, a.path || '.');
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (e) { return { ok: false, output: 'cannot read directory: ' + (e.message || e) }; }
      const out = entries.map((e) => (e.isDirectory() ? e.name + '/' : e.name)).join('\n');
      return { ok: true, output: out || '(empty)' };
    }
    case 'read_file': {
      const p = security.safePath(projectRoot, a.path);
      const st = fs.statSync(p);
      if (st.size > 2 * 1024 * 1024) return { ok: false, output: 'file too large (>2MB)' };
      const buf = fs.readFileSync(p);
      if (buf.includes(0)) return { ok: false, output: 'binary file (' + st.size + ' bytes) - cannot display as text' };
      const content = buf.toString('utf8');
      const max = a.maxBytes || 200000;
      return { ok: true, output: content.slice(0, max) };
    }
    case 'write_file': {
      const p = security.safePath(projectRoot, a.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, a.content == null ? '' : String(a.content), 'utf8');
      return { ok: true, output: 'written ' + a.path };
    }
    case 'delete_file': {
      const p = security.safePath(projectRoot, a.path);
      try {
        if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
        else fs.unlinkSync(p);
      } catch (e) { return { ok: false, output: 'delete failed: ' + (e.message || e) }; }
      return { ok: true, output: 'deleted ' + a.path };
    }
    case 'search_files': {
      const root = security.safePath(projectRoot, a.path || '.');
      if (typeof a.pattern === 'string' && a.pattern.length > 500) return { ok: false, output: 'pattern too long' };
      let re;
      try { re = new RegExp(a.pattern || '', a.flags || 'i'); }
      catch (e) { return { ok: false, output: 'invalid regex: ' + (e.message || e) }; }
      const results = [];
      const MAX_FILE = 512 * 1024;
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { walk(full); continue; }
          let st;
          try { st = fs.statSync(full); } catch (err) { continue; }
          if (!st.isFile() || st.size > MAX_FILE) continue;
          try {
            const txt = fs.readFileSync(full, 'utf8');
            txt.split(/\r?\n/).forEach((line, i) => {
              if (line.length > 4096) return;
              if (re.test(line)) results.push(`${path.relative(projectRoot, full)}:${i + 1}: ${line.trim().slice(0, 300)}`);
            });
          } catch (err) {}
        }
      };
      walk(root);
      return { ok: true, output: results.slice(0, a.limit || 100).join('\n') || '(no matches)' };
    }
    case 'run_command': {
      const cmd = a.command;
      if (isDangerousCmd(cmd)) return { ok: false, output: 'BLOCKED: dangerous command' };
      if (/[;&|`$()<>]/.test(cmd)) return { ok: false, output: 'BLOCKED: shell metacharacters not allowed' };
      if (/[\r\n]/.test(cmd)) return { ok: false, output: 'BLOCKED: newlines not allowed' };
      // Quote-aware split so arguments containing spaces survive.
      const parts = [];
      let cur = '';
      let quote = null;
      for (let i = 0; i < cmd.length; i++) {
        const ch = cmd[i];
        if (quote) {
          if (ch === quote) { quote = null; }
          else { cur += ch; }
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (/\s/.test(ch)) {
          if (cur) { parts.push(cur); cur = ''; }
        } else {
          cur += ch;
        }
      }
      if (cur) parts.push(cur);
      if (parts.length === 0) return { ok: false, output: 'BLOCKED: empty command' };
      // On Windows, .cmd/.bat shims (npm, npx, ...) require a shell to execute.
      // Pass the whole (already-guarded) command string to the shell so quoted
      // arguments with spaces survive instead of being re-split.
      const useShell = process.platform === 'win32';
      if (useShell) {
        return security.runProcess(cmd, [], { cwd: projectRoot, timeout: a.timeout || 60000, shell: true });
      }
      return security.runProcess(parts[0], parts.slice(1), { cwd: projectRoot, timeout: a.timeout || 60000, shell: false });
    }
    case 'run_python': {
      const code = String(a.code || '');
      const tmp = path.join(require('os').tmpdir(), 'aegis-py-' + Date.now() + '.py');
      fs.writeFileSync(tmp, code, 'utf8');
      const r = security.runProcess('python', [tmp], { cwd: projectRoot, timeout: a.timeout || 60000 });
      try { fs.unlinkSync(tmp); } catch (e) {}
      return r;
    }
    case 'web_search': {
      const search = require('./search');
      const result = await search.webSearch(a.query || '', { max_results: a.max_results || a.limit || 8 });
      return { ok: true, output: result };
    }
    default:
      return { ok: false, output: 'unknown tool: ' + name };
  }
}

// Ollama-style tool descriptors
const CODING_TOOLS = [
  { name: 'list_files', description: 'List files in a directory within the project root.', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'read_file', description: 'Read a file within the project root.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, maxBytes: { type: 'number' } }, required: ['path'] } },
  { name: 'write_file', description: 'Write a file within the project root.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path'] } },
  { name: 'delete_file', description: 'Delete a file or directory within the project root.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'search_files', description: 'Search file contents by regex within the project root.', inputSchema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, flags: { type: 'string' }, limit: { type: 'number' } }, required: ['pattern'] } },
  { name: 'run_command', description: 'Run a shell command (no shell metacharacters) in the project root.', inputSchema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] } },
  { name: 'run_python', description: 'Run Python code.', inputSchema: { type: 'object', properties: { code: { type: 'string' }, timeout: { type: 'number' } }, required: ['code'] } },
  { name: 'web_search', description: 'Search the web (DuckDuckGo).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } },
];

function codingToolsAsOllama() {
  return CODING_TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

module.exports = { execCodingTool, codingToolsAsOllama, CODING_TOOLS, isDangerousCmd };
