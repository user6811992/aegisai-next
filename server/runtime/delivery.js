// server/runtime/delivery.js
// F6-1c: delivery wiring for always-on runtime events. Channels are pluggable;
// the built-in event channel is in-memory, the webhook channel posts JSON to a
// validated URL (SSRF guard via security.isSafeUrl).

const security = require('../core/security');

function createEventChannel() {
  const subscribers = new Set();
  const history = [];
  return {
    name: 'event',
    async send(event) {
      history.push(event);
      for (const fn of subscribers) {
        try { await fn(event); } catch (e) { /* subscriber failure is isolated */ }
      }
    },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    history,
  };
}

function createWebhookChannel(opts = {}) {
  const url = opts.url;
  if (typeof url !== 'string' || !url.trim() || !security.isSafeUrl(url)) {
    throw new Error('unsafe or missing webhook url');
  }
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : fetch;
  return {
    name: 'webhook',
    url,
    async send(event) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      return { ok: !!(res && res.ok !== false), status: res && res.status };
    },
  };
}

function createDelivery(opts = {}) {
  const channels = Array.isArray(opts.channels) ? opts.channels.slice() : [];
  return {
    channels,
    async send(event) {
      const results = [];
      for (const channel of channels) {
        if (!channel || typeof channel.send !== 'function') continue;
        try {
          results.push({ channel: channel.name || 'unknown', ok: true, result: await channel.send(event) });
        } catch (e) {
          results.push({ channel: channel.name || 'unknown', ok: false, error: String((e && e.message) || e) });
        }
      }
      return results;
    },
  };
}

module.exports = { createEventChannel, createWebhookChannel, createDelivery };
