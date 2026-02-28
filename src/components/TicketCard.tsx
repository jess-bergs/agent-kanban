import { ExternalLink, AlertCircle, Loader2, GitPullRequest, Zap, GitMerge } from 'lucide-react';
import type { Ticket, TicketStatus } from '../types';

const BORDER_COLORS: Record<TicketStatus, string> = {
  todo: 'border-l-accent-amber',
  in_progress: 'border-l-accent-blue',
  done: 'border-l-accent-green',
  merged: 'border-l-accent-purple',
  failed: 'border-l-accent-red',
  error: 'border-l-accent-red',
};

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
      </div>

      {ticket.instructions && (
        <p className="text-xs text-slate-400 mt-1 line-clamp-2">
          {ticket.instructions}
        </p>
      )}

      {/* In progress — live output */}
      {ticket.status === 'in_progress' && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 text-accent-blue animate-spin" />
            <span className="text-xs text-accent-blue italic">Agent working...</span>
          </div>
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
