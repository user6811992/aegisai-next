// server/integrations/craft.js
const fs = require('fs');
const path = require('path');

function findCraftBin() {
  if (process.env.CRAFT_BIN && fs.existsSync(process.env.CRAFT_BIN)) return process.env.CRAFT_BIN;
  const candidates = [];
  // PATH
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of ['craft-anything-cli', 'craft-anything-cli.exe', 'craft', 'craft.exe']) {
      candidates.push(path.join(dir, name));
    }
  }
  // common dirs
  const common = ['C:\\Tools', 'C:\\Program Files', path.join(process.env.USERPROFILE || '', 'Tools')];
  for (const d of common) {
    try {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.isFile() && /craft/i.test(f.name)) candidates.push(path.join(d, f.name));
      }
    } catch (e) {}
  }
  for (const c of candidates) { if (c && fs.existsSync(c)) return c; }
  return null;
}

let cached = null;
function getBin() {
  if (cached) return cached;
  cached = findCraftBin();
  if (cached) process.env.CRAFT_BIN = cached;
  return cached;
}

const integration = {
  name: 'craft',
  isAvailable: () => !!getBin(),
  tools: () => [],
  status: async () => {
    const bin = getBin();
    return { ready: !!bin, error: bin ? null : 'CRAFT_BIN not set or missing', toolCount: 0, bin };
  },
};

module.exports = { integration, getBin, findCraftBin };
