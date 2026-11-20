// server/core/capabilities.js
// Capability-based tool filtering per agent session.
// allowedTools/deniedTools are arrays of tool name patterns (exact or prefix with *).

function matches(name, pattern) {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1));
  return name === pattern;
}

function filterTools(tools, opts) {
  const allowed = opts && opts.allowedTools;
  const denied = opts && opts.deniedTools;
  return tools.filter((t) => {
    const name = t.function ? t.function.name : t.name;
    if (Array.isArray(denied) && denied.some((p) => matches(name, p))) return false;
    if (Array.isArray(allowed) && allowed.length > 0) {
      return allowed.some((p) => matches(name, p));
    }
    return true;
  });
}

module.exports = { filterTools, matches };
