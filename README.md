# AegisAI (next)

![Version](https://img.shields.io/github/v/release/user6811992/aegisai-next) ![License](https://img.shields.io/github/license/user6811992/aegisai-next)

A local-first AI web UI powered by [Ollama](https://ollama.com) (and other OpenAI-compatible backends). Privacy-first: no telemetry, no cloud, no third-party CDN loads. Reverse-engineering tooling is optional and plugin-based.

This is the **next-generation** codebase — a ground-up modular rebuild of [AegisAI](https://github.com/user6811992/LocalAI).

## Features

### Core
- **Chat UI** — responsive web interface with thinking-block display, Markdown rendering, dark theme
- **Model management** — pull models from Ollama, quick-pull recommended models, scan drives for GGUF/Ollama stores
- **Multi-backend** — Ollama, llama.cpp, LM Studio, Strata, OpenAI-compatible
- **Conversation branching** — fork any chat at any message point
- **Auto-save** — chats persist automatically
- **Export/import** — full backup as JSON

### AI & Agents
- **Agent tool-call loop** — automatic tool execution with SSE streaming
- **Capability-based security** — scope MCP tools per session (allowedTools/deniedTools)
- **Clean room mode** — AI works only from observable behavior
- **Tool budget** — configurable (default 64 tools per request)
- **Web search** — DuckDuckGo integration
- **Voice** — speech-to-text (mic) and text-to-speech (speaker) via Web Speech API

### Memory & Skills
- **Memory panel** — add/delete durable facts with embedding search (RAG)
- **Memory auto-extract** — LLM extracts facts from conversations
- **Skills panel** — add/delete/run custom skills
- **RAG search** — cosine similarity search over memories
- **RAG reindex** — re-embed all memories with current model

### Reverse Engineering (optional)
- **REA MCP** — 255 RE tools (binaries, JS/Electron, Android, firmware, etc.)
- **Ghidra** — auto-detect + install GhidrAssistMCP extension
- **Craft Anything** — install from GitHub (requires Rust)
- **Awesome-RE** — searchable index of 17,000+ reverse-engineered projects
- **Squeeze tool** — read long docs/URLs and extract answers

### Integrations & Settings
- **Integration status** — view ready/off status for all integrations
- **Install buttons** — install REA, Craft, Ghidra MCP from UI
- **Configure** — set env vars from UI (persisted to data/integrations.json)
- **Backend switcher** — change backend type/URL at runtime
- **Pending actions** — human-in-the-loop approve/reject
- **Version checking** — check AegisAI, Node, Ollama, REA versions
- **Error log viewer** — view server error log

### Infrastructure
- **PWA** — installable as progressive web app
- **Mobile-friendly** — safe-area insets, responsive
- **Dark theme** — default dark UI
- **Docker** — Dockerfile + docker-compose.yml
- **No telemetry** — zero phone-home
- **Security** — token auth, path traversal protection, SSRF guard, shell-safe process spawning

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org) 22.5+
- **One** AI backend:
  - [Ollama](https://ollama.com/download) (recommended), **or**
  - Any OpenAI-compatible endpoint

### Install & Run

```bash
git clone https://github.com/user6811992/aegisai-next.git
cd aegisai-next
npm install
npm start
```

Open http://127.0.0.1:8080 in your browser.

### Optional: Pull a model

```bash
ollama pull llama3.2:3b
```

Or use the **Models** tab in the web UI.

## Environment Variables

| Var | Purpose | Default |
|---|---|---|
| `PORT` / `HOST` | Bind address | 127.0.0.1:8080 |
| `LOCALAI_TOKEN` / `AEGISAI_TOKEN` | Auth token (open mode if unset) | (none) |
| `AEGISAI_DATA_DIR` | Data directory | ./data |
| `AEGISAI_PROJECT_ROOT_ALLOWLIST` | Allow-list for agent project roots | (none) |
| `AEGISAI_TOOL_BUDGET` | Agent tool budget | 64 |
| `AEGISAI_MAX_BODY` | Max request body bytes | 100MB |
| `BACKEND_TYPE` | Backend type | auto-detect |
| `BACKEND_URL` / `OLLAMA_URL` | Backend URL | auto-detect |
| `BACKEND_API_KEY` | API key for authenticated backends | (none) |
| `STT_URL` / `TTS_URL` | Voice backend URLs | (none) |
| `GITHUB_TOKEN` | Higher GitHub API rate limits | (none) |
| `GHIDRA_MCP_URL` | GhidrAssistMCP endpoint | auto-detect |
| `CRAFT_BIN` | Path to craft-anything-cli | auto-detect |
| `REA_BIN` | Path to rea binary | auto-detect |

## Architecture

```
server/
  core/          config, security, capabilities
  storage/       SQLite persistence (chats, memories, skills), settings, integrations config
  backends/      multi-backend adapter (Ollama + OpenAI-compat)
  tools/         coding tools, tool registry
  agent/         tool-call loop
  integrations/  plugin contract + REA/Ghidra/Craft/voice/awesome-re
src/             Preact + Tailwind GUI
static/          PWA manifest, service worker
public/          build output (served by Node)
tests/           20 tests (security, http, agent, wave4)
```

`server.js` is wiring only (~500 lines). Each module is independently testable.

## Docker

```bash
docker compose up -d
```

Starts Ollama (port 11434) + AegisAI (port 8080). Data persists in named volumes.

## Installer (Windows)

Requires [Inno Setup 6](https://jrsoftware.org/isinfo.php):

```powershell
.\installer\build.ps1
```

Output: `installer/output/AegisAI-Next-Setup-1.0.0.exe`

## Installer (macOS)

Requires `create-dmg` (`brew install create-dmg`):

```bash
bash installer/build-dmg.sh
```

## Installer (Linux)

Requires `appimagetool`:

```bash
bash installer/build-appimage.sh
```

## Development

```bash
npm run dev      # Vite dev server (proxies /api to :8080)
npm run build    # Build to public/
npm start        # Start server
npm test         # Run tests
```

## License

MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Ollama](https://ollama.com) — local LLM runtime
- [morluto/rea](https://github.com/morluto/rea) — reverse engineering agent (255 tools)
- [symgraph/GhidrAssistMCP](https://github.com/symgraph/GhidrAssistMCP) — Ghidra MCP extension
- [storytold/craft-anything](https://github.com/storytold/craft-anything) — RE toolkit
- [alexgaoth/awesome-reverse-engineered](https://github.com/alexgaoth/awesome-reverse-engineered) — 17,000+ RE projects index
- [Preact](https://preactjs.com) + [Tailwind CSS](https://tailwindcss.com) + [Vite](https://vitejs.dev)