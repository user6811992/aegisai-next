// server/tools/registry.js
// Aggregates tools from coding tools + available integrations, enforces the
// tool budget. Wave 0: skeleton with budget enforcement; tool sources wired later.

const { TOOL_BUDGET } = require('../core/config');

class ToolRegistry {
  constructor() {
    this.sources = new Map(); // name -> () => toolArray
  }
  registerSource(name, provider) {
    if (typeof provider !== 'function') throw new Error('provider must be a function');
    this.sources.set(name, provider);
  }
  unregisterSource(name) { this.sources.delete(name); }
  async all() {
    const out = [];
    for (const [name, provider] of this.sources) {
      const tools = await Promise.resolve(provider());
      for (const t of (tools || [])) out.push(Object.assign({}, t, { __source: name }));
    }
    return out;
  }
  // Return tools trimmed to budget. Coding tools (source 'coding') are always kept.
  async withinBudget(includeSources) {
    const allowed = new Set(includeSources || [...this.sources.keys()]);
    const all = await this.all();
    const coding = all.filter((t) => t.__source === 'coding' && allowed.has('coding'));
    const others = all.filter((t) => t.__source !== 'coding' && allowed.has(t.__source));
    const budget = TOOL_BUDGET;
    const result = [...coding];
    let remaining = budget - coding.length;
    for (const t of others) {
      if (remaining <= 0) break;
      result.push(t);
      remaining -= 1;
    }
    return result;
  }
}

module.exports = { ToolRegistry, TOOL_BUDGET };
