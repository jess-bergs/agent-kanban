import { useEffect, useState, useRef, useCallback } from 'react';
import {
  X,
  Hash,
  Copy,
  Check,
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
  Send,
  CornerDownLeft,
  Pencil,
  FileSearch,
} from 'lucide-react';
import type { Ticket, TicketStatus, Project, AgentActivity, StateChangeEntry } from '../types';
import { TICKET_STATUS_LABELS, formatTimestamp, formatDuration, formatTokenCount, shortenUuids } from '../types';
import { safeStatus, analyzeTicketCompat } from '../lib/ticketCompat';


import { XCircle, GitMerge, AlertTriangle, StopCircle, History, Users, ClipboardCheck, Archive, HelpCircle} from 'lucide-react';


const STATE_REASON_LABELS: Record<string, string> = {
  ticket_created: 'Created',
  agent_started: 'Agent started',
  agent_completed: 'Agent completed',
  agent_failed: 'Agent failed',
  signal_exit: 'Agent stopped (signal)',
  user_abort: 'Aborted by user',
  user_retry: 'Retried by user',
  user_action: 'Manual update',
  pr_merged: 'PR merged',
  auto_merged: 'Auto-merged',
  waiting_tool_approval: 'Waiting for approval',
  tool_approved: 'Tool approved',
  project_not_found: 'Project not found',
  worktree_setup_failed: 'Worktree setup failed',
  orphan_recovery: 'Orphan recovery',
  auto_retry: 'Auto-retried (server restart)',
  audit_requested_changes: 'Reviewer requested changes',
  conflict_resolution_dispatched: 'Conflict resolution dispatched',
  automation_budget_exhausted: 'Automation budget exhausted',
  ci_checks_failed: 'CI checks failed',
  usage_limit_hold: 'Usage limit — on hold',
  hold_resumed: 'Resumed after hold',
};

const STATUS_STYLE: Record<TicketStatus, { bg: string; text: string; icon: typeof Clock }> = {
  todo: { bg: 'bg-accent-amber/10', text: 'text-accent-amber', icon: Clock },
  in_progress: { bg: 'bg-accent-blue/10', text: 'text-accent-blue', icon: Loader2 },
  needs_approval: { bg: 'bg-accent-orange/10', text: 'text-accent-orange', icon: ShieldAlert },
  on_hold: { bg: 'bg-accent-orange/10', text: 'text-accent-orange', icon: Clock },
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
  onNavigateToTeam?: (teamName: string) => void;
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
      return <MessageSquare className="w-3 h-3 text-tertiary" />;
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
      return <span className="text-tertiary">Output</span>;
  }
}

export function TicketDetailModal({ ticket, project, onClose, onNavigateToTeam }: TicketDetailModalProps) {
  const style = STATUS_STYLE[safeStatus(ticket.status)];
  const StatusIcon = style.icon;
  const compat = analyzeTicketCompat(ticket);
  const isAgentActive = ticket.status === 'in_progress' || ticket.status === 'needs_approval';
  const [acting, setActing] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [showActivity, setShowActivity] = useState(true);
  const [showStateLog, setShowStateLog] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [steeringMessage, setSteeringMessage] = useState('');
  const [steeringSending, setSteeringSending] = useState(false);
  const [steeringResult, setSteeringResult] = useState<{ mode: string; error?: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const steeringInputRef = useRef<HTMLTextAreaElement>(null);

  // Edit-before-retry state
  const canRetry = ticket.status === 'error' || ticket.status === 'failed' || ticket.status === 'on_hold';
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState(ticket.subject);
  const [editInstructions, setEditInstructions] = useState(ticket.instructions);
  const [editYolo, setEditYolo] = useState(ticket.yolo ?? true);
  const [editAutoMerge, setEditAutoMerge] = useState(ticket.autoMerge ?? true);
  const [editQueued, setEditQueued] = useState(ticket.queued ?? false);
  const [editUseRalph, setEditUseRalph] = useState(ticket.useRalph ?? false);
  const [editUseTeam, setEditUseTeam] = useState(ticket.useTeam ?? false);
  const [editPlanOnly, setEditPlanOnly] = useState(ticket.planOnly ?? false);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  function enterEditMode() {
    setEditSubject(ticket.subject);
    setEditInstructions(ticket.instructions);
    setEditYolo(ticket.yolo ?? true);
    setEditAutoMerge(ticket.autoMerge ?? true);
    setEditQueued(ticket.queued ?? false);
    setEditUseRalph(ticket.useRalph ?? false);
    setEditUseTeam(ticket.useTeam ?? false);
    setEditPlanOnly(ticket.planOnly ?? false);
    setEditing(true);
  }

  async function handleRetryWithEdits() {
    setActing(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: editSubject.trim(),
          instructions: editInstructions.trim(),
          yolo: editYolo,
          autoMerge: editAutoMerge,
          queued: editQueued,
          useRalph: editUseRalph,
          useTeam: editUseTeam,
          planOnly: editPlanOnly,
        }),
      });
      if (!res.ok) console.warn(`[retry] ${res.status} ${res.statusText}`);
      setEditing(false);
    } finally {
      setActing(false);
    }
  }

  async function handleRetry() {
    setActing(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/retry`, { method: 'POST' });
      if (!res.ok) console.warn(`[retry] ${res.status} ${res.statusText}`);
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
      const res = await fetch(`/api/tickets/${ticket.id}/refresh-status`, { method: 'POST' });
      if (!res.ok) console.warn(`[refresh-status] ${res.status} ${res.statusText}`);
    } finally {
      setActing(false);
    }
  }

  async function handleAbort() {
    setActing(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/abort`, { method: 'POST' });
      if (!res.ok) console.warn(`[abort] ${res.status} ${res.statusText}`);
    } finally {
      setActing(false);
    }
  }

  async function handleMarkDone() {
    setActing(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
      if (!res.ok) console.warn(`[mark-done] ${res.status} ${res.statusText}`);
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

  async function handleSendSteering() {
    const text = steeringMessage.trim();
    if (!text || steeringSending) return;
    setSteeringSending(true);
    setSteeringResult(null);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (res.ok) {
        setSteeringMessage('');
        setSteeringResult({ mode: data.mode });
        setTimeout(() => setSteeringResult(null), 3000);
      } else {
        setSteeringResult({ mode: 'error', error: data.error || 'Failed to send' });
      }
    } catch {
      setSteeringResult({ mode: 'error', error: 'Network error' });
    } finally {
      setSteeringSending(false);
    }
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
              <button
                onClick={() => {
                  navigator.clipboard.writeText(ticket.id);
                  setCopiedId(true);
                  setTimeout(() => setCopiedId(false), 1500);
                }}
                title={`Copy full ID: ${ticket.id}`}
                className="flex items-center gap-1 text-xs text-muted hover:text-secondary transition-colors cursor-pointer"
              >
                <Hash className="w-3 h-3" />
                {ticket.id.slice(0, 8)}
                {copiedId ? <Check className="w-3 h-3 text-accent-green" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
              </button>
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
              {ticket.useTeam && (
                <button
                  onClick={() => {
                    if (ticket.teamName && onNavigateToTeam) {
                      onClose();
                      onNavigateToTeam(ticket.teamName);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue ${ticket.teamName && onNavigateToTeam ? 'hover:bg-accent-blue/20 cursor-pointer' : 'cursor-default'}`}
                  title={ticket.teamName ? `Go to team "${ticket.teamName}" dashboard` : 'Team mode'}
                  aria-label={ticket.teamName ? `Navigate to team ${ticket.teamName}` : 'Team mode'}
                >
                  <Users className="w-3 h-3" />
                  {ticket.teamName || 'Team'}
                </button>
              )}
            </div>
            <h2 className="text-lg font-bold text-primary">{ticket.subject}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-700 text-tertiary hover:text-secondary transition-colors shrink-0" title="Close modal" aria-label="Close modal">
            <X className="w-5 h-5" aria-hidden="true" />
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
                <p className="text-xs text-tertiary truncate">{ticket.prUrl}</p>
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
                <p className="text-xs text-tertiary">
                  This PR has conflicts with the base branch that must be resolved before merging.
                  {ticket.conflictDetectedAt && (
                    <> Detected {formatTimestamp(ticket.conflictDetectedAt)}.</>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Needs approval / has question banner */}
          {ticket.status === 'needs_approval' && (
            ticket.needsInput ? (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-accent-amber/5 border border-accent-amber/30">
                <HelpCircle className="w-5 h-5 text-accent-amber animate-pulse shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-accent-amber">
                    Agent has a question
                  </p>
                  <p className="text-xs text-tertiary">
                    The agent is waiting for your input in the terminal. It may need clarification or a decision before it can continue.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-accent-orange/5 border border-accent-orange/20">
                <ShieldAlert className="w-5 h-5 text-accent-orange animate-pulse shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-accent-orange">
                    Waiting for tool approval
                  </p>
                  <p className="text-xs text-tertiary">
                    This agent is not running in YOLO mode and needs you to approve a tool call in the terminal.
                  </p>
                </div>
              </div>
            )
          )}

          {/* On hold banner — usage limit */}
          {ticket.status === 'on_hold' && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-accent-orange/5 border border-accent-orange/20">
              <Clock className="w-5 h-5 text-accent-orange animate-pulse shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-accent-orange">
                  On Hold — Usage Limit Reached
                </p>
                <p className="text-xs text-tertiary">
                  {ticket.holdUntil
                    ? `Will automatically resume at ${new Date(ticket.holdUntil).toLocaleTimeString()}.`
                    : 'Waiting for usage limit to reset.'}
                </p>
              </div>
            </div>
          )}

          {/* Review verdict banner */}
          {ticket.auditVerdict && (() => {
            const MAX_AUTO_ITERATIONS = 5;
            const canAutoFix = !!ticket.agentSessionId && (ticket.automationIteration || 0) < MAX_AUTO_ITERATIONS;
            const isRequestChanges = ticket.auditVerdict === 'request_changes';
            const autoFixing = isRequestChanges && canAutoFix;

            // Auto-fixing banner (blue) replaces orange when system will handle it
            if (autoFixing) {
              return (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-accent-blue/5 border border-accent-blue/20">
                  <Loader2 className="w-5 h-5 text-accent-blue animate-spin shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-accent-blue">
                      Agent Addressing Feedback ({(ticket.automationIteration || 0)}/{MAX_AUTO_ITERATIONS})
                    </p>
                    {ticket.auditResult && (
                      <p className="text-xs text-tertiary mt-0.5">
                        {ticket.auditResult}
                      </p>
                    )}
                    <p className="text-[11px] text-muted mt-1">
                      The agent will resume and address the review feedback automatically.
                    </p>
                  </div>
                </div>
              );
            }

            return (
              <div className={`flex items-center gap-3 px-4 py-3 rounded-lg ${
                ticket.auditVerdict === 'approve'
                  ? 'bg-accent-green/5 border border-accent-green/20'
                  : isRequestChanges
                    ? 'bg-accent-orange/5 border border-accent-orange/20'
                    : 'bg-accent-cyan/5 border border-accent-cyan/20'
              }`}>
                <ClipboardCheck className={`w-5 h-5 shrink-0 ${
                  ticket.auditVerdict === 'approve'
                    ? 'text-accent-green'
                    : isRequestChanges
                      ? 'text-accent-orange'
                      : 'text-accent-cyan'
                }`} />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${
                    ticket.auditVerdict === 'approve'
                      ? 'text-accent-green'
                      : isRequestChanges
                        ? 'text-accent-orange'
                        : 'text-accent-cyan'
                  }`}>
                    {ticket.auditVerdict === 'approve' && 'Review: Approved'}
                    {isRequestChanges && 'Review: Changes Requested'}
                    {ticket.auditVerdict === 'comment' && 'Review: Comments'}
                  </p>
                  {ticket.auditResult && (
                    <p className="text-xs text-tertiary mt-0.5">
                      {ticket.auditResult}
                    </p>
                  )}
                  {isRequestChanges && (
                    <p className="text-[11px] text-muted mt-1">
                      {!ticket.agentSessionId
                        ? 'No agent session to resume — manual review needed.'
                        : `Auto-fix budget exhausted (${ticket.automationIteration || 0}/${MAX_AUTO_ITERATIONS} iterations) — manual review needed.`}
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Review in progress */}
          {ticket.auditStatus === 'running' && !ticket.auditVerdict && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-accent-purple/5 border border-accent-purple/20">
              <Loader2 className="w-5 h-5 text-accent-purple animate-spin shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-accent-purple">
                  Review in Progress
                </p>
                <p className="text-xs text-tertiary">
                  The pull request is being reviewed.
                </p>
              </div>
            </div>
          )}

          {/* Project info */}
          {project && (
            <div className="flex items-start gap-3">
              <FolderOpen className="w-4 h-4 text-muted mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted mb-1">Project</p>
                <p className="text-sm text-secondary">{project.name}</p>
                <p className="text-xs text-tertiary font-mono">{project.repoPath}</p>
              </div>
            </div>
          )}

          {/* Branch */}
          {ticket.branchName && (
            <div className="flex items-start gap-3">
              <GitBranch className="w-4 h-4 text-accent-purple mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted mb-1">Branch</p>
                <code className="text-sm text-accent-purple bg-accent-purple/10 px-2 py-0.5 rounded">
                  {shortenUuids(ticket.branchName)}
                </code>
              </div>
            </div>
          )}

          {/* Error */}
          {ticket.error && (
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-accent-red mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted mb-1">Error</p>
                <pre className="text-sm text-accent-red whitespace-pre-wrap font-mono bg-accent-red/5 rounded-lg p-3 border border-accent-red/20">
                  {ticket.error}
                </pre>
              </div>
            </div>
          )}

          {/* Instructions (read-only) / Edit form */}
          {editing ? (
            <div className="space-y-4 bg-surface-900/50 rounded-lg p-4 border border-accent-amber/20">
              <div className="flex items-center gap-2 mb-1">
                <Pencil className="w-4 h-4 text-accent-amber" />
                <p className="text-xs font-medium text-accent-amber">Edit before retry</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-tertiary mb-1.5">Title</label>
                <input
                  type="text"
                  value={editSubject}
                  onChange={e => setEditSubject(e.target.value)}
                  className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-accent-blue transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-tertiary mb-1.5">Instructions</label>
                <textarea
                  value={editInstructions}
                  onChange={e => setEditInstructions(e.target.value)}
                  onPaste={e => {
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (const item of Array.from(items)) {
                      if (item.type.startsWith('image/')) {
                        const file = item.getAsFile();
                        if (file) uploadImageFiles([file]);
                      }
                    }
                  }}
                  rows={6}
                  className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-accent-blue transition-colors font-mono leading-relaxed resize-y"
                />
                <p className="text-[10px] text-muted mt-1">
                  Paste screenshots (Cmd+V) or use the image controls below.
                </p>
              </div>

              {/* Options grid */}
              <div>
                <label className="block text-xs font-medium text-tertiary mb-1.5">Options</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditYolo(!editYolo)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                      editYolo
                        ? 'bg-accent-amber/10 border-accent-amber/30'
                        : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                    }`}
                    title="Skip all permission prompts"
                  >
                    <Zap className={`w-4 h-4 shrink-0 ${editYolo ? 'fill-accent-amber text-accent-amber' : 'text-muted'}`} />
                    <span className={`text-xs font-medium ${editYolo ? 'text-accent-amber' : 'text-secondary'}`}>YOLO</span>
                    <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                      editYolo ? 'bg-accent-amber justify-end' : 'bg-surface-600 justify-start'
                    }`}>
                      <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { if (!editPlanOnly) setEditAutoMerge(!editAutoMerge); }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                      editPlanOnly
                        ? 'opacity-40 cursor-not-allowed bg-surface-900 border-surface-600'
                        : editAutoMerge
                          ? 'bg-accent-purple/10 border-accent-purple/30'
                          : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                    }`}
                    title={editPlanOnly ? 'Disabled — plan-only produces a report, not mergeable code.' : 'Automatically merge PR when approved'}
                  >
                    <GitMerge className={`w-4 h-4 shrink-0 ${editPlanOnly ? 'text-faint' : editAutoMerge ? 'text-accent-purple' : 'text-muted'}`} />
                    <span className={`text-xs font-medium ${editPlanOnly ? 'text-faint' : editAutoMerge ? 'text-accent-purple' : 'text-secondary'}`}>Auto-Merge</span>
                    <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                      editPlanOnly ? 'bg-surface-700 justify-start' : editAutoMerge ? 'bg-accent-purple justify-end' : 'bg-surface-600 justify-start'
                    }`}>
                      <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditQueued(!editQueued)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                      editQueued
                        ? 'bg-accent-cyan/10 border-accent-cyan/30'
                        : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                    }`}
                    title="Don't start until all other non-queued tickets finish"
                  >
                    <Clock className={`w-4 h-4 shrink-0 ${editQueued ? 'text-accent-cyan' : 'text-muted'}`} />
                    <span className={`text-xs font-medium ${editQueued ? 'text-accent-cyan' : 'text-secondary'}`}>Queue</span>
                    <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                      editQueued ? 'bg-accent-cyan justify-end' : 'bg-surface-600 justify-start'
                    }`}>
                      <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { if (!editPlanOnly) setEditUseRalph(!editUseRalph); }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                      editPlanOnly
                        ? 'opacity-40 cursor-not-allowed bg-surface-900 border-surface-600'
                        : editUseRalph
                          ? 'bg-accent-green/10 border-accent-green/30'
                          : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                    }`}
                    title={editPlanOnly ? "Disabled — plan-only doesn't need iterative refinement." : 'Iterative self-improving loop'}
                  >
                    <RefreshCw className={`w-4 h-4 shrink-0 ${editPlanOnly ? 'text-faint' : editUseRalph ? 'text-accent-green' : 'text-muted'}`} />
                    <span className={`text-xs font-medium ${editPlanOnly ? 'text-faint' : editUseRalph ? 'text-accent-green' : 'text-secondary'}`}>Ralph Loop</span>
                    <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                      editPlanOnly ? 'bg-surface-700 justify-start' : editUseRalph ? 'bg-accent-green justify-end' : 'bg-surface-600 justify-start'
                    }`}>
                      <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { if (!editPlanOnly) setEditUseTeam(!editUseTeam); }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                      editPlanOnly
                        ? 'opacity-40 cursor-not-allowed bg-surface-900 border-surface-600'
                        : editUseTeam
                          ? 'bg-accent-blue/10 border-accent-blue/30'
                          : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                    }`}
                    title={editPlanOnly ? "Disabled — plan-only doesn't benefit from team mode." : 'Agent spawns sub-agents'}
                  >
                    <Users className={`w-4 h-4 shrink-0 ${editPlanOnly ? 'text-faint' : editUseTeam ? 'text-accent-blue' : 'text-muted'}`} />
                    <span className={`text-xs font-medium ${editPlanOnly ? 'text-faint' : editUseTeam ? 'text-accent-blue' : 'text-secondary'}`}>Team</span>
                    <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                      editPlanOnly ? 'bg-surface-700 justify-start' : editUseTeam ? 'bg-accent-blue justify-end' : 'bg-surface-600 justify-start'
                    }`}>
                      <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const next = !editPlanOnly;
                      setEditPlanOnly(next);
                      if (next) {
                        setEditAutoMerge(false);
                        setEditUseTeam(false);
                        setEditUseRalph(false);
                      }
                    }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                      editPlanOnly
                        ? 'bg-accent-cyan/10 border-accent-cyan/30'
                        : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                    }`}
                    title="Investigation only — agent produces a plan instead of code changes"
                  >
                    <FileSearch className={`w-4 h-4 shrink-0 ${editPlanOnly ? 'text-accent-cyan' : 'text-muted'}`} />
                    <span className={`text-xs font-medium ${editPlanOnly ? 'text-accent-cyan' : 'text-secondary'}`}>Plan Only</span>
                    <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                      editPlanOnly ? 'bg-accent-cyan justify-end' : 'bg-surface-600 justify-start'
                    }`}>
                      <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                    </div>
                  </button>
                </div>
              </div>
            </div>
          ) : ticket.instructions ? (
            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-muted mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted mb-2">Instructions</p>
                <pre className="text-sm text-secondary whitespace-pre-wrap font-mono bg-surface-900 rounded-lg p-4 border border-surface-700 leading-relaxed overflow-x-auto">
                  {ticket.instructions}
                </pre>
              </div>
            </div>
          ) : null}

          {/* Attached images */}
          {(ticket.images?.length || ticket.status === 'todo' || editing) ? (
            <div className="flex items-start gap-3">
              <Images className="w-4 h-4 text-muted mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs text-muted">
                    Images {ticket.images?.length ? `(${ticket.images.length})` : ''}
                  </p>
                  {(ticket.status === 'todo' || editing) && (
                    <>
                      <button
                        onClick={() => (editing ? editFileInputRef : imageInputRef).current?.click()}
                        className="text-[10px] text-accent-blue hover:text-accent-blue/80 transition-colors flex items-center gap-1"
                        title="Add images to this ticket"
                        aria-label="Add images"
                      >
                        <ImagePlus className="w-3 h-3" aria-hidden="true" />
                        Add
                      </button>
                      <input
                        ref={editing ? editFileInputRef : imageInputRef}
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
                          title={`View ${img.originalName} in full size`}
                          aria-label={`View ${img.originalName} in full size`}
                        >
                          <img
                            src={`/api/ticket-images/${img.filename}`}
                            alt={`Screenshot: ${img.originalName}`}
                            className="w-24 h-24 object-cover rounded-lg border border-surface-600 hover:border-accent-blue/50 transition-colors cursor-pointer"
                          />
                        </button>
                        {(ticket.status === 'todo' || editing) && (
                          <button
                            onClick={() => handleDeleteImage(img.filename)}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-accent-red text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            title={`Remove ${img.originalName}`}
                            aria-label={`Remove ${img.originalName}`}
                          >
                            <X className="w-3 h-3" aria-hidden="true" />
                          </button>
                        )}
                        <p className="text-[9px] text-muted truncate w-24 mt-0.5">{img.originalName}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-faint italic">No images attached</p>
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
                alt="Full size screenshot preview"
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
                    className="text-xs text-tertiary whitespace-pre-wrap font-mono bg-accent-purple/5 rounded-lg p-3 border border-accent-purple/20 max-h-48 overflow-y-auto"
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
              <Activity className="w-4 h-4 text-muted mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => setShowActivity(!showActivity)}
                  className="flex items-center gap-1.5 mb-2 text-xs text-muted hover:text-secondary transition-colors"
                >
                  {showActivity
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronRight className="w-3 h-3" />
                  }
                  Agent Activity
                  {ticket.agentActivity?.length ? (
                    <span className="text-[10px] text-faint">
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
                      <p className="text-xs text-faint italic px-1">Waiting for activity...</p>
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
                            <p className="text-[11px] text-muted font-mono truncate leading-tight">
                              {entry.content}
                            </p>
                          </div>
                          <span className="text-[9px] text-faint shrink-0 mt-0.5">
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
              <Hash className="w-4 h-4 text-muted mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs text-muted">Agent Output</p>
                  {isAgentActive && (
                    <span className="flex items-center gap-1 text-[10px] text-accent-blue">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
                      live
                    </span>
                  )}
                </div>
                <pre
                  className="text-xs text-tertiary whitespace-pre-wrap font-mono bg-surface-900 rounded-lg p-3 border border-surface-700 max-h-64 overflow-y-auto"
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

          {/* Steering input — send messages to running or resumable agents */}
          {(isAgentActive || ticket.agentSessionId) && (
            <div className="flex items-start gap-3">
              <Send className="w-4 h-4 text-accent-blue mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs text-muted">
                    {isAgentActive ? 'Steer Agent' : 'Resume & Message'}
                  </p>
                  {isAgentActive && (
                    <span className="flex items-center gap-1 text-[10px] text-accent-blue">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
                      live
                    </span>
                  )}
                  {!isAgentActive && ticket.agentSessionId && (
                    <span className="text-[10px] text-accent-amber">
                      will resume session
                    </span>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    ref={steeringInputRef}
                    value={steeringMessage}
                    onChange={e => setSteeringMessage(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSendSteering();
                      }
                    }}
                    placeholder={isAgentActive
                      ? 'Send a follow-up message to the running agent...'
                      : 'Send a message to resume the agent session...'
                    }
                    rows={2}
                    className="flex-1 bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-xs text-primary placeholder-muted focus:outline-none focus:border-accent-blue transition-colors resize-none"
                    disabled={steeringSending}
                  />
                  <button
                    onClick={handleSendSteering}
                    disabled={!steeringMessage.trim() || steeringSending}
                    className="p-2 rounded-lg bg-accent-blue text-white hover:bg-accent-blue/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    title={isAgentActive ? 'Send to running agent (Enter)' : 'Resume session with this message (Enter)'}
                    aria-label="Send steering message"
                  >
                    {steeringSending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <CornerDownLeft className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
                {steeringResult && (
                  <p className={`text-[10px] mt-1 ${
                    steeringResult.mode === 'error' ? 'text-accent-red' :
                    steeringResult.mode === 'resume' ? 'text-accent-amber' :
                    'text-accent-green'
                  }`}>
                    {steeringResult.mode === 'error' && steeringResult.error}
                    {steeringResult.mode === 'stdin' && 'Message sent to agent'}
                    {steeringResult.mode === 'resume' && 'Agent session resuming with your message...'}
                  </p>
                )}
                <p className="text-[9px] text-faint mt-1">
                  {isAgentActive
                    ? 'Pipes directly to the agent\'s stdin. Use to answer questions or redirect the agent.'
                    : 'Resumes the previous Claude session with your message as the prompt.'
                  }
                </p>
              </div>
            </div>
          )}

          {/* Effort metrics — compact inline bar */}
          {ticket.effort && ticket.effort.turns > 0 && (
            <div className="flex items-center gap-3 text-xs bg-surface-900/60 rounded-lg px-3 py-2 border border-surface-700">
              <Gauge className="w-3.5 h-3.5 text-muted shrink-0" />
              <div className="flex items-center gap-3 flex-wrap font-mono text-tertiary">
                <span><span className="text-muted">turns</span> {ticket.effort.turns}</span>
                <span><span className="text-muted">tools</span> {ticket.effort.toolCalls}</span>
                {ticket.effort.durationMs != null && (
                  <span><span className="text-muted">time</span> {formatDuration(ticket.effort.durationMs)}</span>
                )}
                {(ticket.effort.inputTokens != null || ticket.effort.outputTokens != null) && (
                  <span>
                    <span className="text-muted">tokens</span>{' '}
                    {ticket.effort.inputTokens != null ? formatTokenCount(ticket.effort.inputTokens) : '?'}
                    <span className="text-faint">/</span>
                    {ticket.effort.outputTokens != null ? formatTokenCount(ticket.effort.outputTokens) : '?'}
                  </span>
                )}
                {ticket.effort.costUsd != null && (
                  <span className="text-accent-amber">${ticket.effort.costUsd.toFixed(2)}</span>
                )}
              </div>
            </div>
          )}

          {/* State history timeline */}
          {ticket.stateLog && ticket.stateLog.length > 0 && (
            <div className="flex items-start gap-3">
              <History className="w-4 h-4 text-muted mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => setShowStateLog(!showStateLog)}
                  className="flex items-center gap-1.5 mb-2 text-xs text-muted hover:text-secondary transition-colors"
                >
                  {showStateLog
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronRight className="w-3 h-3" />
                  }
                  State History
                  <span className="text-[10px] text-faint">
                    ({ticket.stateLog.length} transitions)
                  </span>
                </button>
                {showStateLog && (
                  <div className="space-y-0 bg-surface-900 rounded-lg p-2 border border-surface-700">
                    {ticket.stateLog.map((entry, idx) => {
                      const entryStyle = STATUS_STYLE[safeStatus(entry.status)];
                      const EntryIcon = entryStyle.icon;
                      const prevEntry = idx > 0 ? ticket.stateLog![idx - 1] : null;
                      const elapsed = prevEntry ? entry.timestamp - prevEntry.timestamp : null;
                      return (
                        <div key={idx} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-surface-800">
                          <div className="flex flex-col items-center shrink-0">
                            <EntryIcon className={`w-3 h-3 ${entryStyle.text}`} />
                            {idx < ticket.stateLog!.length - 1 && (
                              <div className="w-px h-3 bg-surface-600 mt-0.5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 flex items-center gap-2">
                            <span className={`text-[11px] font-medium ${entryStyle.text}`}>
                              {TICKET_STATUS_LABELS[entry.status]}
                            </span>
                            {entry.reason && (
                              <span className="text-[10px] text-faint">
                                {STATE_REASON_LABELS[entry.reason] || entry.reason}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {elapsed != null && elapsed > 0 && (
                              <span className="text-[9px] text-faint font-mono">
                                +{formatDuration(elapsed)}
                              </span>
                            )}
                            <span className="text-[9px] text-faint">
                              {new Date(entry.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Legacy ticket info */}
          {!compat.isFullyModern && (
            <div className="flex items-start gap-3 text-xs">
              <Archive className="w-4 h-4 text-faint mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-muted mb-1">
                  Generation {compat.generation} ticket
                </p>
                <div className="text-faint space-y-0.5">
                  {compat.missingFeatures.includes('stateLog') && (
                    <p>No state history — created before status tracking was added.</p>
                  )}
                  {compat.missingFeatures.includes('effort') && (
                    <p>No effort metrics — completed before agent metrics were added.</p>
                  )}
                  {compat.missingFeatures.includes('uuidId') && (
                    <p>Uses legacy numeric ID format.</p>
                  )}
                  {compat.hasUnknownStatus && (
                    <p className="text-accent-amber">
                      Unknown status value "{ticket.status}" — displaying as Error.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="flex gap-6 text-xs text-muted pt-2 border-t border-surface-700">
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
                title="Stop the agent and cancel this ticket"
                aria-label="Abort ticket"
              >
                <StopCircle className="w-4 h-4" aria-hidden="true" />
                Abort
              </button>
            )}
            {canRetry && !editing && (
              <>
                <button
                  onClick={enterEditMode}
                  disabled={acting}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent-amber/10 text-accent-amber rounded-lg hover:bg-accent-amber/20 disabled:opacity-50 transition-colors"
                  title="Edit ticket fields before retrying"
                  aria-label="Edit and retry ticket"
                >
                  <Pencil className="w-4 h-4" aria-hidden="true" />
                  Edit & Retry
                </button>
                <button
                  onClick={handleRetry}
                  disabled={acting}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-accent-amber hover:bg-accent-amber/10 rounded-lg disabled:opacity-50 transition-colors"
                  title="Retry this ticket immediately without changes"
                  aria-label="Retry ticket"
                >
                  <RotateCcw className="w-4 h-4" aria-hidden="true" />
                  Retry
                </button>
              </>
            )}
            {editing && (
              <>
                <button
                  onClick={handleRetryWithEdits}
                  disabled={acting || !editSubject.trim() || !editInstructions.trim()}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent-amber text-black rounded-lg hover:bg-accent-amber/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Save changes and retry"
                  aria-label="Confirm retry with edits"
                >
                  <RotateCcw className={`w-4 h-4 ${acting ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {acting ? 'Retrying...' : 'Confirm Retry'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  disabled={acting}
                  className="px-4 py-2 text-sm text-tertiary hover:text-secondary transition-colors"
                >
                  Cancel
                </button>
              </>
            )}
            {ticket.status === 'in_review' && ticket.prUrl && (
              <button
                onClick={handleRefreshStatus}
                disabled={acting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent-cyan/10 text-accent-cyan rounded-lg hover:bg-accent-cyan/20 disabled:opacity-50 transition-colors"
                title="Check if PR has been merged or closed"
                aria-label="Refresh PR status"
              >
                <RefreshCw className={`w-4 h-4 ${acting ? 'animate-spin' : ''}`} aria-hidden="true" />
                Refresh Status
              </button>
            )}
            {(ticket.status === 'failed' || ticket.status === 'in_review') && (
              <button
                onClick={handleMarkDone}
                disabled={acting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent-green/10 text-accent-green rounded-lg hover:bg-accent-green/20 disabled:opacity-50 transition-colors"
                title="Manually mark this ticket as done"
                aria-label="Mark ticket as done"
              >
                <CheckCircle className="w-4 h-4" aria-hidden="true" />
                Mark Done
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={acting}
              className="flex items-center gap-2 px-4 py-2 text-sm text-tertiary hover:text-accent-red hover:bg-accent-red/10 rounded-lg disabled:opacity-50 transition-colors ml-auto"
              title="Permanently delete this ticket"
              aria-label="Delete ticket"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
