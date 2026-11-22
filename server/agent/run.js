// server/agent/run.js
// Agent tool-call loop. Ported (simplified) from legacy runAgent.
// Returns { final, toolLog } where final = { type: 'done', final, toolLog }.

const backends = require('../backends');
const coding = require('../tools/coding');
const capabilities = require('../core/capabilities');
const integrations = require('../integrations/register');

const CLEAN_ROOM_BLOCKED = new Set([
  'read_file', 'write_file', 'delete_file', 'list_files', 'search_files',
  'run_command', 'run_python', 'git_diff', 'decompile_function', 'fetch_url', 'web_search',
]);

function isCleanRoomBlocked(name) {
  // block dangerous/source-reading tool names in clean room
  if (CLEAN_ROOM_BLOCKED.has(name)) return true;
  if (/(^|_)(read|file|exec|run|decompil|fetch|search)/i.test(name) && !/memory/i.test(name)) return true;
  return false;
}

async function runAgent(opts) {
  const {
    model,
    messages,
    projectRoot,
    includeCoding = true,
    includeRe = false,
    cleanRoom = false,
    toolBudget = 64,
    allowedTools,
    deniedTools,
    onEvent = () => {},
    signal,
    externalTools = { ghidra: [], craft: [], are: [], rea: [] },
    fallbackModels = [],
    maxHistory = 20,
    maxTokens = 0,
  } = opts;

  const toolLog = [];
  const msgs = [...(messages || [])];
  // Cost control: truncate conversation history to the last N messages
  // (always preserving system messages).
  if (maxHistory > 0 && msgs.length > maxHistory) {
    const systemMsgs = msgs.filter((m) => m.role === 'system');
    const others = msgs.filter((m) => m.role !== 'system');
    const kept = others.slice(-maxHistory);
    msgs.length = 0;
    msgs.push(...systemMsgs, ...kept);
  }
  let tools = [];

  // assemble coding tools
  if (includeCoding) {
    const ollamaTools = coding.codingToolsAsOllama();
    tools = tools.concat(ollamaTools);
  }
  // external (integration) tools namespaced
  const extDefs = [];
  if (includeRe) {
    for (const t of (externalTools.ghidra || [])) extDefs.push({ src: 'ghidra', tool: t });
    for (const t of (externalTools.craft || [])) extDefs.push({ src: 'craft', tool: t });
    for (const t of (externalTools.are || [])) extDefs.push({ src: 'are', tool: t });
    for (const t of (externalTools.rea || [])) extDefs.push({ src: 'rea', tool: t });
    for (const t of (externalTools.hunt || [])) extDefs.push({ src: 'hunt', tool: t });
    for (const t of (externalTools.mcp || [])) extDefs.push({ src: 'mcp', tool: t });
    for (const t of (externalTools.search || [])) extDefs.push({ src: 'search', tool: t });
  }
  for (const { src, tool } of extDefs) {
    tools.push({
      type: 'function',
      function: {
        name: `${src}_${tool.name}`,
        description: tool.description || '',
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      },
    });
  }

  // capability-based filtering (allowedTools/deniedTools)
  tools = capabilities.filterTools(tools, { allowedTools, deniedTools });

  // budget trim: coding first, then externals
  if (tools.length > toolBudget) {
    const external = (n) => n.startsWith('ghidra_') || n.startsWith('craft_') || n.startsWith('are_') || n.startsWith('rea_') || n.startsWith('hunt_') || n.startsWith('mcp_') || n.startsWith('search_');
    const codingTools = tools.filter((t) => !external(t.function.name));
    const externals = tools.filter((t) => external(t.function.name));
    const kept = [...codingTools];
    let rem = toolBudget - kept.length;
    for (const t of externals) { if (rem <= 0) break; kept.push(t); rem -= 1; }
    tools = kept;
  }

  let iterations = 0;
  const MAX_ITERS = 25;
  while (iterations < MAX_ITERS) {
    iterations += 1;
    onEvent({ type: 'status', message: 'calling model' });
    let resp;
    const modelsToTry = [model].concat(Array.isArray(fallbackModels) ? fallbackModels : []).filter(Boolean);
    let lastErr = null;
    for (let mi = 0; mi < modelsToTry.length; mi++) {
      const m = modelsToTry[mi];
      if (mi > 0) onEvent({ type: 'status', message: 'falling back to ' + m });
      try {
        resp = await backends.backendChat({ model: m, messages: msgs, tools, stream: true, maxTokens }, (e) => onEvent(e), signal);
        break;
      } catch (e) {
        // Retry without tools (vision models like moondream don't support tool calls)
        if (tools && tools.length > 0) {
          try {
            resp = await backends.backendChat({ model: m, messages: msgs, tools: [], stream: true, maxTokens }, (e) => onEvent(e), signal);
            tools = [];
            break;
          } catch (e2) {
            lastErr = e2;
            continue;
          }
        }
        lastErr = e;
        continue;
      }
    }
    if (!resp) {
      return { final: { type: 'done', final: 'error: ' + ((lastErr && (lastErr.message || lastErr)) || 'all models failed'), toolLog }, toolLog };
    }
    const data = resp && resp.data ? resp.data : resp;
    const msg = (data && data.message) || {};
    const toolCalls = msg.tool_calls || (msg.tool_calls === undefined ? null : msg.tool_calls);
    const thinking = msg.thinking || msg.reasoning_content || '';

    if (!toolCalls || (Array.isArray(toolCalls) && toolCalls.length === 0)) {
      const finalText = msg.content || '';
      return { final: { type: 'done', final: finalText, thinking, toolLog, tokenStats: { prompt: data.prompt_eval_count || 0, generated: data.eval_count || 0 } }, toolLog };
    }

    // append assistant message with tool_calls
    msgs.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const fn = tc.function || tc;
      const name = fn.name;
      let args = fn.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
      args = args || {};

      // clean room check
      if (cleanRoom && isCleanRoomBlocked(name)) {
        const blocked = 'BLOCKED (clean room): ' + name;
        toolLog.push({ name, resultPreview: blocked });
        onEvent({ type: 'tool_result', name, preview: blocked });
        msgs.push({ role: 'tool', content: blocked, name });
        continue;
      }

      onEvent({ type: 'tool_call', name, args });
      let result;
      try {
        if (name.startsWith('hunt_')) {
          const toolName = name.slice(5);
          const intg = integrations.registry.list().find((i) => i.name === 'hunt');
          if (intg && typeof intg.callTool === 'function') {
            const r = await intg.callTool(toolName, args);
            result = { ok: true, output: JSON.stringify(r).slice(0, 2000) };
          } else {
            result = { ok: false, output: 'HUNT not available' };
          }
        } else if (name.startsWith('search_')) {
          const toolName = name.slice(7);
          const intg = integrations.registry.list().find((i) => i.name === 'search');
          if (intg && typeof intg.callTool === 'function') {
            const r = await intg.callTool(toolName, args);
            result = { ok: true, output: JSON.stringify(r).slice(0, 2000) };
          } else {
            result = { ok: false, output: 'external search not available' };
          }
        } else if (name.startsWith('mcp_')) {
          const internalName = name.slice(4);
          const intg = integrations.registry.list().find((i) => i.name === 'mcp');
          if (intg && typeof intg.callTool === 'function') {
            const r = await intg.callTool(internalName, args);
            result = { ok: true, output: JSON.stringify(r).slice(0, 2000) };
          } else {
            result = { ok: false, output: 'MCP not available' };
          }
        } else if (name.startsWith('rea_')) {
          const toolName = name.slice(4);
          const intg = integrations.registry.list().find((i) => i.name === 'rea');
          if (intg && typeof intg.callTool === 'function') {
            const r = await intg.callTool(toolName, args);
            result = { ok: true, output: JSON.stringify(r).slice(0, 2000) };
          } else {
            result = { ok: false, output: 'REA not available' };
          }
        } else if (name === 'are_search_reverse_engineered') {
          const ar = require('../integrations/awesome-re');
          result = { ok: true, output: JSON.stringify(ar.search(args.query, args.limit)) };
        } else if (name.startsWith('ghidra_') || name.startsWith('craft_') || name.startsWith('are_')) {
          // external: simulate (MCP clients for these land later)
          result = { ok: true, output: 'simulated: ' + name };
        } else {
          result = await Promise.resolve(coding.execCodingTool(name, args, projectRoot));
        }
      } catch (e) {
        result = { ok: false, output: String(e.message || e) };
      }
      const preview = (result && (result.output || result.out)) || '';
      const previewStr = String(preview).slice(0, 500);
      toolLog.push({ name, resultPreview: previewStr });
      onEvent({ type: 'tool_result', name, preview: previewStr });
      msgs.push({ role: 'tool', content: previewStr, name });
    }
  }

  onEvent({ type: 'done', final: '(max iterations reached)', toolLog });
  return { final: { type: 'done', final: '(max iterations reached)', toolLog }, toolLog };
}

const HUNT_PHASES = ['recon', 'probe', 'verify', 'report'];

function huntPhasePrompt(phase, ctx) {
  const target = (ctx && ctx.target) || 'the target';
  const scope = (ctx && ctx.scope) || 'in-scope assets';
  if (phase === 'recon') {
    return 'HUNT_PHASE=recon. You are in the recon phase of a bug hunt against ' + target + ' (' + scope + '). Map the attack surface: enumerate endpoints, auth surfaces, inputs. Use are_search_reverse_engineered and hunt_vuln_search to find prior art. Goal: produce a candidate area list.';
  }
  if (phase === 'probe') {
    return 'HUNT_PHASE=probe. You are in the probe phase of a bug hunt against ' + target + '. Take the top recon candidates and probe them with safe scanning / MCP tools; record suspected issues with evidence.';
  }
  if (phase === 'verify') {
    return 'HUNT_PHASE=verify. You are in the verify phase of a bug hunt against ' + target + '. Prove each candidate with a concrete reproduction before reporting.';
  }
  if (phase === 'report') {
    return 'HUNT_PHASE=report. You are in the report phase of a bug hunt against ' + target + '. Call the hunt_report tool with the verified findings and produce the final report.';
  }
  return 'HUNT_PHASE=' + phase + '. Continue the bug hunt against ' + target + '.';
}

async function runHunt(opts) {
  const {
    model, projectRoot, includeCoding = true, includeRe = false, cleanRoom = false,
    toolBudget = 64, allowedTools, deniedTools, onEvent = () => {}, signal,
    externalTools = { ghidra: [], craft: [], are: [], rea: [], hunt: [] },
    fallbackModels = [], maxHistory = 20, maxTokens = 0,
    target, scope, maxWaves = 3, phases: optPhases, phasePrompt, taskCtx = {}, messages: initialMessages = [],
  } = opts;

  const baseOpts = {
    model, projectRoot, includeCoding, includeRe, cleanRoom, toolBudget, allowedTools, deniedTools,
    onEvent, signal, externalTools, fallbackModels, maxHistory, maxTokens,
  };

  const phases = Array.isArray(optPhases) && optPhases.length > 0 ? optPhases : HUNT_PHASES;
  const promptFor = typeof phasePrompt === 'function' ? phasePrompt : huntPhasePrompt;

  const maxW = Math.max(1, maxWaves || 3);
  const toolLog = [];
  const waves = [];
  let finalText = '(hunt did not run)';
  let thinking = '';
  const tokenStats = { prompt: 0, generated: 0 };

  for (let wave = 0; wave < maxW; wave++) {
    const phase = phases[Math.min(wave, phases.length - 1)];
    const phaseCtx = { target, scope, ...taskCtx };
    const phaseMessages = [
      { role: 'system', content: promptFor(phase, phaseCtx) },
      { role: 'user', content: 'Begin phase: ' + phase + (phaseCtx.goal ? ' (goal: ' + phaseCtx.goal + ')' : '') + '.' },
    ];
    if (Array.isArray(initialMessages)) phaseMessages.push(...initialMessages);
    const res = await runAgent({ ...baseOpts, messages: phaseMessages });
    finalText = (res.final && res.final.final) || '(no final)';
    thinking = (res.final && res.final.thinking) || '';
    const wl = Array.isArray(res.toolLog) ? res.toolLog : [];
    for (const t of wl) toolLog.push(t);
    const usedReport = wl.some((t) => String(t.name || '').startsWith('hunt_') && /report/i.test(String(t.name || '')));
    waves.push({ phase, final: finalText, toolCount: wl.length, usedReport });
    if (res.final && res.final.tokenStats) {
      tokenStats.prompt += res.final.tokenStats.prompt || 0;
      tokenStats.generated += res.final.tokenStats.generated || 0;
    }
    if (usedReport) break;
  }

  const finalResult = { type: 'done', final: finalText, thinking, toolLog, tokenStats };
  return { final: finalResult, toolLog, waves };
}

module.exports = { runAgent, runHunt, isCleanRoomBlocked };
