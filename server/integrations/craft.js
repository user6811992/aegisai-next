// server/integrations/craft.js
const fs = require('fs');
function craftAvailable() {
  const bin = process.env.CRAFT_BIN;
  return !!(bin && fs.existsSync(bin));
}
const integration = {
  name: 'craft',
  isAvailable: () => craftAvailable(),
  tools: () => [],
  status: () => ({ ready: craftAvailable(), error: craftAvailable() ? null : 'CRAFT_BIN not set or missing', toolCount: 0 }),
};
module.exports = { integration };
