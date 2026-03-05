import {
  Package,
  GitBranch,
  Ticket,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FolderOpen,
  ExternalLink,
} from 'lucide-react';
import type { Project, Ticket as TicketType } from '../types';
import { TICKET_STATUS_LABELS, TICKET_STATUS_COLORS } from '../types';

interface ProductViewProps {
  projects: Project[];
  tickets: TicketType[];
  onSelectProject: (id: string) => void;
}

interface StatusCount {
  status: string;
  label: string;
  count: number;
  color: string;
}

function getTicketStatusCounts(tickets: TicketType[]): StatusCount[] {
  const counts = new Map<string, number>();
  for (const t of tickets) {
    counts.set(t.status, (counts.get(t.status) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([status, count]) => ({
      status,
      label: TICKET_STATUS_LABELS[status as keyof typeof TICKET_STATUS_LABELS] || status,
      count,
      color: TICKET_STATUS_COLORS[status as keyof typeof TICKET_STATUS_COLORS] || 'gray',
    }))
    .sort((a, b) => b.count - a.count);
}

const COLOR_CLASSES: Record<string, string> = {
  amber: 'text-accent-amber bg-accent-amber/10',
  blue: 'text-accent-blue bg-accent-blue/10',
  green: 'text-accent-green bg-accent-green/10',
  red: 'text-accent-red bg-accent-red/10',
  purple: 'text-accent-purple bg-accent-purple/10',
  cyan: 'text-accent-cyan bg-accent-cyan/10',
  orange: 'text-accent-orange bg-accent-orange/10',
  gray: 'text-muted bg-surface-600',
};

export function ProductView({ projects, tickets, onSelectProject }: ProductViewProps) {
  const totalTickets = tickets.length;
  const activeTickets = tickets.filter(t => t.status === 'in_progress').length;
  const completedTickets = tickets.filter(t => t.status === 'done' || t.status === 'merged').length;
  const failedTickets = tickets.filter(t => t.status === 'failed' || t.status === 'error').length;

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold text-primary flex items-center gap-2">
            <Package className="w-5 h-5 text-accent-blue" />
            Product Overview
          </h1>
          <p className="text-sm text-muted mt-1">
            Summary of all projects and their ticket activity
          </p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
            <p className="text-xs text-muted uppercase tracking-wide">Projects</p>
            <p className="text-2xl font-bold text-primary mt-1">{projects.length}</p>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
            <p className="text-xs text-muted uppercase tracking-wide">Total Tickets</p>
            <p className="text-2xl font-bold text-primary mt-1">{totalTickets}</p>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
            <p className="text-xs text-muted uppercase tracking-wide">Active</p>
            <p className="text-2xl font-bold text-accent-blue mt-1">{activeTickets}</p>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
            <p className="text-xs text-muted uppercase tracking-wide">Completed</p>
            <p className="text-2xl font-bold text-accent-green mt-1">{completedTickets}</p>
          </div>
        </div>

        {/* Project cards */}
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FolderOpen className="w-12 h-12 text-faint mb-4" />
            <h2 className="text-base font-semibold text-secondary mb-2">No projects yet</h2>
            <p className="text-sm text-muted">
              Add a project from the Projects tab to see product details here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {projects.map(project => {
              const projectTickets = tickets.filter(t => t.projectId === project.id);
              const statusCounts = getTicketStatusCounts(projectTickets);
              const hasFailures = projectTickets.some(
                t => t.status === 'failed' || t.status === 'error',
              );

              return (
                <button
                  key={project.id}
                  onClick={() => onSelectProject(project.id)}
                  className="w-full text-left bg-surface-800 border border-surface-700 rounded-lg p-5 hover:border-accent-blue/50 transition-colors group"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-primary text-sm group-hover:text-accent-blue transition-colors">
                          {project.name}
                        </h3>
                        {hasFailures && (
                          <AlertTriangle className="w-3.5 h-3.5 text-accent-red shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                        <span className="font-mono truncate max-w-[300px]">
                          {project.repoPath}
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          <GitBranch className="w-3 h-3" />
                          {project.defaultBranch}
                        </span>
                        {project.remoteUrl && (
                          <span className="flex items-center gap-1 shrink-0">
                            <ExternalLink className="w-3 h-3" />
                            remote
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 ml-4">
                      <p className="text-xs text-muted">
                        {projectTickets.length} ticket{projectTickets.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>

                  {/* Status breakdown */}
                  {statusCounts.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {statusCounts.map(({ status, label, count, color }) => (
                        <span
                          key={status}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${COLOR_CLASSES[color] || COLOR_CLASSES.gray}`}
                        >
                          {label}: {count}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
