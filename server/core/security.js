// server/core/security.js
// Process-safety and path-safety primitives. Ported from the legacy monolith.
// runProcess uses execFile (no shell) by default; callers that need a shell must
// pass shell:true explicitly and are responsible for sanitizing their inputs.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Always spawn without a shell so user-supplied values can never be interpreted
// by cmd.exe / sh. Single most important process-safety primitive.
/**
 * Run a process without a shell (execFile). Returns { ok, out, err, code }.
 * @param {string} file - Executable path
 * @param {string[]} [args=[]] - Arguments
 * @param {object} [opts] - execFile options (encoding, timeout, cwd, shell, etc.)
 * @returns {Promise<{ok: boolean, out: string, err: string|null, code: number}>}
 */
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

/**
 * Ollama model references: name[:tag] or namespace/name[:tag]. Rejects whitespace,
 * quotes, and option-like leading dashes.
 * @param {string} name - Model name to validate
 * @returns {boolean} true if valid
 */
function isValidModelName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._\/:@-]{0,199}$/.test(name);
}

/**
 * SSRF guard: only http(s) URLs whose host is not loopback/private/link-local.
 * @param {string} u - URL to check
 * @returns {boolean} true if safe
 */
function isSafeUrl(u) {
  if (typeof u !== 'string' || !u) return false;
  let parsed;
  try { parsed = new URL(u); } catch (e) { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = (parsed.hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host === '::1' || host === '0.0.0.0') return false;
  // IPv6 literal
  const v6 = host.replace(/^\[|\]$/g, '');
  if (v6.includes(':')) {
    if (v6 === '::1' || v6 === '::') return false;
    if (/^fe[89ab][0-9a-f]:/i.test(v6) || /^fe80::/i.test(v6)) return false; // link-local
    if (/^f[cd][0-9a-f]{2}:/i.test(v6)) return false; // unique local fc00::/7
    if (/^ff[0-9a-f]{2}:/i.test(v6)) return false; // multicast
    // IPv4-mapped
    const m = v6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (m) {
      const fake = 'http://' + m[1];
      // reuse IPv4 checks
      const parts = m[1].split('.').map(Number);
      const a = parts[0], b = parts[1];
      if (a === 10 || a === 127 || a === 0) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
    }
    return true;
  }
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
  return true;
}

/**
 * Validate that a candidate project root exists and (if an allow-list is
 * configured) is inside it. Returns the resolved path or throws with .status=403.
 * @param {string} root - Project root path
 * @param {string[]} [allowlist] - Allowed base paths
 * @returns {string} Resolved path
 * @throws {Error} with .status if invalid
 */
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

/**
 * Download a URL to disk, following up to 5 redirects (http/https only).
 * Rejects non-200 responses instead of writing an error page to disk.
 * @param {string} url - URL to download
 * @param {string} dest - Destination file path
 * @param {object} [opts] - Options (maxRedirects, headers)
 * @returns {Promise<void>}
 */
function downloadToFile(url, dest, opts) {
  const http = require('http');
  const https = require('https');
  const fs = require('fs');
  const maxHops = (opts && opts.maxRedirects) || 5;
  return new Promise((resolve, reject) => {
    let hops = 0;
    const doGet = (u) => {
      let parsed;
      try { parsed = new URL(u); } catch (e) { return reject(e); }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return reject(new Error('unsupported protocol: ' + parsed.protocol));
      const lib = parsed.protocol === 'https:' ? https : http;
      const headers = Object.assign({ 'User-Agent': 'AegisAI' }, (opts && opts.headers) || {});
      const req = lib.get(u, { headers }, (res) => {
        const code = res.statusCode;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && hops < maxHops) {
          hops += 1;
          res.resume();
          let next;
          try { next = new URL(res.headers.location, u).toString(); } catch (e) { return reject(e); }
          return doGet(next);
        }
        if (code !== 200) { res.resume(); return reject(new Error('HTTP ' + code)); }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => { file.close(() => resolve()); });
        file.on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
      });
      req.on('error', (e) => { try { fs.unlink(dest, () => {}); } catch (_) {} reject(e); });
    };
    doGet(url);
  });
}

module.exports = { runProcess, isValidModelName, isSafeUrl, validateProjectRoot, safePath, downloadToFile };
