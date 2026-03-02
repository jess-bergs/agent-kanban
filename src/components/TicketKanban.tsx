import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChevronDown, Eye, HelpCircle, Plus, Search, X } from 'lucide-react';
import type { Ticket, TicketStatus, Project } from '../types';
import { TICKET_STATUS_LABELS } from '../types';
import { safeStatus } from '../lib/ticketCompat';
import { TicketCard } from './TicketCard';
import { TicketDetailModal } from './TicketDetailModal';
import { CreateTicketModal } from './CreateTicketModal';

const COLUMNS: TicketStatus[] = ['todo', 'in_progress', 'needs_approval', 'on_hold', 'in_review', 'done', 'failed', 'error'];
const PAGE_SIZE = 10;

const COLUMN_STYLES: Record<TicketStatus, { header: string; badge: string }> = {
  todo: {
    header: 'bg-accent-amber/10 text-accent-amber',
    badge: 'bg-accent-amber/20 text-accent-amber',
  },
  in_progress: {
    header: 'bg-accent-blue/10 text-accent-blue',
    badge: 'bg-accent-blue/20 text-accent-blue',
  },
  needs_approval: {
    header: 'bg-accent-orange/10 text-accent-orange',
    badge: 'bg-accent-orange/20 text-accent-orange',
  },
  on_hold: {
    header: 'bg-accent-orange/10 text-accent-orange',
    badge: 'bg-accent-orange/20 text-accent-orange',
  },
  in_review: {
    header: 'bg-accent-cyan/10 text-accent-cyan',
    badge: 'bg-accent-cyan/20 text-accent-cyan',
  },
  done: {
    header: 'bg-accent-green/10 text-accent-green',
    badge: 'bg-accent-green/20 text-accent-green',
  },
  merged: {
    header: 'bg-accent-purple/10 text-accent-purple',
    badge: 'bg-accent-purple/20 text-accent-purple',
  },
  failed: {
    header: 'bg-accent-red/10 text-accent-red',
    badge: 'bg-accent-red/20 text-accent-red',
  },
  error: {
    header: 'bg-accent-red/10 text-accent-red',
    badge: 'bg-accent-red/20 text-accent-red',
  },
};

interface TicketKanbanProps {
  tickets: Ticket[];
  project: Project;
  openTicketId?: string | null;
  onTicketOpened?: () => void;
}

export function TicketKanban({ tickets, project, openTicketId, onTicketOpened }: TicketKanbanProps) {
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState<Partial<Record<TicketStatus, number>>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const getVisibleCount = useCallback(
    (status: TicketStatus) => visibleCount[status] ?? PAGE_SIZE,
    [visibleCount],
  );

  const showMore = useCallback((status: TicketStatus) => {
    setVisibleCount(prev => ({
      ...prev,
      [status]: (prev[status] ?? PAGE_SIZE) + PAGE_SIZE,
    }));
  }, []);

  // Cmd+N / Ctrl+N to open the create ticket modal
  // Cmd+K / Ctrl+K to focus search
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        // Don't trigger when typing in an input or textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        // Don't trigger if another modal is already open
        if (selectedTicket || showCreate) return;
        e.preventDefault();
        setShowCreate(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [selectedTicket, showCreate]);

  // Auto-open ticket when navigated from agents view
  useEffect(() => {
    if (openTicketId) {
      const ticket = tickets.find(t => t.id === openTicketId);
      if (ticket) {
        setSelectedTicket(ticket);
        onTicketOpened?.();
      }
    }
  }, [openTicketId, tickets, onTicketOpened]);

  const filteredTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter(t =>
      t.id.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q) ||
      t.instructions.toLowerCase().includes(q)
    );
  }, [tickets, searchQuery]);

  const grouped: Record<TicketStatus, Ticket[]> = {
    todo: [],
    in_progress: [],
    needs_approval: [],
    on_hold: [],
    in_review: [],
    done: [],
    merged: [],
    failed: [],
    error: [],
  };

  for (const ticket of filteredTickets) {
    const effective = safeStatus(ticket.status);
    // Fold merged tickets into the done column
    const bucket = effective === 'merged' ? 'done' : effective;
    if (bucket in grouped) {
      grouped[bucket].push(ticket);
    }
  }

  // Sort by creation time, newest first
  for (const status of COLUMNS) {
    grouped[status].sort((a, b) => b.createdAt - a.createdAt);
  }

  // Count tickets needing manual review in the in_review column
  const needsReviewCount = grouped.in_review.filter(
    t => t.auditVerdict === 'request_changes',
  ).length;

  // Count tickets where the agent has a question in the needs_approval column
  const needsInputCount = grouped.needs_approval.filter(
    t => t.needsInput,
  ).length;

  // Hide needs_approval/on_hold/done/failed/error columns if empty
  const visibleColumns = COLUMNS.filter(
    s => !['needs_approval', 'on_hold', 'done', 'failed', 'error'].includes(s) || grouped[s].length > 0,
  );

  return (
    <>
      <div className="flex flex-col gap-4 h-full">
        {/* Search bar */}
        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search tickets by ID, title, or description... (⌘K)"
            className="w-full pl-9 pr-8 py-2 text-sm bg-surface-700 border border-surface-600 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-accent-blue/50 focus:ring-1 focus:ring-accent-blue/25"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Kanban columns */}
        <div
          className="grid gap-4 flex-1 min-h-0"
          style={{ gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(0, 1fr))` }}
        >
        {visibleColumns.map(status => {
          const style = COLUMN_STYLES[status];
          const columnTickets = grouped[status];
          const limit = getVisibleCount(status);
          const visibleTickets = columnTickets.slice(0, limit);
          const hiddenCount = columnTickets.length - visibleTickets.length;

          return (
            <div key={status} className="bg-surface-800 rounded-xl flex flex-col min-h-0">
              {/* Column header */}
              <div className={`flex items-center justify-between px-4 py-2.5 rounded-t-xl ${style.header}`}>
                <span className="text-sm font-semibold">
                  {TICKET_STATUS_LABELS[status]}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.badge}`}>
                    {columnTickets.length}
                  </span>
                  {status === 'in_review' && needsReviewCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-orange/20 text-accent-orange animate-pulse">
                      <Eye className="w-3 h-3" />
                      {needsReviewCount}
                    </span>
                  )}
                  {status === 'needs_approval' && needsInputCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-amber/20 text-accent-amber animate-pulse">
                      <HelpCircle className="w-3 h-3" />
                      {needsInputCount}
                    </span>
                  )}
                  {status === 'todo' && (
                    <button
                      onClick={() => setShowCreate(true)}
                      className="p-0.5 rounded hover:bg-white/10 transition-colors"
                      title="New ticket (⌘N)"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Ticket list */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {columnTickets.length === 0 ? (
                  <div className="text-center py-6">
                    {status === 'todo' ? (
                      <button
                        onClick={() => setShowCreate(true)}
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        + Create a ticket
                      </button>
                    ) : (
                      <p className="text-xs text-slate-500">No tickets</p>
                    )}
                  </div>
                ) : (
                  <>
                    {visibleTickets.map(ticket => (
                      <TicketCard
                        key={ticket.id}
                        ticket={ticket}
                        onClick={setSelectedTicket}
                      />
                    ))}
                    {hiddenCount > 0 && (
                      <button
                        onClick={() => showMore(status)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-surface-600/40 rounded-lg transition-colors"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                        Show more ({hiddenCount} older)
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          project={project}
          onClose={() => setSelectedTicket(null)}
        />
      )}

      {showCreate && (
        <CreateTicketModal
          project={project}
          onClose={() => setShowCreate(false)}
          onCreated={() => {}}
        />
      )}
    </>
  );
}
