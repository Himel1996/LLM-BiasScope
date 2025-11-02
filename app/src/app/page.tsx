'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ===== Available Models =====
type ModelOption = { id: string; name: string; endpoint: string; dot: string };

const AVAILABLE_MODELS: ModelOption[] = [
  //{ id: 'openai/gpt-5', name: 'OpenAI — GPT-5', endpoint: '/api/chat?model=openai/gpt-5', dot: 'bg-cyan-400' },
  { id: 'google/gemini-2.5-flash-lite', name: 'Google — Gemini 2.5 Flash Lite', endpoint: '/api/chat?model=google/gemini-2.5-flash-lite', dot: 'bg-blue-400' },
  { id: 'deepseek/deepseek-v3.1', name: 'DeepSeek — DeepSeek V3.1', endpoint: '/api/chat?model=deepseek/deepseek-v3.1', dot: 'bg-purple-400' },
  //{ id: 'xai/grok-4', name: 'xAI — Grok-4', endpoint: '/api/chat?model=xai/grok-4', dot: 'bg-pink-400' },
  { id: 'minimax/minimax-m2', name: 'MiniMax — MiniMax M2', endpoint: '/api/chat?model=minimax/minimax-m2', dot: 'bg-indigo-400' },
// { id: 'anthropic/claude-3.5-sonnet', name: 'Anthropic — Claude 3.5 Sonnet', endpoint: '/api/chat?model=anthropic/claude-3.5-sonnet', dot: 'bg-violet-400' },
  { id: 'mistral/ministral-3b', name: 'Mistral — Mixtral 3B', endpoint: '/api/chat?model=mistral/ministral-3b', dot: 'bg-orange-400' },
  { id: 'meituan/longcat-flash-chat', name: 'Meituan — LongCat Flash Chat', endpoint: '/api/chat?model=meituan/longcat-flash-chat', dot: 'bg-teal-400' },
  { id: 'openai/text-embedding-3-small', name: 'OpenAI — Text Embedding 3 Small', endpoint: '/api/chat?model=openai/text-embedding-3-small', dot: 'bg-green-400' },
  { id: 'meta/llama-3.1-8b', name: 'Meta — Llama 3.1 8B', endpoint: '/api/chat?model=meta/llama-3.1-8b', dot: 'bg-red-400' },
];

const DEFAULT_MODELS = ['minimax/minimax-m2', 'meituan/longcat-flash-chat'];

type Panel = { id: string; name: string; endpoint: string; dot: string };

const MODEL_SELECTION_KEY = 'biascope_models_v1';

type SentenceAnalysis = {
  sentence: string;
  biasDetection: {
    label: string;
    friendlyLabel: string;
    score: number;
  };
  biasType: {
    label: string;
    score: number;
  } | null;
};

type BiasApiResult = {
  text: string;
  sentences: SentenceAnalysis[];
  statistics: {
    totalSentences: number;
    biasedSentences: number;
    unbiasedSentences: number;
    biasPercentage: number;
    avgBiasScore: number;
    avgBiasedScore: number;
    biasTypeCounts: Record<string, number>;
  };
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
        {isAssistant ? (
          <div className="text-[15px] leading-relaxed prose prose-invert prose-headings:text-[var(--textPrimary)] prose-p:text-[var(--textPrimary)] prose-strong:text-[var(--textPrimary)] prose-code:text-[var(--textPrimary)] prose-pre:bg-[rgba(20,24,34,0.95)] prose-pre:border prose-pre:border-[var(--panelHairline)] prose-code:bg-[rgba(20,24,34,0.7)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-blockquote:border-l-[var(--accent)] prose-blockquote:border-l-4 prose-blockquote:pl-4 prose-blockquote:italic">
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              components={{
                // Custom styling for code blocks
                code({ className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '');
                  const isInline = !match && !className?.includes('language-');
                  return isInline ? (
                    <code className="bg-[rgba(20,24,34,0.7)] px-1.5 py-0.5 rounded text-sm font-mono text-[var(--textPrimary)]" {...props}>
                      {children}
                    </code>
                  ) : (
                    <code className="bg-[rgba(20,24,34,0.95)] border border-[var(--panelHairline)] rounded-lg p-3 my-2 block overflow-x-auto font-mono text-sm text-[var(--textPrimary)]" {...props}>
                      {children}
                    </code>
                  );
                },
                // Custom styling for pre (code blocks)
                pre: ({ children }) => (
                  <pre className="bg-[rgba(20,24,34,0.95)] border border-[var(--panelHairline)] rounded-lg p-3 my-2 overflow-x-auto">
                    {children}
                  </pre>
                ),
                // Custom styling for headings
                h1: ({ children }) => <h1 className="text-2xl font-bold mb-2 mt-4 text-[var(--textPrimary)]">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xl font-bold mb-2 mt-3 text-[var(--textPrimary)]">{children}</h2>,
                h3: ({ children }) => <h3 className="text-lg font-semibold mb-2 mt-3 text-[var(--textPrimary)]">{children}</h3>,
                // Custom styling for paragraphs
                p: ({ children }) => <p className="mb-2 text-[var(--textPrimary)]">{children}</p>,
                // Custom styling for lists
                ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1 text-[var(--textPrimary)]">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1 text-[var(--textPrimary)]">{children}</ol>,
                li: ({ children }) => <li className="text-[var(--textPrimary)]">{children}</li>,
                // Custom styling for blockquotes
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-[var(--accent)] pl-4 italic my-2 text-[var(--muted)]">
                    {children}
                  </blockquote>
                ),
                // Custom styling for links
                a: ({ href, children }) => (
                  <a href={href} className="text-[var(--accent)] hover:underline" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
                // Custom styling for strong/bold
                strong: ({ children }) => <strong className="font-bold text-[var(--textPrimary)]">{children}</strong>,
                // Custom styling for emphasis/italic
                em: ({ children }) => <em className="italic text-[var(--textPrimary)]">{children}</em>,
              }}
            >
              {text}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{text}</div>
        )}
      </div>
    </div>
  );
}

// Add a new localStorage key for messages
const MESSAGES_STORAGE_KEY = 'biascope_messages_v1';

// ===== One chat column =====
function ChatColumn({
  panel,
  chatId,
  sharedPrompt,
  onFirstUserMessage,
  onBiasUpdate,
  onMessagesUpdate,
  columnIndex,
  onModelChange,
  otherSelectedModel,
}: {
  panel: Panel;
  chatId: string;
  sharedPrompt: string;
  onFirstUserMessage: (text: string) => void;
  onBiasUpdate: (panelId: string, state: BiasColumnState) => void;
  onMessagesUpdate?: (panelId: string, messages: any[]) => void;
  columnIndex: number;
  onModelChange: (columnIndex: number, modelId: string) => void;
  otherSelectedModel: string | null;
}) {
  const [showModelSelector, setShowModelSelector] = useState(false);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const updateDropdownPosition = useCallback(() => {
    if (typeof window === 'undefined' || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const minWidth = 288; // 18rem to match previous min width
    const padding = 16;
    const viewportWidth = window.innerWidth;
    const maxWidth = Math.max(minWidth, viewportWidth - padding * 2);
    const width = Math.min(Math.max(rect.width, minWidth), maxWidth);
    let left = rect.left;
    if (left + width > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - width - padding);
    }
    left = Math.max(padding, left);
    const top = rect.bottom + 8;
    setDropdownStyle({ top, left, width });
  }, []);
  const toggleModelSelector = useCallback(() => {
    setShowModelSelector((prev) => {
      const next = !prev;
      if (next) {
        updateDropdownPosition();
      } else {
        setDropdownStyle(null);
      }
      return next;
    });
  }, [updateDropdownPosition]);
  
  const storageKey = `${chatId}:${panel.id}`;
  
  // give each column a stable id bound to chatId so history separates per chat
  const { messages, sendMessage, status, error, stop, setMessages } = useChat({
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
    if (onMessagesUpdate) {
      onMessagesUpdate(panel.id, messages);
    }
  }, [messages, onMessagesUpdate, panel.id]);

  useEffect(() => {
    setBiasState({ prompt: { status: 'idle' }, response: { status: 'idle' } });
    lastAnalyzedText.current = { prompt: '', response: '' };
    firstUserSent.current = false;
  }, [chatId, panel.id]);

  const send = async (text: string) => {
    if (!text.trim()) return;
    await sendMessage({ text });
    if (!firstUserSent.current) {
      onFirstUserMessage(text);
      firstUserSent.current = true;
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        modelSelectorRef.current &&
        !modelSelectorRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setShowModelSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showModelSelector) {
      setDropdownStyle(null);
      return;
    }

    updateDropdownPosition();
    const handleReposition = () => updateDropdownPosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [showModelSelector, updateDropdownPosition]);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    if (typeof window === 'undefined' || !messages.length) return;
    
    try {
      const stored = localStorage.getItem(MESSAGES_STORAGE_KEY);
      const allStoredMessages = stored ? JSON.parse(stored) : {};
      allStoredMessages[storageKey] = messages;
      localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(allStoredMessages));
    } catch (err) {
      console.error('Failed to save messages to localStorage:', err);
    }
  }, [messages, storageKey]);

  // Load messages when chatId or panel.id changes
  useEffect(() => {
    if (typeof window === 'undefined' || !setMessages) return;
    try {
      const stored = localStorage.getItem(MESSAGES_STORAGE_KEY);
      if (stored) {
        const allStoredMessages = JSON.parse(stored);
        const key = `${chatId}:${panel.id}`;
        const savedMessages = allStoredMessages[key] || [];
        if (savedMessages.length > 0 && messages.length === 0) {
          setMessages(savedMessages);
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, panel.id]);

  return (
    <section className="flex h-full flex-1" style={{ maxHeight: '80vh' }}>
      <div className="flex h-full w-full flex-col overflow-hidden border border-[var(--panelBorder)] bg-[var(--panel)] shadow-[0_26px_60px_rgba(5,10,25,0.35)] backdrop-blur-xl">
        {/* Column header */}
        <div className={`flex items-center justify-between border-b border-[var(--panelHairline)] bg-[var(--panelHeader)] px-7 py-[18px] ${showModelSelector ? 'relative z-[9999]' : ''}`}>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <span className={`h-2.5 w-2.5 rounded-full ${panel.dot} shrink-0`} />
            <div className={`relative flex-1 min-w-0 ${showModelSelector ? 'z-[10000]' : ''}`} ref={modelSelectorRef}>
              <button
                ref={buttonRef}
                onClick={toggleModelSelector}
                className="flex items-center gap-2 text-[14px] font-semibold tracking-wide text-white border-none rounded-lg px-3 py-1.5 transition-all truncate"
                style={{
                  background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
                  boxShadow: '0 14px 30px rgba(107, 114, 255, 0.45)',
                }}
                title={`Change model (currently ${panel.name})`}
              >
                <span className="truncate">{panel.name}</span>
                <span className="text-xs opacity-80 shrink-0">▼</span>
              </button>
              {showModelSelector && dropdownStyle && typeof document !== 'undefined' &&
                createPortal(
                  <div
                    ref={dropdownRef}
                    className="rounded-lg border border-slate-700 bg-[rgba(15,18,28,0.98)] text-white shadow-xl p-2 backdrop-blur"
                    style={{
                      position: 'fixed',
                      top: dropdownStyle.top,
                      left: dropdownStyle.left,
                      width: dropdownStyle.width,
                      minWidth: '18rem',
                      maxWidth: '32rem',
                      zIndex: 10000,
                    }}
                  >
                    <div className="space-y-1 max-h-[70vh] overflow-y-auto">
                      {AVAILABLE_MODELS.map((model) => {
                        const normalizedPanelId = panel.id.replace(/-/g, '/').replace(/\./g, '/');
                        const isCurrentModel =
                          model.id === normalizedPanelId || model.id.replace(/[\/\.]/g, '-') === panel.id;
                        const isOtherColumn = model.id === otherSelectedModel;
                        const canSelect = isCurrentModel || !isOtherColumn;

                        return (
                          <button
                            key={model.id}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                              isCurrentModel
                                ? 'text-white font-semibold border-none'
                                : isOtherColumn
                                ? 'opacity-60 cursor-not-allowed text-slate-400'
                                : 'text-white hover:bg-white/10'
                            }`}
                            style={
                              isCurrentModel
                                ? {
                                    background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
                                    boxShadow: '0 14px 30px rgba(107, 114, 255, 0.45)',
                                  }
                                : undefined
                            }
                            onClick={() => {
                              if (!canSelect) return;
                              if (!isCurrentModel) {
                                onModelChange(columnIndex, model.id);
                                setShowModelSelector(false);
                              }
                            }}
                            disabled={!canSelect}
                          >
                            <span className={`h-2.5 w-2.5 rounded-full ${model.dot} shrink-0`} />
                            <span className="whitespace-normal break-words">{model.name}</span>
                            {isCurrentModel && <span className="ml-auto text-xs shrink-0">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>,
                  document.body
                )}
            </div>
            <span className="badge shrink-0">Streaming: {status === 'streaming' ? 'yes' : 'no'}</span>
          </div>
          <button
            onClick={() => stop()}
            disabled={status !== 'streaming'}
            className="btn h-[44px] px-5 shrink-0"
          >
            Stop
          </button>
        </div>

        {/* Messages */}
        <div 
          ref={scrollRef} 
          className="flex-1 space-y-6 overflow-y-auto px-8 py-7 min-h-0" 
          style={{ 
            maxHeight: '60vh', 
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.2) transparent'
          }}
        >
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
        <div className="border border-[var(--panelHairline)]/60 bg-white/10 px-5 py-4 text-sm text-[var(--muted)]">
          <div className="text-xs uppercase tracking-wider text-[var(--muted)]/80 mb-3">{label}</div>
          <div className="text-sm">Analyzing sentences…</div>
        </div>
      );
    }

    if (slot.status === 'error' && slot.error) {
      return (
        <div className="border border-red-500/40 bg-red-900/10 px-5 py-4 text-sm text-red-200">
          <div className="text-xs uppercase tracking-wider text-red-200/80 mb-3">{label}</div>
          <div>{slot.error}</div>
        </div>
      );
    }

    if (slot.status === 'ready' && slot.result) {
      const { statistics, sentences } = slot.result;
      
      // Prepare data for bias distribution pie chart (biased vs unbiased)
      const biasDistributionData = [
        { name: 'Biased', value: statistics.biasedSentences, color: '#ef4444' },
        { name: 'Unbiased', value: statistics.unbiasedSentences, color: '#10b981' },
      ];

      // Prepare data for bias type pie chart with stable colors
      const biasTypeColors = [
        '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899',
        '#10b981', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
      ];
      const biasTypeData = Object.entries(statistics.biasTypeCounts).map(([type, count], idx) => ({
        name: type,
        value: count,
        color: biasTypeColors[idx % biasTypeColors.length],
      }));

      // Get biased sentences for display
      const biasedSentences = sentences.filter(
        (s) => s.biasDetection.friendlyLabel.toLowerCase() === 'biased' && s.biasDetection.score > 0.5
      );

      return (
        <div className="border border-[var(--panelHairline)]/60 bg-white/5 px-5 py-4 text-sm text-[var(--textPrimary)] max-h-[800px] overflow-y-auto">
          <div className="text-xs uppercase tracking-wider text-[var(--muted)]/80 mb-4">{label}</div>
          
          {/* Statistics Summary */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-[var(--muted)]">Total Sentences</div>
              <div className="font-semibold text-[var(--textPrimary)]">{statistics.totalSentences}</div>
            </div>
            <div>
              <div className="text-[var(--muted)]">Bias Percentage</div>
              <div className="font-semibold text-[var(--textPrimary)]">{statistics.biasPercentage.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-[var(--muted)]">Biased</div>
              <div className="font-semibold text-red-400">{statistics.biasedSentences}</div>
            </div>
            <div>
              <div className="text-[var(--muted)]">Unbiased</div>
              <div className="font-semibold text-green-400">{statistics.unbiasedSentences}</div>
            </div>
          </div>

          {/* Bias Percentage Progress Bar */}
          {statistics.totalSentences > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-[var(--muted)]">Bias Level</span>
                <span className="font-semibold text-[var(--textPrimary)]">
                  {statistics.biasPercentage.toFixed(1)}%
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--panelHairline)]/30">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${statistics.biasPercentage}%`,
                    backgroundColor: statistics.biasPercentage > 50 ? '#ef4444' : statistics.biasPercentage > 25 ? '#f59e0b' : '#10b981',
                  }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>
          )}

          {/* Bias Distribution Comparison */}
          {statistics.totalSentences > 0 && (
            <div className="mt-6 border border-[var(--panelHairline)]/40 bg-gradient-to-br from-[rgba(255,255,255,0.03)] to-[rgba(255,255,255,0.01)] p-4">
              <div className="mb-2 text-xs font-medium text-[var(--muted)]">Distribution</div>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={biasDistributionData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} animationDuration={800} animationEasing="ease-out">
                    {biasDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Bias Types Horizontal Bar Chart - Better than pie chart for multiple types */}
          {biasTypeData.length > 0 && (
            <div className="mt-6 border border-[var(--panelHairline)]/40 bg-gradient-to-br from-[rgba(255,255,255,0.03)] to-[rgba(255,255,255,0.01)] p-4">
              <div className="mb-2 text-xs font-medium text-[var(--muted)]">Bias Types</div>
              {biasTypeData.length > 1 ? (
                <ResponsiveContainer width="100%" height={Math.min(40 * biasTypeData.length, 200)}>
                  <BarChart data={biasTypeData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} animationDuration={800} animationEasing="ease-out">
                      {biasTypeData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-[var(--panelHairline)]/40 bg-black/10 px-4 py-3">
                  <div
                    className="h-8 w-1 rounded-full"
                    style={{ backgroundColor: biasTypeData[0]?.color || '#f59e0b' }}
                  />
                  <div className="flex-1">
                    <div className="text-xs font-medium text-[var(--textPrimary)]">{biasTypeData[0]?.name}</div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {biasTypeData[0]?.value} {biasTypeData[0]?.value === 1 ? 'sentence' : 'sentences'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bias Radar Chart - per model profile */}
          {biasTypeData.length > 0 && label === 'Response' && (
            <div className="mt-6 border border-[var(--panelHairline)]/40 bg-gradient-to-br from-[rgba(255,255,255,0.03)] to-[rgba(255,255,255,0.01)] p-4">
              <div className="mb-3 text-xs font-medium text-[var(--muted)]">Bias Profile Radar</div>
              <ResponsiveContainer width="100%" height={250}>
                <RadarChart data={biasTypeData.map(item => ({
                  biasType: item.name,
                  value: item.value,
                  fullMark: Math.max(...biasTypeData.map(d => d.value), 1),
                }))}>
                  <PolarGrid stroke="rgba(255,255,255,0.1)" />
                  <PolarAngleAxis 
                    dataKey="biasType" 
                    tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.6)' }}
                    className="text-xs"
                  />
                  <PolarRadiusAxis 
                    angle={90} 
                    domain={[0, 'dataMax']} 
                    tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.5)' }}
                  />
                  <Radar
                    name="Bias Score"
                    dataKey="value"
                    stroke={biasTypeData[0]?.color || '#8b5cf6'}
                    fill={biasTypeData[0]?.color || '#8b5cf6'}
                    fillOpacity={0.4}
                    strokeWidth={2}
                    animationDuration={1000}
                    animationEasing="ease-out"
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(15,18,28,0.98)', 
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      color: '#fff'
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Biased Sentences List */}
          {biasedSentences.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-xs font-medium text-[var(--muted)]">
                Biased Sentences ({biasedSentences.length})
              </div>
              <div className="max-h-48 space-y-3 overflow-y-auto">
                {biasedSentences.map((sentenceAnalysis, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-red-500/30 bg-red-900/10 px-3 py-2 text-xs"
                  >
                    <div className="text-[var(--textPrimary)]">{sentenceAnalysis.sentence}</div>
                    <div className="mt-1 flex items-center justify-between text-[var(--muted)]">
                      <span>Score: {(sentenceAnalysis.biasDetection.score * 100).toFixed(1)}%</span>
                      {sentenceAnalysis.biasType && (
                        <span className="text-red-300">Type: {sentenceAnalysis.biasType.label}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="border border-[var(--panelHairline)]/30 bg-transparent px-5 py-4 text-sm text-[var(--muted)]">
        <div className="text-xs uppercase tracking-wider text-[var(--muted)]/70 mb-3">{label}</div>
        <div>Awaiting conversation…</div>
      </div>
    );
  };

  return (
    <div className="flex max-h-[600px] min-h-[400px] flex-1 flex-col border border-[var(--panelBorder)] bg-gradient-to-br from-[var(--panel)]/92 via-[var(--panel)]/95 to-[var(--panel)]/92 shadow-[0_18px_45px_rgba(5,10,25,0.3)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[var(--panelHairline)]/60 bg-gradient-to-r from-[var(--panelHeader)]/80 to-[var(--panelHeader)]/60 px-6 py-4 shrink-0">
        <div className="flex items-center gap-3 text-sm font-semibold text-[var(--textPrimary)]">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--panelBorder)] opacity-60" />
          Bias insights · {panel.name.split('—')[0].trim()}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 px-6 py-6 overflow-y-auto">
        <div className="space-y-6">
          {renderSection('Prompt', prompt)}
          {renderSection('Response', response)}
        </div>
      </div>
    </div>
  );
}

// ===== Model Comparison Component =====
function ModelComparisonCard({
  panels,
  biasSummaries,
  activeChatId,
}: {
  panels: Panel[];
  biasSummaries: Record<string, BiasColumnState>;
  activeChatId: string;
}) {
  // Get response bias data for both models
  const model1Response = biasSummaries[`${activeChatId}:${panels[0]?.id}`]?.response;
  const model2Response = biasSummaries[`${activeChatId}:${panels[1]?.id}`]?.response;

  // Both models need to have ready response data
  if (
    model1Response?.status !== 'ready' ||
    model2Response?.status !== 'ready' ||
    !model1Response.result ||
    !model2Response.result
  ) {
    return null;
  }

  const model1Stats = model1Response.result.statistics;
  const model2Stats = model2Response.result.statistics;

  // Prepare comparison data for bias types
  const allBiasTypes = new Set([
    ...Object.keys(model1Stats.biasTypeCounts),
    ...Object.keys(model2Stats.biasTypeCounts),
  ]);

  const comparisonData = Array.from(allBiasTypes).map((biasType) => {
    const model1Count = model1Stats.biasTypeCounts[biasType] || 0;
    const model2Count = model2Stats.biasTypeCounts[biasType] || 0;
    const model1Percentage = model1Stats.totalSentences > 0 
      ? (model1Count / model1Stats.totalSentences) * 100 
      : 0;
    const model2Percentage = model2Stats.totalSentences > 0 
      ? (model2Count / model2Stats.totalSentences) * 100 
      : 0;
    
    return {
      biasType,
      model1: model1Count,
      model2: model2Count,
      model1Percentage: model1Percentage.toFixed(1),
      model2Percentage: model2Percentage.toFixed(1),
      delta: model2Percentage - model1Percentage,
    };
  });

  if (comparisonData.length === 0) {
    return null;
  }

  const model1Name = panels[0]?.name.split('—')[0].trim() || 'Model 1';
  const model2Name = panels[1]?.name.split('—')[0].trim() || 'Model 2';

  // Helper function to get color from dot class
  const getModelColor = (dot: string | undefined): string => {
    if (!dot) return '#6366f1';
    if (dot.includes('cyan')) return '#06b6d4';
    if (dot.includes('blue')) return '#3b82f6';
    if (dot.includes('purple')) return '#8b5cf6';
    if (dot.includes('pink')) return '#ec4899';
    if (dot.includes('indigo')) return '#6366f1';
    if (dot.includes('violet')) return '#a78bfa';
    if (dot.includes('orange')) return '#f97316';
    if (dot.includes('teal')) return '#14b8a6';
    return '#6366f1';
  };

  const model1Color = getModelColor(panels[0]?.dot);
  const model2Color = getModelColor(panels[1]?.dot);

  return (
    <div className="w-full max-w-[1300px] mx-auto">
      <div className="flex flex-col border border-[var(--panelBorder)] bg-gradient-to-br from-[var(--panel)]/92 via-[var(--panel)]/95 to-[var(--panel)]/92 shadow-[0_18px_45px_rgba(5,10,25,0.3)] backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-[var(--panelHairline)]/60 bg-gradient-to-r from-[var(--panelHeader)]/80 to-[var(--panelHeader)]/60 px-6 py-4 shrink-0">
          <div className="flex items-center gap-3 text-sm font-semibold text-[var(--textPrimary)]">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--panelBorder)] opacity-60" />
            Model Comparison · Response Bias Analysis
          </div>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Overall Comparison Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border border-[var(--panelHairline)]/40 bg-gradient-to-br from-[rgba(255,255,255,0.03)] to-[rgba(255,255,255,0.01)] p-4">
              <div className="text-xs text-[var(--muted)] mb-1">{model1Name}</div>
              <div className="text-2xl font-bold text-[var(--textPrimary)]">{model1Stats.biasPercentage.toFixed(1)}%</div>
              <div className="text-[10px] text-[var(--muted)] mt-1">
                {model1Stats.biasedSentences} biased / {model1Stats.totalSentences} total
              </div>
            </div>
            <div className="border border-[var(--panelHairline)]/40 bg-gradient-to-br from-[rgba(255,255,255,0.03)] to-[rgba(255,255,255,0.01)] p-4">
              <div className="text-xs text-[var(--muted)] mb-1">{model2Name}</div>
              <div className="text-2xl font-bold text-[var(--textPrimary)]">{model2Stats.biasPercentage.toFixed(1)}%</div>
              <div className="text-[10px] text-[var(--muted)] mt-1">
                {model2Stats.biasedSentences} biased / {model2Stats.totalSentences} total
              </div>
            </div>
          </div>

          {/* Model-vs-Model Delta Chart */}
          <div className="border border-[var(--panelHairline)]/40 bg-gradient-to-br from-[rgba(255,255,255,0.03)] to-[rgba(255,255,255,0.01)] p-4 overflow-visible">
            <div className="mb-4 text-xs font-medium text-[var(--muted)]">
              Bias Type Comparison · {model1Name} vs {model2Name}
            </div>
            <div className="overflow-visible">
              <ResponsiveContainer width="100%" height={Math.max(250, comparisonData.length * 35)}>
                <BarChart data={comparisonData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis 
                    type="number" 
                    tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.6)' }}
                    label={{ value: 'Bias Count', position: 'insideBottom', offset: -5, style: { fill: 'rgba(255,255,255,0.6)', fontSize: 11 } }}
                  />
                  <YAxis 
                    type="category" 
                    dataKey="biasType" 
                    width={90} 
                    tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.6)' }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(15,18,28,0.98)', 
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '12px'
                    }}
                    formatter={(value: any, name: string, props: any) => {
                      const biasType = props?.payload?.biasType;
                      const data = comparisonData.find(d => d.biasType === biasType);
                      if (name === 'model1' && data) return [`${value} (${data.model1Percentage}%)`, model1Name];
                      if (name === 'model2' && data) return [`${value} (${data.model2Percentage}%)`, model2Name];
                      return value;
                    }}
                  />
                  <Legend 
                    formatter={(value) => {
                      if (value === 'model1') return model1Name;
                      if (value === 'model2') return model2Name;
                      return value;
                    }}
                    wrapperStyle={{ fontSize: '11px', paddingTop: '10px', paddingBottom: '10px' }}
                    iconType="rect"
                  />
                  <Bar 
                    dataKey="model1" 
                    fill={model1Color} 
                    radius={[0, 4, 4, 0]}
                    animationDuration={800}
                    name="model1"
                  >
                    {comparisonData.map((entry, index) => (
                      <Cell 
                        key={`cell-model1-${index}`} 
                        fill={model1Color}
                      />
                    ))}
                  </Bar>
                  <Bar 
                    dataKey="model2" 
                    fill={model2Color} 
                    radius={[0, 4, 4, 0]}
                    animationDuration={800}
                    name="model2"
                  >
                    {comparisonData.map((entry, index) => (
                      <Cell 
                        key={`cell-model2-${index}`} 
                        fill={model2Color}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Delta Summary */}
            <div className="mt-4 pt-4 border-t border-[var(--panelHairline)]/30 px-1">
              <div className="text-xs font-medium text-[var(--muted)] mb-2">Key Differences:</div>
              <div className="space-y-1.5">
                {comparisonData
                  .filter(item => Math.abs(item.delta) > 2) // Only show significant differences
                  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
                  .slice(0, 3)
                  .map((item, idx) => (
                    <div key={idx} className="text-[11px] text-[var(--muted)] leading-relaxed">
                      {item.delta > 0 ? (
                        <span>
                          <span className="text-red-400">{model2Name}</span> shows <span className="text-red-400 font-semibold">+{Math.abs(item.delta).toFixed(1)}%</span> more <span className="text-[var(--textPrimary)]">{item.biasType}</span> bias than <span className="text-blue-400">{model1Name}</span>
                        </span>
                      ) : (
                        <span>
                          <span className="text-red-400">{model1Name}</span> shows <span className="text-red-400 font-semibold">+{Math.abs(item.delta).toFixed(1)}%</span> more <span className="text-[var(--textPrimary)]">{item.biasType}</span> bias than <span className="text-blue-400">{model2Name}</span>
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Model Selection Hook =====
function useModelSelection() {
  const [selectedModels, setSelectedModels] = useState<[string, string]>([...DEFAULT_MODELS] as [string, string]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const loadModels = (): [string, string] => {
      try {
        const stored = localStorage.getItem(MODEL_SELECTION_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length === 2) {
            // Validate models exist
            const valid = parsed.filter(m => AVAILABLE_MODELS.some(am => am.id === m));
            if (valid.length === 2) return valid as [string, string];
          }
        }
      } catch {
        /* ignore malformed data */
      }
      return [...DEFAULT_MODELS] as [string, string];
    };

    const models = loadModels();
    setSelectedModels(models);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(MODEL_SELECTION_KEY, JSON.stringify(selectedModels));
  }, [selectedModels, hydrated]);

  const setModel = useCallback((columnIndex: 0 | 1, modelId: string) => {
    if (AVAILABLE_MODELS.some(am => am.id === modelId)) {
      setSelectedModels((prev) => {
        const newModels: [string, string] = [...prev];
        newModels[columnIndex] = modelId;
        return newModels;
      });
    }
  }, []);

  return { selectedModels, setModel, hydrated };
}

// ===== Main page =====
export default function Page() {
  const { chats, addChat, renameChat, removeChat, hydrated: chatsHydrated } = useChatHistory();
  const { selectedModels, setModel, hydrated: modelsHydrated } = useModelSelection();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [biasSummaries, setBiasSummaries] = useState<Record<string, BiasColumnState>>({});
  const [allMessages, setAllMessages] = useState<Record<string, any[]>>({});
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Create panels from selected models
  const panels = useMemo<Panel[]>(() => {
    return selectedModels
      .map((modelId) => AVAILABLE_MODELS.find((m) => m.id === modelId))
      .filter((m): m is ModelOption => m !== undefined)
      .map((model) => ({
        id: model.id.replace(/[\/\.]/g, '-'),
        name: model.name,
        endpoint: model.endpoint,
        dot: model.dot,
      }));
  }, [selectedModels]);

  const handleModelChange = useCallback((columnIndex: number, modelId: string) => {
    setModel(columnIndex as 0 | 1, modelId);
  }, [setModel]);

  const handleBiasUpdate = useCallback((panelId: string, state: BiasColumnState) => {
    if (!activeChatId) return;
    const key = `${activeChatId}:${panelId}`;
    setBiasSummaries((prev) => ({ ...prev, [key]: state }));
  }, [activeChatId]);

  const handleMessagesUpdate = useCallback((panelId: string, messages: any[]) => {
    if (!activeChatId) return;
    const key = `${activeChatId}:${panelId}`;
    setAllMessages((prev) => ({ ...prev, [key]: messages }));
  }, [activeChatId]);

  useEffect(() => {
    if (!chatsHydrated || chats.length === 0) return;
    if (!activeChatId || !chats.some((c) => c.id === activeChatId)) {
      setActiveChatId(chats[0].id);
    }
  }, [chatsHydrated, chats, activeChatId]);


  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
  }, [prompt, chatsHydrated]);

  const canUseChat = chatsHydrated && modelsHydrated && !!activeChatId && panels.length === 2;

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

  // Export chat data with full messages and bias statistics
  const exportChatJSON = () => {
    if (!canUseChat) return;
    
    const exportData = {
      chat: activeChat,
      exportedAt: new Date().toISOString(),
      models: panels.map((panel) => {
        const messages = allMessages[`${activeChatId}:${panel.id}`] || [];
        const biasAnalysis = biasSummaries[`${activeChatId}:${panel.id}`];
        
        return {
          id: panel.id,
          name: panel.name,
          messages: messages.map((msg) => ({
            role: msg.role,
            content: getTextFromParts(msg.parts),
            timestamp: msg.createdAt || msg.timestamp,
          })),
          biasAnalysis: biasAnalysis ? {
            prompt: biasAnalysis.prompt.status === 'ready' ? {
              text: biasAnalysis.prompt.text,
              statistics: biasAnalysis.prompt.result?.statistics,
              sentences: biasAnalysis.prompt.result?.sentences,
            } : null,
            response: biasAnalysis.response.status === 'ready' ? {
              text: biasAnalysis.response.text,
              statistics: biasAnalysis.response.result?.statistics,
              sentences: biasAnalysis.response.result?.sentences,
            } : null,
          } : null,
        };
      }),
    };
    
    const blob = new Blob(
      [JSON.stringify(exportData, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${activeChat?.title || activeChatId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Export as PDF with visuals
  const exportChatPDF = async () => {
    if (!canUseChat) return;
    
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let yPosition = 20;
      
      // Header
      pdf.setFontSize(18);
      pdf.text('LLM Bias Analysis Report', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 10;
      
      pdf.setFontSize(12);
      pdf.text(`Chat: ${activeChat?.title || 'Untitled'}`, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 5;
      pdf.text(`Exported: ${new Date().toLocaleString()}`, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 15;
      
      // For each model
      for (const panel of panels) {
        if (yPosition > pageHeight - 40) {
          pdf.addPage();
          yPosition = 20;
        }
        
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text(panel.name, 20, yPosition);
        yPosition += 8;
        
        const messages = allMessages[`${activeChatId}:${panel.id}`] || [];
        const biasAnalysis = biasSummaries[`${activeChatId}:${panel.id}`];
        
        // Messages
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'normal');
        pdf.text('Messages:', 20, yPosition);
        yPosition += 6;
        
        for (const msg of messages) {
          if (yPosition > pageHeight - 20) {
            pdf.addPage();
            yPosition = 20;
          }
          
          const content = getTextFromParts(msg.parts);
          pdf.setFont('helvetica', 'bold');
          pdf.text(`${msg.role === 'user' ? 'User' : 'Assistant'}:`, 20, yPosition);
          yPosition += 6;
          
          pdf.setFont('helvetica', 'normal');
          const lines = pdf.splitTextToSize(content, pageWidth - 40);
          pdf.text(lines, 25, yPosition);
          yPosition += lines.length * 5 + 3;
        }
        
        // Bias Analysis
        if (biasAnalysis) {
          if (yPosition > pageHeight - 30) {
            pdf.addPage();
            yPosition = 20;
          }
          
          yPosition += 5;
          pdf.setFont('helvetica', 'bold');
          pdf.text('Bias Analysis:', 20, yPosition);
          yPosition += 6;
          
          // Prompt analysis
          if (biasAnalysis.prompt.status === 'ready' && biasAnalysis.prompt.result) {
            const stats = biasAnalysis.prompt.result.statistics;
            pdf.setFont('helvetica', 'bold');
            pdf.text('Prompt Analysis:', 25, yPosition);
            yPosition += 6;
            pdf.setFont('helvetica', 'normal');
            pdf.text(`Total Sentences: ${stats.totalSentences}`, 30, yPosition);
            yPosition += 5;
            pdf.text(`Biased: ${stats.biasedSentences} (${stats.biasPercentage.toFixed(1)}%)`, 30, yPosition);
            yPosition += 5;
            pdf.text(`Unbiased: ${stats.unbiasedSentences}`, 30, yPosition);
            yPosition += 8;
          }
          
          // Response analysis
          if (biasAnalysis.response.status === 'ready' && biasAnalysis.response.result) {
            if (yPosition > pageHeight - 30) {
              pdf.addPage();
              yPosition = 20;
            }
            
            const stats = biasAnalysis.response.result.statistics;
            pdf.setFont('helvetica', 'bold');
            pdf.text('Response Analysis:', 25, yPosition);
            yPosition += 6;
            pdf.setFont('helvetica', 'normal');
            pdf.text(`Total Sentences: ${stats.totalSentences}`, 30, yPosition);
            yPosition += 5;
            pdf.text(`Biased: ${stats.biasedSentences} (${stats.biasPercentage.toFixed(1)}%)`, 30, yPosition);
            yPosition += 5;
            pdf.text(`Unbiased: ${stats.unbiasedSentences}`, 30, yPosition);
            yPosition += 5;
            
            // Bias types
            if (Object.keys(stats.biasTypeCounts).length > 0) {
              pdf.text('Bias Types:', 30, yPosition);
              yPosition += 5;
              for (const [type, count] of Object.entries(stats.biasTypeCounts)) {
                pdf.text(`  • ${type}: ${count}`, 35, yPosition);
                yPosition += 5;
              }
            }
            yPosition += 8;
          }
        }
        
        yPosition += 5;
      }
      
      pdf.save(`chat-${activeChat?.title || activeChatId}.pdf`);
    } catch (error) {
      console.error('PDF export failed:', error);
      alert('Failed to export PDF. Please try again.');
    }
  };

  // Send to all
  const sendAll = () => {
    if (!canUseChat) return;
    document.querySelectorAll<HTMLButtonElement>('button[data-send]').forEach(b => b.click());
    setPrompt('');
  };

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar - DISABLED */}
      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--panelHairline)] bg-[var(--panelHeader)] px-6 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <img
              src="/favicon.ico"
              alt="BiasScope Logo"
              className="h-[1.4em] w-[1.4em] object-contain align-middle"
            />
            <h1>LLM Bias Scope</h1>
            <span className="badge hidden md:inline">Compare model biases side-by-side</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              className="btn"
              href="https://docs.google.com/forms/d/e/1FAIpQLSd7YMQ-15J2oHZ4_Ihdsa4FJHb0JMANY5-JAP2Tt6EQn2N4Mg/viewform?usp=publish-editor"
              target="_blank"
              rel="noopener noreferrer"
            >
              Give Feedback
            </a>
            <div className="relative" ref={exportMenuRef}>
              <button className="btn" onClick={() => setShowExportMenu(!showExportMenu)} disabled={!canUseChat}>
                Export ▼
              </button>
              {showExportMenu && (
                <div className="absolute top-full right-0 mt-1 w-40 rounded-lg border border-[var(--panelHairline)] bg-[var(--panel)] shadow-lg z-50">
                  <button
                    className="btn ghost w-full rounded-b-none rounded-t-lg px-3 py-2 text-sm"
                    onClick={() => { exportChatJSON(); setShowExportMenu(false); }}
                  >
                    Export as JSON
                  </button>
                  <button
                    className="btn ghost w-full rounded-t-none rounded-b-lg px-3 py-2 text-sm"
                    onClick={() => { exportChatPDF(); setShowExportMenu(false); }}
                  >
                    Export as PDF
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Scrollable content area */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            {/* Two fixed columns; scroll horizontally on narrow viewports */}
            <div className="flex overflow-x-auto px-8 py-12">
              <div className="mx-auto flex w-full max-w-[1300px] flex-1 items-stretch justify-center" style={{ gap: '2rem' }}>
                {chatsHydrated && modelsHydrated && activeChatId && panels.length === 2 ? (
                  panels.map((p, idx) => (
                    <div key={`${activeChatId}-${p.id}-wrapper`} className="flex-1 relative" style={{ minWidth: '420px', maxWidth: '560px' }}>
                      {idx > 0 && (
                        <div 
                          className="absolute left-0 top-0 bottom-0 w-px bg-[var(--panelHairline)]/50"
                          style={{ left: '-1rem', zIndex: 1 }}
                        />
                      )}
                      <ChatColumn
                        key={`${activeChatId}-${p.id}`}
                        panel={p}
                        chatId={activeChatId}
                        sharedPrompt={prompt}
                        onFirstUserMessage={handleFirstUserMessage}
                        onBiasUpdate={handleBiasUpdate}
                        onMessagesUpdate={handleMessagesUpdate}
                        columnIndex={idx}
                        onModelChange={handleModelChange}
                        otherSelectedModel={idx === 0 ? selectedModels[1] : selectedModels[0]}
                      />
                    </div>
                  ))
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]">
                    Preparing chats…
                  </div>
                )}
              </div>
            </div>

            {/* Bias summaries */}
            <div className="px-8 pb-12 pt-12 border-t border-[var(--panelHairline)]/30">
              <div className="mx-auto flex w-full max-w-[1300px] flex-col items-stretch justify-center" style={{ gap: '2rem' }}>
                <div className="flex w-full flex-wrap items-stretch justify-center relative" style={{ gap: '2rem' }}>
                  {panels.map((p, idx) => (
                    <div key={`${p.id}-bias-wrapper`} className="flex-1 relative" style={{ minWidth: '400px', maxWidth: '600px' }}>
                      {idx > 0 && (
                        <div 
                          className="absolute left-0 top-0 bottom-0 w-px bg-[var(--panelHairline)]/50"
                          style={{ left: '-1rem', zIndex: 1 }}
                        />
                      )}
                      <BiasSummaryCard panel={p} analysis={biasSummaries[`${activeChatId}:${p.id}`]} />
                    </div>
                  ))}
                </div>
                {/* Model Comparison Card */}
                <ModelComparisonCard 
                  panels={panels} 
                  biasSummaries={biasSummaries}
                  activeChatId={activeChatId}
                />
              </div>
            </div>
          </div>

          {/* Composer (bottom, big and pretty) */}
          <footer className="border-t border-transparent px-8 pb-12 pt-6 shrink-0">
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
      </div>
    
  );
}
