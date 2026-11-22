// server/storage/vuln-patterns.js
// Disclosed-vulnerability pattern library for the bug-hunting workflow.
// Seed content derived from curated disclosed-report patterns (e.g. Claude-BugHunter:
// 24 vulnerability classes, 681 disclosed-report patterns). Structured for
// incremental expansion without breaking the search API.

const VULN_CLASSES = [
  { id: 'sqli', name: 'SQL Injection', cwe: 'CWE-89', description: 'Attacker-controlled data reaches SQL queries via unsafe concatenation/interpolation.' },
  { id: 'xss', name: 'Cross-Site Scripting (XSS)', cwe: 'CWE-79', description: 'Untrusted data is rendered into HTML/JS sinks without encoding.' },
  { id: 'csrf', name: 'Cross-Site Request Forgery', cwe: 'CWE-352', description: 'State-changing request is authenticated but not origin-checked.' },
  { id: 'ssrf', name: 'Server-Side Request Forgery', cwe: 'CWE-918', description: 'Server-side fetch of attacker-influenced URL reaches internal or external services.' },
  { id: 'rce', name: 'Remote Code Execution', cwe: 'CWE-94', description: 'Unsafe deserialization, eval, shell invocation, or template evaluation executes attacker code.' },
  { id: 'path-traversal', name: 'Path Traversal', cwe: 'CWE-22', description: 'File access uses unsanitized user input allowing escape of the intended root.' },
  { id: 'auth-bypass', name: 'Authentication / Authorization Bypass', cwe: 'CWE-287', description: 'Missing or flawed checks on privilege boundaries.' },
  { id: 'info-leak', name: 'Information Disclosure', cwe: 'CWE-200', description: 'Sensitive data exposure via errors, responses, or misconfiguration.' },
];

const PATTERNS = [
  { id: 'sqli-auth-log-bypass', classId: 'sqli', name: 'Auth endpoint SQLi via string concat', description: 'Login/auth queries built with string concatenation permit UNION-based credential bypass.', indicators: ['sql', 'concat', 'union select', 'auth', 'password'], source: 'seed' },
  { id: 'xss-dm-rce', classId: 'xss', name: 'DOM-based XSS via innerHTML sink', description: 'Dangerous sink (innerHTML / eval / jQuery.html) reached from unsanitized API data.', indicators: ['innerhtml', 'eval(', 'jquerysource', 'dom sink'], source: 'seed' },
  { id: 'csrf-state-change', classId: 'csrf', name: 'State-changing POST without origin check', description: 'Form actions lack Origin / Referer validation; cross-site request forging possible.', indicators: ['csrf', 'origin', 'referer', 'post', 'state'], source: 'seed' },
  { id: 'ssrf-internal', classId: 'ssrf', name: 'SSRF to internal metadata / service', description: 'Server-side URL fetch with attacker-controlled host reaches internal services or cloud metadata.', indicators: ['ssrf', 'fetch', 'url', '169.254', 'metadata'], source: 'seed' },
  { id: 'rce-deser', classId: 'rce', name: 'Unsafe deserialization / eval in backend', description: 'Deserialization or dynamic evaluation of untrusted input reaches execution.', indicators: ['deserialize', 'pickle', 'eval', 'yaml.load', 'shell'], source: 'seed' },
  { id: 'traversal-root', classId: 'path-traversal', name: 'Unvalidated path join in file serving', description: 'User-influenced path segments joined without containment check.', indicators: ['path.join', 'join', 'traversal', 'root', 'file'], source: 'seed' },
  { id: 'auth-id-token', classId: 'auth-bypass', name: 'Token validation weakness / privilege confusion', description: 'Token issuance or comparison flaw allows privilege escalation.', indicators: ['token', 'jwt', 'signature', 'admin', 'role'], source: 'seed' },
  { id: 'leak-error-stack', classId: 'info-leak', name: 'Verbose error / stack leakage', description: 'Stack traces or internal identifiers returned to clients in error paths.', indicators: ['stack', 'trace', 'error', 'debug', 'internal'], source: 'seed' },
];

function searchPatterns(query, opts) {
  opts = opts || {};
  const q = String(query || '').toLowerCase();
  const limit = (opts.limit === undefined || opts.limit === null) ? 20 : opts.limit;
  const results = [];
  for (const p of PATTERNS) {
    const cls = VULN_CLASSES.find((c) => c.id === p.classId) || {};
    const hay = ((p.name || '') + ' ' + (p.description || '') + ' ' + (cls.name || '') + ' ' + (cls.cwe || '') + ' ' + (Array.isArray(p.indicators) ? p.indicators.join(' ') : '')).toLowerCase();
    if (q && !hay.includes(q)) continue;
    results.push({ id: p.id, classId: p.classId, className: cls.name, cwe: cls.cwe, name: p.name, description: p.description, indicators: p.indicators || [], source: p.source });
    if (results.length >= limit) break;
  }
  return results;
}

module.exports = { VULN_CLASSES, PATTERNS, searchPatterns };
