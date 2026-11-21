# Changelog

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