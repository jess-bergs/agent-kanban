import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';
import type { ChatMessage } from '../types';

export function ChatPopover() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Request failed');
      }

      const data = await res.json() as { content: string };
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.content, timestamp: Date.now() },
      ]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all ${
          open
            ? 'bg-surface-700 text-slate-400 hover:text-slate-200'
            : 'bg-accent-blue text-white hover:bg-accent-blue/90'
        }`}
      >
        {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-96 h-[32rem] bg-surface-800 border border-surface-600 rounded-xl shadow-2xl flex flex-col animate-in overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-700 shrink-0">
            <MessageCircle className="w-4 h-4 text-accent-blue" />
            <span className="text-sm font-semibold text-slate-100">Agent Kanban Chat</span>
            <span className="text-[10px] text-slate-500 ml-auto">Ask about projects, tickets, agents</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="text-center text-xs text-slate-500 mt-8 space-y-2">
                <MessageCircle className="w-8 h-8 mx-auto text-slate-600" />
                <p>Ask me about your projects, tickets, or agents.</p>
                <div className="space-y-1 text-[11px]">
                  <p className="text-slate-600">Try:</p>
                  <button
                    onClick={() => setInput('What tickets are in progress?')}
                    className="block mx-auto text-accent-blue/70 hover:text-accent-blue transition-colors"
                  >
                    "What tickets are in progress?"
                  </button>
                  <button
                    onClick={() => setInput('Show me a summary of all projects')}
                    className="block mx-auto text-accent-blue/70 hover:text-accent-blue transition-colors"
                  >
                    "Show me a summary of all projects"
                  </button>
                  <button
                    onClick={() => setInput('Are any agents running right now?')}
                    className="block mx-auto text-accent-blue/70 hover:text-accent-blue transition-colors"
                  >
                    "Are any agents running right now?"
                  </button>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-accent-blue/20 text-slate-100'
                      : 'bg-surface-700 text-slate-200'
                  }`}
                >
                  <MessageContent content={msg.content} />
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-surface-700 rounded-lg px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Thinking...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-surface-700 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                rows={1}
                className="flex-1 bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent-blue transition-colors resize-none max-h-20"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="p-2 rounded-lg bg-accent-blue text-white hover:bg-accent-blue/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Parses inline markdown (bold, inline code) into React elements */
function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*.*?\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const segment = match[0];
    if (segment.startsWith('**') && segment.endsWith('**')) {
      nodes.push(<strong key={match.index}>{segment.slice(2, -2)}</strong>);
    } else if (segment.startsWith('`') && segment.endsWith('`')) {
      nodes.push(
        <code key={match.index} className="bg-surface-900 px-1 rounded text-[11px] font-mono">
          {segment.slice(1, -1)}
        </code>
      );
    }
    lastIndex = match.index + segment.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

/** Renders message content with basic markdown support (safe, no innerHTML) */
function MessageContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-1.5">
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const inner = part.slice(3, -3);
          const firstNewline = inner.indexOf('\n');
          const code = firstNewline >= 0 ? inner.slice(firstNewline + 1) : inner;
          return (
            <pre key={i} className="bg-surface-900 rounded p-2 overflow-x-auto font-mono text-[11px] text-slate-300">
              {code}
            </pre>
          );
        }

        return part.split('\n').map((line, j) => {
          if (!line.trim()) return <div key={`${i}-${j}`} className="h-1" />;

          const isBullet = /^[-*]\s/.test(line);
          const displayLine = isBullet ? line.slice(2) : line;

          return (
            <p key={`${i}-${j}`}>
              {isBullet && '• '}
              {parseInline(displayLine)}
            </p>
          );
        });
      })}
    </div>
  );
}
