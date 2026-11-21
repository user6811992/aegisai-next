// server/core/ratelimit.js
// Optional, opt-in rate limiter. Disabled by default (limit 0) so local-only
// deployments are unaffected. Loopback addresses are always exempt.
const config = require('./config');

const LIMIT = Math.max(0, parseInt(process.env.AEGISAI_RATE_LIMIT || '0', 10));
const WINDOW_MS = Math.max(1000, (parseInt(process.env.AEGISAI_RATE_WINDOW || '60', 10)) * 1000);
const STRICT = LIMIT > 0 ? Math.max(1, parseInt(process.env.AEGISAI_RATE_LIMIT_STRICT || String(Math.max(1, Math.floor(LIMIT / 4))), 10)) : 0;

const buckets = new Map(); // key -> { timestamps: number[] }

function isLoopback(ip) {
  if (!ip) return true;
  const v = String(ip).toLowerCase().replace(/^::ffff:/, '');
  return v === '127.0.0.1' || v === 'localhost' || v === '::1' || v === '0.0.0.0';
}

function isStrictPath(url) {
  if (url === '/api/agent' || url === '/api/pull-model') return true;
  if (url === '/api/integrations/ghidra/install-mcp') return true;
  if (url === '/api/integrations/craft/install' || url === '/api/integrations/craft/install-rust') return true;
  if (url === '/api/integrations/rea/update' || url === '/api/integrations/awesome-re/update') return true;
  return false;
}

function check(req, res) {
  if (LIMIT <= 0) return true;
  const rawIp = (req.socket && req.socket.remoteAddress) || '';
  // Only trust X-Forwarded-For when the direct peer is loopback (i.e. behind a
  // local reverse proxy); otherwise a client could spoof its IP to evade limits.
  let ip = rawIp;
  if (isLoopback(rawIp)) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) ip = String(xff).split(',')[0].trim();
  }
  if (isLoopback(ip)) return true;
  const url = (req.url || '').split('?')[0];
  const limit = isStrictPath(url) ? STRICT : LIMIT;
  if (limit <= 0) return true;
  const key = ip + '|' + (isStrictPath(url) ? 'strict' : 'normal');
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let b = buckets.get(key);
  if (!b) { b = { timestamps: [] }; buckets.set(key, b); }
  b.timestamps = b.timestamps.filter((t) => t > cutoff);
  if (b.timestamps.length >= limit) {
    const retry = Math.ceil((b.timestamps[0] + WINDOW_MS - now) / 1000);
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Retry-After', String(Math.max(1, retry)));
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', '0');
    try { res.end(JSON.stringify({ ok: false, error: 'rate limit exceeded, retry in ' + retry + 's' })); } catch (e) {}
    return false;
  }
  b.timestamps.push(now);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - b.timestamps.length)));
  return true;
}

// Periodic cleanup of stale buckets.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, b] of buckets) {
    b.timestamps = b.timestamps.filter((t) => t > cutoff);
    if (b.timestamps.length === 0) buckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

// Auth-failure tracking (brute-force protection).
const AUTH_FAIL_LIMIT = Math.max(0, parseInt(process.env.AEGISAI_AUTH_FAIL_LIMIT || '5', 10));
const AUTH_FAIL_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAIL_BLOCK_MS = 15 * 60 * 1000;
const authFailures = new Map(); // ip -> { timestamps: [], blockedUntil: 0 }

function recordAuthFailure(ip) {
  if (AUTH_FAIL_LIMIT <= 0) return;
  const v = String(ip || '').toLowerCase().replace(/^::ffff:/, '');
  if (isLoopback(v)) return;
  const now = Date.now();
  let b = authFailures.get(v);
  if (!b) { b = { timestamps: [], blockedUntil: 0 }; authFailures.set(v, b); }
  if (now < b.blockedUntil) return;
  b.timestamps = b.timestamps.filter((t) => now - t < AUTH_FAIL_WINDOW_MS);
  b.timestamps.push(now);
  if (b.timestamps.length >= AUTH_FAIL_LIMIT) {
    b.blockedUntil = now + AUTH_FAIL_BLOCK_MS;
    b.timestamps = [];
  }
}

function isAuthBlocked(ip) {
  if (AUTH_FAIL_LIMIT <= 0) return false;
  const v = String(ip || '').toLowerCase().replace(/^::ffff:/, '');
  if (isLoopback(v)) return false;
  const b = authFailures.get(v);
  if (!b) return false;
  if (Date.now() < b.blockedUntil) return true;
  if (b.blockedUntil > 0) { b.blockedUntil = 0; b.timestamps = []; }
  return false;
}

module.exports = { check, LIMIT, WINDOW_MS, STRICT, isLoopback, recordAuthFailure, isAuthBlocked, AUTH_FAIL_LIMIT };
