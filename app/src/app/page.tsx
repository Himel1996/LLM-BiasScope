'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';

// ===== Models to compare side-by-side =====
type Panel = { id: string; name: string; endpoint: string; dot: string };
const PANELS: Panel[] = [
  { id: 'openai-gpt-5',  name: 'OpenAI — GPT-5',            endpoint: '/api/chat?model=openai/gpt-5',           dot: 'bg-cyan-400' },
  { id: 'claude-3-5',    name: 'Anthropic — Claude 3.5',    endpoint: '/api/chat?model=anthropic/claude-3.5-sonnet', dot: 'bg-violet-400' },
];

// ===== Chat history (local) =====
type ChatMeta = { id: string; title: string; createdAt: number };
const LS_KEY = 'biascope_chats_v1';

function useChatHistory() {
  const [chats, setChats] = useState<ChatMeta[]>(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  });

  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(chats)); }, [chats]);

  const addChat = () => {
    const id = crypto.randomUUID();
    const meta = { id, title: 'New Chat', createdAt: Date.now() };
    setChats((c) => [meta, ...c]);
    return meta;
  };
  const renameChat = (id: string, title: string) =>
    setChats((c) => c.map((x) => (x.id === id ? { ...x, title } : x)));
  const removeChat = (id: string) =>
    setChats((c) => c.filter((x) => x.id !== id));
  return { chats, addChat, renameChat, removeChat };
}

// ===== Message bubble =====
function MessageBubble({
  role,
  parts,
}: {
  role: 'user' | 'assistant' | 'system';
  parts: { type: string; text?: string }[];
}) {
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`msg ${isUser ? 'user' : isAssistant ? 'assistant' : ''}`}>
        <div className="whitespace-pre-wrap text-[15px]">{text}</div>
      </div>
    </div>
  );
}

// ===== One chat column =====
function ChatColumn({
  panel,
  chatId,
  sharedPrompt,
  onFirstUserMessage,
}: {
  panel: Panel;
  chatId: string;
  sharedPrompt: string;
  onFirstUserMessage: (text: string) => void;
}) {
  // give each column a stable id bound to chatId so history separates per chat
  const { messages, sendMessage, status, error, stop } = useChat({
    id: `${chatId}:${panel.id}`,
    transport: new TextStreamChatTransport({ api: panel.endpoint }),
  });

  const [localInput, setLocalInput] = useState('');
  const firstUserSent = useRef(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const send = async (text: string) => {
    if (!text.trim()) return;
    await sendMessage({ text });
    if (!firstUserSent.current) {
      onFirstUserMessage(text);
      firstUserSent.current = true;
    }
  };

  return (
    <section className="flex h-full min-w-[520px] flex-col border-l border-[var(--panelBorder)]">
      {/* Column header */}
      <div className="flex items-center justify-between border-b border-[var(--panelBorder)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${panel.dot}`} />
          <div className="text-[13px] font-semibold opacity-90">{panel.name}</div>
          <span className="badge">Streaming: {status === 'streaming' ? 'yes' : 'no'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => stop()} disabled={status !== 'streaming'} className="btn">Stop</button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mt-12 text-center text-sm text-[var(--muted)]">No messages yet.</div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} parts={m.parts} />
        ))}
        {error && (
          <div className="rounded-lg border border-red-900/40 bg-red-900/20 p-2 text-sm text-red-300">
            {String(error)}
          </div>
        )}
      </div>

      {/* Per-column mini composer */}
      <div className="border-t border-[var(--panelBorder)] p-3">
        <div className="flex items-center gap-2">
          <input
            className="input"
            placeholder={`Ask only ${panel.name}…`}
            value={localInput}
            onChange={(e) => setLocalInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(localInput);
                setLocalInput('');
              }
            }}
          />
          <button
            data-send
            onClick={() => { const text = sharedPrompt || localInput || 'Hello! Compare this.'; setLocalInput(''); send(text); }}
            disabled={status === 'streaming'}
            className="btn primary"
          >
            Send
          </button>
        </div>
      </div>
    </section>
  );
}

// ===== Main page =====
export default function Page() {
  const { chats, addChat, renameChat, removeChat } = useChatHistory();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string>(() => chats[0]?.id || addChat().id);
  const [prompt, setPrompt] = useState('');

  // update title on first message
  const handleFirstUserMessage = (text: string) => {
    const title = text.length > 60 ? text.slice(0, 57) + '…' : text || 'New Chat';
    renameChat(activeChatId, title);
  };

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId),
    [chats, activeChatId]
  );

  // Export all messages of this chat (per column) to JSON
  const exportChat = () => {
    const blob = new Blob(
      [JSON.stringify({ chat: activeChat, models: PANELS.map(p => p.id) }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `chat-${activeChat?.title || activeChatId}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  // Send to all
  const sendAll = () => {
    document.querySelectorAll<HTMLButtonElement>('button[data-send]').forEach(b => b.click());
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="sidebar w-[280px] shrink-0 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold opacity-90">Chatbot</div>
            <button className="btn ghost" onClick={() => setSidebarOpen(false)} title="Hide sidebar">⟨</button>
          </div>

          <button
            className="btn primary w-full mb-3"
            onClick={() => { const { id } = addChat(); setActiveChatId(id); setPrompt(''); }}
            title="+ New chat"
          >
            ＋ New chat
          </button>

          <div className="space-y-1">
            {chats.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveChatId(c.id)}
                className={`sidebar-item w-full justify-between ${activeChatId === c.id ? 'bg-[#161b25]' : ''}`}
                title={new Date(c.createdAt).toLocaleString()}
              >
                <span className="truncate">{c.title}</span>
                <span className="text-xs text-[var(--muted)]">{new Date(c.createdAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>

          {activeChat && (
            <div className="mt-3 flex gap-2">
              <button className="btn w-full" onClick={() => exportChat()}>Export</button>
              <button className="btn w-full" onClick={() => { removeChat(activeChatId); const n = addChat(); setActiveChatId(n.id); }}>
                Delete
              </button>
            </div>
          )}

          <div className="mt-6 text-[11px] text-[var(--muted)]">
            You have reached the end of your chat history.
          </div>
        </aside>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 items-center justify-between border-b border-[var(--panelBorder)] px-4">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <button className="btn ghost" onClick={() => setSidebarOpen(true)} title="Show sidebar">☰</button>
            )}
            <h1>LLM Bias Scope</h1>
            <span className="badge hidden md:inline">Compare models side-by-side</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={exportChat}>Export</button>
            <button className="btn" onClick={() => { const { id } = addChat(); setActiveChatId(id); setPrompt(''); }}>
              ＋ New
            </button>
          </div>
        </header>

        {/* Two fixed columns; scroll horizontally on narrow viewports */}
        <div className="flex min-h-0 flex-1 overflow-x-auto">
          <div className="mx-auto flex w-full max-w-[1600px]">
            {PANELS.map((p) => (
              <ChatColumn
                key={p.id}
                panel={p}
                chatId={activeChatId}
                sharedPrompt={prompt}
                onFirstUserMessage={handleFirstUserMessage}
              />
            ))}
          </div>
        </div>

        {/* Composer (bottom, big and pretty) */}
        <footer className="border-t border-[var(--panelBorder)] p-4">
          <div className="mx-auto w-full max-w-[900px]">
            <div className="panel">
              <textarea
                className="textarea h-28 rounded-t-[14px] text-[16px] placeholder:text-[var(--muted)]"
                placeholder="Send a message to all models…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendAll();
                  }
                }}
              />
              <div className="flex items-center justify-between gap-3 border-t border-[var(--panelBorder)] p-2">
                <div className="text-xs text-[var(--muted)]">Shift+Enter for newline</div>
                <button onClick={sendAll} className="btn primary">Send to all</button>
              </div>
            </div>
            <div className="mt-2 text-center text-[11px] text-[var(--muted)]">
              Reasoning may be incorrect. Compare tone and citations across models.
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
