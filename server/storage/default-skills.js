// server/storage/default-skills.js
const db = require('./db');

const DEFAULT_SKILLS = [
  { name: 'search-before-re', description: 'Search the awesome-reverse-engineered index (17,000+ projects) before starting any reverse engineering work. Avoids duplicating existing efforts.', code: "print('Use are_search_reverse_engineered to find existing RE projects before starting new work.')" },
  { name: 'design-review', description: 'Review code design for abstraction quality, fallback patterns, external dependencies, and change impact.', code: "print('Review checklist: 1) Is abstraction justified? 2) Are fallbacks explicit? 3) Are external deps minimized? 4) What is the blast radius of this change?')" },
  { name: 'pr-review', description: 'Simulate a PR review: check if code changes can be cleanly merged, identify conflicts, assess test coverage, and flag potential regressions.', code: "print('PR review: 1) Does it merge cleanly? 2) Are tests added/updated? 3) Any regressions? 4) Is the change minimal and focused?')" },
  { name: 'doc-discipline', description: 'Documentation discipline: what to write, where to put it, when to remove it.', code: "print('Doc rules: 1) Write docs next to code. 2) Remove stale docs. 3) Keep README as source of truth. 4) Update docs in same commit as code changes.')" },
  { name: 're-methodology', description: 'Reverse engineering methodology router: APK/Android, binary, .NET, JS, firmware, malware.', code: "print('RE methodology: 1) Identify binary type. 2) Select appropriate tool. 3) Static analysis first, then dynamic. 4) Document findings. 5) Use MCP tools for automated analysis.')" },
  { name: 're-convention', description: 'RE naming conventions: Hungarian notation for variables, PascalCase for functions.', code: "print('RE conventions: Functions=PascalCase with verb. Variables=camelCase with type prefix. Structs=PascalCase. Constants=UPPER_SNAKE.')" },
  { name: 'android-re', description: 'Android reverse engineering methodology: APK decompilation, API extraction, Kotlin name recovery.', code: "print('Android RE: 1) Fingerprint APK. 2) Decompile with jadx. 3) Recover Kotlin names. 4) Extract API calls. 5) Trace call flows.')" },
  { name: 'ui-review', description: 'Review UI/UX for AI-generated patterns: gradients, nested cards, emoji icons, invented stats.', code: "print('UI review: 1) No unnecessary gradients. 2) No nested cards. 3) No emoji as icons. 4) Virtualized lists. 5) Native navigation.')" },
  { name: 'context-compress', description: 'Compress tool outputs, logs, files before they reach the LLM to reduce token usage.', code: "print('Context compression: 1) Truncate large outputs. 2) Summarize file contents. 3) Use squeeze tool. 4) Remove redundant context.')" },
  { name: 'bug-hunting', description: 'Autonomous bug-hunting workflow: recon -> target discovery (dorking / awesome-re) -> probe (Burp/scanner / MCP) -> verify -> report. Enforces authorized testing and disclosed-pattern usage.', code: "print('Bug hunt workflow: 1) Recon target scope and map attack surface. 2) Discover prior art via are_search_reverse_engineered before probing. 3) Probe with safe scanners / MCP tools. 4) Verify PoC before reporting. 5) Report using disclosed vulnerability patterns.')" },
];

function ensureDefaultSkills() {
  try {
    const skills = db.listSkills();
    let added = 0;
    for (const ds of DEFAULT_SKILLS) {
      if (skills.find((s) => s.name === ds.name)) continue;
      db.saveSkill({ name: ds.name, description: ds.description, code: ds.code });
      added++;
    }
    if (added > 0) console.log('Default skills seeded:', added, 'new');
  } catch (e) {
    console.error('Failed to seed default skills:', e.message);
  }
}

module.exports = { DEFAULT_SKILLS, ensureDefaultSkills };
