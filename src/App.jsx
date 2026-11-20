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

  useEffect(() => {
    fetch('/api/version').then((r) => r.json()).then((d) => setVersion(d.version)).catch(() => setVersion('?'));
    fetch('/api/models').then((r) => r.json()).then((d) => {
      const ms = (d.models || []).map((m) => m.name);
      setModels(ms);
      if (ms.length && !model) setModel(ms[0]);
    }).catch(() => {});
    fetch('/api/integrations/status').then((r) => r.json()).then(setIntegrations).catch(() => {});
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

  return (
    <div class="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <header class="bg-white border-b px-4 py-2 flex items-center gap-3">
        <h1 class="font-semibold text-lg">AegisAI (next)</h1>
        <span class="text-xs text-gray-500">v{version}</span>
        <div class="ml-auto flex items-center gap-2">
          <select class="border rounded px-2 py-1 text-sm" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => <option value={m}>{m}</option>)}
          </select>
          <button class="border rounded px-2 py-1 text-sm" onClick={() => setShowSettings((s) => !s)}>Settings</button>
        </div>
      </header>
      <main class="flex-1 overflow-auto p-4 space-y-3 max-w-3xl w-full mx-auto">
        {messages.map((m, i) => (
          <div key={i} class={`rounded-lg p-3 ${m.role === 'user' ? 'bg-blue-50 ml-8' : 'bg-white border'}`}>
            <div class="text-xs text-gray-500 mb-1">{m.role}</div>
            <pre class="whitespace-pre-wrap text-sm">{m.content}</pre>
          </div>
        ))}
        {busy && <div class="text-sm text-gray-400">Thinking…</div>}
      </main>
      <footer class="bg-white border-t p-3">
        <div class="max-w-3xl mx-auto flex gap-2">
          <input
            class="flex-1 border rounded px-3 py-2 text-sm"
            value={input}
            onInput={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            placeholder="Message…"
            disabled={busy}
          />
          <button class="bg-blue-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50" onClick={send} disabled={busy}>
            Send
          </button>
        </div>
      </footer>
      {showSettings && (
        <div class="fixed inset-0 bg-black/30 flex items-center justify-center" onClick={() => setShowSettings(false)}>
          <div class="bg-white rounded-lg p-4 w-96" onClick={(e) => e.stopPropagation()}>
            <h2 class="font-semibold mb-2">Settings</h2>
            <h3 class="text-sm font-medium mt-2 mb-1">Integrations</h3>
            <ul class="text-sm space-y-1">
              {Object.entries(integrations).map(([name, s]) => (
                <li key={name} class="flex justify-between">
                  <span>{name}</span>
                  <span class={s.ready ? 'text-green-600' : 'text-gray-400'}>{s.ready ? 'ready' : 'off'} ({s.toolCount || 0} tools)</span>
                </li>
              ))}
            </ul>
            <p class="text-xs text-gray-500 mt-3">Memory, skills, branching land in Wave 4.</p>
          </div>
        </div>
      )}
    </div>
  );
}
