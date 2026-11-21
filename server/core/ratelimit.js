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
  if (url.startsWith('/api/integrations/') && /install/i.test(url)) return true;
  return false;
}

function check(req, res) {
  if (LIMIT <= 0) return true;
  const ip = (req.socket && req.socket.remoteAddress) || req.headers['x-forwarded-for'] || '';
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

module.exports = { check, LIMIT, WINDOW_MS, STRICT, isLoopback };
