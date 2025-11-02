'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// ===== Available Models =====
type ModelOption = { id: string; name: string; endpoint: string; dot: string };

const AVAILABLE_MODELS: ModelOption[] = [
  { id: 'openai/gpt-5', name: 'OpenAI — GPT-5', endpoint: '/api/chat?model=openai/gpt-5', dot: 'bg-cyan-400' },
  { id: 'google/gemini-2.5-flash-lite', name: 'Google — Gemini 2.5 Flash Lite', endpoint: '/api/chat?model=google/gemini-2.5-flash-lite', dot: 'bg-blue-400' },
  { id: 'deepseek/deepseek-v3.1', name: 'DeepSeek — DeepSeek V3.1', endpoint: '/api/chat?model=deepseek/deepseek-v3.1', dot: 'bg-purple-400' },
  { id: 'xai/grok-4', name: 'xAI — Grok-4', endpoint: '/api/chat?model=xai/grok-4', dot: 'bg-pink-400' },
  { id: 'minimax/minimax-m2', name: 'MiniMax — MiniMax M2', endpoint: '/api/chat?model=minimax/minimax-m2', dot: 'bg-indigo-400' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Anthropic — Claude 3.5 Sonnet', endpoint: '/api/chat?model=anthropic/claude-3.5-sonnet', dot: 'bg-violet-400' },
  { id: 'mistral/ministral-3b', name: 'Mistral — Mixtral 3B', endpoint: '/api/chat?model=mistral/ministral-3b', dot: 'bg-orange-400' },
];

const DEFAULT_MODELS = ['openai/gpt-5', 'google/gemini-2.5-flash-lite'];

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
    if (onMessagesUpdate) {
      onMessagesUpdate(panel.id, messages);
    }
  }, [messages, onMessagesUpdate, panel.id]);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
        setShowModelSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <section className="flex h-full min-w-[420px] max-w-[560px] flex-1 px-4 py-3">
      <div className="flex h-full w-full flex-col overflow-hidden rounded-[26px] border border-[var(--panelBorder)] bg-[var(--panel)] shadow-[0_26px_60px_rgba(5,10,25,0.35)] backdrop-blur-xl">
        {/* Column header */}
        <div className="flex items-center justify-between border-b border-[var(--panelHairline)] bg-[var(--panelHeader)] px-7 py-[18px]">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <span className={`h-2.5 w-2.5 rounded-full ${panel.dot} shrink-0`} />
            <div className="relative flex-1 min-w-0" ref={modelSelectorRef}>
              <button
                onClick={() => setShowModelSelector(!showModelSelector)}
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
              {showModelSelector && (
                <div className="absolute top-full left-0 mt-1 w-56 rounded-lg border border-[var(--panelHairline)] bg-[var(--panel)] shadow-lg z-50 p-2">
                  <div className="mb-2 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
                    Select Model
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {AVAILABLE_MODELS.map((model) => {
                      // Match model ID with panel ID (panel.id has / replaced with -)
                      const normalizedPanelId = panel.id.replace(/-/g, '/').replace(/\./g, '/');
                      const isCurrentModel = model.id === normalizedPanelId || model.id.replace(/[\/\.]/g, '-') === panel.id;
                      const isOtherColumn = model.id === otherSelectedModel;
                      const canSelect = isCurrentModel || !isOtherColumn;
                      
                      return (
                        <button
                          key={model.id}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                            isCurrentModel
                              ? 'text-white border-none'
                              : isOtherColumn
                              ? 'opacity-50 cursor-not-allowed text-[var(--muted)]'
                              : 'hover:bg-[var(--panelHairline)]/50 text-[var(--textPrimary)]'
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
                          <span className="truncate">{model.name}</span>
                          {isCurrentModel && <span className="ml-auto text-xs shrink-0">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
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
        <div className="rounded-2xl border border-[var(--panelHairline)]/60 bg-white/10 px-5 py-4 text-sm text-[var(--muted)]">
          <div className="text-xs uppercase tracking-wider text-[var(--muted)]/80 mb-3">{label}</div>
          <div className="text-sm">Analyzing sentences…</div>
        </div>
      );
    }

    if (slot.status === 'error' && slot.error) {
      return (
        <div className="rounded-2xl border border-red-500/40 bg-red-900/10 px-5 py-4 text-sm text-red-200">
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
        <div className="rounded-2xl border border-[var(--panelHairline)]/60 bg-white/5 px-5 py-4 text-sm text-[var(--textPrimary)] max-h-[800px] overflow-y-auto">
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
            <div className="mt-6">
              <div className="mb-2 text-xs font-medium text-[var(--muted)]">Distribution</div>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={biasDistributionData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
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
            <div className="mt-6">
              <div className="mb-2 text-xs font-medium text-[var(--muted)]">Bias Types</div>
              {biasTypeData.length > 1 ? (
                <ResponsiveContainer width="100%" height={Math.min(40 * biasTypeData.length, 200)}>
                  <BarChart data={biasTypeData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
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
      <div className="rounded-2xl border border-[var(--panelHairline)]/30 bg-transparent px-5 py-4 text-sm text-[var(--muted)]">
        <div className="text-xs uppercase tracking-wider text-[var(--muted)]/70 mb-3">{label}</div>
        <div>Awaiting conversation…</div>
      </div>
    );
  };

  return (
    <div className="flex max-h-[600px] min-h-[400px] flex-1 flex-col rounded-[26px] border border-[var(--panelBorder)] bg-[var(--panel)]/92 shadow-[0_18px_45px_rgba(5,10,25,0.3)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[var(--panelHairline)]/60 bg-[var(--panelHeader)]/80 px-6 py-4 shrink-0">
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
    setBiasSummaries((prev) => ({ ...prev, [panelId]: state }));
  }, []);

  const handleMessagesUpdate = useCallback((panelId: string, messages: any[]) => {
    setAllMessages((prev) => ({ ...prev, [panelId]: messages }));
  }, []);

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
        const messages = allMessages[panel.id] || [];
        const biasAnalysis = biasSummaries[panel.id];
        
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
        
        const messages = allMessages[panel.id] || [];
        const biasAnalysis = biasSummaries[panel.id];
        
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
      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="sidebar w-[280px] shrink-0 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold opacity-90">Chatbot</div>
            <button className="btn ghost" onClick={() => setSidebarOpen(false)} title="Hide sidebar">⟨</button>
          </div>

          <button
            className="btn primary w-full mb-3"
            onClick={() => { if (!chatsHydrated) return; const { id } = addChat(); setActiveChatId(id); setPrompt(''); }}
            title="+ New chat"
            disabled={!chatsHydrated}
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
              <div className="relative flex-1" ref={exportMenuRef}>
                <button
                  className="btn w-full"
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  disabled={!canUseChat}
                >
                  Export ▼
                </button>
                {showExportMenu && (
                  <div className="absolute bottom-full left-0 mb-1 w-full rounded-lg border border-[var(--panelHairline)] bg-[var(--panel)] shadow-lg z-50">
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
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--panelHairline)] bg-[var(--panelHeader)] px-6 backdrop-blur-md">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button className="btn ghost" onClick={() => setSidebarOpen(true)} title="Show sidebar">☰</button>
            )}
            <h1>LLM Bias Scope</h1>
            <span className="badge hidden md:inline">Compare models side-by-side</span>
          </div>
          <div className="flex items-center gap-2">
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
            <button className="btn" onClick={() => { if (!chatsHydrated) return; const { id } = addChat(); setActiveChatId(id); setPrompt(''); }} disabled={!chatsHydrated}>
              ＋ New
            </button>
          </div>
        </header>

        {/* Scrollable content area */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* Two fixed columns; scroll horizontally on narrow viewports */}
          <div className="flex overflow-x-auto px-8 py-12">
            <div className="mx-auto flex w-full max-w-[1300px] flex-1 items-stretch justify-center gap-14">
              {chatsHydrated && modelsHydrated && activeChatId && panels.length === 2 ? (
                panels.map((p, idx) => (
                  <ChatColumn
                  key={p.id}
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
                ))
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]">
                  Preparing chats…
                </div>
              )}
            </div>
          </div>

        {/* Bias summaries */}
        <div className="px-8 pb-12 pt-8">
          <div className="mx-auto flex w-full max-w-[1300px] flex-wrap items-stretch justify-center gap-14">
              {panels.map((p) => (
                <BiasSummaryCard key={`${p.id}-bias`} panel={p} analysis={biasSummaries[p.id]} />
              ))}
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
