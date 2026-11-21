# Changelog

## [1.1.40] - 2026-11-21

### Changed
- Added JSDoc annotations to security.js functions (isSafeUrl, validateProjectRoot).
- Enhanced mobile-responsive CSS with additional breakpoints and touch targets.

## [1.1.39] - 2026-11-21

### Changed
- Cookie-only auth: removed all localStorage token references. Auth uses httpOnly cookies exclusively.

## [1.1.38] - 2026-11-21

### Changed
- Cookie-only auth: removed localStorage token fallback; uses httpOnly cookies exclusively.
- Added JSDoc type annotations to config and security modules.
- Enhanced mobile-responsive CSS.

## [1.1.37] - 2026-11-21

### Fixed
- Re-added legacy localStorage token migration to httpOnly cookie (one-time, clears after).
- Documented clustering + SQLite WAL concurrency limitation.
- Metrics in-memory persistence documented (acceptable for Prometheus).

## [1.1.36] - 2026-11-21

### Added
- Cookie-only auth: removed localStorage token fallback; uses httpOnly cookies exclusively.
- Mobile-responsive CSS: enhanced media queries, touch-friendly targets, safe-area insets.
- Prometheus metrics: (already in v1.1.34) `/metrics` endpoint wired.

## [1.1.35] - 2026-11-21

### Fixed
- Wired metrics counter into request handler (http_requests_total now increments).

## [1.1.34] - 2026-11-21

### Added
- Prometheus metrics: `/metrics` endpoint with counters and histograms.
- Cookie-only auth: removed localStorage fallback; uses httpOnly cookies exclusively.
- Mobile-responsive CSS: media queries, touch-friendly targets, safe-area insets.
- Dark/light theme toggle: ☀️/🌙 button with CSS variable overrides.

## [1.1.33] - 2026-11-21

### Fixed
- Plugin loader now documents security implications (plugins run in-process).
- Light theme CSS expanded with more component overrides.

## [1.1.32] - 2026-11-21

### Added
- Plugin/extension system: `server/core/plugins.js` loader + `/api/plugins` endpoint.
- PDF export: "Export chat (PDF)" button using browser print.
- Cookie-only auth migration: localStorage token migrated to httpOnly cookie on load.

## [1.1.31] - 2026-11-21

### Fixed
- http.test.js now uses temp data dir (avoids leftover state from manual testing).
- All 33 tests pass.

## [1.1.30] - 2026-11-21

### Added
- Multi-user support: users table, /api/users CRUD, token-per-user auth.
- Scheduled tasks: tasks table, /api/tasks CRUD, background runner.
- Audit log: (already in v1.1.28) action logging.

## [1.1.29] - 2026-11-21

### Fixed
- OpenAPI endpoint path corrected (`__dirname` instead of `__dirname/..`).

## [1.1.28] - 2026-11-21

### Added
- Audit log: records actions (memory/skill/settings/chat/document) with IP; `/api/audit-log` endpoint.
- Structured logging: `server/core/logger.js` with levels and JSON mode (`AEGISAI_LOG_JSON=1`).
- Backup scheduling: `AEGISAI_BACKUP_INTERVAL` (minutes) for automated periodic backups.
- OpenAPI spec: `openapi.json` + `/api/openapi.json` endpoint.
- Model comparison (A/B): `/api/compare` endpoint + "Compare models" button.

## [1.1.27] - 2026-11-21

### Fixed
- Onboarding wizard now uses separate pulling/pullMsg state (no UI conflicts).
- E2E test now sets AEGISAI_DATA_DIR before requiring server (uses temp DB).
- Chat folder filter now uses text input + datalist (allows creating new folders).

## [1.1.26] - 2026-11-21

### Added
- Database migrations: schema_version tracking + incremental migrations (v1 base, v2 folder column).
- Chat folders/tags: folder column, filter dropdown in sidebar, folder assignment on rename.
- Onboarding wizard: first-run modal to pull a recommended model.
- HTTPS/TLS: HTTPS_CERT + HTTPS_KEY env vars enable HTTPS.
- E2E tests: 6 smoke tests (health, version, settings, memory, document upload, 404).

## [1.1.25] - 2026-11-21

### Fixed
- `send()` now checks `res.ok` before reading stream; shows friendly error on failure.
- Chat search now searches message content (via snippet from first user message).
- Voice input alert now suggests Chrome/Edge for Firefox users.

## [1.1.24] - 2026-11-21

### Added
- Retry on failure: fetchWithRetry with exponential backoff for agent requests.
- Error translation: friendly error messages instead of raw errors.
- Loading skeletons: animated placeholders while chats load.
- Chat search: filter chats by title in sidebar.
- Voice input: 🎤 mic button using browser SpeechRecognition.

## [1.1.23] - 2026-11-21

### Added
- Image input (vision): attach image button, base64 encoding, image display in chat, OpenAI-compat vision format support.

## [1.1.22] - 2026-11-21

### Added
- Token/cost display per message (prompt/generated tokens shown).
- Message editing (✏️ on user messages) and regeneration (🔄 on assistant messages).
- Conversation export as Markdown (Export chat (MD) button).
- CI/CD: GitHub Actions workflow running tests + build on push/PR.
- Image input foundation (base64 upload path).

## [1.1.21] - 2026-11-21

### Added
- Streaming cancellation: Stop button + Escape key aborts in-flight generation.
- Document RAG: PDF upload, text extraction, chunking, embedding, and RAG injection into chat context.
- Health check endpoint: `GET /api/health` (no auth, for Docker/K8s probes).
- Graceful shutdown: SIGTERM/SIGINT handlers close server and DB.
- Keyboard shortcuts: Enter to send, Esc to stop.

## [1.1.20] - 2026-11-21

### Fixed
- Raw settings textarea now re-mounts when settings load, so it displays current values.

## [1.1.19] - 2026-11-21

### Added
- Raw settings JSON textarea in Settings modal (edit settings.json directly with validation).

## [1.1.18] - 2026-11-21

### Fixed
- Settings modal inputs now reflect persisted values (controlled via `settingsCfg` state loaded on open).
- Added `defaultValue` binding for maxHistory, maxTokens, fallbackModels, includeMemories checkbox.

## [1.1.17] - 2026-11-21

### Fixed
- Added AbortSignal.timeout to embedding fetch in RAG memory injection.

## [1.1.16] - 2026-11-21

### Fixed
- Fixed duplicate `const s` declaration in `/api/agent` (SyntaxError that broke all tests).
- Renamed shadowed variable in RAG memory injection.

## [1.1.15] - 2026-11-21

### Added
- Model fallback: `fallbackModels` setting + retry logic in `runAgent` (tries next model on failure).
- Cost reduction: history truncation (`maxHistory`), `maxTokens` cap, RAG memory injection (`includeMemories`), all configurable in Settings.

## [1.1.14] - 2026-11-21

### Fixed
- Rate limiter now only trusts `X-Forwarded-For` from loopback peers (prevents IP spoofing).
- Rate limiter strict-path matching now uses exact endpoint list (no false positives).
- `run_command` now blocks newlines (defense-in-depth).

## [1.1.13] - 2026-11-21

### Added
- Optional, opt-in rate limiter (`AEGISAI_RATE_LIMIT`, default 0 = off). Loopback always exempt; stricter limits on auth/expensive endpoints; `Retry-After` + `X-RateLimit-*` headers.

## [1.1.12] - 2026-11-21

### Fixed
- `run_command` on Windows now passes the whole guarded command string to the shell, preserving quoted arguments with spaces.

## [1.1.11] - 2026-11-21

### Fixed
- Removed unused `server/tools/registry.js` skeleton.
- `App.jsx` `send()` now adds a fallback when the stream ends without a `done` event.

## [1.1.10] - 2026-11-21

### Fixed
- Added `process.on('uncaughtException'/'unhandledRejection')` handlers that log to `error.log` (improves crash diagnostics).

## [1.1.9] - 2026-11-21

### Fixed
- `App.jsx` `send()` now handles `tool_result` SSE events (surfaces tool results in UI).
- `App.jsx` `useEffect` now cleans up on unmount (prevents stale state updates).
- `/api/skills/run` rejects skill code larger than 100 KB.
- `/api/memory/extract` and `/api/squeeze` now pass a 60s abort signal to the backend.

## [1.1.8] - 2026-11-21

### Fixed
- Ghidra `probePort` now requires HTTP 2xx/3xx (reduces false positives).
- `awesome-re` refresh now has a 30s socket timeout.
- `run_command` uses a quote-aware splitter for arguments with spaces.
- `read_file` detects binary files (null bytes) and reports size instead of crashing.
- `/api/model-search` HuggingFace fetch now has a 15s timeout and 2 MB size cap.
- `launcher.vbs` guards against quote injection in installation paths.
- `isCleanRoomBlocked` regex tightened (v1.1.6) — fewer false positives.
- Stale `public/index.html` build artifact documented (regenerated by `npm run build`).

## [1.1.7] - 2026-11-21

### Fixed
- `/api/skills/run` now provides a `print` shim so default skills (which use `print()`) execute correctly.
- `/api/error-log` read capped to last 100 KB.

## [1.1.6] - 2026-11-21

### Fixed
- `db.rowToMemory`/`getChat` no longer 500 on corrupt JSON rows (graceful fallback).
- `isCleanRoomBlocked` regex tightened to keyword-boundary matching (fewer false positives).

## [1.1.5] - 2026-11-21

### Fixed
- Frontend now attaches `AEGISAI_TOKEN` from localStorage to all API requests (enables Docker/token-protected deployments).
- Settings modal gains an "Auth token" input.
- `awesome-re` refresh now follows HTTP redirects.

## [1.1.4] - 2026-11-21

### Fixed
- `run_command` now uses a shell on Windows so `.cmd` shims (npm, npx, ...) execute; metacharacter guard retained.
- `isSafeUrl` now rejects IPv6 link-local/ULA/multicast/unspecified and IPv4-mapped addresses.

## [1.1.3] - 2026-11-21

### Fixed
- Ghidra install-mcp now extracts the extension into `Ghidra/Extensions` (previously extracted to a throwaway dir and searched for `ghidraRun`, so the extension was never installed).
- `integrations.available()` no longer breaks `/api/agent` if one integration throws.
- `list_files`/`delete_file` no longer 500 on missing paths; `read_file` rejects files >2MB.
- `checkAuth` uses timing-safe comparison.
- Ollama calls no longer use `shell: true` (removes env-controlled binary injection surface).
- `run_command`/`search_files` robustness (unchanged behavior).

## [1.1.2] - 2026-11-21

### Fixed
- Install endpoints now follow HTTP redirects and reject non-200 responses (craft rustup, craft prebuilt binary, Ghidra MCP zip).
- macOS/Linux installer scripts: corrected version to 1.1.2 and build with dev deps so `vite` is available.
- Added `.dockerignore` (excludes node_modules, .git, data, build artifacts).
- Windows installer: uses a real `.ico` icon and installs `launcher.vbs`.
- `launcher.vbs` honors `PORT` instead of hardcoding 8080.
- Agent `toolBudget` is clamped to a positive integer.
- `/api/rag/search` `limit` is clamped to 0-100.
- README security wording updated; removed obsolete `version` key from docker-compose.

## [1.1.1] - 2026-11-21

### Fixed
- `package-lock.json` version desynced from `package.json`.
- SSE error path: agent exceptions now emit an `error` event instead of hanging the UI; client disconnect aborts the run; 30-minute deadline added.
- Streamed tool calls are merged by index instead of overwritten (fixes fragmented arguments on OpenAI-compatible backends).
- REA tools now respect the tool budget.
- `/api/agent` validates `messages` is an array; `/api/backend` validates the URL scheme and rejects embedded credentials.
- Server fails fast if the database cannot be opened.

### Changed
- README: corrected installer version, `server.js` line count, and Docker token instructions.

## [1.1.0] - 2026-11-21

### Fixed
- Docker image build failed (`npm ci --omit=dev` then `npm run build`); now builds with dev deps then prunes.
- Fresh clone served a blank page; added `npm run build` to Quick Start.
- REA tools never reached the model; wired into agent tool definitions.
- Awesome-RE search tool was unreachable (shadowed by simulated branch); reordered.
- Editing a memory silently wiped its embedding; now preserved.
- SQLite "database is locked" under concurrent opens; added `busy_timeout`.
- `/api/squeeze` SSRF hole; added `isSafeUrl` guard.
- Ghidra MCP install path traversal / shell injection; validated asset name and dropped shell.
- Integration configure could set arbitrary env vars; added allowlist.
- `/api/agent` now streams over SSE; frontend consumes the stream.
- Service worker registration re-enabled.
- Server refuses non-loopback bind without an auth token.
- `search_files` ReDoS mitigations (pattern length, file/line size caps, invalid regex).
- `serveStatic` and citation rendering no longer crash on malformed input.

### Changed
- README: dropped inaccurate "SSE streaming" wording (now accurate), added build step.
- docker-compose requires `AEGISAI_TOKEN`.

### Added
- `static/icon.svg` PWA icon.