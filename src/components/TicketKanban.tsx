import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Ticket, TicketStatus, Project } from '../types';
import { TICKET_STATUS_LABELS } from '../types';
import { TicketCard } from './TicketCard';
import { TicketDetailModal } from './TicketDetailModal';
import { CreateTicketModal } from './CreateTicketModal';

const COLUMNS: TicketStatus[] = ['todo', 'in_progress', 'done', 'merged', 'failed', 'error'];

const COLUMN_STYLES: Record<TicketStatus, { header: string; badge: string }> = {
  todo: {
    header: 'bg-accent-amber/10 text-accent-amber',
    badge: 'bg-accent-amber/20 text-accent-amber',
  },
  in_progress: {
    header: 'bg-accent-blue/10 text-accent-blue',
    badge: 'bg-accent-blue/20 text-accent-blue',
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
}

export function TicketKanban({ tickets, project }: TicketKanbanProps) {
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const grouped: Record<TicketStatus, Ticket[]> = {
    todo: [],
    in_progress: [],
    done: [],
    merged: [],
    failed: [],
    error: [],
  };

  for (const ticket of tickets) {
    if (ticket.status in grouped) {
      grouped[ticket.status].push(ticket);
    }
  }

  // Sort by creation time
  for (const status of COLUMNS) {
    grouped[status].sort((a, b) => a.createdAt - b.createdAt);
  }

  // Hide merged/failed/error columns if empty
  const visibleColumns = COLUMNS.filter(
    s => !['merged', 'failed', 'error'].includes(s) || grouped[s].length > 0,
  );

  return (
    <>
      <div
        className="grid gap-4 h-full"
        style={{ gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(0, 1fr))` }}
      >
        {visibleColumns.map(status => {
          const style = COLUMN_STYLES[status];
          const columnTickets = grouped[status];

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
                  {status === 'todo' && (
                    <button
                      onClick={() => setShowCreate(true)}
                      className="p-0.5 rounded hover:bg-white/10 transition-colors"
                      title="New ticket"
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
                  columnTickets.map(ticket => (
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      onClick={setSelectedTicket}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
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
