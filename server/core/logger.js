// server/core/logger.js
// Structured logger with levels. Falls back to console when not JSON mode.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = (process.env.AEGISAI_LOG_LEVEL || 'info').toLowerCase();
const JSON_MODE = process.env.AEGISAI_LOG_JSON === '1';
const minLevel = LEVELS[MIN_LEVEL] || LEVELS.info;

function emit(level, msg, meta) {
  if ((LEVELS[level] || 0) < minLevel) return;
  const entry = { ts: new Date().toISOString(), level, msg };
  if (meta && typeof meta === 'object') Object.assign(entry, meta);
  if (JSON_MODE) {
    try { console.log(JSON.stringify(entry)); } catch (e) { console.log(entry); }
  } else {
    const prefix = '[' + level.toUpperCase() + ']';
    if (meta) console.log(prefix, msg, meta);
    else console.log(prefix, msg);
  }
}

module.exports = {
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};
