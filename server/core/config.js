// server/core/config.js
/**
 * Centralized configuration. Reads env vars; no mutable global state beyond this module.
 * @module config
 */
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '127.0.0.1';

const MAX_BODY_BYTES = parseInt(process.env.AEGISAI_MAX_BODY || (100 * 1024 * 1024), 10);

const PROJECT_ROOT_ALLOWLIST = (process.env.AEGISAI_PROJECT_ROOT_ALLOWLIST || '')
  .split(/[;]|:(?!\\|\/)/)
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => path.resolve(s));

const TOOL_BUDGET = Math.max(1, parseInt(process.env.AEGISAI_TOOL_BUDGET || '64', 10));

const DATA_DIR = process.env.AEGISAI_DATA_DIR || path.join(process.cwd(), 'data');

const PUBLIC_DIR = process.env.AEGISAI_PUBLIC_DIR || path.join(__dirname, '..', '..', 'public');

module.exports = {
  PORT,
  HOST,
  MAX_BODY_BYTES,
  PROJECT_ROOT_ALLOWLIST,
  TOOL_BUDGET,
  DATA_DIR,
  PUBLIC_DIR,
};
