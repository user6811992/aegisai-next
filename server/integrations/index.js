// server/integrations/index.js
// Plugin contract for optional integrations (REA, Ghidra, Craft, Awesome-RE, voice, ...).
// An integration is an object implementing:
//   name: string
//   isAvailable(): boolean (sync or async)
//   tools(): Array<{ name, description, inputSchema }>   // MCP-style descriptors
//   status(): { ready: boolean, error: string|null, toolCount: number }
// Integrations register themselves at startup; the tool registry aggregates only
// available ones. This replaces the legacy "if present" global variables.

const integrations = new Map();

function register(integration) {
  if (!integration || !integration.name) throw new Error('integration requires a name');
  integrations.set(integration.name, integration);
}

function unregister(name) { integrations.delete(name); }

function list() { return [...integrations.values()]; }

async function available() {
  const out = [];
  for (const i of integrations.values()) {
    const ok = typeof i.isAvailable === 'function' ? await i.isAvailable() : true;
    if (ok) out.push(i);
  }
  return out;
}

async function statusAll() {
  const out = {};
  for (const [name, i] of integrations) {
    out[name] = (typeof i.status === 'function') ? await i.status() : { ready: false, error: null, toolCount: 0 };
  }
  return out;
}

module.exports = { register, unregister, list, available, statusAll };
