import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Retry a fetch up to `retries` times with exponential backoff.
async function fetchWithRetry(url, opts, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok || res.status < 500) return res;
      lastErr = new Error('HTTP ' + res.status);
    } catch (e) { lastErr = e; }
    if (i < retries) await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
  }
  throw lastErr || new Error('fetch failed');
}

function friendlyError(e) {
  const msg = String((e && e.message) || e || '');
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Network error — is the server running?';
  if (/401|unauthorized/i.test(msg)) return 'Unauthorized — check your auth token in Settings.';
  if (/404/i.test(msg)) return 'Not found — the requested resource or model may not exist.';
  if (/500/i.test(msg)) return 'Server error — check the error log in Settings.';
  if (/timeout|aborted/i.test(msg)) return 'Request timed out — the model may be too slow or unavailable.';
  if (/rate limit/i.test(msg)) return 'Rate limited — please wait a moment and try again.';
  return msg || 'Unknown error';
}

// Attach auth token from localStorage to every request (needed for token-protected / Docker deployments).
const _origFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : null;
if (_origFetch) {
  window.fetch = (input, init) => {
    const tok = (typeof localStorage !== 'undefined') ? (localStorage.getItem('aegisai_token') || '') : '';
    if (tok) {
      init = init || {};
      const h = Object.assign({}, (init.headers || {}));
      if (!h['X-Auth-Token'] && !h['x-auth-token']) h['X-Auth-Token'] = tok;
      init.headers = h;
    }
    return _origFetch(input, init);
  };
}

export default function App() {
  const [version, setVersion] = useState('...');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [inputHistory, setInputHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingPulling, setOnboardingPulling] = useState(false);
  const [onboardingPullMsg, setOnboardingPullMsg] = useState('');
  const [abortCtrl, setAbortCtrl] = useState(null);
  const [settingsCfg, setSettingsCfg] = useState({});
  const [integrations, setIntegrations] = useState({});
  const [tab, setTab] = useState('chat');
  const [memories, setMemories] = useState([]);
  const [skills, setSkills] = useState([]);
  const [newMemory, setNewMemory] = useState('');
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillDesc, setNewSkillDesc] = useState('');
  const [newSkillCode, setNewSkillCode] = useState('');
  const [chatId, setChatId] = useState(null);
  const [chats, setChats] = useState([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [chatSearch, setChatSearch] = useState('');
  const [chatFolderFilter, setChatFolderFilter] = useState('');
  const [branches, setBranches] = useState([]);
  const [parentId, setParentId] = useState(null);
  const [cleanRoom, setCleanRoom] = useState(false);
  const [pullModel, setPullModel] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState('');
  const [scanResults, setScanResults] = useState([]);
  const [modelSearch, setModelSearch] = useState('');
  const [modelSearchResults, setModelSearchResults] = useState([]);
  const [modelSearching, setModelSearching] = useState(false);
  const [areQuery, setAreQuery] = useState('');
  const [areResults, setAreResults] = useState([]);
  const [areLoading, setAreLoading] = useState(false);
  const [areCategory, setAreCategory] = useState('');
  const [areLanguage, setAreLanguage] = useState('');
  const [areMinStars, setAreMinStars] = useState(0);
  const [areReadme, setAreReadme] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [includeDocuments, setIncludeDocuments] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [ragQuery, setRagQuery] = useState('');
  const [ragResults, setRagResults] = useState([]);
  const [toolLog, setToolLog] = useState([]);
  const [showToolLog, setShowToolLog] = useState(false);

  const refreshMemory = () => fetch('/api/memory').then((r) => r.json()).then((d) => setMemories(d.memories || [])).catch(() => {});
  const refreshSkills = () => fetch('/api/skills').then((r) => r.json()).then((d) => setSkills(d.skills || [])).catch(() => {});
  const refreshDocuments = () => fetch('/api/documents').then((r) => r.json()).then((d) => setDocuments(d.documents || [])).catch(() => {});
  const loadChats = () => { setLoadingChats(true); fetch('/api/chats').then((r) => r.json()).then((d) => setChats(d.chats || [])).catch(() => {}).finally(() => setLoadingChats(false)); };
  const newChat = () => { setMessages([]); setChatId(null); setBranches([]); setToolLog([]); };

  useEffect(() => {
    let cancelled = false;
    const safe = (fn) => { if (!cancelled) fn(); };
    fetch('/api/version').then((r) => r.json()).then((d) => safe(() => setVersion(d.version))).catch(() => safe(() => setVersion('?')));
    fetch('/api/models').then((r) => r.json()).then((d) => safe(() => {
      const ms = (d.models || []).map((m) => m.name);
      setModels(ms);
      if (ms.length && !model) setModel(ms[0]);
      if (ms.length === 0) setShowOnboarding(true);
    })).catch(() => {});
    fetch('/api/integrations/status').then((r) => r.json()).then((d) => { fetch('/api/backend').then((r) => r.json()).then((b) => safe(() => setIntegrations({ ...d, _backend: b }))).catch(() => safe(() => setIntegrations(d))); }).catch(() => {});
    refreshMemory();
    refreshSkills();
    refreshDocuments();
    loadChats();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    fetch('/api/settings').then((r) => r.json()).then((d) => setSettingsCfg(d || {})).catch(() => {});
  }, [showSettings]);

  async function send(textOverride) {
    const text = (textOverride !== undefined ? textOverride : input).trim();
    if (!text || busy) return;
    setInputHistory((h) => [...h, text]);
    setHistoryIdx(-1);
    const userMsg = { role: 'user', content: text };
    if (pendingImage) { userMsg.images = [pendingImage]; }
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setPendingImage(null);
    setBusy(true);
    const ctrl = new AbortController();
    setAbortCtrl(ctrl);
    const assistant = { role: 'assistant', content: '' };
    setMessages([...next, assistant]);
    let cfg = {};
    try { cfg = await (await fetch('/api/settings')).json(); } catch (e) {}
    try {
      const res = await fetchWithRetry('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: next, includeCoding: cfg.includeCoding !== false, includeRe: cfg.includeRe !== false, cleanRoom, includeDocuments }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        assistant.content = 'Error: ' + friendlyError(new Error('HTTP ' + res.status));
        setMessages([...next, { ...assistant }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalData = null;
      const toolLogAcc = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (!payload) continue;
          let ev;
          try { ev = JSON.parse(payload); } catch (e) { continue; }
          if (ev.type === 'token') {
            assistant.content += (ev.content || '');
          } else if (ev.type === 'tool_call') {
            toolLogAcc.push({ name: ev.name });
            assistant.content += '\n🔧 ' + ev.name + '\n';
          } else if (ev.type === 'done' && ev.final !== undefined) {
            finalData = ev;
          } else if (ev.type === 'tool_result') {
            if (toolLogAcc.length) {
              toolLogAcc[toolLogAcc.length - 1].resultPreview = ev.preview || toolLogAcc[toolLogAcc.length - 1].resultPreview;
            }
          } else if (ev.type === 'error') {
            finalData = { error: ev.error, final: '', toolLog: [] };
          }
          setMessages([...next, { ...assistant }]);
        }
      }
      if (!finalData) {
        finalData = { final: assistant.content ? '' : '[No response received from model.]', thinking: '', toolLog: toolLogAcc };
      }
      if (finalData) {
        let finalText = finalData.final || '';
        if (!finalText && !(finalData.toolLog && finalData.toolLog.length) && !assistant.content.trim()) {
          finalText = '[Model returned an empty response. Try a chat-capable model like llama3.2:3b or mistral:7b.]';
        }
        if (finalData.error) finalText = 'Error: ' + finalData.error;
        if (finalText && !assistant.content.includes(finalText)) {
          assistant.content += finalText;
        }
        assistant.thinking = finalData.thinking || '';
        const tl = (finalData.toolLog && finalData.toolLog.length) ? finalData.toolLog : toolLogAcc;
        if (tl && tl.length) {
          setToolLog((prev) => [...prev, ...tl.map((t) => ({ ...t, ts: Date.now() }))]);
        }
        const cites = [];
        for (const t of (tl || [])) {
          if (t.name === 'web_search') {
            const urls = (t.resultPreview || '').match(/https?:\/\/[^\s)]+/g) || [];
            cites.push(...urls);
          }
        }
        assistant.citations = [...new Set(cites)].slice(0, 5);
        if (finalData.tokenStats) assistant.tokenStats = finalData.tokenStats;
      }
      setMessages([...next, { ...assistant }]);
      // auto-save
      try {
        const r = await fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Chat', messages: [...next, assistant] }) });
        const d = await r.json();
        if (d.id) setChatId(d.id);
      } catch (e) {}
    } catch (e) {
      console.error('send() error:', e);
      assistant.content = 'Error: ' + friendlyError(e);
      setMessages([...next, { ...assistant }]);
    } finally {
      setBusy(false);
      setAbortCtrl(null);
    }
  }

  async function saveChat() {
    const r = await fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Chat', messages }) });
    const d = await r.json();
    if (d.id) setChatId(d.id);
  }

  async function branchChat() {
    if (!chatId) { await saveChat(); }
    const id = chatId || (await (async () => { const r = await fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Chat', messages }) }); const d = await r.json(); setChatId(d.id); return d.id; })());
    const r = await fetch('/api/chats/branch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, atIndex: messages.length }) });
    const d = await r.json();
    if (d.id) {
      const cr = await fetch('/api/chats/' + d.id);
      const cd = await cr.json();
      setMessages(cd.messages || []);
      setChatId(d.id);
    }
  }

  async function navigateParent() {
    if (!chatId) return;
    const chat = await (await fetch('/api/chats/' + chatId)).json();
    if (chat.parent_id) {
      const pr = await fetch('/api/chats/' + chat.parent_id);
      const pd = await pr.json();
      setMessages(pd.messages || []);
      setChatId(chat.parent_id);
      setBranches([]);
    }
  }

  async function loadBranches() {
    if (!chatId) return;
    try {
      const r = await fetch('/api/chats/branches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: chatId }) });
      const d = await r.json();
      setBranches(d.branches || []);
    } catch (e) { setBranches([]); }
  }

  async function addMemory() {
    if (!newMemory.trim()) return;
    await fetch('/api/memory/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: newMemory }) });
    setNewMemory('');
    refreshMemory();
  }

  async function delMemory(id) {
    await fetch('/api/memory/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    refreshMemory();
  }

  async function searchRag() {
    if (!ragQuery.trim()) return;
    try {
      const r = await fetch('/api/rag/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: ragQuery, limit: 10 }) });
      const d = await r.json();
      setRagResults(d.results || []);
    } catch (e) { setRagResults([]); }
  }

  async function addSkill() {
    if (!newSkillName.trim()) return;
    await fetch('/api/skills/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newSkillName, description: newSkillDesc, code: newSkillCode }) });
    setNewSkillName(''); setNewSkillDesc(''); setNewSkillCode('');
    refreshSkills();
  }

  async function delSkill(name) {
    await fetch('/api/skills/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    refreshSkills();
  }

  async function searchAre() {
    if (!areQuery.trim()) return;
    setAreLoading(true);
    try {
      const r = await fetch('/api/are-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: areQuery, limit: 30, category: areCategory, language: areLanguage, minStars: areMinStars }) });
      const d = await r.json();
      setAreResults(d.results || []);
    } catch (e) { setAreResults([]); }
    finally { setAreLoading(false); }
  }

  async function exportBackup() {
    const r = await fetch('/api/backup');
    const d = await r.json();
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'aegisai-backup.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function exportChatMd() {
    if (!messages.length) { alert('No chat to export'); return; }
    const lines = ['# Chat Export', ''];
    for (const m of messages) {
      lines.push('## ' + (m.role === 'user' ? 'User' : 'Assistant'));
      lines.push('');
      lines.push(m.content || '');
      lines.push('');
      if (m.tokenStats) lines.push('_Tokens: ' + m.tokenStats.prompt + ' in / ' + m.tokenStats.generated + ' out_');
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'chat-export.md'; a.click();
    URL.revokeObjectURL(url);
  }

  const card = 'bg-gray-800 border border-gray-700 rounded-lg';

  return (
    <div class="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      {showSidebar && (
        <div class="fixed inset-y-0 left-0 z-40 bg-gray-800 border-r border-gray-700 w-64 overflow-auto p-2 space-y-1 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div class="flex justify-between items-center mb-2">
            <span class="text-sm font-medium text-white">Chats</span>
            <button class="text-gray-400 hover:text-white" onClick={() => setShowSidebar(false)}>✕</button>
          </div>
          <button class="w-full text-left text-sm bg-blue-600 text-white rounded px-3 py-2 mb-2" onClick={() => { newChat(); setShowSidebar(false); }}>+ New chat</button>
          <input class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-xs text-gray-100 placeholder-gray-400 mb-2" value={chatSearch} onInput={(e) => setChatSearch(e.target.value)} placeholder="Search chats…" />
          <input class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-xs text-gray-100 placeholder-gray-400 mb-2" list="folderList" value={chatFolderFilter} onInput={(e) => setChatFolderFilter(e.target.value)} placeholder="Filter by folder (type to create)…" />
          <datalist id="folderList">
            <option value="">All folders</option>
            {[...new Set(chats.map((c) => c.folder).filter(Boolean))].map((f) => <option value={f} />)}
          </datalist>
          {loadingChats && chats.length === 0 && [1,2,3].map((i) => (
            <div key={i} class="w-full h-8 bg-gray-700/50 rounded animate-pulse mb-1" />
          ))}
          {chats.filter((c) => (!chatFolderFilter || (c.folder || '') === chatFolderFilter) && (!chatSearch || (c.title || '').toLowerCase().includes(chatSearch.toLowerCase()) || (c.snippet || '').toLowerCase().includes(chatSearch.toLowerCase()))).map((c) => (
            <button key={c.id} class={`w-full text-left text-xs rounded px-3 py-2 truncate ${chatId === c.id ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`} onClick={async () => { const r = await fetch('/api/chats/' + c.id); const d = await r.json(); setMessages(d.messages || []); setChatId(c.id); setShowSidebar(false); loadChats(); }}>
              {c.title || 'Untitled'}
            </button>
          ))}
        </div>
      )}
      <header class="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center gap-3">
        <h1 class="font-semibold text-lg text-white">AegisAI (next)</h1>
        <span class="text-xs text-gray-400">v{version}</span>
        <nav class="ml-4 flex gap-2">
          <button class="text-sm px-2 py-1 rounded text-gray-300 hover:bg-gray-700" onClick={() => { setShowSidebar((s) => !s); loadChats(); }}>Chats</button>
          {['chat', 'memory', 'skills', 'are', 'models', 'documents'].map((t) => (
            <button key={t} class={`text-sm px-2 py-1 rounded ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
        <div class="ml-auto flex items-center gap-2">
          {(() => { const chars = messages.reduce((a, m) => a + (m.content || '').length, 0); const pct = Math.min(100, Math.round((chars / 4 / 8192) * 100)); return <button class="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200" onClick={() => alert('Context: ~' + Math.round(chars/4) + ' tokens (' + pct + '% of 8192)\\nMessages: ' + messages.length)} title="Click for details"><div class="w-16 h-2 bg-gray-700 rounded overflow-hidden"><div class="h-full bg-blue-500" style={{ width: pct + '%' }} /></div><span>{pct}%</span></button>; })()}
          <select class="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => <option value={m}>{m}</option>)}
          </select>
          <button class="border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 hover:bg-gray-700" onClick={() => setShowSettings((s) => !s)}>Settings</button>
        </div>
      </header>

      {tab === 'chat' && (
        <>
          {branches.length > 0 && (
            <div class="px-4 py-1 flex gap-2 text-xs flex-wrap">
              {branches.map((b) => (
                <button key={b.id} class="border border-gray-600 rounded px-2 py-0.5 text-gray-200 hover:bg-gray-700" onClick={async () => { const r = await fetch('/api/chats/' + b.id); const d = await r.json(); setMessages(d.messages || []); setChatId(b.id); setBranches([]); }}>{b.title}</button>
              ))}
            </div>
          )}
          <div class="px-4 py-1 flex gap-2 text-xs items-center flex-wrap">
            <button class="border border-gray-600 rounded px-2 py-0.5 text-gray-200 hover:bg-gray-700" onClick={() => setShowToolLog((s) => !s)}>Tool log ({toolLog.length})</button>
            <button class="border border-gray-600 rounded px-2 py-0.5 text-gray-200 hover:bg-gray-700" onClick={async () => { const t = prompt('Chat title:', 'Chat'); if (t) { const f = prompt('Folder (optional):', ''); fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: chatId, title: t, messages, folder: f || null }) }); } }}>Rename</button>
            <button class="border border-gray-600 rounded px-2 py-0.5 text-gray-200 hover:bg-gray-700" onClick={saveChat}>Save chat</button>
            <button class="border border-gray-600 rounded px-2 py-0.5 text-gray-200 hover:bg-gray-700" onClick={branchChat}>Branch</button>
            <button class="border border-gray-600 rounded px-2 py-0.5 text-gray-200 hover:bg-gray-700" onClick={navigateParent}>Parent</button>
            <button class="border border-gray-600 rounded px-2 py-0.5 text-gray-200 hover:bg-gray-700" onClick={loadBranches}>Branches</button>
            <button class="border border-gray-600 rounded px-2 py-0.5 text-red-400 hover:bg-gray-700" onClick={async () => { if (!chatId) await saveChat(); if (chatId && confirm('Delete this chat?')) { await fetch('/api/chats/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: chatId }) }); setMessages([]); setChatId(null); } }}>Delete</button>
            <button class="border border-gray-600 rounded px-2 py-0.5 text-gray-200 hover:bg-gray-700" onClick={async () => { const blob = new Blob([JSON.stringify({ title: 'Chat', messages }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'chat.json'; a.click(); URL.revokeObjectURL(url); }}>Export</button>
            <button class="border border-gray-600 rounded px-2 py-0.5 text-gray-200 hover:bg-gray-700" onClick={async () => { const u = prompt('URL or text to squeeze:'); if (!u) return; const q = prompt('Question:'); if (!q) return; const r = await fetch('/api/squeeze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: u, question: q, model }) }); const d = await r.json(); if (d.ok) { setInput((prev) => (prev + '\n' + d.answer).trim()); } else { alert('Squeeze failed: ' + (d.error || 'unknown')); } }}>Squeeze</button>
            <label class="text-xs text-gray-400 flex items-center gap-1"><input type="checkbox" checked={cleanRoom} onChange={(e) => setCleanRoom(e.target.checked)} /> Clean room</label>
          </div>
          <main class="flex-1 overflow-auto p-4 space-y-3 max-w-3xl w-full mx-auto">
            {messages.map((m, i) => (
              <div key={i} class={`rounded-lg p-3 ${m.role === 'user' ? 'bg-blue-900/40 ml-8 border border-blue-800' : 'bg-gray-800 border border-gray-700'}`}>
                <div class="text-xs text-gray-400 mb-1 flex justify-between">
                  <span>{m.role}{m.role === 'assistant' && m.tokenStats ? ` · ${m.tokenStats.prompt}↑ ${m.tokenStats.generated}↓ tok` : ''}</span>
                  <div class="flex gap-1">
                    {m.role === 'user' && <button class="text-xs text-gray-400 hover:text-gray-200" onClick={() => { setInput(m.content || ''); setMessages(messages.slice(0, i)); }}>✏️</button>}
                    {m.role === 'assistant' && i > 0 && messages[i-1]?.role === 'user' && <button class="text-xs text-gray-400 hover:text-gray-200" onClick={() => { const prev = messages[i-1]; const trimmed = messages.slice(0, i); setMessages(trimmed); setInput(prev.content || ''); setTimeout(() => send(prev.content || ''), 50); }} title="Regenerate">🔄</button>}
                    {m.role === 'assistant' && <button class="text-xs text-gray-400 hover:text-gray-200" onClick={() => { const u = new SpeechSynthesisUtterance(m.content); window.speechSynthesis.speak(u); }}>🔊</button>}
                  </div>
                </div>
                {m.thinking && (
                  <details class="mb-2">
                    <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300">💭 Thinking</summary>
                    <div class="text-xs text-gray-400 mt-1 whitespace-pre-wrap bg-gray-900/50 rounded p-2">{m.thinking}</div>
                  </details>
                )}
                <div class="text-sm text-gray-100 prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: (function() { try { const html = marked.parse(m.content || ''); return (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(html) : html; } catch (e) { return (m.content || '').replace(/</g, '&lt;'); } })() }} />
                {m.images && m.images.length > 0 && <div class="mt-2 flex gap-2 flex-wrap">{m.images.map((img, i) => <img key={i} src={'data:image/png;base64,' + img} class="max-w-xs rounded border border-gray-600" alt="attached" />)}</div>}
{m.citations && m.citations.length > 0 && (
                  <div class="mt-2 flex flex-wrap gap-1">
                    {m.citations.map((c, i) => {
                      let host = c;
                      try { host = new URL(c).hostname; } catch (e) {}
                      return (
                        <a key={i} href={c} target="_blank" class="text-xs text-blue-400 border border-blue-800 rounded px-2 py-0.5 hover:bg-blue-900/30">{host}</a>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {busy && <div class="text-sm text-gray-400">Thinking…</div>}
            {(() => { const chars = messages.reduce((a, m) => a + (m.content || '').length, 0); const pct = Math.round((chars / 4 / 8192) * 100); return pct > 80 ? <div class="text-xs text-yellow-400">⚠ Context {pct}% full — consider starting a new chat</div> : null; })()}
          </main>
          {showToolLog && toolLog.length > 0 && (
            <div class="px-4 py-2 max-w-3xl w-full mx-auto">
              <div class="bg-gray-800 border border-gray-700 rounded p-2 max-h-40 overflow-auto text-xs font-mono text-gray-300 space-y-1">
                {toolLog.map((t, i) => (
                  <div key={i}>{t.name}: {String(t.resultPreview || '').slice(0, 120)}</div>
                ))}
              </div>
            </div>
          )}
          <footer class="bg-gray-800 border-t border-gray-700 p-3">
            <div class="max-w-3xl mx-auto flex gap-2">
              <button class="border border-gray-600 rounded px-2 py-2 text-sm text-gray-200 hover:bg-gray-700" onClick={() => {
                const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SR) { alert('Speech recognition not supported'); return; }
                const rec = new SR();
                rec.onresult = (e) => { setInput((prev) => (prev + ' ' + e.results[0][0].transcript).trim()); };
                rec.start();
              }}>🎤</button>
              <input class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-400" value={input} onInput={(e) => setInput(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Enter') { send(); } else if (e.key === 'Escape' && busy) { e.preventDefault(); abortCtrl?.abort(); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); if (inputHistory.length === 0) return; const newIdx = historyIdx === -1 ? inputHistory.length - 1 : Math.max(0, historyIdx - 1); setHistoryIdx(newIdx); setInput(inputHistory[newIdx]); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); if (historyIdx === -1) return; const newIdx = historyIdx + 1; if (newIdx >= inputHistory.length) { setHistoryIdx(-1); setInput(''); } else { setHistoryIdx(newIdx); setInput(inputHistory[newIdx]); } }
              }} placeholder="Message… (↑↓ history, Esc stop)" disabled={busy} />
              {pendingImage && <img src={'data:image/png;base64,' + pendingImage} class="h-10 w-10 object-cover rounded border border-gray-600" alt="pending" />}
              <label class="bg-gray-700 text-gray-200 rounded px-3 py-2 text-sm cursor-pointer hover:bg-gray-600" title="Attach image">
                📎
                <input type="file" accept="image/*" class="hidden" onChange={async (e) => {
                  const f = e.target.files[0]; if (!f) return;
                  const buf = await f.arrayBuffer();
                  const bytes = new Uint8Array(buf);
                  let binary = '';
                  const chunkSize = 0x8000;
                  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
                  setPendingImage(btoa(binary));
                  e.target.value = '';
                }} />
              </label>
              <button class="bg-gray-700 text-gray-200 rounded px-3 py-2 text-sm hover:bg-gray-600" title="Voice input" onClick={() => {
                const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SR) { alert('Voice input requires Chrome or Edge (SpeechRecognition not available in this browser).'); return; }
                const rec = new SR();
                rec.lang = 'en-US';
                rec.interimResults = false;
                rec.onresult = (e) => { const t = e.results[0][0].transcript; setInput((prev) => (prev + ' ' + t).trim()); };
                rec.onerror = (e) => alert('Voice error: ' + e.error);
                rec.start();
              }}>🎤</button>
              <button class="bg-blue-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50" onClick={() => send()} disabled={busy}>Send</button>
              {busy && <button class="bg-red-600 text-white rounded px-4 py-2 text-sm" onClick={() => abortCtrl?.abort()}>Stop</button>}
            </div>
          </footer>
        </>
      )}

      {tab === 'memory' && (
        <main class="flex-1 overflow-auto p-4 max-w-3xl w-full mx-auto space-y-3">
          <div class="flex gap-2">
            <input class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-400" value={newMemory} onInput={(e) => setNewMemory(e.target.value)} placeholder="New memory…" />
            <button class="bg-blue-600 text-white rounded px-4 py-2 text-sm" onClick={addMemory}>Add</button>
            <button class="border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 hover:bg-gray-700" onClick={async () => { if (messages.length === 0) { alert('No chat to extract from'); return; } const r = await fetch('/api/memory/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, model }) }); const d = await r.json(); if (d.ok && d.facts && d.facts.length) { for (const f of d.facts) { await fetch('/api/memory/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: f }) }); } refreshMemory(); alert('Extracted ' + d.facts.length + ' facts'); } else { alert('No facts extracted'); } }}>Extract from chat</button>
          </div>
          {memories.map((m) => (
            <div key={m.id} class={`${card} p-3 flex justify-between items-start`}>
              <div class="text-sm text-gray-100">{m.text}</div>
              <div class="flex gap-1">
                <button class="text-blue-400 text-xs" onClick={async () => { const t = prompt('Edit memory:', m.text); if (t !== null) { await fetch('/api/memory/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id, text: t }) }); refreshMemory(); } }}>edit</button>
                <button class="text-red-400 text-xs" onClick={() => delMemory(m.id)}>del</button>
              </div>
            </div>
          ))}
          <div class="mt-4 space-y-2">
            <div class="text-sm text-gray-300 font-medium">RAG search</div>
            <div class="flex gap-2">
              <input class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-400" value={ragQuery} onInput={(e) => setRagQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') searchRag(); }} placeholder="Search memories by meaning…" />
              <button class="bg-blue-600 text-white rounded px-4 py-2 text-sm" onClick={searchRag}>Search</button>
              <button class="border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 hover:bg-gray-700" onClick={async () => { const r = await fetch('/api/rag/reindex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); const d = await r.json(); alert('Reindexed ' + (d.reindexed || 0) + '/' + (d.total || 0)); }}>Reindex</button>
            </div>
            {ragResults.map((r, i) => (
              <div key={i} class="bg-gray-800 border border-gray-700 rounded p-2 text-sm text-gray-300">
                {r.score !== undefined && <span class="text-xs text-gray-500 mr-2">{r.score.toFixed(3)}</span>}
                {r.text}
              </div>
            ))}
          </div>
        </main>
      )}

      {tab === 'skills' && (
        <main class="flex-1 overflow-auto p-4 max-w-3xl w-full mx-auto space-y-3">
          <div class={`space-y-2 border border-gray-700 rounded p-3 ${card}`}>
            <input class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-400" value={newSkillName} onInput={(e) => setNewSkillName(e.target.value)} placeholder="Skill name" />
            <input class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-400" value={newSkillDesc} onInput={(e) => setNewSkillDesc(e.target.value)} placeholder="Description" />
            <textarea class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm font-mono text-gray-100 placeholder-gray-400" rows="4" value={newSkillCode} onInput={(e) => setNewSkillCode(e.target.value)} placeholder="Code" />
            <button class="bg-blue-600 text-white rounded px-4 py-2 text-sm" onClick={addSkill}>Save skill</button>
          </div>
          {skills.map((s) => (
            <div key={s.name} class={`${card} p-3 flex justify-between items-start`}>
              <div>
                <div class="font-medium text-sm text-gray-100">{s.name}</div>
                <div class="text-xs text-gray-400">{s.description}</div>
              </div>
              <div class="flex gap-1">
                <button class="text-blue-400 text-xs" onClick={async () => { const desc = prompt('Description:', s.description); if (desc === null) return; const code = prompt('Code:', s.code); if (code === null) return; await fetch('/api/skills/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: s.name, description: desc, code }) }); refreshSkills(); }}>edit</button>
                <button class="text-blue-400 text-xs" onClick={async () => { const r = await fetch('/api/skills/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: s.name, args: {} }) }); const d = await r.json(); alert(d.ok ? ('Result: ' + JSON.stringify(d.result)) : ('Error: ' + d.error)); }}>run</button>
                <button class="text-red-400 text-xs" onClick={() => delSkill(s.name)}>del</button>
              </div>
            </div>
          ))}
        </main>
      )}

      {tab === 'documents' && (
        <main class="flex-1 overflow-auto p-4 max-w-3xl w-full mx-auto space-y-3">
          <div class={`space-y-2 border border-gray-700 rounded p-3 ${card}`}>
            <div class="text-sm text-gray-200 font-medium">Upload PDF</div>
            <input type="file" accept="application/pdf" class="text-sm text-gray-300" onChange={async (e) => {
              const f = e.target.files[0]; if (!f) return;
              const buf = await f.arrayBuffer();
              const bytes = new Uint8Array(buf);
              let binary = '';
              const chunkSize = 0x8000;
              for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
              }
              const b64 = btoa(binary);
              const r = await fetch('/api/documents/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data: b64 }) });
              const d = await r.json();
              if (d.ok) { alert('Uploaded: ' + d.name + ' (' + d.chunks + ' chunks)'); refreshDocuments(); }
              else { alert('Upload failed: ' + (d.error || 'unknown')); }
              e.target.value = '';
            }} />
            <label class="flex items-center gap-2 text-xs text-gray-300 mt-2">
              <input type="checkbox" checked={includeDocuments} onChange={(e) => setIncludeDocuments(e.target.checked)} /> Include documents in chat context
            </label>
          </div>
          {documents.map((d) => (
            <div key={d.id} class={`${card} p-3 flex justify-between items-start`}>
              <div>
                <div class="font-medium text-sm text-gray-100">{d.name}</div>
                <div class="text-xs text-gray-400">{d.created}</div>
              </div>
              <button class="text-red-400 text-xs" onClick={async () => { await fetch('/api/documents/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.id }) }); refreshDocuments(); }}>del</button>
            </div>
          ))}
          {documents.length === 0 && <div class="text-xs text-gray-500">No documents uploaded.</div>}
        </main>
      )}

      {tab === 'are' && (
        <main class="flex-1 overflow-auto p-4 max-w-3xl w-full mx-auto space-y-3">
          <div class="flex gap-2 flex-wrap">
            <input class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-400" value={areQuery} onInput={(e) => setAreQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') searchAre(); }} placeholder="Search reverse-engineered projects…" />
            <input class="w-28 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-sm text-gray-100 placeholder-gray-400" value={areCategory} onInput={(e) => setAreCategory(e.target.value)} placeholder="Category" />
            <input class="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-sm text-gray-100 placeholder-gray-400" value={areLanguage} onInput={(e) => setAreLanguage(e.target.value)} placeholder="Language" />
            <input class="w-20 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-sm text-gray-100 placeholder-gray-400" type="number" value={areMinStars} onInput={(e) => setAreMinStars(parseInt(e.target.value) || 0)} placeholder="Min★" />
            <button class="bg-blue-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50" onClick={searchAre} disabled={areLoading}>{areLoading ? 'Searching…' : 'Search'}</button>
          </div>
          {areResults.map((r, i) => (
            <div key={i} class="bg-gray-800 border border-gray-700 rounded p-3">
              <div class="flex justify-between items-start">
                <a href={r.url} target="_blank" class="font-medium text-sm text-blue-400 hover:underline">{r.name}</a>
                {r.stars && <span class="text-xs text-gray-500">{r.stars} ⭐</span>}
              </div>
              <div class="text-xs text-gray-400 mt-1">{r.description}</div>
              <div class="text-xs text-gray-500 mt-1">{r.category} {r.language ? '· ' + r.language : ''}</div>
              {r.url && <button class="text-xs text-blue-400 mt-1 hover:underline" onClick={async () => { const rr = await fetch('/api/are-readme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: r.url }) }); const d = await rr.json(); setAreReadme(d.content || 'No README'); }}>Preview README</button>}
            </div>
          ))}
          {areResults.length === 0 && areQuery && !areLoading && <div class="text-sm text-gray-500">No results. Try "Update index" in Settings first.</div>}
        </main>
      )}

      {areReadme !== null && (
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center" onClick={() => setAreReadme(null)}>
          <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 w-full max-w-2xl max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h2 class="font-semibold mb-2 text-white">README Preview</h2>
            <pre class="text-xs text-gray-300 whitespace-pre-wrap">{areReadme}</pre>
            <button class="mt-3 border border-gray-600 rounded px-3 py-1 text-sm text-gray-200 hover:bg-gray-700" onClick={() => setAreReadme(null)}>Close</button>
          </div>
        </div>
      )}

      {tab === 'models' && (
        <main class="flex-1 overflow-auto p-4 max-w-3xl w-full mx-auto space-y-3">
          <div class="flex gap-2">
            <input class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-400" value={modelSearch} onInput={(e) => setModelSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { (async () => { if (!modelSearch.trim()) return; setModelSearching(true); try { const r = await fetch('/api/model-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: modelSearch }) }); const d = await r.json(); setModelSearchResults(d.results || []); } catch (e) { setModelSearchResults([]); } finally { setModelSearching(false); } })(); } }} placeholder="Search models (HuggingFace + Ollama)…" />
            <button class="bg-blue-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50" disabled={modelSearching} onClick={async () => { if (!modelSearch.trim()) return; setModelSearching(true); try { const r = await fetch('/api/model-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: modelSearch }) }); const d = await r.json(); setModelSearchResults(d.results || []); } catch (e) { setModelSearchResults([]); } finally { setModelSearching(false); } }}>{modelSearching ? 'Searching…' : 'Search'}</button>
          </div>
          {modelSearchResults.length > 0 && (
            <div class="space-y-1 max-h-60 overflow-auto">
              {modelSearchResults.map((r, i) => (
                <div key={i} class="bg-gray-800 border border-gray-700 rounded p-2 text-xs flex justify-between items-center">
                  <div>
                    <span class="text-gray-400 mr-1">[{r.source}]</span>
                    <span class="text-gray-200">{r.name}</span>
                    {r.downloads && <span class="text-gray-500 ml-2">{r.downloads} dl</span>}
                  </div>
                  {r.source === 'ollama' && <button class="text-blue-400 hover:underline" onClick={() => setPullModel(r.name + ':latest')}>pull</button>}
                  {r.source === 'huggingface' && <button class="text-blue-400 hover:underline" onClick={() => { window.open(r.url, '_blank'); }}>open</button>}
                </div>
              ))}
            </div>
          )}
          <div class="flex gap-2 mt-2">
            <input class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-400" value={pullModel} onInput={(e) => setPullModel(e.target.value)} placeholder="Model name (e.g. llama3.2:3b)" />
            <button class="bg-blue-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50" disabled={pulling} onClick={async () => { if (!pullModel.trim()) return; setPulling(true); setPullMsg('Pulling...'); try { const r = await fetch('/api/pull-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: pullModel }) }); const d = await r.json(); setPullMsg(d.message || (d.ok ? 'Done' : 'Failed')); if (d.ok) { const mr = await fetch('/api/models'); const md = await mr.json(); setModels((md.models || []).map((m) => m.name)); } } catch (e) { setPullMsg('Error: ' + e.message); } finally { setPulling(false); } }}>{pulling ? 'Pulling…' : 'Pull'}</button>
          </div>
          {pullMsg && <div class="text-xs text-gray-400">{pullMsg}</div>}
          <div class="text-sm text-gray-300 font-medium mt-2">Quick pull recommended:</div>
          <div class="flex flex-wrap gap-2">
            {['llama3.2:3b', 'qwen2.5-coder:7b', 'mistral:7b', 'nomic-embed-text', 'moondream'].map((m) => (
              <button key={m} class="text-xs border border-gray-600 rounded px-2 py-1 text-gray-200 hover:bg-gray-700" onClick={() => setPullModel(m)}>{m}</button>
            ))}
          </div>
          <div class="mt-3">
            <button class="border border-gray-600 rounded px-3 py-1 text-sm text-gray-200 hover:bg-gray-700" onClick={async () => { const m1 = prompt('Model 1:', models[0] || ''); if (!m1) return; const m2 = prompt('Model 2:', models[1] || ''); if (!m2) return; const q = prompt('Prompt:'); if (!q) return; const r = await fetch('/api/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ models: [m1, m2], prompt: q }) }); const d = await r.json(); if (d.ok) { alert(m1 + ':\n' + (d.results[0].content || d.results[0].error) + '\n\n---\n\n' + m2 + ':\n' + (d.results[1].content || d.results[1].error)); } else { alert('Failed: ' + (d.error || 'unknown')); } }}>Compare models (A/B)</button>
          </div>
          {scanResults.length > 0 && (
            <div class="space-y-1">
              {scanResults.map((s, i) => (
                <div key={i} class="bg-gray-800 border border-gray-700 rounded p-2 text-xs text-gray-300">
                  <span class="text-gray-400">{s.type}</span> — {s.label || s.path}
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {showOnboarding && (
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div class="bg-gray-800 border border-gray-700 rounded-lg p-6 w-96 text-center">
            <h2 class="text-xl font-bold text-white mb-2">Welcome to AegisAI (next)</h2>
            <p class="text-sm text-gray-300 mb-4">No models found. Let's get you set up.</p>
            <div class="space-y-2">
              <button class="w-full bg-blue-600 text-white rounded px-4 py-2 text-sm" onClick={async () => {
                setOnboardingPulling(true); setOnboardingPullMsg('Pulling llama3.2:3b...');
                try {
                  const r = await fetch('/api/pull-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'llama3.2:3b' }) });
                  const d = await r.json();
                  setOnboardingPullMsg(d.message || (d.ok ? 'Done!' : 'Failed'));
                  if (d.ok) {
                    const mr = await fetch('/api/models'); const md = await mr.json();
                    const ms = (md.models || []).map((m) => m.name);
                    setModels(ms); if (ms.length) setModel(ms[0]);
                    setShowOnboarding(false);
                  }
                } catch (e) { setOnboardingPullMsg('Error: ' + e.message); }
                finally { setOnboardingPulling(false); }
              }} disabled={onboardingPulling}>{onboardingPulling ? 'Pulling…' : 'Pull llama3.2:3b (recommended)'}</button>
              <button class="w-full border border-gray-600 text-gray-200 rounded px-4 py-2 text-sm" onClick={() => setShowOnboarding(false)}>Skip — I'll configure later</button>
            </div>
            {onboardingPullMsg && <p class="text-xs text-gray-400 mt-3">{onboardingPullMsg}</p>}
            <p class="text-xs text-gray-500 mt-3">Make sure Ollama is running: <code class="text-gray-300">ollama serve</code></p>
          </div>
        </div>
      )}

      {showSettings && (
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center" onClick={() => setShowSettings(false)}>
          <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 w-96" onClick={(e) => e.stopPropagation()}>
            <h2 class="font-semibold mb-2 text-white">Settings</h2>
            <h3 class="text-sm font-medium mt-2 mb-1 text-gray-200">Integrations</h3>
            <ul class="text-sm space-y-1">
              {Object.entries(integrations).filter(([name]) => name !== '_backend').map(([name, s]) => (
                <li key={name} class="text-gray-300">
                  <div class="flex justify-between items-center">
                    <span>{name}</span>
                    <span class={s.ready ? 'text-green-400' : 'text-gray-500'}>{s.ready ? 'ready' : 'off'} ({s.toolCount || 0} tools)</span>
                  </div>
                  {s.note && <div class="text-xs text-gray-500 ml-2">{s.note}</div>}
                  {!s.ready && s.error && <div class="text-xs text-gray-500 ml-2">{s.error}</div>}
                  {name === 'rea' && (
                    <button class="text-xs text-blue-400 ml-2 mt-1 block cursor-pointer hover:underline" onClick={async () => { const r = await fetch('/api/integrations/rea/update', { method: 'POST' }); const d = await r.json(); alert(d.ok ? 'REA updated' : ('Update failed: ' + (d.error || d.output || 'unknown'))); const st = await (await fetch('/api/integrations/status')).json(); const b = await (await fetch('/api/backend')).json(); setIntegrations({ ...st, _backend: b }); }}>Update REA</button>
                  )}
                  {name === 'awesome-re' && (
                    <button class="text-xs text-blue-400 ml-2 mt-1 block cursor-pointer hover:underline" onClick={async () => { const r = await fetch('/api/integrations/awesome-re/update', { method: 'POST' }); const d = await r.json(); alert(d.ok ? ('Index updated: ' + d.count + ' entries') : ('Update failed: ' + (d.error || 'unknown'))); const st = await (await fetch('/api/integrations/status')).json(); const b = await (await fetch('/api/backend')).json(); setIntegrations({ ...st, _backend: b }); }}>Update index</button>
                  )}
                  {name === 'ghidra' && (
                    <>
                      {!s.ready && <button class="text-xs text-blue-400 ml-2 mt-1" onClick={async () => { const v = prompt('Ghidra MCP URL (e.g. http://127.0.0.1:8089):'); if (v) { await fetch('/api/integrations/ghidra/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envKey: 'GHIDRA_MCP_URL', value: v }) }); const st = await (await fetch('/api/integrations/status')).json(); const b = await (await fetch('/api/backend')).json(); setIntegrations({ ...st, _backend: b }); } }}>Configure</button>}
                      <button class="text-xs text-green-400 ml-2 mt-1" onClick={async () => { if (!confirm('Download Ghidra + GhidrAssistMCP? (~500MB, may take a few minutes)')) return; const r = await fetch('/api/integrations/ghidra/install-mcp', { method: 'POST' }); const d = await r.json(); alert(d.ok ? ('Installed to: ' + d.extracted) : ('Failed: ' + (d.error || 'unknown'))); const st = await (await fetch('/api/integrations/status')).json(); const b = await (await fetch('/api/backend')).json(); setIntegrations({ ...st, _backend: b }); }}>Install Ghidra+MCP</button>
                      <button class="text-xs text-yellow-400 ml-2 mt-1" onClick={async () => { const r = await fetch('/api/integrations/ghidra/detect', { method: 'POST' }); const d = await r.json(); alert(d.ok ? ('Detected MCP at ' + d.url) : 'No Ghidra MCP detected. Open Ghidra and enable the extension.'); const st = await (await fetch('/api/integrations/status')).json(); const b = await (await fetch('/api/backend')).json(); setIntegrations({ ...st, _backend: b }); }}>Detect MCP</button>
                      {s.installDir && <div class="text-xs text-gray-500 ml-2">Ghidra: {s.installDir}</div>}
                    </>
                  )}
                  {name === 'craft' && (
                    <>
                      {!s.ready && <button class="text-xs text-blue-400 ml-2 mt-1" onClick={async () => { const v = prompt('Path to craft-anything-cli binary:'); if (v) { await fetch('/api/integrations/craft/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envKey: 'CRAFT_BIN', value: v }) }); const st = await (await fetch('/api/integrations/status')).json(); const b = await (await fetch('/api/backend')).json(); setIntegrations({ ...st, _backend: b }); } }}>Configure</button>}
                      <button class="text-xs text-green-400 ml-2 mt-1" onClick={async () => { if (!confirm('Download/build craft-anything? (may take a few minutes)')) return; const r = await fetch('/api/integrations/craft/install', { method: 'POST' }); const d = await r.json(); alert(d.ok ? ('Installed: ' + d.binary) : ('Failed: ' + (d.error || 'unknown'))); const st = await (await fetch('/api/integrations/status')).json(); const b = await (await fetch('/api/backend')).json(); setIntegrations({ ...st, _backend: b }); }}>Install craft</button>
                      <button class="text-xs text-yellow-400 ml-2 mt-1" onClick={async () => { if (!confirm('Download and install Rust toolchain? (may take a few minutes)')) return; const r = await fetch('/api/integrations/craft/install-rust', { method: 'POST' }); const d = await r.json(); alert(d.ok ? 'Rust installed' : ('Failed: ' + (d.error || d.output || 'unknown'))); }}>Install Rust</button>
                    </>
                  )}
                  {name === 'voice' && (
                    <button class="text-xs text-blue-400 ml-2 mt-1" onClick={async () => { const v = prompt('STT_URL (leave blank to skip):'); const t = prompt('TTS_URL (leave blank to skip):'); await fetch('/api/integrations/voice/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envKey: 'STT_URL', value: v || '' }) }); await fetch('/api/integrations/voice/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envKey: 'TTS_URL', value: t || '' }) }); const st = await (await fetch('/api/integrations/status')).json(); const b = await (await fetch('/api/backend')).json(); setIntegrations({ ...st, _backend: b }); }}>Configure audio</button>
                  )}
                </li>
              ))}
            </ul>
            <div class="mt-3 text-xs text-gray-400 space-y-1">
              <div>Backend: <span class="text-gray-200">{(integrations._backend || {}).type || 'loading…'}</span> at <span class="text-gray-200">{(integrations._backend || {}).url || ''}</span></div>
            </div>
            <div class="mt-2 flex items-center gap-2 text-xs text-gray-300">
              <label>Search engine:</label>
              <select class="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100" id="searchEngine" defaultValue="duckduckgo" onChange={async (e) => { await fetch('/api/search-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: e.target.value }) }); }}>
                <option value="duckduckgo">DuckDuckGo</option>
                <option value="wikipedia">Wikipedia</option>
                <option value="searxng">SearXNG</option>
                <option value="google-html">Google</option>
                <option value="internet-archive">Internet Archive</option>
                <option value="langsearch">LangSearch</option>
              </select>
            </div>
            <div class="mt-2 flex items-center gap-2 text-xs text-gray-300">
              <select class="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100" id="backendType" defaultValue={(integrations._backend || {}).type || 'ollama'}>
                <option value="ollama">ollama</option>
                <option value="llamacpp">llamacpp</option>
                <option value="lmstudio">lmstudio</option>
                <option value="openai">openai</option>
                <option value="strata">strata</option>
              </select>
              <input class="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100" id="backendUrl" placeholder="http://127.0.0.1:11434" defaultValue={(integrations._backend || {}).url || ''} />
              <button class="border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 hover:bg-gray-700" onClick={async () => {
                const t = document.getElementById('backendType').value;
                const u = document.getElementById('backendUrl').value;
                const r = await fetch('/api/backend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: t, url: u }) });
                const d = await r.json();
                alert(d.ok ? ('Backend switched to ' + d.type) : ('Failed: ' + (d.error || 'unknown')));
                const st = await (await fetch('/api/integrations/status')).json();
                const b = await (await fetch('/api/backend')).json();
                setIntegrations({ ...st, _backend: b });
              }}>Apply</button>
            </div>
            <div class="mt-2 flex items-center gap-2 text-xs text-gray-300">
              <label>Auth token (Docker):</label>
              <input class="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100" placeholder="paste AEGISAI_TOKEN" defaultValue={localStorage.getItem('aegisai_token') || ''} onChange={(e) => { const v = e.target.value.trim(); if (v) localStorage.setItem('aegisai_token', v); else localStorage.removeItem('aegisai_token'); }} />
            </div>
            <div class="mt-2 flex items-center gap-2 text-xs text-gray-300">
              <label>Max history (msgs):</label>
              <input class="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100" defaultValue={settingsCfg.maxHistory || 20} onChange={async (e) => { const v = parseInt(e.target.value, 10); if (v > 0) { const cfg = await (await fetch('/api/settings')).json(); cfg.maxHistory = v; await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }); setSettingsCfg(cfg); } }} />
              <label>Max tokens:</label>
              <input class="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100" defaultValue={settingsCfg.maxTokens != null ? settingsCfg.maxTokens : 0} placeholder="0=unlimited" onChange={async (e) => { const v = parseInt(e.target.value, 10); if (v >= 0) { const cfg = await (await fetch('/api/settings')).json(); cfg.maxTokens = v; await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }); setSettingsCfg(cfg); } }} />
            </div>
            <div class="mt-2 flex items-center gap-2 text-xs text-gray-300">
              <label>Fallback models (comma-sep):</label>
              <input class="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100" placeholder="e.g. llama3.2:3b,mistral:7b" defaultValue={(settingsCfg.fallbackModels || []).join(',')} onChange={async (e) => { const v = e.target.value.trim(); const models = v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []; const cfg = await (await fetch('/api/settings')).json(); cfg.fallbackModels = models; await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }); setSettingsCfg(cfg); }} />
            </div>
            <div class="mt-2 flex items-center gap-2 text-xs text-gray-300">
              <label><input type="checkbox" defaultChecked={!!settingsCfg.includeMemories} onChange={async (e) => { const cfg = await (await fetch('/api/settings')).json(); cfg.includeMemories = e.target.checked; await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }); setSettingsCfg(cfg); }} /> Inject relevant memories (RAG)</label>
            </div>
            <div class="mt-3 flex gap-2">
              <button class="border border-gray-600 rounded px-3 py-1 text-sm text-gray-200 hover:bg-gray-700" onClick={async () => { const r = await fetch('/api/versions'); const d = await r.json(); alert('AegisAI: ' + d.aegisai + '\nNode: ' + d.node + '\nOllama: ' + d.ollama + '\nREA: ' + (d.rea && d.rea.toolCount) + ' tools'); }}>Check versions</button>
              <button class="border border-gray-600 rounded px-3 py-1 text-sm text-gray-200 hover:bg-gray-700" onClick={async () => { const r = await fetch('/api/error-log'); const d = await r.json(); alert((d.content || '').slice(-1000) || 'No errors logged'); }}>View error log</button>
            </div>
            <div class="mt-3 flex gap-2">
              <button class="border border-gray-600 rounded px-3 py-1 text-sm text-gray-200 hover:bg-gray-700" onClick={exportBackup}>Export backup</button>
              <button class="border border-gray-600 rounded px-3 py-1 text-sm text-gray-200 hover:bg-gray-700" onClick={exportChatMd}>Export chat (MD)</button>
              <label class="border border-gray-600 rounded px-3 py-1 text-sm text-gray-200 hover:bg-gray-700 cursor-pointer">
                Import backup
                <input type="file" accept="application/json" class="hidden" onChange={async (e) => { const f = e.target.files[0]; if (!f) return; const text = await f.text(); const data = JSON.parse(text); const r = await fetch('/api/backup/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const d = await r.json(); alert(d.ok ? 'Imported' : ('Failed: ' + (d.error || 'unknown'))); refreshMemory(); refreshSkills(); }} />
              </label>
            </div>
            <p class="text-xs text-gray-500 mt-3">RAG reindex available via /api/rag/reindex.</p>
            <div class="mt-3 border-t border-gray-700 pt-3">
              <div class="text-xs text-gray-400 mb-1">Raw settings (JSON):</div>
              <textarea key={JSON.stringify(settingsCfg)} class="w-full h-32 bg-gray-900 border border-gray-700 rounded p-2 text-xs font-mono text-gray-200" defaultValue={JSON.stringify(settingsCfg, null, 2)} onBlur={async (e) => { try { const cfg = JSON.parse(e.target.value); await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }); setSettingsCfg(cfg); alert('Settings saved'); } catch (err) { alert('Invalid JSON: ' + err.message); } }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}