# aegisai_next_roadmap

Roadmap for **AegisAI (next)** — the local-first AI agent product at `github.com/user6811992/aegisai-next`.

- **Status:** draft — created 2026-11-21 from live GitHub ecosystem exploration
- **Scope:** feature candidates to add to `aegisai-next`

> Note: the AegisAI **Harness** roadmap lives at `../aegisai-harness/ROADMAP.md`. That is a different program; this roadmap is for the product.

## Discovery sources for this pass

1. `https://github.com/search?q=bughunter&type=repositories` (page 1)
2. `https://github.com/search?q=bughunter&type=repositories&p=2` (page 2)
3. `https://github.com/search?q=ai+agent+harness&type=repositories&p=1` (page 1)

## Feature candidates worth adding

### F1 — Autonomous bug-hunting pipeline (top pick)

- [ ] Candidate scope: recon → target discovery (dorking) → probe (Burp/scanner) → verify → report
- **Sources:** elementalsouls/Claude-BugHunter (15.9k★, 82 skills / 681 disclosed-report patterns / 24 vuln classes), thehackingsage/bughunter (252★, dork discovery + scanning), google/bughunters (331★, bughunters.google.com), devanshbatham/Gorecon (287★, recon swiss-kid), iamunixtz/Lazy-Hunter (238★, Shodan/CVE recon), h4ckologic/bughunter-ai (101★, 20-agent autonomous bounty framework + Burp Suite MCP, `hunt target.com`), KingOfBugBounty/KingOfBugBountyTips (5.6k★, methodology/tips content)
- **Fit:** `aegisai-next` already ships security core, awesome-re/REA integration, local vuln scan, agent loop + tool execution.
- **First milestone:** security skill pack + disclosed-report pattern library + `hunt` agent team + report generation.

### F2 — Long-horizon / multi-agent task orchestration

- **Sources:** bytedance/deer-flow (85.6k★, long-horizon SuperAgent: sandboxes/memories/tools/skills/subagents), ruvnet/ruflo (82.2k★, swarms, autonomous workflows, federation, adaptive memory), openai/openai-agents-python (30.8k★), MemTensor/MemOS (12.5k★, self-evolving memory, −35% tokens), omnigent-ai/omnigent (11.5k★, meta-harness, harness swapping, policies), strands-agents/harness-sdk (9.3k★), EverMind-AI/Raven (6.3k★, harness of harnesses), ModelEngine-Group/nexent (6.2k★, zero-code agent generation)
- **Fit:** product is currently single-agent, chat-centric; ecosystem has moved to long-horizon tasks + multi-agent swarms.
- **First milestone:** task substrate — goal → plan → agent waves → sandboxed execution → verification → delivery.

### F3 — Self-evolving memory + token efficiency

- **Sources:** rohitg00/agentmemory (30.5k★, persistent memory for coding agents), MemTensor/MemOS (12.5k★, self-evolving memory, hybrid retrieval, cross-task skill reuse), ruvnet/ruflo (82.2k★, adaptive memory)
- **Fit:** memory persistence exists; self-evolution, skill reuse, retrieval scoring missing.

### F4 — Agent observability & enforcement

- **Sources:** FailproofAI/failproofai (10k★, run capture, policy enforcement, reliability); adjacent to existing metrics/audit/rate-limit.
- **Fit:** run capture + policy gate in front of consequential actions is high-value.

### F5 — Always-on personal assistant / delivery channels

- **Sources:** nanocoai/nanoclaw (31k★, always-on, containerized agents, Slack/TG/WA/Discord), zhayujie/CowAgent (48k★, personal assistant, multi-channel), the-open-agent/openagent (5.8k★, personal AI + RAG + computer-use), phone-harness/phone-harness (5.4k★, agent controls phone)
- **Fit:** product-direction candidate.

### F6 — Agent runtime / always-on execution platform (OpenComputer-style) — NEW (from diggerhq, 2026-11-21)

- **Sources:** diggerhq/opencomputer (⭐1.1k, Apache-2.0, TypeScript, "An open-source, faster Devin alternative"), diggerhq/opendots (⭐28, MIT, TS, "always-on personal agent you own, on the model you choose… alternative to OpenAI's Dots"), diggerhq/openmuse (⭐61, TS, deployable personal assistant), diggerhq/opencomputer-native-coder (⭐1, TS, agentic software factory template), diggerhq/shipvideo (⭐386, TS, agent-rendered launch video)
- **Key findings:** agent works in Slack / on its own computers / in your cloud or yours; result lands as a PR. Architecture: gateway + Calvin bridge (Slack events → session with Claude Code / Codex / OpenCode) → session isolation via rootless Podman on a single VM locked to outbound-only network → git-backed state store. Always-on personal agent, model-agnostic alternative to OpenAI's Dots.
- **Fit:** directly complements F2 task substrate (landed) + F5 always-on assistant; unblocks autonomous "agent works while you sleep" execution.
- **Feasibility:** high (always-on runtime core + task loop); medium (rootless-container sandbox wiring); high (Slack delivery path).
- **First milestone:** always-on agent runtime core (gateway/loop, session isolation, git-backed persistence) + delivery channel wiring.

### F7 — Agent speed benchmark harness (diggerhq/speedbench) — NEW (from diggerhq, 2026-11-21)

- **Source:** diggerhq/speedbench (⭐1, TS, "A speed benchmark of cloud coding agents") — measures how fast coding agents ship small real changes from Slack (fixtures: small TS apps pinned to zod 4.0.0; dep bump → run checks → open PR; time from Slack message ts → first push / last PR open / CI green; 5 runs median).
- **Fit:** evaluation capability for local vs cloud agent performance; feeds F4 observability/eval.
- **Feasibility:** medium.

## Parked (content, not engine)

- XSS-Payloads (222★), andripwn/PayloadsAll (50★), alihussainzada/BugHunterMethodology (177★), bhavesh-pardhi/Bughunters-Arsenal (14★), kh4sh3i/security-mindmap (58★), dorkerdevil/HackNotes (3★) — candidate library / skill content.

## Explicitly deferred (tracked in the harness roadmap)

- In-process model loading, microVM/K8s/eBPF sandboxing, Rust SDK, deterministic durable execution, multi-tenant isolation.

## F1 — Autonomous bug-hunting pipeline: implementation plan (draft)

### Context
`aegisai-next` already ships the security core, awesome-re/REA integration, local vuln scan, and the agent loop (`server/agent/run.js`), but has no hunt orchestration layer, no disclosed-pattern library, and only `are_*`/`rea_*` external tools wired.

### Proposed v1 design
1. Security skill pack — extend default skills (`server/storage/default-skills.js`) with a Bug Hunting skill (recon → discovery → probe → verify → report; safety constraints).
2. Disclosed-pattern library — new module (e.g. `server/storage/vuln-patterns.js`) seeded from Claude-BugHunter's curated patterns (24 vuln classes / 681 disclosed-report patterns).
3. Hunt integration — new `server/integrations/hunt.js` exposing tools (`hunt_start`, `vuln_search`, `hunt_report`) with `{src:'hunt', tool}` namespacing.
4. Loop dispatch — teach `runAgent` the `hunt_` external namespace (dispatch to hunt integration `callTool`); add `hunt` prefix to external-tool budget predicate; keep clean-room semantics.
5. Safety — reuse `security.isSafeUrl`, `security.runProcess` (execFile, no shell), `security.validateProjectRoot`/`safePath`, `security.downloadToFile` for any fetch/scan steps.
6. Reporting — `hunt_report` renders markdown; findings persist via storage/memory.

### Issue breakdown (proposed)
- [x] H1: Bug-hunting skill pack content + wiring — `bug-hunting` skill added to `DEFAULT_SKILLS`; auto-wired via `ensureDefaultSkills`.
- [x] H2: Disclosed-pattern library module + seed data — `server/storage/vuln-patterns.js` created (VULN_CLASSES + PATTERNS + searchPatterns); `node --check` pass.
- [ ] H3: Hunt integration module + tool defs — CREATED `server/integrations/hunt.js` (start/vuln_search/report); registered, wired into ext + agent dispatch + budget; `node --check` pass, tests 33/33 pass.
- [x] H4: Agent-loop dispatch for `hunt_` + budget handling — dispatch + budget wiring landed; added `runHunt` wave driver (recon → probe → verify → report, stops on `hunt_report`); `/api/agent` branches on `body.hunt.target`. `node --check` pass; re-running test suite.
- [x] H5: Report persistence / surfacing — `hunt_report` now persists to hunt session + reports store; added `list` tool (`hunt_list`) for surfacing. `node --check` pass; re-running suite.
- [x] H6: Tests (dispatch, budget, clean-room, patterns) — added `tests/hunt.test.js` (pattern search, hunt dispatch, clean-room block, runHunt wave stop); full suite now 37/37 pass, `node --check` clean.

### Acceptance criteria (v1)
- Given a target, the agent can run a multi-step hunt within budget using safe primitives.
- Pattern library is searchable.
- Security guards hold.

## F2 — Long-horizon / multi-agent task orchestration: implementation plan (draft)

### Context
`aegisai-next` agent loop (`server/agent/run.js`) is currently single-agent/chat-centric; wave orchestration exists only for the bug-hunt flow (`runHunt`). Ecosystem (bytedance/deer-flow, ruvnet/ruflo, openai/openai-agents-python, MemTensor/MemOS, omnigent-ai/omnigent, strands-agents/harness-sdk) has converged on goal → plan → execute → verify → deliver and multi-agent swarms.

### First milestone: task substrate
1. Task phase driver — generalize the wave loop (`runHunt`) with pluggable `phases` + `phasePrompt` (defaults preserve hunt behavior).
2. Task runner — new `server/agent/task.js` with `runTask` + `TASK_PHASES = ['plan', 'execute', 'verify', 'deliver']`.
3. API — `/api/agent` branches on `body.task.goal` → task runner.

### Issue breakdown (proposed)
- [x] F2-1: Task phase driver generalization (`phases` + `phasePrompt` pluggable) — landed in `runHunt`; suite green.
- [x] F2-2: `runTask` + task phase prompts — landed (`server/agent/task.js`); task branch wired in `/api/agent`; exported.
- [x] F2-3: Task orchestration tests — added `runTask drives task phases plan->execute->verify` test; task/swarm/sandbox tests added; full suite now 43/43 pass.
- [x] F2-4: Sandbox integration for task steps (reuse `security` guards) — task.js now requires `../core/security`; adds `sandboxTaskContext` + `sandboxTaskStep` (URL checks via `security.isSafeUrl`); `runTask` blocks on unsafe task context; tests added.

### Acceptance criteria (v1)
- Given a goal, the agent can run plan → execute → verify → deliver within wave budget.
- Security guards hold for task steps.

## Next actions

- [x] F1 milestone close-out: H1–H6 complete (tests 38/38 pass including task tests; `node --check` clean).
- [x] F2 task substrate landed: phase driver generalization + `runTask` + `/api/agent` task branch + task orchestration tests (suite 38/38 pass).
- [x] F2-4 landed: task sandbox integration (security guards reuse, unsafe task context/step blocking; suite now 40/40 pass).
- [x] F2-5 landed (first milestone): multi-agent swarm orchestration — `server/agent/swarm.js` `runSwarm` added (subtasks via explicit list or plan, bounded concurrency), `/api/agent` swarm branch + export wired, fan-out + plan-driven tests added; full suite now 43/43 pass.
- [x] F2-5 follow-up landed: per-subtask policy overrides (model/cleanRoom/toolBudget via subtask spec) in `runSwarm`; `node --check` clean on tests/hunt.test.js; suite re-run in background.
- [x] F2-5a landed: explicit subtask-level retry policy — `resolveRetries(st, perTask)` helper (subtask > perTask > 0, invalid values fall through), retry loop uses it, per-result `attempts` recorded; new unit test covers priority resolution; suite 45/45 pass.
- [x] F2-5b landed: swarm cancellation/timeout — `createSwarmSignal(opts)` combines caller `signal` with `timeoutMs` (first abort wins), worker loops + retry loop check aborted state, signal forwarded to `runTask`, per-result `cancelled` flag + final-report note, cleanup on completion; `/api/agent` swarm branch forwards `body.swarm.timeoutMs`; two new tests; suite 47/47 pass.
- [x] F2-5c landed: subtask budget propagation — `resolveBudget(st, perTask, opts)` flows swarm-wide → perTask → per-subtask (most specific wins), injected into task opts and recorded per result; 3 new tests (priority, override integration, swarm-wide fallback); suite 50/50 pass.
- [x] F2-5: Multi-agent swarm orchestration — complete through F2-5a (retry policy), F2-5b (cancellation/timeout), F2-5c (budget propagation); suite 50/50 pass.
- [x] F6-1a landed: always-on runtime core — `server/runtime/always-on.js` `AlwaysOnRuntime` (persistent sessions, durable job queue, one-job-per-tick drain loop, injectable executor, start/stop interval, events); exported `createRuntime` from `server.js`; 6 new tests; suite 56/56 pass.
- [x] F6-1b landed: session isolation — `server/runtime/isolation.js` `createSessionPolicy` (root validated via security allow-list, cleanRoom/tool lists/maxJobs) + `checkJobAgainstPolicy` (unsafe job URLs and job-limit overflow blocked); wired into session creation, enqueue, and executor context; 3 new tests; suite 59/59 pass.
- [x] F6-1c landed: delivery wiring — `server/runtime/delivery.js` with in-memory event channel, SSRF-guarded webhook channel, and failure-isolating `createDelivery`; `AlwaysOnRuntime.emitEvent` forwards lifecycle events to delivery; delivery factories exported from `server.js`; 4 new tests; suite 63/63 pass.
- [ ] F6: Promote OpenComputer-style agent runtime / always-on execution platform into a milestone (F6-1 runtime core + delivery wiring first).
- [x] F7 landed (first milestone): local speed benchmark harness — `server/eval/speedbench.js` `runBenchmark` (task × N runs via injected runner, medians + success rate, injectable clock) + `median`; exported `runBenchmark` from `server.js`; 4 new tests; suite 67/67 pass.
- [x] F7b landed: local-agent runner + report export — `createLocalAgentRunner` wraps an injected `runAgent` (or `agentFn`) into a benchmark runner, `exportReport` renders markdown/JSON; exported from `server.js`; 2 new tests; suite 69/69 pass.
- [x] Ecosystem re-scan (2026-11-21, second pass) complete — new source page `.opencode/wiki/sources/agent-ecosystem-2026-11-21b.md`; seeded milestone F8 below.

## F8 — Durable always-on loop (new milestone, seeded 2026-11-21)

**Why:** F6-1 landed a runtime core (sessions, queue, delivery) but the ecosystem has converged on four things we do not have yet: a *durable* inbox/outbox, human approval gates, timers/schedules, and always-on evaluation. `ShenSeanChen/waku-agent` (2.2k★) names all four explicitly; `bubbleptr/aoa` implements the inbox+worker+SQLite pattern; HALO supplies the evaluation angle.

**Fit with existing code:** `AlwaysOnRuntime` (server/runtime/always-on.js) + `createDelivery` + `createSessionPolicy` are the base; `server/storage/db.js` already provides SQLite; `server.js` already has a `pendingActions` human-in-the-loop queue to reuse for approvals.

- [x] F8-1 landed — Durable inbox/outbox: new migration v4 (`runtime_sessions`, `runtime_jobs`, `runtime_outbox`), `server/runtime/durable.js` persistence/restore helpers, `AlwaysOnRuntime` `durable` option + `restore()`; db.js now exports `one`/`all`/`run`; 3 new tests; suite 72/72 pass.
- [x] F8-2 landed — Approval gate: `server/runtime/approval.js` (`requiresApproval` heuristics + `createApprovalGate` with polling decisions and timeout), wired into `AlwaysOnRuntime.tick` with `approvalRequired`/`approved`/`rejected` events; `server.js` exports `createRuntimeApprovalGate` backed by the existing pending-actions queue; 4 new tests; suite 76/76 pass.
- [x] F8-3 landed — Timers / scheduled jobs: `server/runtime/timers.js` `createTimerScheduler` (interval + one-shot, maxRuns, in-flight overlap guard, unref'd handles, cancel/cancelSession), wired into `AlwaysOnRuntime` via `scheduleJob`/`cancelTimer`/`destroySession`; durable session deletion added; 3 new tests; suite 79/79 pass. Timer definitions remain in-memory (persistence deferred).
- [x] F8-4 landed — Always-on evaluation (HALO-style): `server/eval/always-on-eval.js` `evaluateAlwaysOn` runs sense→remember→act pipelines over scenarios/rounds, reports stage rates and Sensing→Memory→Action connectivity, and measures `learningGain` via with/without-learn ablation; exported from `server.js`; 4 new tests; suite 83/83 pass. **F8 milestone complete.**

**Parked candidates (recorded, not scheduled):**
- Sandbox policy from plain-English constitutions (`provos/ironcurtain`, `nolabs-ai/nono`, `perplexityai/SPACE`) — extend `isolation.js` with declarative policy parsing; feasibility medium, higher risk.
- Local Ollama-native recon agent (`pikpikcu/airecon`, `H-mmer/pentest-agents`, `awarexone/Agentic-Bug-Hunter`) — extends F1 with offline-first recon; feasibility medium.
- Self-evolving memory/context DB (`volcengine/OpenViking`, `openmemind/memind`) — large scope distinct from the current storage layer; feasibility low-medium.
- DiggerHQ `opencomputer-example-cve-swarm` — CVE reachability + dependency-only fixes; interesting F1×supply-chain crossover, feasibility medium.

## F9 — MCP ecosystem interoperability (seeded 2026-11-22 from modelcontextprotocol/servers)

**Source:** `modelcontextprotocol/servers` (92.2k★, active 2026-11-19) — official reference MCP servers: Everything, Fetch, Filesystem, Git, Memory, Sequential Thinking, Time. Repo is explicitly educational, not production-ready; license is mixed MIT/Apache-2.0 (docs CC-BY-4.0), so **do not copy server code** — integrate via the existing `@modelcontextprotocol/sdk` dependency instead.

**Fit with existing code:** `server/integrations/rea.js` already implements a generic-enough stdio MCP client (Client + StdioClientTransport, `listTools`, `callTool`); `server/integrations/register.js` + `/api/agent` ext-tool gathering provide the wiring pattern; `server/core/security.js` (`validateProjectRoot`, `safePath`, `isSafeUrl`, `runProcess`) supplies guards.

- [ ] F9-1 — Generic MCP client integration: config-driven stdio/streamable-HTTP servers, tools namespaced `mcp_<server>_<tool>`, registered as an external-tool source with the same budget/clean-room gating as `hunt_`/`rea_`. **Feasibility: high** (SDK present, REA client is a template).
- [ ] F9-2 — Curated safe presets: Filesystem scoped to the configured project root, Git read-only, Fetch through `isSafeUrl`, Memory/Time/Sequential-Thinking. Allow-list server commands; no arbitrary shell. **Feasibility: medium-high** (argument validation is the real work).
- [x] F9-3 landed — Expose AegisAI as an MCP server: `mcp-server.js` (stdio, `npm run mcp`) registers `aegisai_health`, `aegisai_agent`, `aegisai_hunt`, `aegisai_task`, `aegisai_swarm`; project root validated against `AEGISAI_PROJECT_ROOT_ALLOWLIST` before agent tools run; 2 new MCP client tests; suite 87/87 pass. README includes client config example.
- [ ] F9-4 — MCP registry browser / install flow (registry.modelcontextprotocol.io). **Feasibility: medium**, largest trust/UX surface; defer until F9-1/3 land.
- Parked: reusing the reference Memory knowledge-graph server duplicates our SQLite memory/RAG layer — **low priority**.
