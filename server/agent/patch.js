// server/agent/patch.js
// F10-3: dependency-only patch proposals for verified vulnerability findings.
// Only a package.json dependency version can be changed; no arbitrary file
// writes, no shell commands, and traversal outside the project root is blocked.

const fs = require('fs');
const path = require('path');
const security = require('../core/security');

const SAFE_DEP = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-zA-Z0-9][a-z0-9._-]*$/;
const SAFE_VERSION = /^[\^~]?\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$|^[a-zA-Z0-9.*xX-]+$/;

function simpleDiff(oldText, newText) {
  const a = String(oldText).split(/\r?\n/);
  const b = String(newText).split(/\r?\n/);
  const lines = [];
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = a.length - 1;
  let k = b.length - 1;
  while (j >= i && k >= i && a[j] === b[k]) { j--; k--; }
  for (let n = Math.max(0, i - 2); n < i; n++) lines.push(' ' + a[n]);
  for (let n = i; n <= j; n++) lines.push('-' + a[n]);
  for (let n = i; n <= k; n++) lines.push('+' + b[n]);
  for (let n = j + 1; n < Math.min(a.length, j + 3); n++) lines.push(' ' + a[n]);
  return ['--- package.json', '+++ package.json', ...lines].join('\n');
}

function proposePatch(opts = {}) {
  const root = opts.projectRoot;
  if (!root || typeof root !== 'string') throw new Error('projectRoot is required');
  const pkgPath = security.safePath(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return { ok: false, reason: 'no package.json in project root' };

  const dep = String(opts.dependency || '').trim();
  const version = String(opts.fixedVersion || '').trim();
  if (!dep || !SAFE_DEP.test(dep)) return { ok: false, reason: 'invalid dependency name' };
  if (!version || !SAFE_VERSION.test(version)) return { ok: false, reason: 'invalid fixed version' };

  let original;
  let data;
  try {
    original = fs.readFileSync(pkgPath, 'utf8');
    data = JSON.parse(original);
  } catch (e) {
    return { ok: false, reason: 'could not read package.json: ' + e.message };
  }
  const section = (opts.kind === 'dev') ? 'devDependencies' : 'dependencies';
  const current = data[section] && data[section][dep];
  if (!current) return { ok: false, reason: 'dependency not found in ' + section };
  if (current === version) return { ok: false, reason: 'dependency already at fixed version' };

  data[section][dep] = version;
  const updated = JSON.stringify(data, null, 2) + '\n';
  const diff = simpleDiff(original, updated);
  const dryRun = opts.dryRun !== false;
  if (!dryRun) {
    const tmp = pkgPath + '.patch.tmp';
    fs.writeFileSync(tmp, updated, 'utf8');
    fs.renameSync(tmp, pkgPath);
  }
  return {
    ok: true,
    dependency: dep,
    section,
    from: current,
    to: version,
    dryRun,
    diff,
    file: pkgPath,
  };
}

module.exports = { proposePatch, simpleDiff, SAFE_DEP, SAFE_VERSION };
