# Changelog

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