import { useEffect, useState, useRef, useCallback } from 'react';
import {
  X,
  Hash,
  Clock,
  Loader2,
  CheckCircle,
  AlertCircle,
  GitPullRequest,
  ExternalLink,
  FileText,
  GitBranch,
  FolderOpen,
  RotateCcw,
  Trash2,
  Zap,
  RefreshCw,
  Brain,
  Terminal,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Activity,
  Gauge,
  ShieldAlert,
  ImagePlus,
  Images,
} from 'lucide-react';
import type { Ticket, TicketStatus, Project, AgentActivity } from '../types';
import { TICKET_STATUS_LABELS, formatTimestamp, formatDuration, formatTokenCount } from '../types';

import { XCircle, GitMerge, AlertTriangle, StopCircle } from 'lucide-react';

const STATUS_STYLE: Record<TicketStatus, { bg: string; text: string; icon: typeof Clock }> = {
  todo: { bg: 'bg-accent-amber/10', text: 'text-accent-amber', icon: Clock },
  in_progress: { bg: 'bg-accent-blue/10', text: 'text-accent-blue', icon: Loader2 },
  needs_approval: { bg: 'bg-accent-orange/10', text: 'text-accent-orange', icon: ShieldAlert },
  in_review: { bg: 'bg-accent-cyan/10', text: 'text-accent-cyan', icon: GitPullRequest },
  done: { bg: 'bg-accent-green/10', text: 'text-accent-green', icon: CheckCircle },
  merged: { bg: 'bg-accent-purple/10', text: 'text-accent-purple', icon: GitMerge },
  failed: { bg: 'bg-accent-red/10', text: 'text-accent-red', icon: XCircle },
  error: { bg: 'bg-accent-red/10', text: 'text-accent-red', icon: AlertCircle },
};

interface TicketDetailModalProps {
  ticket: Ticket;
  project: Project | null;
  onClose: () => void;
}

function ActivityIcon({ type }: { type: AgentActivity['type'] }) {
  switch (type) {
    case 'thinking':
      return <Brain className="w-3 h-3 text-accent-purple" />;
    case 'tool_use':
      return <Terminal className="w-3 h-3 text-accent-cyan" />;
    case 'tool_result':
      return <CheckCircle className="w-3 h-3 text-accent-green" />;
    case 'text':
      return <MessageSquare className="w-3 h-3 text-slate-400" />;
  }
}

function ActivityLabel({ entry }: { entry: AgentActivity }) {
  switch (entry.type) {
    case 'thinking':
      return <span className="text-accent-purple">Reasoning</span>;
    case 'tool_use':
      return <span className="text-accent-cyan">{entry.tool || 'Tool'}</span>;
    case 'tool_result':
      return <span className="text-accent-green">Result</span>;
    case 'text':
      return <span className="text-slate-400">Output</span>;
  }
}

export function TicketDetailModal({ ticket, project, onClose }: TicketDetailModalProps) {
  const style = STATUS_STYLE[ticket.status];
  const StatusIcon = style.icon;
  const isAgentActive = ticket.status === 'in_progress' || ticket.status === 'needs_approval';
  const [acting, setActing] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [showActivity, setShowActivity] = useState(true);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  async function handleRetry() {
    setActing(true);
    try {
      await fetch(`/api/tickets/${ticket.id}/retry`, { method: 'POST' });
    } finally {
      setActing(false);
    }
  }

  async function handleDelete() {
    setActing(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, { method: 'DELETE' });
      if (res.ok) onClose();
    } finally {
      setActing(false);
    }
  }

  async function handleRefreshStatus() {
    setActing(true);
    try {
      await fetch(`/api/tickets/${ticket.id}/refresh-status`, { method: 'POST' });
    } finally {
      setActing(false);
    }
  }

  async function handleAbort() {
    setActing(true);
    try {
      await fetch(`/api/tickets/${ticket.id}/abort`, { method: 'POST' });
    } finally {
      setActing(false);
    }
  }

  async function handleMarkDone() {
    setActing(true);
    try {
      await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
    } finally {
      setActing(false);
    }
  }

  const uploadImageFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      await fetch(`/api/tickets/${ticket.id}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, originalName: file.name }),
      });
    }
  }, [ticket.id]);

  async function handleDeleteImage(filename: string) {
    await fetch(`/api/tickets/${ticket.id}/images/${filename}`, { method: 'DELETE' });
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (expandedImage) {
          setExpandedImage(null);
        } else {
          onClose();
        }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, expandedImage]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-surface-800 border border-surface-600 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-surface-700 shrink-0">
          <div className="min-w-0 flex-1 pr-4">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Hash className="w-3 h-3" />
                {ticket.id}
              </span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
                <StatusIcon className={`w-3 h-3 ${ticket.status === 'in_progress' ? 'animate-spin' : ''} ${ticket.status === 'needs_approval' ? 'animate-pulse' : ''}`} />
                {TICKET_STATUS_LABELS[ticket.status]}
              </span>
              {ticket.queued && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-accent-cyan/10 text-accent-cyan">
                  <Clock className="w-3 h-3" />
                  Queued
                </span>
              )}
              {ticket.yolo && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-accent-amber/10 text-accent-amber">
                  <Zap className="w-3 h-3 fill-accent-amber" />
                  YOLO
                </span>
              )}
              {ticket.autoMerge && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-accent-purple/10 text-accent-purple">
                  <GitMerge className="w-3 h-3" />
                  Auto-Merge
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-slate-100">{ticket.subject}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-700 text-slate-400 hover:text-slate-200 transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* PR Link */}
          {ticket.prUrl && (
            <a
              href={ticket.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-colors ${
                ticket.hasConflict
                  ? 'bg-accent-red/5 border border-accent-red/20 hover:bg-accent-red/10'
                  : 'bg-accent-green/5 border border-accent-green/20 hover:bg-accent-green/10'
              }`}
            >
              <GitPullRequest className={`w-5 h-5 ${ticket.hasConflict ? 'text-accent-red' : 'text-accent-green'}`} />
              <div className="flex-1">
                <p className={`text-sm font-medium ${ticket.hasConflict ? 'text-accent-red' : 'text-accent-green'}`}>
                  Pull Request #{ticket.prNumber || ''}
                </p>
                <p className="text-xs text-slate-400 truncate">{ticket.prUrl}</p>
              </div>
              <ExternalLink className={`w-4 h-4 ${ticket.hasConflict ? 'text-accent-red' : 'text-accent-green'}`} />
            </a>
          )}

          {/* Merge Conflict Banner */}
          {ticket.hasConflict && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-accent-red/5 border border-accent-red/20">
              <AlertTriangle className="w-5 h-5 text-accent-red shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-accent-red">Merge Conflict Detected</p>
                <p className="text-xs text-slate-400">
                  This PR has conflicts with the base branch that must be resolved before merging.
                  {ticket.conflictDetectedAt && (
                    <> Detected {formatTimestamp(ticket.conflictDetectedAt)}.</>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Needs approval banner */}
          {ticket.status === 'needs_approval' && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-accent-orange/5 border border-accent-orange/20">
              <ShieldAlert className="w-5 h-5 text-accent-orange animate-pulse shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-accent-orange">
                  Waiting for tool approval
                </p>
                <p className="text-xs text-slate-400">
                  This agent is not running in YOLO mode and needs you to approve a tool call in the terminal.
                </p>
              </div>
            </div>
          )}

          {/* Project info */}
          {project && (
            <div className="flex items-start gap-3">
              <FolderOpen className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-slate-500 mb-1">Project</p>
                <p className="text-sm text-slate-200">{project.name}</p>
                <p className="text-xs text-slate-400 font-mono">{project.repoPath}</p>
              </div>
            </div>
          )}

          {/* Branch */}
          {ticket.branchName && (
            <div className="flex items-start gap-3">
              <GitBranch className="w-4 h-4 text-accent-purple mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-slate-500 mb-1">Branch</p>
                <code className="text-sm text-accent-purple bg-accent-purple/10 px-2 py-0.5 rounded">
                  {ticket.branchName}
                </code>
              </div>
            </div>
          )}

          {/* Error */}
          {ticket.error && (
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-accent-red mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500 mb-1">Error</p>
                <pre className="text-sm text-accent-red whitespace-pre-wrap font-mono bg-accent-red/5 rounded-lg p-3 border border-accent-red/20">
                  {ticket.error}
                </pre>
              </div>
            </div>
          )}

          {/* Instructions */}
          {ticket.instructions && (
            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500 mb-2">Instructions</p>
                <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono bg-surface-900 rounded-lg p-4 border border-surface-700 leading-relaxed overflow-x-auto">
                  {ticket.instructions}
                </pre>
              </div>
            </div>
          )}

          {/* Attached images */}
          {(ticket.images?.length || ticket.status === 'todo') ? (
            <div className="flex items-start gap-3">
              <Images className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs text-slate-500">
                    Images {ticket.images?.length ? `(${ticket.images.length})` : ''}
                  </p>
                  {ticket.status === 'todo' && (
                    <>
                      <button
                        onClick={() => imageInputRef.current?.click()}
                        className="text-[10px] text-accent-blue hover:text-accent-blue/80 transition-colors flex items-center gap-1"
                      >
                        <ImagePlus className="w-3 h-3" />
                        Add
                      </button>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={e => {
                          if (e.target.files) uploadImageFiles(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </>
                  )}
                </div>
                {ticket.images && ticket.images.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {ticket.images.map(img => (
                      <div key={img.filename} className="relative group">
                        <button
                          type="button"
                          onClick={() => setExpandedImage(`/api/ticket-images/${img.filename}`)}
                          className="block"
                        >
                          <img
                            src={`/api/ticket-images/${img.filename}`}
                            alt={img.originalName}
                            className="w-24 h-24 object-cover rounded-lg border border-surface-600 hover:border-accent-blue/50 transition-colors cursor-pointer"
                          />
                        </button>
                        {ticket.status === 'todo' && (
                          <button
                            onClick={() => handleDeleteImage(img.filename)}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-accent-red text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                        <p className="text-[9px] text-slate-500 truncate w-24 mt-0.5">{img.originalName}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600 italic">No images attached</p>
                )}
              </div>
            </div>
          ) : null}

          {/* Expanded image lightbox */}
          {expandedImage && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer"
              onClick={() => setExpandedImage(null)}
            >
              <img
                src={expandedImage}
                alt="Expanded view"
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                onClick={e => e.stopPropagation()}
              />
            </div>
          )}

          {/* Agent reasoning — collapsible thinking block */}
          {ticket.lastThinking && (
            <div className="flex items-start gap-3">
              <Brain className="w-4 h-4 text-accent-purple mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => setShowReasoning(!showReasoning)}
                  className="flex items-center gap-1.5 mb-2 text-xs text-accent-purple hover:text-accent-purple/80 transition-colors"
                >
                  {showReasoning
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronRight className="w-3 h-3" />
                  }
                  Agent Reasoning
                  {isAgentActive && (
                    <span className="flex items-center gap-1 text-[10px] text-accent-purple/70">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-purple animate-pulse" />
                      live
                    </span>
                  )}
                </button>
                {showReasoning && (
                  <pre
                    className="text-xs text-slate-400 whitespace-pre-wrap font-mono bg-accent-purple/5 rounded-lg p-3 border border-accent-purple/20 max-h-48 overflow-y-auto"
                    ref={el => {
                      if (el && isAgentActive) {
                        el.scrollTop = el.scrollHeight;
                      }
                    }}
                  >
                    {ticket.lastThinking}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Agent activity feed — live tool calls + output stream */}
          {(ticket.agentActivity?.length || isAgentActive) ? (
            <div className="flex items-start gap-3">
              <Activity className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => setShowActivity(!showActivity)}
                  className="flex items-center gap-1.5 mb-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showActivity
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronRight className="w-3 h-3" />
                  }
                  Agent Activity
                  {ticket.agentActivity?.length ? (
                    <span className="text-[10px] text-slate-600">
                      ({ticket.agentActivity.length} events)
                    </span>
                  ) : null}
                  {isAgentActive && (
                    <span className="flex items-center gap-1 text-[10px] text-accent-blue">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
                      live
                    </span>
                  )}
                </button>
                {showActivity && (
                  <div
                    className="space-y-1 max-h-52 overflow-y-auto bg-surface-900 rounded-lg p-2 border border-surface-700"
                    ref={el => {
                      if (el && isAgentActive) {
                        el.scrollTop = el.scrollHeight;
                      }
                    }}
                  >
                    {(!ticket.agentActivity || ticket.agentActivity.length === 0) ? (
                      <p className="text-xs text-slate-600 italic px-1">Waiting for activity...</p>
                    ) : (
                      ticket.agentActivity.map((entry, idx) => (
                        <div key={idx} className="flex items-start gap-2 px-1 py-0.5 rounded hover:bg-surface-800">
                          <div className="mt-0.5 shrink-0">
                            <ActivityIcon type={entry.type} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-[10px] font-medium">
                              <ActivityLabel entry={entry} />
                            </span>
                            <p className="text-[11px] text-slate-500 font-mono truncate leading-tight">
                              {entry.content}
                            </p>
                          </div>
                          <span className="text-[9px] text-slate-600 shrink-0 mt-0.5">
                            {formatTimestamp(entry.timestamp)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Agent output — live terminal */}
          {(ticket.lastOutput || isAgentActive) && (
            <div className="flex items-start gap-3">
              <Hash className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs text-slate-500">Agent Output</p>
                  {isAgentActive && (
                    <span className="flex items-center gap-1 text-[10px] text-accent-blue">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
                      live
                    </span>
                  )}
                </div>
                <pre
                  className="text-xs text-slate-400 whitespace-pre-wrap font-mono bg-surface-900 rounded-lg p-3 border border-surface-700 max-h-64 overflow-y-auto"
                  ref={el => {
                    if (el && isAgentActive) {
                      el.scrollTop = el.scrollHeight;
                    }
                  }}
                >
                  {ticket.lastOutput || 'Waiting for output...'}
                </pre>
              </div>
            </div>
          )}

          {/* Effort metrics — compact inline bar */}
          {ticket.effort && ticket.effort.turns > 0 && (
            <div className="flex items-center gap-3 text-xs bg-surface-900/60 rounded-lg px-3 py-2 border border-surface-700">
              <Gauge className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <div className="flex items-center gap-3 flex-wrap font-mono text-slate-400">
                <span><span className="text-slate-500">turns</span> {ticket.effort.turns}</span>
                <span><span className="text-slate-500">tools</span> {ticket.effort.toolCalls}</span>
                {ticket.effort.durationMs != null && (
                  <span><span className="text-slate-500">time</span> {formatDuration(ticket.effort.durationMs)}</span>
                )}
                {(ticket.effort.inputTokens != null || ticket.effort.outputTokens != null) && (
                  <span>
                    <span className="text-slate-500">tokens</span>{' '}
                    {ticket.effort.inputTokens != null ? formatTokenCount(ticket.effort.inputTokens) : '?'}
                    <span className="text-slate-600">/</span>
                    {ticket.effort.outputTokens != null ? formatTokenCount(ticket.effort.outputTokens) : '?'}
                  </span>
                )}
                {ticket.effort.costUsd != null && (
                  <span className="text-accent-amber">${ticket.effort.costUsd.toFixed(2)}</span>
                )}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="flex gap-6 text-xs text-slate-500 pt-2 border-t border-surface-700">
            <span>Created {formatTimestamp(ticket.createdAt)}</span>
            {ticket.startedAt && <span>Started {formatTimestamp(ticket.startedAt)}</span>}
            {ticket.completedAt && <span>Completed {formatTimestamp(ticket.completedAt)}</span>}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-3 border-t border-surface-700">
            {(ticket.status === 'in_progress' || ticket.status === 'needs_approval') && (
              <button
                onClick={handleAbort}
                disabled={acting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent-red/10 text-accent-red rounded-lg hover:bg-accent-red/20 disabled:opacity-50 transition-colors"
              >
                <StopCircle className="w-4 h-4" />
                Abort
              </button>
            )}
            {(ticket.status === 'error' || ticket.status === 'failed') && (
              <button
                onClick={handleRetry}
                disabled={acting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent-amber/10 text-accent-amber rounded-lg hover:bg-accent-amber/20 disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Retry
              </button>
            )}
            {ticket.status === 'in_review' && ticket.prUrl && (
              <button
                onClick={handleRefreshStatus}
                disabled={acting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent-cyan/10 text-accent-cyan rounded-lg hover:bg-accent-cyan/20 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${acting ? 'animate-spin' : ''}`} />
                Refresh Status
              </button>
            )}
            {(ticket.status === 'failed' || ticket.status === 'in_review') && (
              <button
                onClick={handleMarkDone}
                disabled={acting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent-green/10 text-accent-green rounded-lg hover:bg-accent-green/20 disabled:opacity-50 transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Mark Done
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={acting}
              className="flex items-center gap-2 px-4 py-2 text-sm text-slate-400 hover:text-accent-red hover:bg-accent-red/10 rounded-lg disabled:opacity-50 transition-colors ml-auto"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
