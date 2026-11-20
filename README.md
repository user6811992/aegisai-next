# AegisAI (next)

Modular rebuild of [AegisAI](https://github.com/user6811992/LocalAI) — a local-first AI web UI
powered by Ollama (and other OpenAI-compatible backends). Privacy-first: no telemetry, no cloud,
no third-party CDN loads. Reverse-engineering tooling is optional and plugin-based.

This repository is the **next-generation** codebase. The legacy monolith remains at `LocalAI`.

## Status

- **v1.0.0** — all waves complete.
- Wave 0: scaffold, security primitives, SQLite storage, integration/tool-registry contracts.
- Wave 1: backend adapter, coding tools, agent loop, SSE route.
- Wave 2: Vite + Preact + Tailwind GUI shell (chat, model select, settings).
- Wave 3: integration plugins (REA, Ghidra, Craft, voice, awesome-re), capability security, status UI.
- Wave 4: memory/skills/branching panels, export/import backup, stats, settings, RAG reindex stub.

## Quick start

```bash
npm install
npm test
npm start
```

Open http://127.0.0.1:8080.

## Environment

| Var | Purpose |
|---|---|
| `PORT` / `HOST` | bind address (default 127.0.0.1:8080) |
| `LOCALAI_TOKEN` / `AEGISAI_TOKEN` | auth token (open mode if unset) |
| `AEGISAI_DATA_DIR` | data directory (default ./data) |
| `AEGISAI_PROJECT_ROOT_ALLOWLIST` | allow-list for agent project roots |
| `AEGISAI_TOOL_BUDGET` | agent tool budget (default 64) |
| `AEGISAI_MAX_BODY` | max request body bytes |

## Architecture

```
server/
  core/          config, security (runProcess, safePath, ...)
  storage/       SQLite persistence (chats, memories, skills)
  tools/         tool registry + budget policy
  integrations/  plugin contract for optional deps (REA, Ghidra, Craft, ...)
  backends/      backend adapters (wave 1)
```

`server.js` is wiring only.

## License

MIT (see legacy project).
