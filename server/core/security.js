// server/core/security.js
// Process-safety and path-safety primitives. Ported from the legacy monolith.
// These are the most security-critical helpers in the codebase; do not weaken.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Always spawn without a shell so user-supplied values can never be interpreted
// by cmd.exe / sh. Single most important process-safety primitive.
function runProcess(file, args, opts) {
  return new Promise((resolve) => {
    try {
      execFile(file, Array.isArray(args) ? args : [], Object.assign({
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }, opts || {}), (err, stdout, stderr) => {
        resolve({
          ok: !err,
          out: (stdout || '') + (stderr || ''),
          err: err ? (err.message || String(err)) : null,
          code: err ? (err.code || 1) : 0,
        });
      });
    } catch (e) {
      resolve({ ok: false, out: '', err: e.message || String(e), code: 1 });
    }
  });
}

// Ollama model references: name[:tag] or namespace/name[:tag]. Rejects whitespace,
// quotes, and option-like leading dashes.
function isValidModelName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._\/:@-]{0,199}$/.test(name);
}

// SSRF guard: only http(s) URLs whose host is not loopback/private/link-local.
function isSafeUrl(u) {
  if (typeof u !== 'string' || !u) return false;
  let parsed;
  try { parsed = new URL(u); } catch (e) { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = (parsed.hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host === '::1' || host === '0.0.0.0') return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  if (host.startsWith('[')) return false;
  if (/^(fc|fd|fe80|::1)/i.test(host)) return false;
  return true;
}

// Validate that a candidate project root exists and (if an allow-list is
// configured) is inside it. Returns the resolved path or throws with .status=403.
function validateProjectRoot(root, allowlist) {
  if (typeof root !== 'string' || !root) throw Object.assign(new Error('root required'), { status: 400 });
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw Object.assign(new Error('root does not exist'), { status: 400 });
  }
  const list = Array.isArray(allowlist) ? allowlist : [];
  if (list.length > 0) {
    const ok = list.some((base) => resolved === base || resolved.startsWith(base + path.sep));
    if (!ok) throw Object.assign(new Error('root outside allow-list'), { status: 403 });
  }
  return resolved;
}

// Resolve a relative path inside a project root, blocking traversal.
function safePath(projectRoot, rel) {
  if (!projectRoot) throw new Error('no project root set');
  const resolved = path.resolve(projectRoot, rel || '.');
  if (resolved !== projectRoot && !resolved.startsWith(projectRoot + path.sep)) {
    throw new Error('escapes project root');
  }
  return resolved;
}

module.exports = { runProcess, isValidModelName, isSafeUrl, validateProjectRoot, safePath };
