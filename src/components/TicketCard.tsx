import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  Clock,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Images,
  Loader2,
  Users,
  FileSearch,
  ShieldAlert,
  StopCircle,
  Terminal,
  Zap
} from 'lucide-react';
import type { Ticket, TicketStatus, TicketEffort } from '../types';
import { formatDuration, formatTokenCount } from '../types';

const BORDER_COLORS: Record<TicketStatus, string> = {
  todo: 'border-l-accent-amber',
  in_progress: 'border-l-accent-blue',
  needs_approval: 'border-l-accent-orange',
  in_review: 'border-l-accent-cyan',
  done: 'border-l-accent-green',
  merged: 'border-l-accent-purple',
  failed: 'border-l-accent-red',
  error: 'border-l-accent-red',
};

function EffortBadge({ effort }: { effort: TicketEffort }) {
  const parts: string[] = [];
  if (effort.costUsd != null) parts.push(`$${effort.costUsd.toFixed(2)}`);
  if (effort.durationMs != null) parts.push(formatDuration(effort.durationMs));
  parts.push(`${effort.turns}t/${effort.toolCalls}tc`);
  return (
    <span className="text-[10px] font-mono text-slate-500 bg-surface-600/40 px-1.5 py-0.5 rounded shrink-0">
      {parts.join(' · ')}
    </span>
  );
}

interface TicketCardProps {
  ticket: Ticket;
  onClick?: (ticket: Ticket) => void;
}

export function TicketCard({ ticket, onClick }: TicketCardProps) {
  const borderColor = BORDER_COLORS[ticket.status];
  const [aborting, setAborting] = useState(false);
  const isRunning = ticket.status === 'in_progress' || ticket.status === 'needs_approval';

  async function handleAbort(e: React.MouseEvent) {
    e.stopPropagation();
    setAborting(true);
    try {
      await fetch(`/api/tickets/${ticket.id}/abort`, { method: 'POST' });
    } finally {
      setAborting(false);
    }
  }

  return (
    <div
      onClick={() => onClick?.(ticket)}
      className={`bg-surface-700 rounded-lg p-3 border border-surface-600 border-l-2 ${borderColor} hover:border-surface-500 transition-colors cursor-pointer`}
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-slate-100 flex-1">{ticket.subject}</p>
        {ticket.queued && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-cyan bg-accent-cyan/10 px-1.5 py-0.5 rounded shrink-0">
            <Clock className="w-3 h-3" />
            QUEUED
          </span>
        )}
        {ticket.autoMerge && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-purple bg-accent-purple/10 px-1.5 py-0.5 rounded shrink-0">
            <GitMerge className="w-3 h-3" />
          </span>
        )}
        {ticket.yolo && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-amber bg-accent-amber/10 px-1.5 py-0.5 rounded shrink-0">
            <Zap className="w-3 h-3 fill-accent-amber" />
            YOLO
          </span>
        )}
        {ticket.useTeam && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-blue bg-accent-blue/10 px-1.5 py-0.5 rounded shrink-0">
            <Users className="w-3 h-3" />
            TEAM
          </span>
        )}
        {ticket.planOnly && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-cyan bg-accent-cyan/10 px-1.5 py-0.5 rounded shrink-0">
            <FileSearch className="w-3 h-3" />
            PLAN
          </span>
        )}
        {ticket.images && ticket.images.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-surface-600/40 px-1.5 py-0.5 rounded shrink-0">
            <Images className="w-3 h-3" />
            {ticket.images.length}
          </span>
        )}
        {ticket.hasConflict && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent-red bg-accent-red/10 px-1.5 py-0.5 rounded shrink-0 animate-pulse">
            <AlertTriangle className="w-3 h-3" />
            CONFLICT
          </span>
        )}
        {ticket.effort && ticket.effort.turns > 0 && (
          <EffortBadge effort={ticket.effort} />
        )}
      </div>

      {ticket.instructions && (
        <p className="text-xs text-slate-400 mt-1 line-clamp-2">
          {ticket.instructions}
        </p>
      )}

      {/* Needs approval — waiting for human in terminal */}
      {ticket.status === 'needs_approval' && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="w-3 h-3 text-accent-orange animate-pulse" />
            <span className="text-xs text-accent-orange font-medium">Waiting for approval in terminal</span>
          </div>
          {ticket.lastOutput && (
            <pre className="text-[11px] text-slate-400 font-mono bg-surface-900/60 rounded px-2 py-1.5 line-clamp-3 whitespace-pre-wrap leading-relaxed">
              {ticket.lastOutput.slice(-200)}
            </pre>
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
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                {last.type === 'tool_use' && <Terminal className="w-3 h-3 text-accent-cyan" />}
                {last.type === 'thinking' && <Brain className="w-3 h-3 text-accent-purple" />}
                <span className="truncate font-mono">
                  {last.type === 'tool_use' ? last.tool : last.type === 'thinking' ? 'Reasoning...' : last.content.slice(0, 80)}
                </span>
              </div>
            );
          })()}
          {ticket.lastOutput && (
            <pre className="text-[11px] text-slate-400 font-mono bg-surface-900/60 rounded px-2 py-1.5 line-clamp-3 whitespace-pre-wrap leading-relaxed">
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
          >
            <StopCircle className="w-3 h-3" />
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
        >
          <GitPullRequest className="w-3.5 h-3.5" />
          <span className="font-medium">
            PR #{ticket.prNumber || 'opened'}
          </span>
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}
