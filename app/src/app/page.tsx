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
