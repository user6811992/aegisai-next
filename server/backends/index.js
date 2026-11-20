// server/backends/index.js
// Multi-backend adapter. Normalizes OpenAI-compatible backends to Ollama shape.
// Ported from the legacy monolith; state is encapsulated in a config object.

const state = {
  type: (process.env.BACKEND_TYPE || '').toLowerCase(),
  url: process.env.BACKEND_URL || process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  apiKey: process.env.BACKEND_API_KEY || '',
  sttUrl: process.env.STT_URL || '',
  ttsUrl: process.env.TTS_URL || '',
  explicit: !!(process.env.BACKEND_TYPE || process.env.BACKEND_URL || process.env.OLLAMA_URL),
};

function getType() { return state.type; }
function getUrl() { return state.url; }
function setBackend(type, url) {
  if (type) state.type = type.toLowerCase();
  if (url) state.url = url;
  state.explicit = true;
  console.log('Backend switched to:', state.type, 'at', state.url);
}
function getApiKey() { return state.apiKey; }
function getSttUrl() { return state.sttUrl; }
function getTtsUrl() { return state.ttsUrl; }
function isOpenaiCompat() {
  const t = state.type;
  return t === 'llamacpp' || t === 'lmstudio' || t === 'openai' || t === 'strata' || t === 'robin' || t === 'hyperqwen' || t === 'exllamav3';
}

// Try to auto-detect Strata API key from its config files.
function detectStrataApiKey() {
  if (state.apiKey) return;
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const home = os.homedir();
  const candidates = [path.join(home, '.config', 'strata'), path.join(home, '.strata')];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf8'));
        const key = data.api_key || data.apiKey || data.key || (data.server && (data.server.api_key || data.server.apiKey));
        if (key && typeof key === 'string' && key.startsWith('sk-')) { state.apiKey = key; return; }
      } catch (_) {}
    }
  };
  for (const dir of candidates) {
    if (!require('fs').existsSync(dir)) continue;
    walk(dir);
    if (state.apiKey) return;
  }
}

async function detectBackend() {
  if (state.explicit) {
    if (!state.type) state.type = 'ollama';
    if (!state.url) state.url = 'http://127.0.0.1:11434';
    if (state.type === 'ollama' && !state.url) state.url = 'http://127.0.0.1:11434';
    console.log('Backend (explicit):', state.type, 'at', state.url);
    return;
  }
  const probes = [
    { type: 'ollama', url: 'http://127.0.0.1:11434', path: '/api/version' },
    { type: 'lmstudio', url: 'http://127.0.0.1:1234', path: '/v1/models' },
    { type: 'llamacpp', url: 'http://127.0.0.1:8081', path: '/v1/models' },
    { type: 'strata', url: 'http://127.0.0.1:8082', path: '/v1/models' },
    { type: 'openai', url: 'http://127.0.0.1:8000', path: '/v1/models' },
  ];
  for (const p of probes) {
    try {
      const r = await fetch(p.url + p.path, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        state.type = p.type;
        state.url = p.url;
        console.log('Auto-detected backend:', p.type, 'at', p.url);
        return;
      }
    } catch (e) {}
  }
  if (!state.type) {
    state.type = 'ollama';
    state.url = state.url || 'http://127.0.0.1:11434';
    console.log('No backend detected; defaulting to Ollama at', state.url);
  }
}

// Ollama native chat stream (NDJSON). Returns { status, data }.
async function ollamaStream(pathname, bodyObj, onChunk, signal) {
  const r = await fetch(state.url + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
    signal,
  });
  if (!r.ok) throw new Error('Chat failed: ' + r.status);
  if (bodyObj.stream === false) {
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch (e) {
      const lines = text.trim().split('\n').filter(Boolean);
      // Merge NDJSON lines: content/tool_calls may be in different lines.
      data = {};
      let msg = { role: 'assistant', content: '' };
      for (const line of lines) {
        try {
          const o = JSON.parse(line);
          if (o.message) {
            if (o.message.content) msg.content += o.message.content;
            if (o.message.tool_calls) msg.tool_calls = o.message.tool_calls;
          }
          if (o.eval_count) data.eval_count = o.eval_count;
          if (o.prompt_eval_count) data.prompt_eval_count = o.prompt_eval_count;
          if (o.done) data.done = true;
        } catch (e2) {}
      }
      data.message = msg;
      data.done = true;
    }
    return { status: 200, data };
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let fullContent = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let lastMessage = null;
  let toolCalls = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        lastMessage = obj;
        if (obj.message) {
          if (obj.message.content) {
            fullContent += obj.message.content;
            if (onChunk) onChunk({ type: 'token', content: obj.message.content });
          }
          if (obj.message.thinking) {
            if (onChunk) onChunk({ type: 'thinking', content: obj.message.thinking });
          }
          if (obj.message.tool_calls) {
            toolCalls = obj.message.tool_calls;
            if (onChunk) onChunk({ type: 'tool_calls', tool_calls: obj.message.tool_calls });
          }
        }
        if (obj.eval_count) completionTokens = obj.eval_count;
        if (obj.prompt_eval_count) promptTokens = obj.prompt_eval_count;
        if (obj.done) {
          if (onChunk) onChunk({ type: 'done' });
        }
      } catch (e) {}
    }
  }
  return { status: 200, data: { message: { role: 'assistant', content: fullContent, tool_calls: toolCalls }, done: true, eval_count: completionTokens, prompt_eval_count: promptTokens } };
}

async function backendListModels() {
  if (!isOpenaiCompat()) {
    const r = await fetch(state.url + '/api/tags');
    if (!r.ok) throw new Error('Failed to list models: ' + r.status);
    return r.json();
  }
  const headers = { 'Content-Type': 'application/json' };
  if (state.apiKey) headers['Authorization'] = 'Bearer ' + state.apiKey;
  const r = await fetch(state.url + '/v1/models', { headers });
  if (!r.ok) throw new Error('Failed to list models: ' + r.status);
  const data = await r.json();
  const models = (data.data || []).map((m) => ({
    name: m.id, model: m.id, modified_at: new Date().toISOString(),
    size: 0, digest: '', details: { format: 'gguf', family: 'unknown', parameter_size: '', quantization_level: '' },
  }));
  return { models };
}

async function backendShowModel(name) {
  if (!isOpenaiCompat()) {
    const r = await fetch(state.url + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!r.ok) throw new Error('Model not found: ' + r.status);
    return r.json();
  }
  const models = await backendListModels();
  const found = (models.models || []).find((m) => m.name === name);
  if (!found) throw new Error('Model not found: ' + name);
  return { modelfile: '', parameters: '', template: '', details: found.details || {} };
}

async function backendChat(bodyObj, onChunk, signal) {
  if (!isOpenaiCompat()) {
    return ollamaStream('/api/chat', bodyObj, onChunk, signal);
  }
  const oaiBody = {
    model: bodyObj.model,
    messages: bodyObj.messages || [],
    stream: bodyObj.stream !== false,
    temperature: bodyObj.options && bodyObj.options.temperature,
  };
  if (bodyObj.tools && bodyObj.tools.length) {
    oaiBody.tools = bodyObj.tools;
    oaiBody.tool_choice = 'auto';
  }
  const chatHeaders = { 'Content-Type': 'application/json' };
  if (state.apiKey) chatHeaders['Authorization'] = 'Bearer ' + state.apiKey;
  const r = await fetch(state.url + '/v1/chat/completions', {
    method: 'POST', headers: chatHeaders, body: JSON.stringify(oaiBody), signal,
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error('Chat failed: ' + r.status + ' ' + errText);
  }
  if (bodyObj.stream === false) {
    const data = await r.json();
    const choice = (data.choices && data.choices[0]) || {};
    const msg = choice.message || {};
    const usage = data.usage || {};
    const result = { message: { role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls }, done: true, eval_count: usage.completion_tokens || 0, prompt_eval_count: usage.prompt_tokens || 0 };
    if (onChunk) onChunk({ type: 'token', content: msg.content || '' });
    return { status: 200, data: result };
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buf = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let toolCalls = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const obj = JSON.parse(payload);
        const delta = (obj.choices && obj.choices[0] && obj.choices[0].delta) || {};
        if (delta.content) {
          fullContent += delta.content;
          if (onChunk) onChunk({ type: 'token', content: delta.content });
        }
        if (delta.reasoning_content) {
          if (onChunk) onChunk({ type: 'thinking', content: delta.reasoning_content });
        }
        if (delta.tool_calls) {
          toolCalls = delta.tool_calls;
          if (onChunk) onChunk({ type: 'tool_calls', tool_calls: delta.tool_calls });
        }
        if (obj.usage) {
          promptTokens = obj.usage.prompt_tokens || promptTokens;
          completionTokens = obj.usage.completion_tokens || completionTokens;
        }
      } catch (_) {}
    }
  }
  if (onChunk) onChunk({ type: 'done' });
  return { status: 200, data: { message: { role: 'assistant', content: fullContent, tool_calls: toolCalls }, done: true, eval_count: completionTokens, prompt_eval_count: promptTokens } };
}

async function backendPullModel(name, onProgress) {
  if (isOpenaiCompat()) {
    throw new Error('Model pulling is not supported for OpenAI-compatible backends. Download models manually.');
  }
  // Ollama native pull: stream progress
  const r = await fetch(state.url + '/api/pull', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: true }),
  });
  if (!r.ok) throw new Error('Pull failed: ' + r.status);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t);
        if (onProgress) onProgress(obj);
      } catch (e) {}
    }
  }
  return { ok: true };
}

module.exports = {
  state,
  getType, getUrl, getApiKey, getSttUrl, getTtsUrl, isOpenaiCompat,
  detectStrataApiKey, detectBackend,
  backendListModels, backendShowModel, backendChat, backendPullModel,
  ollamaStream, setBackend,
};
