import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  CheckCircle,
  Clock,
  Eye,
  ExternalLink,
  FileSearch,
  GitMerge,
  GitPullRequest,
  HelpCircle,
  Archive,
  Images,
  Loader2,
  MessageSquare,
  PauseCircle,
  Users,
  ShieldAlert,
  StopCircle,
  Terminal,
  Zap
} from 'lucide-react';
import type { Ticket, TicketStatus, TicketEffort } from '../types';
import { formatDuration, formatTokenCount } from '../types';
import { safeStatus, safeEffort, analyzeTicketCompat } from '../lib/ticketCompat';

const BORDER_COLORS: Record<TicketStatus, string> = {
  todo: 'border-l-accent-amber',
  in_progress: 'border-l-accent-blue',
  needs_approval: 'border-l-accent-orange',
  on_hold: 'border-l-accent-orange',
  in_review: 'border-l-accent-cyan',
  done: 'border-l-accent-green',
  merged: 'border-l-accent-purple',
  failed: 'border-l-accent-red',
  error: 'border-l-accent-red',
};

function EffortBadge({ effort }: { effort: TicketEffort }) {
  const safe = safeEffort(effort);
  const parts: string[] = [];
  if (safe.costUsd != null) parts.push(`$${safe.costUsd.toFixed(2)}`);
  if (safe.durationMs != null) parts.push(formatDuration(safe.durationMs));
  parts.push(`${safe.turns}t/${safe.toolCalls}tc`);
  return (
    <span className="text-[10px] font-mono text-muted bg-surface-600/40 px-1.5 py-0.5 rounded shrink-0">
      {parts.join(' · ')}
    </span>
  );
}

interface TicketCardProps {
  ticket: Ticket;
  onClick?: (ticket: Ticket) => void;
}

export function TicketCard({ ticket, onClick }: TicketCardProps) {
  const borderColor = BORDER_COLORS[safeStatus(ticket.status)];
  const compat = analyzeTicketCompat(ticket);
  const [aborting, setAborting] = useState(false);
  const isRunning = ticket.status === 'in_progress' || ticket.status === 'needs_approval';
  const isFinished = ticket.status === 'done' || ticket.status === 'merged';
  const pulse = isFinished ? '' : 'animate-pulse';

  async function handleAbort(e: React.MouseEvent) {
    e.stopPropagation();
    setAborting(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/abort`, { method: 'POST' });
      if (!res.ok) console.warn(`[abort] ${res.status} ${res.statusText}`);
    } finally {
      setAborting(false);
    }
  }

  const MAX_AUTO_ITERATIONS = 5;
  const canAutoFix = !!ticket.agentSessionId && (ticket.automationIteration || 0) < MAX_AUTO_ITERATIONS;
  const isReviewing = ticket.status === 'in_review' && ticket.auditStatus === 'running';
  const needsReview = !isFinished && ticket.auditVerdict === 'request_changes' && !canAutoFix;
  const autoFixPending = !isFinished && ticket.auditVerdict === 'request_changes' && canAutoFix && !isReviewing;
  const hasQuestion = !!ticket.needsInput;

  return (
    <div
      onClick={() => onClick?.(ticket)}
      className={`bg-surface-700 rounded-lg p-3 border-l-2 ${borderColor} hover:border-surface-500 transition-colors cursor-pointer overflow-hidden ${
        hasQuestion
          ? 'border border-accent-amber/50 ring-1 ring-accent-amber/25'
          : needsReview
            ? 'border border-accent-orange/40 ring-1 ring-accent-orange/20'
            : 'border border-surface-600'
      }`}
    >
      <p className="text-sm font-medium text-primary truncate">{ticket.subject}</p>
      <div className="flex flex-wrap items-center gap-1 mt-1">
        {ticket.queued && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-cyan bg-accent-cyan/10 px-1.5 py-0.5 rounded" title="This ticket is queued and will start after other non-queued tickets finish">
            <Clock className="w-3 h-3" aria-hidden="true" />
            QUEUED
          </span>
        )}
        {ticket.autoMerge && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-purple bg-accent-purple/10 px-1.5 py-0.5 rounded" title="Auto-merge enabled: PR will be automatically merged when approved and checks pass">
            <GitMerge className="w-3 h-3" aria-hidden="true" />
          </span>
        )}
        {ticket.yolo && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-amber bg-accent-amber/10 px-1.5 py-0.5 rounded" title="YOLO mode: Agent runs fully autonomous without permission prompts">
            <Zap className="w-3 h-3 fill-accent-amber" aria-hidden="true" />
            YOLO
          </span>
        )}
        {ticket.useTeam && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-blue bg-accent-blue/10 px-1.5 py-0.5 rounded" title={`Team mode: Agent will spawn sub-agents${ticket.teamName ? ` in team "${ticket.teamName}"` : ''}`}>
            <Users className="w-3 h-3" aria-hidden="true" />
            {ticket.teamName || 'TEAM'}
          </span>
        )}
        {ticket.planOnly && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-cyan bg-accent-cyan/10 px-1.5 py-0.5 rounded" title="Plan only: Agent will investigate and create a plan-report.md instead of making code changes">
            <FileSearch className="w-3 h-3" aria-hidden="true" />
            PLAN
          </span>
        )}
        {ticket.images && ticket.images.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-tertiary bg-surface-600/40 px-1.5 py-0.5 rounded" title={`${ticket.images.length} image${ticket.images.length !== 1 ? 's' : ''} attached`}>
            <Images className="w-3 h-3" aria-hidden="true" />
            {ticket.images.length}
          </span>
        )}
        {ticket.needsAttention && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-red bg-accent-red/10 px-1.5 py-0.5 rounded animate-pulse" title="This ticket requires your immediate attention">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            NEEDS ATTENTION
          </span>
        )}
        {hasQuestion && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-amber bg-accent-amber/10 px-1.5 py-0.5 rounded animate-pulse" title="Agent has a question and is waiting for your response in the terminal">
            <HelpCircle className="w-3 h-3" aria-hidden="true" />
            HAS QUESTION
          </span>
        )}
        {ticket.hasConflict && (
          <span className={`flex items-center gap-1 text-[10px] font-medium text-accent-red bg-accent-red/10 px-1.5 py-0.5 rounded ${pulse}`} title="PR has merge conflicts that need to be resolved">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            CONFLICT
          </span>
        )}
        {ticket.auditVerdict === 'approve' && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-green bg-accent-green/10 px-1.5 py-0.5 rounded" title="PR has been reviewed and approved">
            <CheckCircle className="w-3 h-3" aria-hidden="true" />
            APPROVED
          </span>
        )}
        {ticket.auditVerdict === 'request_changes' && !autoFixPending && (
          <span className={`flex items-center gap-1 text-[10px] font-medium text-accent-orange bg-accent-orange/10 px-1.5 py-0.5 rounded ${pulse}`} title="Reviewer has requested changes to this PR">
            <ShieldAlert className="w-3 h-3" aria-hidden="true" />
            CHANGES
          </span>
        )}
        {autoFixPending && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-blue bg-accent-blue/10 px-1.5 py-0.5 rounded">
            <Loader2 className="w-3 h-3 animate-spin" />
            FIXING ({(ticket.automationIteration || 0)}/{MAX_AUTO_ITERATIONS})
          </span>
        )}
        {ticket.auditVerdict === 'comment' && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-cyan bg-accent-cyan/10 px-1.5 py-0.5 rounded" title="PR has been reviewed with comments">
            <MessageSquare className="w-3 h-3" aria-hidden="true" />
            REVIEWED
          </span>
        )}
        {ticket.status === 'in_review' && ticket.auditStatus === 'running' && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-purple bg-accent-purple/10 px-1.5 py-0.5 rounded" title="PR review is currently in progress">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            REVIEWING
          </span>
        )}
        {ticket.effort && ticket.effort.turns > 0 && (
          <EffortBadge effort={ticket.effort} />
        )}
        {!compat.isFullyModern && (
          <span
            className="flex items-center gap-1 text-[10px] font-medium text-faint bg-surface-600/30 px-1.5 py-0.5 rounded"
            title={`Gen ${compat.generation} ticket — missing: ${compat.missingFeatures.join(', ')}`}
          >
            <Archive className="w-3 h-3" />
            v{compat.generation}
          </span>
        )}
      </div>

      {ticket.instructions && (
        <p className="text-xs text-tertiary mt-1 line-clamp-2">
          {ticket.instructions}
        </p>
      )}

      {/* Plan summary from plan-report.md */}
      {ticket.planSummary && (
        <div className="mt-2 bg-accent-cyan/5 border border-accent-cyan/20 rounded px-2 py-1.5">
          <p className="text-[10px] font-medium text-accent-cyan mb-0.5">Plan Summary</p>
          <p className="text-xs text-secondary line-clamp-3">{ticket.planSummary}</p>
        </div>
      )}

      {/* Needs approval — waiting for human in terminal */}
      {ticket.status === 'needs_approval' && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            {hasQuestion ? (
              <>
                <HelpCircle className="w-3 h-3 text-accent-amber animate-pulse" />
                <span className="text-xs text-accent-amber font-medium">Agent has a question — respond in terminal</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3 h-3 text-accent-orange animate-pulse" />
                <span className="text-xs text-accent-orange font-medium">Waiting for approval in terminal</span>
              </>
            )}
          </div>
          {ticket.lastOutput && (
            <pre className="text-[11px] text-tertiary font-mono bg-surface-900/60 rounded px-2 py-1.5 line-clamp-3 whitespace-pre-wrap leading-relaxed">
              {ticket.lastOutput.slice(-200)}
            </pre>
          )}
        </div>
      )}

      {/* On hold — usage limit reached, waiting for reset */}
      {ticket.status === 'on_hold' && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <PauseCircle className="w-3 h-3 text-accent-orange animate-pulse" />
            <span className="text-xs text-accent-orange font-medium">Usage limit — on hold</span>
          </div>
          {ticket.holdUntil && (
            <p className="text-[11px] text-tertiary">
              Resumes {new Date(ticket.holdUntil).toLocaleTimeString()}
            </p>
          )}
          {ticket.error && (
            <p className="text-[11px] text-muted truncate">{ticket.error}</p>
          )}
        </div>
      )}

      {/* Review in progress — PR being reviewed */}
      {ticket.status === 'in_review' && ticket.auditStatus === 'running' && !ticket.auditVerdict && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 text-accent-purple animate-spin" />
            <span className="text-xs text-accent-purple italic">PR under review...</span>
          </div>
        </div>
      )}

      {/* Review verdict — auto-fixing */}
      {ticket.status === 'in_review' && autoFixPending && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 text-accent-blue animate-spin" />
            <span className="text-xs text-accent-blue font-medium">Agent addressing feedback</span>
          </div>
          {ticket.auditResult && (
            <p className="text-[11px] text-tertiary bg-accent-blue/5 border border-accent-blue/20 rounded px-2 py-1.5 line-clamp-2">
              {ticket.auditResult}
            </p>
          )}
        </div>
      )}

      {/* Review verdict — needs human review (no session to resume or budget exhausted) */}
      {ticket.status === 'in_review' && ticket.auditVerdict === 'request_changes' && !autoFixPending && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Eye className="w-3 h-3 text-accent-orange animate-pulse" />
            <span className="text-xs text-accent-orange font-medium">
              {!ticket.agentSessionId ? 'Needs your review — no agent session to resume' : `Needs your review — auto-fix budget exhausted (${ticket.automationIteration || 0}/${MAX_AUTO_ITERATIONS})`}
            </span>
          </div>
          {ticket.auditResult && (
            <p className="text-[11px] text-tertiary bg-accent-orange/5 border border-accent-orange/20 rounded px-2 py-1.5 line-clamp-2">
              {ticket.auditResult}
            </p>
          )}
        </div>
      )}

      {/* In progress — live activity + output */}
      {(ticket.status === 'in_progress') && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 text-accent-blue animate-spin" />
            <span className="text-xs text-accent-blue italic">Agent working...</span>
            {ticket.lastThinking && (
              <span className="flex items-center gap-1 text-[10px] text-accent-purple">
                <Brain className="w-3 h-3" />
                reasoning
              </span>
            )}
          </div>
          {/* Show latest activity entry if available */}
          {ticket.agentActivity && ticket.agentActivity.length > 0 && (() => {
            const last = ticket.agentActivity[ticket.agentActivity.length - 1];
            return (
              <div className="flex items-center gap-1.5 text-[10px] text-muted">
                {last.type === 'tool_use' && <Terminal className="w-3 h-3 text-accent-cyan" />}
                {last.type === 'thinking' && <Brain className="w-3 h-3 text-accent-purple" />}
                <span className="truncate font-mono">
                  {last.type === 'tool_use' ? last.tool : last.type === 'thinking' ? 'Reasoning...' : last.content.slice(0, 80)}
                </span>
              </div>
            );
          })()}
          {ticket.lastOutput && (
            <pre className="text-[11px] text-tertiary font-mono bg-surface-900/60 rounded px-2 py-1.5 line-clamp-3 whitespace-pre-wrap leading-relaxed">
              {ticket.lastOutput.slice(-200)}
            </pre>
          )}
        </div>
      )}

      {/* Abort button for running tickets */}
      {isRunning && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={handleAbort}
            disabled={aborting}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-accent-red bg-accent-red/10 rounded hover:bg-accent-red/20 disabled:opacity-50 transition-colors"
            title="Stop the agent and cancel this ticket"
            aria-label="Abort ticket"
          >
            <StopCircle className="w-3 h-3" aria-hidden="true" />
            {aborting ? 'Aborting...' : 'Abort'}
          </button>
        </div>
      )}

      {/* Error / Failed */}
      {(ticket.status === 'error' || ticket.status === 'failed') && ticket.error && (
        <div className="flex items-center gap-1.5 mt-2">
          <AlertCircle className="w-3 h-3 text-accent-red" />
          <span className="text-xs text-accent-red truncate">{ticket.error}</span>
        </div>
      )}

      {/* PR Link */}
      {ticket.prUrl && (
        <a
          href={ticket.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-1.5 mt-2 text-xs text-accent-green hover:text-accent-green/80 transition-colors"
          title={`View Pull Request #${ticket.prNumber || ''} on GitHub`}
          aria-label={`View Pull Request #${ticket.prNumber || 'opened'}`}
        >
          <GitPullRequest className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="font-medium">
            PR #{ticket.prNumber || 'opened'}
          </span>
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
