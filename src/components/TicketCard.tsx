import { ExternalLink, AlertCircle, Loader2, GitPullRequest, Zap, GitMerge, Clock, Brain, Terminal, Info } from 'lucide-react';
import type { Ticket, TicketStatus, TicketEffort } from '../types';
import { formatDuration, formatTokenCount } from '../types';

const BORDER_COLORS: Record<TicketStatus, string> = {
  todo: 'border-l-accent-amber',
  in_progress: 'border-l-accent-blue',
  in_review: 'border-l-accent-cyan',
  done: 'border-l-accent-green',
  merged: 'border-l-accent-purple',
  failed: 'border-l-accent-red',
  error: 'border-l-accent-red',
};

function EffortBadge({ effort }: { effort: TicketEffort }) {
  return (
    <span className="relative group/effort shrink-0" onClick={e => e.stopPropagation()}>
      <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-surface-600/50 px-1.5 py-0.5 rounded cursor-help">
        <Info className="w-3 h-3" />
        {effort.turns}t
      </span>
      <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover/effort:block">
        <div className="bg-surface-900 border border-surface-600 rounded-lg p-2.5 shadow-xl text-[11px] text-slate-300 whitespace-nowrap space-y-1 min-w-[160px]">
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide mb-1.5">Agent Effort</p>
          <p className="flex justify-between gap-4">
            <span className="text-slate-500">API turns</span>
            <span className="font-mono">{effort.turns}</span>
          </p>
          <p className="flex justify-between gap-4">
            <span className="text-slate-500">Tool calls</span>
            <span className="font-mono">{effort.toolCalls}</span>
          </p>
          {effort.durationMs != null && (
            <p className="flex justify-between gap-4">
              <span className="text-slate-500">Duration</span>
              <span className="font-mono">{formatDuration(effort.durationMs)}</span>
            </p>
          )}
          {effort.inputTokens != null && (
            <p className="flex justify-between gap-4">
              <span className="text-slate-500">Input tokens</span>
              <span className="font-mono">{formatTokenCount(effort.inputTokens)}</span>
            </p>
          )}
          {effort.outputTokens != null && (
            <p className="flex justify-between gap-4">
              <span className="text-slate-500">Output tokens</span>
              <span className="font-mono">{formatTokenCount(effort.outputTokens)}</span>
            </p>
          )}
          {effort.costUsd != null && (
            <p className="flex justify-between gap-4">
              <span className="text-slate-500">Cost</span>
              <span className="font-mono text-accent-amber">${effort.costUsd.toFixed(4)}</span>
            </p>
          )}
        </div>
      </div>
    </span>
  );
}

interface TicketCardProps {
  ticket: Ticket;
  onClick?: (ticket: Ticket) => void;
}

export function TicketCard({ ticket, onClick }: TicketCardProps) {
  const borderColor = BORDER_COLORS[ticket.status];

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
        {ticket.effort && ticket.effort.turns > 0 && (
          <EffortBadge effort={ticket.effort} />
        )}
      </div>

      {ticket.instructions && (
        <p className="text-xs text-slate-400 mt-1 line-clamp-2">
          {ticket.instructions}
        </p>
      )}

      {/* In progress — live activity + output */}
      {ticket.status === 'in_progress' && (
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
