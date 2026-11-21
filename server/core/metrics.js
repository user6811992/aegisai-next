// server/core/metrics.js
// Minimal Prometheus-style metrics (no external dependency).
const counters = new Map();
const histograms = new Map();

function inc(name, labels) {
  const key = name + (labels ? '|' + JSON.stringify(labels) : '');
  counters.set(key, (counters.get(key) || 0) + 1);
}

function observe(name, value) {
  if (!histograms.has(name)) histograms.set(name, []);
  const arr = histograms.get(name);
  arr.push(value);
  if (arr.length > 1000) arr.shift();
}

function render() {
  const lines = [];
  for (const [key, val] of counters) {
    const [name, labels] = key.split('|');
    lines.push('# TYPE ' + name + ' counter');
    lines.push(name + (labels && labels !== 'undefined' ? labels.replace(/"/g, '') : '') + ' ' + val);
  }
  for (const [name, arr] of histograms) {
    const sum = arr.reduce((a, b) => a + b, 0);
    lines.push('# TYPE ' + name + ' summary');
    lines.push(name + '_count ' + arr.length);
    lines.push(name + '_sum ' + sum);
    lines.push(name + '_avg ' + (arr.length ? (sum / arr.length).toFixed(4) : 0));
  }
  return lines.join('\n') + '\n';
}

module.exports = { inc, observe, render };
