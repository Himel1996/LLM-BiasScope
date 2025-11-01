// app/src/app/page.tsx
'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai'; // <-- add this

function ChatPanel({ panel, input }: { panel: { id: string; name: string; endpoint: string }, input: string }) {
  const { messages, sendMessage, status, error, stop } = useChat({
    // use the text transport for toTextStreamResponse()
    transport: new TextStreamChatTransport({ api: panel.endpoint }),
  });

  return (
    <div className="border rounded-lg p-3 flex flex-col">
      <div className="font-semibold mb-2">{panel.name}</div>

      <div className="flex-1 overflow-auto space-y-3 max-h-[60vh]">
        {messages.map((m) => (
          <div key={m.id}>
            <div className="text-xs opacity-70">{m.role.toUpperCase()}</div>
            {/* text protocol => render parts with type 'text' */}
            {m.parts.map((part, i) => part.type === 'text' ? (
              <p key={i} className="whitespace-pre-wrap">{part.text}</p>
            ) : null)}
          </div>
        ))}
        {error && <div className="text-red-500 text-sm">{String(error)}</div>}
      </div>

      <div className="flex gap-2 mt-3">
      <button
          data-send
          className="border rounded px-3 py-2"
          onClick={() => sendMessage({ text: input || 'Hello! Compare this.' })}
          disabled={status === 'streaming'}
        >
          {status === 'streaming' ? 'Streaming…' : 'Send'}
        </button>

        {/* Optional stop button */}
        <button
          className="border rounded px-3 py-2"
          onClick={() => stop()}
          disabled={status !== 'streaming'}
        >
          Stop
        </button>

        {/* Error display */}
        {error && <div className="text-red-500 text-sm">{String(error)}</div>}

      </div>
    </div>
  );

}
const PANELS = [
  {
    id: 'openai-gpt-5',
    name: 'OpenAI GPT-5',
    endpoint: '/api/chat?model=openai/gpt-5',
  },
  {
    id: 'anthropic-claude-sonnet',
    name: 'Anthropic Claude 3.5 Sonnet',
    endpoint: '/api/chat?model=anthropic/claude-3.5-sonnet',
  },
] as const;
export default function Page() {
  const [prompt, setPrompt] = useState('');
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-gray-900">LLM Bias Scope</h1>
          <p className="text-sm text-gray-600">
            Enter a prompt once and compare how different models respond. Update the prompt, then click
            &ldquo;Send&rdquo; on each panel to stream a new answer.
          </p>
        </header>
        <section className="space-y-2">
          <label className="flex items-center justify-between text-sm font-medium text-gray-800" htmlFor="prompt">
            Prompt
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            placeholder="Ask something that could reveal differences in tone, reasoning, or bias…"
            className="w-full rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm focus:border-gray-400 focus:outline-none"
          />
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          {PANELS.map((panel) => (
            <ChatPanel key={panel.id} panel={panel} input={prompt} />
          ))}
        </section>
      </div>
    </main>
  );
}