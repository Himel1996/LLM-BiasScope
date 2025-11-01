'use client';

import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';

type Panel = { id: string; name: string; endpoint: string; accent: string };

const PANELS: Panel[] = [
  {
    id: 'openai-gpt-5',
    name: 'OpenAI – GPT-5',
    endpoint: '/api/chat?model=openai/gpt-5',
    accent: 'from-sky-500 to-sky-600',
  },
  {
    id: 'anthropic-claude-sonnet',
    name: 'Anthropic – Claude 3.5 Sonnet',
    endpoint: '/api/chat?model=anthropic/claude-3.5-sonnet',
    accent: 'from-violet-500 to-violet-600',
  },
  // add more columns if you like
];

export default function Page() {
  const [prompt, setPrompt] = useState('');

  // Sends to all columns by clicking their hidden buttons.
  const sendAll = () => {
    document
      .querySelectorAll<HTMLButtonElement>('button[data-send]')
      .forEach((b) => b.click());
  };

  return (
    <main className="h-screen w-screen bg-neutral-50">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-gray-900 to-gray-700" />
            <h1 className="text-[15px] font-semibold tracking-tight">LLM Bias Scope</h1>
          </div>
          <div className="text-xs text-neutral-500">Vercel AI Gateway • Compare models</div>
        </div>
      </header>

      {/* Content area: two fixed columns, never stack. We allow horizontal scroll on small screens */}
      <div className="mx-auto grid h-[calc(100vh-7rem)] max-w-[1400px] grid-cols-2 gap-0 divide-x overflow-hidden px-0 md:px-6">
        {PANELS.map((p) => (
          <ChatColumn key={p.id} panel={p} sharedPrompt={prompt} />
        ))}
      </div>

      {/* Composer like ChatGPT: fixed at bottom, centered and wide */}
      <footer className="sticky bottom-0 z-20 border-t bg-white/80 backdrop-blur">
        <div className="mx-auto w-full max-w-[900px] px-4 py-3">
          <div className="rounded-xl border bg-white shadow-sm">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Message all models…  (press Send to stream side-by-side)"
              className="h-24 w-full resize-none rounded-t-xl bg-transparent p-3 outline-none"
            />
            <div className="flex items-center justify-between gap-3 border-t p-2">
              <div className="text-xs text-neutral-500">
                Shift+Enter for newline • Streams to all columns
              </div>
              <button
                onClick={sendAll}
                className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 active:bg-black"
              >
                Send to all
                <svg width="14" height="14" viewBox="0 0 24 24" className="opacity-90">
                  <path fill="currentColor" d="M2 21L23 12L2 3v7l15 2l-15 2v7z" />
                </svg>
              </button>
            </div>
          </div>
          <div className="mt-2 text-center text-[11px] text-neutral-500">
            Outputs may be inaccurate. Compare reasoning, tone, & bias across models.
          </div>
        </div>
      </footer>
    </main>
  );
}

function ChatColumn({ panel, sharedPrompt }: { panel: Panel; sharedPrompt: string }) {
  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new TextStreamChatTransport({ api: panel.endpoint }),
  });

  const [localInput, setLocalInput] = useState(''); // ← local state

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  return (
    <section className="flex h-full min-w-[480px] flex-col">
      {/* Column header */}
      <div className="flex items-center justify-between border-b bg-white p-3">
        <div className="flex items-center gap-2">
          <div className={`h-5 w-5 rounded-md bg-gradient-to-br ${panel.accent}`} />
          <div className="text-sm font-medium">{panel.name}</div>
        </div>
        <div className="text-[11px] text-neutral-500">
          {status === 'streaming' ? 'Streaming…' : 'Idle'}
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-neutral-50 p-4">
        {messages.length === 0 && (
          <div className="mt-10 text-center text-sm text-neutral-500">
            No messages yet. Press <span className="font-medium">Send to all</span> to start.
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} parts={m.parts} />
        ))}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {String(error)}
          </div>
        )}
      </div>

      {/* Per-column controls */}
      <div className="flex items-center justify-between gap-2 border-t bg-white p-2">
        <div className="text-[11px] text-neutral-500">Send only to this model</div>
        <div className="flex gap-2">
          <input
            value={localInput}
            onChange={(e) => setLocalInput(e.target.value)}  // ✅ local change handler
            placeholder="Ask this model…"
            className="w-52 rounded-md border bg-white px-2 py-1 text-sm outline-none"
          />
          <button
            data-send
            onClick={() =>
              sendMessage({
                text: sharedPrompt || localInput || 'Hello! Compare this.',
              })
            }
            disabled={status === 'streaming'}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {status === 'streaming' ? 'Streaming…' : 'Send'}
          </button>
          <button
            onClick={() => stop()}
            disabled={status !== 'streaming'}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            Stop
          </button>
        </div>
      </div>
    </section>
  );
}


function MessageBubble({
  role,
  parts,
}: {
  role: 'user' | 'assistant' | 'system';
  parts: { type: string; text?: string }[];
}) {
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';

  const content = parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[80%] rounded-2xl px-3 py-2 text-[14px] leading-[1.5]',
          isUser
            ? 'bg-sky-600 text-white shadow-sm'
            : isAssistant
            ? 'bg-white text-neutral-900 border border-neutral-200 shadow-sm'
            : 'bg-yellow-50 text-yellow-900 border border-yellow-200',
        ].join(' ')}
      >
        <div className="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  );
}
