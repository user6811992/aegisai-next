// server/agent/run.js
// Agent tool-call loop. Ported (simplified) from legacy runAgent.
// Returns { final, toolLog } where final = { type: 'done', final, toolLog }.

const backends = require('../backends');
const coding = require('../tools/coding');
const { ToolRegistry } = require('../tools/registry');

const CLEAN_ROOM_BLOCKED = new Set([
  'read_file', 'write_file', 'delete_file', 'list_files', 'search_files',
  'run_command', 'run_python', 'git_diff', 'decompile_function', 'fetch_url', 'web_search',
]);

function isCleanRoomBlocked(name) {
  // block dangerous/source-reading tool names in clean room
  if (CLEAN_ROOM_BLOCKED.has(name)) return true;
  if (/read|file|exec|run|decompil|fetch|search/i.test(name) && !/memory/i.test(name)) return true;
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
    onEvent = () => {},
    externalTools = { ghidra: [], craft: [], are: [] },
  } = opts;

  const toolLog = [];
  const msgs = [...(messages || [])];
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

  // budget trim: coding first, then externals
  if (tools.length > toolBudget) {
    const codingTools = tools.filter((t) => !t.function.name.startsWith('ghidra_') && !t.function.name.startsWith('craft_') && !t.function.name.startsWith('are_'));
    const externals = tools.filter((t) => t.function.name.startsWith('ghidra_') || t.function.name.startsWith('craft_') || t.function.name.startsWith('are_'));
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
    try {
      resp = await backends.backendChat({ model, messages: msgs, tools, stream: false }, (e) => onEvent(e));
    } catch (e) {
      onEvent({ type: 'error', message: String(e.message || e) });
      return { final: { type: 'done', final: 'error: ' + (e.message || e), toolLog }, toolLog };
    }
    const data = resp && resp.data ? resp.data : resp;
    const msg = (data && data.message) || {};
    const toolCalls = msg.tool_calls || (msg.tool_calls === undefined ? null : msg.tool_calls);

    if (!toolCalls || (Array.isArray(toolCalls) && toolCalls.length === 0)) {
      const finalText = msg.content || '';
      onEvent({ type: 'done', final: finalText, toolLog });
      return { final: { type: 'done', final: finalText, toolLog }, toolLog };
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
        if (name.startsWith('ghidra_') || name.startsWith('craft_') || name.startsWith('are_')) {
          // external: not executed here (no MCP client in wave 1); simulate
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

module.exports = { runAgent, isCleanRoomBlocked };
