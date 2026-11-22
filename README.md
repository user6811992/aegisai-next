> [!CAUTION]
> **DEPRECATED.** This project (`aegisai-next`) is deprecated and no longer actively maintained.
> All features have been ported to and superseded by [`aegisai-harness`](https://github.com/user6811992/aegisai-harness),
> which is now the primary, actively developed project. Please migrate to `aegisai-harness`.

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
- **Agent tool-call loop** — automatic tool execution with streaming responses
- **Capability-based security** — scope MCP tools per session (allowedTools/deniedTools)
- **Clean room mode** — AI works only from observable behavior
- **Tool budget** — configurable (default 64 tools per request)
- **Web search** — DuckDuckGo integration
- **Voice** — speech-to-text (mic) and text-to-speech (speaker) via Web Speech API

### Agent Orchestration & Evaluation
- **Bug-hunting pipeline** — bug-hunting skill, disclosed-vulnerability pattern library, `hunt` tools (`hunt_start`, `hunt_vuln_search`, `hunt_report`), wave orchestration (recon → probe → verify → **patch** → report) and persisted reports
- **Dependency patch proposals** — `patch_propose` generates a dry-run `package.json` version bump (diff only) for verified findings; `dryRun:false` applies it with path validation
- **CVE reachability** — `cve_scan` (or `POST /api/security/cve-reachability`) queries OSV for this project's npm dependencies, reports only reachable advisories and proposes dependency-only fixes; pass `seed` advisories for offline analysis
- **Long-horizon tasks** — goal → plan → execute → verify → deliver phase driver with sandbox URL/target guards
- **Swarm orchestration** — fan-out across subtasks with per-subtask retry, cancellation/timeout and tool-budget overrides
- **Always-on runtime** — persistent sessions with a durable SQLite inbox/outbox, restart restore, per-session isolation policy, approval gates for high-risk jobs, and interval/one-shot timers
- **Delivery channels** — in-memory event stream and SSRF-guarded webhook fan-out for runtime lifecycle events
- **Speed benchmark** — repeat tasks through the local agent and report median latency/success rate as Markdown or JSON
- **Always-on evaluation** — HALO-style Sensing/Memory/Action connectivity checks with a with/without-learning ablation

### Memory & Skills
- **Memory panel** — add/delete durable facts with embedding search (RAG)
- **Memory auto-extract** — LLM extracts facts from conversations
- **Skills panel** — add/delete/run custom skills
- **RAG search** — cosine similarity search over memories
- **RAG reindex** — re-embed all memories with current model
- **Markdown mirror** — memories export to `data/memories.md`; import via `POST /api/memory/markdown/import`
- **Sleep consolidation** — `POST /api/memory/consolidate` merges near-duplicate facts and rewrites the Markdown mirror; a scheduler runs this automatically every 24h (override with `AEGISAI_CONSOLIDATION_INTERVAL_MS`) and is controlled via `/api/memory/consolidation/{status,start,stop,run}`; `GET /api/memory/search?q=&limit=` provides ranked local retrieval without embeddings
- **Skill evaluation gates** — `GET /api/skills/evaluate` scores every skill and MCP tool descriptor on quality, security scanning and harness compatibility, returning pass/warn/fail with reasons; `POST /api/skills/evaluate` with `{"name":"..."}` checks one skill (or `mcp:<tool>`)

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
- **MCP client** — spawn configured MCP servers (e.g. Filesystem, Git, Fetch, Memory) and expose their tools to the agent as `mcp_<id>__<tool>`; configure under `mcpServers` in `data/integrations.json`:
  ```json
  { "mcpServers": [{ "id": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/allowed"] }] }
  ```
  On Windows use `"command": "cmd", "args": ["/c", "npx", ...]`. Only `npx`, `uvx`, `node`, `python`/`python3` (or absolute paths to those executables) are accepted; no arbitrary shell commands.
- **Streamable HTTP MCP servers** — use `{"id":"remote","url":"http://127.0.0.1:3001/mcp"}` instead of `command`/`args`. Loopback URLs are allowed for locally hosted servers; public URLs must pass the SSRF guard, and credentials in URLs are rejected.
- **External search bridge** — mark an MCP server with `"role":"search"` (or use a tool whose name contains search/query/find) and the agent gains a unified `search_external` tool that fans out across those servers. For a local [xerj](https://github.com/xerj-org/xerj) index, point its Streamable HTTP endpoint at it:
  ```json
  { "mcpServers": [{ "id": "xerj", "url": "http://127.0.0.1:3001/mcp", "role": "search" }] }
  ```
- **Registry browser** — `GET /api/integrations/mcp/registry?query=&limit=&cursor=` searches [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io) (60s cache, `MCP_REGISTRY_URL` overrides the endpoint). `POST /api/integrations/mcp/registry/install` with `{"name":"<registry name>","version":"<optional>","id":"<optional>"}` re-fetches the entry and installs a validated spec. Only npm/pypi package identifiers and safe remote URLs are accepted — registry entries are third-party and untrusted.
- **Curated presets** — `POST /api/integrations/mcp/presets` with `{"presets":["fs","git","fetch","memory","seq","time"],"root":"<project>"}` installs safe configurations for the official reference servers. Filesystem is pinned to the validated project root, Git tools are filtered to read-only names, and every MCP tool call has its URL/path arguments re-checked against the SSRF/path guards.
- **Pending actions** — human-in-the-loop approve/reject
- **Version checking** — check AegisAI, Node, Ollama, REA versions
- **Error log viewer** — view server error log

### MCP server (for external coding agents)
- **stdio MCP server** — `npm run mcp` exposes `aegisai_health`, `aegisai_agent`, `aegisai_hunt`, `aegisai_task` and `aegisai_swarm` to Claude Code, OpenCode, Codex or any MCP client
- **Scoped by default** — tools that run the agent require `AEGISAI_PROJECT_ROOT` and validate it against `AEGISAI_PROJECT_ROOT_ALLOWLIST`; stdio is reserved for the protocol (all diagnostics go to stderr)

Example MCP client config:

```json
{
  "mcpServers": {
    "aegisai": {
      "command": "node",
      "args": ["C:/path/to/aegisai-next/mcp-server.js"],
      "env": {
        "AEGISAI_PROJECT_ROOT": "C:/path/to/allowed/project",
        "AEGISAI_PROJECT_ROOT_ALLOWLIST": "C:/path/to/allowed/project"
      }
    }
  }
}
```

### Infrastructure
- **PWA** — installable as progressive web app
- **Mobile-friendly** — safe-area insets, responsive
- **Dark theme** — default dark UI
- **Docker** — Dockerfile + docker-compose.yml
- **No telemetry** — zero phone-home
- **Security** — token auth, path traversal protection, URL validation on user-supplied fetches, shell-safe process spawning

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
npm run build
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
| `AEGISAI_RATE_LIMIT` | Rate limit (req/min per IP; 0 = off) | 0 |
| `AEGISAI_RATE_WINDOW` | Rate limit window (seconds) | 60 |
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

`server.js` is wiring only (~890 lines). Each module is independently testable.

## Docker

```bash
docker compose up -d
```

Starts Ollama (port 11434) + AegisAI (port 8080). Data persists in named volumes. Set `AEGISAI_TOKEN` before starting — the container binds `0.0.0.0` and the server refuses to start without a token:

```bash
AEGISAI_TOKEN=your-strong-secret docker compose up -d
```

## Installer (Windows)

Requires [Inno Setup 6](https://jrsoftware.org/isinfo.php):

```powershell
.\installer\build.ps1
```

Output: `installer/output/AegisAI-Next-Setup-<version>.exe` (version is read from `package.json` at build time)

Automated builds: the **Windows installer** workflow compiles the setup on a Windows runner for every published release, verifies the output, and attaches the `.exe` to that release. It can also be run manually from the Actions tab to attach an installer to an existing tag.

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

Programmatic helpers are exported from `server.js` for integrations: `runAgent`, `runHunt`, `task`, `swarm`, `createRuntime`, `restoreRuntime`, `createDelivery`, `createEventChannel`, `createWebhookChannel`, `createRuntimeApprovalGate`, `createTimerScheduler`, `runBenchmark`, `createLocalAgentRunner`, `exportReport` and `evaluateAlwaysOn`.

See `aegisai_next_roadmap.md` for the feature roadmap and milestone status.

## License

MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

### Prior art & inspiration
The agent capabilities added in v1.1.54–v1.1.56 were informed by the public descriptions and feature sets of these projects. No source code or assets were copied from them; AegisAI (next) remains MIT-licensed.

- **Bug hunting (F1)** — [elementalsouls/Claude-BugHunter](https://github.com/elementalsouls/Claude-BugHunter), [h4ckologic/bughunter-ai](https://github.com/h4ckologic/bughunter-ai), [pikpikcu/airecon](https://github.com/pikpikcu/airecon), [H-mmer/pentest-agents](https://github.com/H-mmer/pentest-agents), [awarexone/Agentic-Bug-Hunter](https://github.com/awarexone/Agentic-Bug-Hunter)
- **Agent harnesses & long-horizon tasks (F2)** — [bytedance/deer-flow](https://github.com/bytedance/deer-flow), [ruvnet/ruflo](https://github.com/ruvnet/ruflo), [zhayujie/CowAgent](https://github.com/zhayujie/CowAgent), [langchain-ai/deepagents](https://github.com/langchain-ai/deepagents), [openai/openai-agents-python](https://github.com/openai/openai-agents-python)
- **Always-on runtime (F6 / F8)** — [diggerhq/opencomputer](https://github.com/diggerhq/opencomputer), [diggerhq/opendots](https://github.com/diggerhq/opendots), [nanocoai/nanoclaw](https://github.com/nanocoai/nanoclaw), [ShenSeanChen/waku-agent](https://github.com/ShenSeanChen/waku-agent), [bubbleptr/aoa](https://github.com/bubbleptr/aoa)
- **Benchmarks & evaluation (F7 / F8-4)** — [diggerhq/speedbench](https://github.com/diggerhq/speedbench), [Always-On-Intelligence/HALO](https://github.com/Always-On-Intelligence/HALO)
- **Memory & self-evolution ideas (parked)** — [volcengine/OpenViking](https://github.com/volcengine/OpenViking), [openmemind/memind](https://github.com/openmemind/memind), [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory)

### Tooling & dependencies

- [Ollama](https://ollama.com) — local LLM runtime
- [morluto/rea](https://github.com/morluto/rea) — reverse engineering agent (255 tools)
- [symgraph/GhidrAssistMCP](https://github.com/symgraph/GhidrAssistMCP) — Ghidra MCP extension
- [storytold/craft-anything](https://github.com/storytold/craft-anything) — RE toolkit
- [alexgaoth/awesome-reverse-engineered](https://github.com/alexgaoth/awesome-reverse-engineered) — 17,000+ RE projects index
- [Preact](https://preactjs.com) + [Tailwind CSS](https://tailwindcss.com) + [Vite](https://vitejs.dev)