// server/integrations/register.js
const registry = require('./index');
const rea = require('./rea');
const voice = require('./voice');
const ghidra = require('./ghidra');
const craft = require('./craft');
const awesomeRe = require('./awesome-re');
const hunt = require('./hunt');
const mcp = require('./mcp');
const mcpSearch = require('./mcp-search');
const patch = require('./patch');
const cve = require('./cve');

function registerAll() {
  registry.register(rea.integration);
  registry.register(voice.integration);
  registry.register(ghidra.integration);
  registry.register(craft.integration);
  registry.register(awesomeRe.integration);
  registry.register(hunt.integration);
  registry.register(mcp.integration);
  registry.register(mcpSearch.integration);
  registry.register(patch.integration);
  registry.register(cve.integration);
}

module.exports = { registerAll, registry };
