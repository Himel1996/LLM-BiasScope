'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';

// ===== Models to compare side-by-side =====
type Panel = { id: string; name: string; endpoint: string; dot: string };
const PANELS: Panel[] = [
  { id: 'openai-gpt-5',  name: 'OpenAI — GPT-5',            endpoint: '/api/chat?model=openai/gpt-5',           dot: 'bg-cyan-400' },
  { id: 'claude-3-5',    name: 'Anthropic — Claude 3.5',    endpoint: '/api/chat?model=anthropic/claude-3.5-sonnet', dot: 'bg-violet-400' },
];

type BiasApiResult = {
  text: string;
  detection: {
    label: string;
    friendlyLabel: string;
    score: number;
  };
  type: {
    label: string;
    score: number;
  } | null;
};

type BiasSlotState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  text?: string;
  result?: BiasApiResult;
  error?: string;
};

type BiasColumnState = {
  prompt: BiasSlotState;
  response: BiasSlotState;
};

// ===== Chat history (local) =====
type ChatMeta = { id: string; title: string; createdAt: number };
const LS_KEY = 'biascope_chats_v1';

const createChatMeta = (): ChatMeta => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  title: 'New Chat',
  createdAt: Date.now(),
});

function useChatHistory() {
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadChats = (): ChatMeta[] => {
      try {
        const stored = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
        if (Array.isArray(stored) && stored.length > 0) {
          return stored;
        }
      } catch {
        /* ignore malformed data */
      }
      const fallback = [createChatMeta()];
      localStorage.setItem(LS_KEY, JSON.stringify(fallback));
      return fallback;
    };

    setChats(loadChats());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(LS_KEY, JSON.stringify(chats));
  }, [chats, hydrated]);

  const addChat = useCallback(() => {
    const meta = createChatMeta();
    setChats((c) => [meta, ...c]);
    return meta;
  }, []);

  const renameChat = useCallback((id: string, title: string) => {
    setChats((c) => c.map((x) => (x.id === id ? { ...x, title } : x)));
  }, []);

  const removeChat = useCallback((id: string) => {
    setChats((c) => c.filter((x) => x.id !== id));
  }, []);

  return { chats, addChat, renameChat, removeChat, hydrated };
}

const getTextFromParts = (parts: { type: string; text?: string }[]) =>
  parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text!.trim())
    .join('\n')
    .trim();

// ===== Message bubble =====
function MessageBubble({
  role,
  parts,
}: {
  role: 'user' | 'assistant' | 'system';
  parts: { type: string; text?: string }[];
}) {
  const text = getTextFromParts(parts);
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';
  return (
    <div className={`flex px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`msg ${isUser ? 'user' : isAssistant ? 'assistant' : ''}`}>
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{text}</div>
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
  onBiasUpdate,
}: {
  panel: Panel;
  chatId: string;
  sharedPrompt: string;
  onFirstUserMessage: (text: string) => void;
  onBiasUpdate: (panelId: string, state: BiasColumnState) => void;
}) {
  // give each column a stable id bound to chatId so history separates per chat
  const { messages, sendMessage, status, error, stop } = useChat({
    id: `${chatId}:${panel.id}`,
    transport: new TextStreamChatTransport({ api: panel.endpoint }),
  });

  const [localInput, setLocalInput] = useState('');
  const firstUserSent = useRef(false);
  const [biasState, setBiasState] = useState<BiasColumnState>({
    prompt: { status: 'idle' },
    response: { status: 'idle' },
  });
  const lastAnalyzedText = useRef<{ prompt: string; response: string }>({
    prompt: '',
    response: '',
  });

  const analyzeText = useCallback(async (text: string): Promise<BiasApiResult> => {
    const response = await fetch('/api/bias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error ?? 'Bias analysis failed');
    }
    return payload as BiasApiResult;
  }, []);

  const runBias = useCallback(
    async (slot: 'prompt' | 'response', text: string) => {
      setBiasState((prev) => ({
        ...prev,
        [slot]: { status: 'loading', text },
      }));
      try {
        const result = await analyzeText(text);
        setBiasState((prev) => ({
          ...prev,
          [slot]: { status: 'ready', text, result },
        }));
      } catch (err) {
        setBiasState((prev) => ({
          ...prev,
          [slot]: {
            status: 'error',
            text,
            error: err instanceof Error ? err.message : 'Unexpected error',
          },
        }));
      }
    },
    [analyzeText]
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  useEffect(() => {
    if (!messages.length) return;

    const latestUser = [...messages]
      .slice()
      .reverse()
      .find((msg) => msg.role === 'user');
    if (latestUser) {
      const text = getTextFromParts(latestUser.parts);
      if (text && text !== lastAnalyzedText.current.prompt) {
        lastAnalyzedText.current.prompt = text;
        runBias('prompt', text);
      }
    }

    const latestAssistant = [...messages]
      .slice()
      .reverse()
      .find((msg) => msg.role === 'assistant');
    if (latestAssistant && status !== 'streaming') {
      const text = getTextFromParts(latestAssistant.parts);
      if (text && text !== lastAnalyzedText.current.response) {
        lastAnalyzedText.current.response = text;
        runBias('response', text);
      }
    }
  }, [messages, runBias, status]);

  useEffect(() => {
    onBiasUpdate(panel.id, biasState);
  }, [biasState, onBiasUpdate, panel.id]);

  useEffect(() => {
    setBiasState({ prompt: { status: 'idle' }, response: { status: 'idle' } });
    lastAnalyzedText.current = { prompt: '', response: '' };
  }, [chatId, panel.id]);

  const send = async (text: string) => {
    if (!text.trim()) return;
    await sendMessage({ text });
    if (!firstUserSent.current) {
      onFirstUserMessage(text);
      firstUserSent.current = true;
    }
  };

  return (
    <section className="flex h-full min-w-[420px] max-w-[560px] flex-1 px-4 py-3">
      <div className="flex h-full w-full flex-col overflow-hidden rounded-[26px] border border-[var(--panelBorder)] bg-[var(--panel)] shadow-[0_26px_60px_rgba(5,10,25,0.35)] backdrop-blur-xl">
        {/* Column header */}
        <div className="flex items-center justify-between border-b border-[var(--panelHairline)] bg-[var(--panelHeader)] px-7 py-[18px]">
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${panel.dot}`} />
            <div className="text-[14px] font-semibold tracking-wide text-[var(--textPrimary)] opacity-90">
              {panel.name}
            </div>
            <span className="badge">Streaming: {status === 'streaming' ? 'yes' : 'no'}</span>
          </div>
          <button
            onClick={() => stop()}
            disabled={status !== 'streaming'}
            className="btn h-[44px] px-5"
          >
            Stop
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto px-8 py-7">
          {messages.length === 0 && (
            <div className="mt-12 text-center text-sm text-[var(--muted)]">No messages yet.</div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role} parts={m.parts} />
          ))}
          {error && (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
              {String(error)}
            </div>
          )}
        </div>

        {/* Per-column mini composer */}
        <div className="border-t border-[var(--panelHairline)] bg-transparent px-7 py-[18px]">
          <div className="flex items-center gap-3.5">
            <input
              className="input h-12"
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
              onClick={() => {
                const text = sharedPrompt || localInput || 'Hello! Compare this.';
                setLocalInput('');
                send(text);
              }}
              disabled={status === 'streaming'}
              className="btn primary h-12 px-6"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function BiasSummaryCard({
  panel,
  analysis,
}: {
  panel: Panel;
  analysis?: BiasColumnState;
}) {
  const prompt: BiasSlotState = analysis?.prompt ?? { status: 'idle' };
  const response: BiasSlotState = analysis?.response ?? { status: 'idle' };

  const renderSection = (label: string, slot: BiasSlotState) => {
    if (slot.status === 'loading') {
      return (
        <div className="rounded-2xl border border-[var(--panelHairline)]/60 bg-white/10 px-4 py-3 text-sm text-[var(--muted)]">
          <div className="text-xs uppercase tracking-wider text-[var(--muted)]/80">{label}</div>
          <div className="mt-1 text-sm">Analyzing…</div>
        </div>
      );
    }

    if (slot.status === 'error' && slot.error) {
      return (
        <div className="rounded-2xl border border-red-500/40 bg-red-900/10 px-4 py-3 text-sm text-red-200">
          <div className="text-xs uppercase tracking-wider text-red-200/80">{label}</div>
          <div className="mt-1">{slot.error}</div>
        </div>
      );
    }

    if (slot.status === 'ready' && slot.result) {
      const { detection, type, text } = slot.result;
      return (
        <div className="rounded-2xl border border-[var(--panelHairline)]/60 bg-white/5 px-4 py-3 text-sm text-[var(--textPrimary)]">
          <div className="text-xs uppercase tracking-wider text-[var(--muted)]/80">{label}</div>
          <div className="mt-2 text-sm font-semibold text-[var(--textPrimary)]">
            {detection.friendlyLabel}{' '}
            <span className="ml-2 text-xs font-medium text-[var(--muted)]">
              {(detection.score * 100).toFixed(1)}% confidence
            </span>
          </div>
          {type ? (
            <div className="mt-1 text-xs text-[var(--muted)]">
              Bias type · <span className="font-medium text-[var(--textPrimary)]">{type.label}</span>{' '}
              ({(type.score * 100).toFixed(1)}%)
            </div>
          ) : (
            <div className="mt-1 text-xs text-[var(--muted)]">No specific bias category detected.</div>
          )}
          {text ? (
            <div className="mt-3 max-h-28 overflow-y-auto rounded-xl border border-[var(--panelHairline)]/40 bg-black/10 px-3 py-2 text-xs text-[var(--muted)]">
              {text}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-[var(--panelHairline)]/30 bg-transparent px-4 py-3 text-sm text-[var(--muted)]">
        <div className="text-xs uppercase tracking-wider text-[var(--muted)]/70">{label}</div>
        <div className="mt-1">Awaiting conversation…</div>
      </div>
    );
  };

  return (
    <div className="flex min-h-[220px] flex-1 flex-col rounded-[26px] border border-[var(--panelBorder)] bg-[var(--panel)]/92 shadow-[0_18px_45px_rgba(5,10,25,0.3)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[var(--panelHairline)]/60 bg-[var(--panelHeader)]/80 px-6 py-4">
        <div className="flex items-center gap-3 text-sm font-semibold text-[var(--textPrimary)]">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--panelBorder)] opacity-60" />
          Bias insights · {panel.name.split('—')[0].trim()}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-6 py-5">
        <div className="max-h-48 flex-1 overflow-y-auto space-y-3">
          {renderSection('Prompt', prompt)}
          {renderSection('Response', response)}
        </div>
      </div>
    </div>
  );
}

// ===== Main page =====
export default function Page() {
  const { chats, addChat, renameChat, removeChat, hydrated } = useChatHistory();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [biasSummaries, setBiasSummaries] = useState<Record<string, BiasColumnState>>({});
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const handleBiasUpdate = useCallback((panelId: string, state: BiasColumnState) => {
    setBiasSummaries((prev) => ({ ...prev, [panelId]: state }));
  }, []);

  useEffect(() => {
    if (!hydrated || chats.length === 0) return;
    if (!activeChatId || !chats.some((c) => c.id === activeChatId)) {
      setActiveChatId(chats[0].id);
    }
  }, [hydrated, chats, activeChatId]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
  }, [prompt, hydrated]);

  const canUseChat = hydrated && !!activeChatId;

  // update title on first message
  const handleFirstUserMessage = (text: string) => {
    if (!activeChatId) return;
    const title = text.length > 60 ? text.slice(0, 57) + '…' : text || 'New Chat';
    renameChat(activeChatId, title);
  };

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId),
    [chats, activeChatId]
  );

  // Export all messages of this chat (per column) to JSON
  const exportChat = () => {
    if (!canUseChat) return;
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
    if (!canUseChat) return;
    document.querySelectorAll<HTMLButtonElement>('button[data-send]').forEach(b => b.click());
    setPrompt('');
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
            onClick={() => { if (!hydrated) return; const { id } = addChat(); setActiveChatId(id); setPrompt(''); }}
            title="+ New chat"
            disabled={!hydrated}
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
              <button className="btn w-full" onClick={() => exportChat()} disabled={!canUseChat}>Export</button>
              <button className="btn w-full" disabled={!canUseChat} onClick={() => {
                if (!activeChatId) return;
                removeChat(activeChatId);
                const next = addChat();
                setActiveChatId(next.id);
              }}>
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
        <header className="flex h-16 items-center justify-between border-b border-[var(--panelHairline)] bg-[var(--panelHeader)] px-6 backdrop-blur-md">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button className="btn ghost" onClick={() => setSidebarOpen(true)} title="Show sidebar">☰</button>
            )}
            <h1>LLM Bias Scope</h1>
            <span className="badge hidden md:inline">Compare models side-by-side</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={exportChat} disabled={!canUseChat}>Export</button>
            <button className="btn" onClick={() => { if (!hydrated) return; const { id } = addChat(); setActiveChatId(id); setPrompt(''); }} disabled={!hydrated}>
              ＋ New
            </button>
          </div>
        </header>

        {/* Two fixed columns; scroll horizontally on narrow viewports */}
        <div className="flex min-h-0 flex-1 overflow-x-auto px-8 py-10">
          <div className="mx-auto flex w-full max-w-[1300px] flex-1 items-stretch justify-center gap-14">
            {hydrated && activeChatId ? (
              PANELS.map((p) => (
                <ChatColumn
                key={p.id}
                panel={p}
                chatId={activeChatId}
                sharedPrompt={prompt}
                onFirstUserMessage={handleFirstUserMessage}
                onBiasUpdate={handleBiasUpdate}
              />
              ))
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]">
                Preparing chats…
              </div>
            )}
          </div>
        </div>

        {/* Bias summaries */}
        <div className="px-8 pb-8">
          <div className="mx-auto flex w-full max-w-[1300px] flex-wrap items-stretch justify-center gap-14">
            {PANELS.map((p) => (
              <BiasSummaryCard key={`${p.id}-bias`} panel={p} analysis={biasSummaries[p.id]} />
            ))}
          </div>
        </div>

        {/* Composer (bottom, big and pretty) */}
        <footer className="border-t border-transparent px-8 pb-12 pt-6">
          <div className="mx-auto w-full max-w-[960px]">
            <div className="flex flex-col overflow-hidden rounded-[26px] border border-[var(--panelBorder)] bg-[var(--panel)] shadow-[0_26px_60px_rgba(5,10,25,0.35)] backdrop-blur-xl">
              <div className="px-7 pt-6 pb-2">
                <textarea
                  ref={composerRef}
                  rows={1}
                  className="composer-textarea"
                  style={{ minHeight: '3.25rem', maxHeight: '22rem' }}
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
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-[var(--panelHairline)] bg-[var(--panelHeader)] px-6 py-3">
                <div className="text-xs text-[var(--muted)]">Shift+Enter for newline</div>
                <button onClick={sendAll} className="btn primary h-12 px-6" disabled={!canUseChat}>
                  Send to all
                </button>
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
