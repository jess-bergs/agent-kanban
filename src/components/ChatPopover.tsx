import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { MessageCircle, X, Send, Loader2, FolderOpen, File, ChevronRight, ChevronLeft, Paperclip } from 'lucide-react';
import type { ChatMessage, Project } from '../types';

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

interface ChatPopoverProps {
  projects: Project[];
}

export function ChatPopover({ projects }: ChatPopoverProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Project & file selection
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [browseDir, setBrowseDir] = useState('');
  const [browseItems, setBrowseItems] = useState<FileItem[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (open && !showFilePicker) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open, showFilePicker]);

  // Load file listing when browsing
  useEffect(() => {
    if (!showFilePicker || !selectedProjectId) return;
    setBrowseLoading(true);
    const params = new URLSearchParams({ projectId: selectedProjectId });
    if (browseDir) params.set('path', browseDir);
    fetch(`/api/chat/files?${params}`)
      .then(r => r.json())
      .then((data: { items: FileItem[] }) => setBrowseItems(data.items))
      .catch(() => setBrowseItems([]))
      .finally(() => setBrowseLoading(false));
  }, [showFilePicker, selectedProjectId, browseDir]);

  function handleProjectChange(id: string) {
    setSelectedProjectId(id || null);
    setAttachedFiles([]);
    setBrowseDir('');
  }

  function toggleFile(filePath: string) {
    setAttachedFiles(prev =>
      prev.includes(filePath)
        ? prev.filter(f => f !== filePath)
        : prev.length < 10 ? [...prev, filePath] : prev
    );
  }

  function removeFile(filePath: string) {
    setAttachedFiles(prev => prev.filter(f => f !== filePath));
  }

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
      const body: Record<string, unknown> = { messages: updatedMessages };
      if (selectedProjectId) body.projectId = selectedProjectId;
      if (attachedFiles.length > 0) body.filePaths = attachedFiles;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
            ? 'bg-surface-700 text-tertiary hover:text-secondary'
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
            <span className="text-sm font-semibold text-primary">Agent Kanban Chat</span>
          </div>

          {/* Project selector bar */}
          <div className="px-3 py-2 border-b border-surface-700 shrink-0 flex items-center gap-2">
            <FolderOpen className="w-3.5 h-3.5 text-tertiary shrink-0" />
            <select
              value={selectedProjectId ?? ''}
              onChange={e => handleProjectChange(e.target.value)}
              className="flex-1 bg-surface-900 border border-surface-600 rounded px-2 py-1 text-xs text-secondary focus:outline-none focus:border-accent-blue"
            >
              <option value="">All projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {selectedProjectId && (
              <button
                onClick={() => { setShowFilePicker(!showFilePicker); setBrowseDir(''); }}
                className={`p-1 rounded transition-colors ${
                  showFilePicker
                    ? 'bg-accent-blue/20 text-accent-blue'
                    : 'text-tertiary hover:text-secondary hover:bg-surface-700'
                }`}
                title="Attach files"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Attached files pills */}
          {attachedFiles.length > 0 && (
            <div className="px-3 py-1.5 border-b border-surface-700 shrink-0 flex flex-wrap gap-1">
              {attachedFiles.map(f => (
                <span
                  key={f}
                  className="inline-flex items-center gap-1 bg-accent-blue/15 text-accent-blue text-[10px] px-2 py-0.5 rounded-full"
                >
                  <File className="w-2.5 h-2.5" />
                  {f.split('/').pop()}
                  <button
                    onClick={() => removeFile(f)}
                    className="hover:text-white transition-colors"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* File picker overlay */}
          {showFilePicker && selectedProjectId ? (
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="px-3 py-2 border-b border-surface-700 flex items-center gap-2 text-xs text-tertiary">
                {browseDir && (
                  <button
                    onClick={() => {
                      const parent = browseDir.includes('/')
                        ? browseDir.slice(0, browseDir.lastIndexOf('/'))
                        : '';
                      setBrowseDir(parent);
                    }}
                    className="flex items-center gap-0.5 text-tertiary hover:text-secondary transition-colors"
                  >
                    <ChevronLeft className="w-3 h-3" />
                    Back
                  </button>
                )}
                <span className="font-mono truncate">
                  /{browseDir || selectedProject?.name || ''}
                </span>
                <button
                  onClick={() => setShowFilePicker(false)}
                  className="ml-auto text-muted hover:text-secondary text-[10px]"
                >
                  Done
                </button>
              </div>
              {browseLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-muted" />
                </div>
              ) : browseItems.length === 0 ? (
                <div className="text-center text-xs text-muted py-8">Empty directory</div>
              ) : (
                <div className="divide-y divide-surface-700/50">
                  {browseItems.map(item => (
                    <button
                      key={item.path}
                      onClick={() => {
                        if (item.type === 'dir') {
                          setBrowseDir(item.path);
                        } else {
                          toggleFile(item.path);
                        }
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-surface-700/50 transition-colors ${
                        attachedFiles.includes(item.path) ? 'bg-accent-blue/10' : ''
                      }`}
                    >
                      {item.type === 'dir' ? (
                        <FolderOpen className="w-3.5 h-3.5 text-accent-amber shrink-0" />
                      ) : (
                        <File className="w-3.5 h-3.5 text-tertiary shrink-0" />
                      )}
                      <span className="truncate text-secondary">{item.name}</span>
                      {item.type === 'dir' && (
                        <ChevronRight className="w-3 h-3 text-muted ml-auto shrink-0" />
                      )}
                      {item.type === 'file' && attachedFiles.includes(item.path) && (
                        <span className="ml-auto text-[10px] text-accent-blue">attached</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Messages */
            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
              {messages.length === 0 && (
                <div className="text-center text-xs text-muted mt-8 space-y-2">
                  <MessageCircle className="w-8 h-8 mx-auto text-faint" />
                  <p>Ask questions or take actions on your projects and tickets.</p>
                  <div className="space-y-1 text-[11px]">
                    <p className="text-faint">Try:</p>
                    <button
                      onClick={() => setInput('What tickets are in progress?')}
                      className="block mx-auto text-accent-blue/70 hover:text-accent-blue transition-colors"
                    >
                      "What tickets are in progress?"
                    </button>
                    <button
                      onClick={() => setInput('Retry all failed tickets')}
                      className="block mx-auto text-accent-blue/70 hover:text-accent-blue transition-colors"
                    >
                      "Retry all failed tickets"
                    </button>
                    <button
                      onClick={() => setInput('Show me the project structure')}
                      className="block mx-auto text-accent-blue/70 hover:text-accent-blue transition-colors"
                    >
                      "Show me the project structure"
                    </button>
                    <button
                      onClick={() => setInput('Are there any tickets that need attention?')}
                      className="block mx-auto text-accent-blue/70 hover:text-accent-blue transition-colors"
                    >
                      "Are there any tickets that need attention?"
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
                        ? 'bg-accent-blue/20 text-primary'
                        : 'bg-surface-700 text-secondary'
                    }`}
                  >
                    <MessageContent content={msg.content} />
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-surface-700 rounded-lg px-3 py-2 text-xs text-tertiary flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Thinking...
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-surface-700 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedProject ? `Ask about ${selectedProject.name}...` : 'Ask a question...'}
                rows={1}
                className="flex-1 bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-xs text-primary placeholder-muted focus:outline-none focus:border-accent-blue transition-colors resize-none max-h-20"
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
            <pre key={i} className="bg-surface-900 rounded p-2 overflow-x-auto font-mono text-[11px] text-secondary">
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
