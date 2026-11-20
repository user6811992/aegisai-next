import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';

export default function App() {
  const [version, setVersion] = useState('...');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [integrations, setIntegrations] = useState({});
  const [tab, setTab] = useState('chat');
  const [memories, setMemories] = useState([]);
  const [skills, setSkills] = useState([]);
  const [newMemory, setNewMemory] = useState('');
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillDesc, setNewSkillDesc] = useState('');
  const [newSkillCode, setNewSkillCode] = useState('');
  const [chatId, setChatId] = useState(null);

  const refreshMemory = () => fetch('/api/memory').then((r) => r.json()).then((d) => setMemories(d.memories || [])).catch(() => {});
  const refreshSkills = () => fetch('/api/skills').then((r) => r.json()).then((d) => setSkills(d.skills || [])).catch(() => {});

  useEffect(() => {
    fetch('/api/version').then((r) => r.json()).then((d) => setVersion(d.version)).catch(() => setVersion('?'));
    fetch('/api/models').then((r) => r.json()).then((d) => {
      const ms = (d.models || []).map((m) => m.name);
      setModels(ms);
      if (ms.length && !model) setModel(ms[0]);
    }).catch(() => {});
    fetch('/api/integrations/status').then((r) => r.json()).then(setIntegrations).catch(() => {});
    refreshMemory();
    refreshSkills();
  }, []);

  async function send() {
    if (!input.trim() || busy) return;
    const userMsg = { role: 'user', content: input };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setBusy(true);
    const assistant = { role: 'assistant', content: '' };
    setMessages([...next, assistant]);
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: next, includeCoding: true }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'token') {
              assistant.content += evt.content || '';
              setMessages([...next, { ...assistant }]);
            } else if (evt.type === 'tool_call') {
              assistant.content += `\n🔧 ${evt.name}\n`;
              setMessages([...next, { ...assistant }]);
            } else if (evt.type === 'done') {
              if (evt.final && !assistant.content) assistant.content = evt.final;
              setMessages([...next, { ...assistant }]);
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      assistant.content = 'Error: ' + (e.message || e);
      setMessages([...next, { ...assistant }]);
    } finally {
      setBusy(false);
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

  async function exportBackup() {
    const r = await fetch('/api/backup');
    const d = await r.json();
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'aegisai-backup.json'; a.click();
    URL.revokeObjectURL(url);
  }

  const card = 'bg-gray-800 border border-gray-700 rounded-lg';

  return (
    <div class="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <header class="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center gap-3">
        <h1 class="font-semibold text-lg text-white">AegisAI (next)</h1>
        <span class="text-xs text-gray-400">v{version}</span>
        <nav class="ml-4 flex gap-2">
          {['chat', 'memory', 'skills'].map((t) => (
            <button key={t} class={`text-sm px-2 py-1 rounded ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
        <div class="ml-auto flex items-center gap-2">
          <select class="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => <option value={m}>{m}</option>)}
          </select>
          <button class="border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 hover:bg-gray-700" onClick={() => setShowSettings((s) => !s)}>Settings</button>
        </div>
      </header>

      {tab === 'chat' && (
        <>
          <div class="px-4 py-1 flex gap-2 text-xs">
            <button class="border border-gray-600 rounded px-2 py-0.5 text-gray-200 hover:bg-gray-700" onClick={saveChat}>Save chat</button>
            <button class="border border-gray-600 rounded px-2 py-0.5 text-gray-200 hover:bg-gray-700" onClick={branchChat}>Branch</button>
          </div>
          <main class="flex-1 overflow-auto p-4 space-y-3 max-w-3xl w-full mx-auto">
            {messages.map((m, i) => (
              <div key={i} class={`rounded-lg p-3 ${m.role === 'user' ? 'bg-blue-900/40 ml-8 border border-blue-800' : 'bg-gray-800 border border-gray-700'}`}>
                <div class="text-xs text-gray-400 mb-1">{m.role}</div>
                <pre class="whitespace-pre-wrap text-sm text-gray-100">{m.content}</pre>
              </div>
            ))}
            {busy && <div class="text-sm text-gray-400">Thinking…</div>}
          </main>
          <footer class="bg-gray-800 border-t border-gray-700 p-3">
            <div class="max-w-3xl mx-auto flex gap-2">
              <input class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-400" value={input} onInput={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Message…" disabled={busy} />
              <button class="bg-blue-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50" onClick={send} disabled={busy}>Send</button>
            </div>
          </footer>
        </>
      )}

      {tab === 'memory' && (
        <main class="flex-1 overflow-auto p-4 max-w-3xl w-full mx-auto space-y-3">
          <div class="flex gap-2">
            <input class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-400" value={newMemory} onInput={(e) => setNewMemory(e.target.value)} placeholder="New memory…" />
            <button class="bg-blue-600 text-white rounded px-4 py-2 text-sm" onClick={addMemory}>Add</button>
          </div>
          {memories.map((m) => (
            <div key={m.id} class={`${card} p-3 flex justify-between items-start`}>
              <div class="text-sm text-gray-100">{m.text}</div>
              <button class="text-red-400 text-xs ml-2" onClick={() => delMemory(m.id)}>del</button>
            </div>
          ))}
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
              <button class="text-red-400 text-xs ml-2" onClick={() => delSkill(s.name)}>del</button>
            </div>
          ))}
        </main>
      )}

      {showSettings && (
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center" onClick={() => setShowSettings(false)}>
          <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 w-96" onClick={(e) => e.stopPropagation()}>
            <h2 class="font-semibold mb-2 text-white">Settings</h2>
            <h3 class="text-sm font-medium mt-2 mb-1 text-gray-200">Integrations</h3>
            <ul class="text-sm space-y-1">
              {Object.entries(integrations).map(([name, s]) => (
                <li key={name} class="text-gray-300">
                  <div class="flex justify-between items-center">
                    <span>{name}</span>
                    <span class={s.ready ? 'text-green-400' : 'text-gray-500'}>{s.ready ? 'ready' : 'off'} ({s.toolCount || 0} tools)</span>
                  </div>
                  {s.note && <div class="text-xs text-gray-500 ml-2">{s.note}</div>}
                  {!s.ready && s.error && <div class="text-xs text-gray-500 ml-2">{s.error}</div>}
                  {name === 'rea' && (
                    <button class="text-xs text-blue-400 ml-2 mt-1" onClick={async () => { const r = await fetch('/api/integrations/rea/update', { method: 'POST' }); const d = await r.json(); alert(d.ok ? 'REA updated' : ('Update failed: ' + (d.error || d.output || 'unknown'))); const st = await (await fetch('/api/integrations/status')).json(); setIntegrations(st); }}>Update REA</button>
                  )}
                  {name === 'awesome-re' && (
                    <button class="text-xs text-blue-400 ml-2 mt-1" onClick={async () => { await fetch('/api/integrations/awesome-re/update', { method: 'POST' }); const st = await (await fetch('/api/integrations/status')).json(); setIntegrations(st); }}>Update index</button>
                  )}
                  {name === 'ghidra' && !s.ready && (
                    <button class="text-xs text-blue-400 ml-2 mt-1" onClick={async () => { const v = prompt('Ghidra MCP URL (e.g. http://127.0.0.1:8089):'); if (v) { await fetch('/api/integrations/ghidra/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envKey: 'GHIDRA_MCP_URL', value: v }) }); const st = await (await fetch('/api/integrations/status')).json(); setIntegrations(st); } }}>Configure</button>
                  )}
                  {name === 'craft' && !s.ready && (
                    <>
                      <button class="text-xs text-blue-400 ml-2 mt-1" onClick={async () => { const v = prompt('Path to craft-anything-cli binary:'); if (v) { await fetch('/api/integrations/craft/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envKey: 'CRAFT_BIN', value: v }) }); const st = await (await fetch('/api/integrations/status')).json(); setIntegrations(st); } }}>Configure</button>
                      <button class="text-xs text-green-400 ml-2 mt-1" onClick={async () => { if (!confirm('Clone & build craft-anything from GitHub? (may take a few minutes)')) return; const r = await fetch('/api/integrations/craft/install', { method: 'POST' }); const d = await r.json(); alert(d.ok ? ('Installed: ' + d.binary) : ('Failed: ' + (d.error || 'unknown'))); const st = await (await fetch('/api/integrations/status')).json(); setIntegrations(st); }}>Install from GitHub</button>
                    </>
                  )}
                  {name === 'voice' && (
                    <button class="text-xs text-blue-400 ml-2 mt-1" onClick={async () => { const v = prompt('STT_URL (leave blank to skip):'); const t = prompt('TTS_URL (leave blank to skip):'); await fetch('/api/integrations/voice/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envKey: 'STT_URL', value: v || '' }) }); await fetch('/api/integrations/voice/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envKey: 'TTS_URL', value: t || '' }) }); const st = await (await fetch('/api/integrations/status')).json(); setIntegrations(st); }}>Configure audio</button>
                  )}
                </li>
              ))}
            </ul>
            <div class="mt-3 flex gap-2">
              <button class="border border-gray-600 rounded px-3 py-1 text-sm text-gray-200 hover:bg-gray-700" onClick={exportBackup}>Export backup</button>
            </div>
            <p class="text-xs text-gray-500 mt-3">RAG reindex available via /api/rag/reindex.</p>
          </div>
        </div>
      )}
    </div>
  );
}
