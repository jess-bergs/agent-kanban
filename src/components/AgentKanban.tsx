import { Bot, Monitor, Code2, Terminal, GitBranch, Clock, MessageSquare, Rocket, ExternalLink } from 'lucide-react';
import type { SoloAgent, Ticket } from '../types';
import { formatTimestamp, shortenUuids } from '../types';

/** Extract a human-readable name from a dispatched agent's slug or branch.
 *  Strips the `agent-ticket-{uuid}-` or `agent/ticket-{uuid}-` prefix. */
function humanName(agent: SoloAgent, ticket?: Ticket): string {
  // Best case: we have the ticket subject
  if (ticket?.subject) return ticket.subject;

  // Otherwise extract readable part from slug/branch
  const raw = agent.slug || agent.gitBranch || agent.sessionId.slice(0, 8);
  return raw
    .replace(/^agent[-/]ticket-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}-?/i, '')
    .replace(/^agent[-/]ticket-[0-9a-f]{8,}-?/i, '')
    .replace(/^-+|-+$/g, '') || raw;
}

interface AgentKanbanProps {
  agents: SoloAgent[];
  tickets: Ticket[];
  onNavigateToTicket?: (projectId: string, ticketId: string) => void;
}

function sourceLabel(source: SoloAgent['source']): { label: string; icon: typeof Bot } {
  switch (source) {
    case 'vscode': return { label: 'VS Code', icon: Code2 };
    case 'terminal': return { label: 'Terminal', icon: Terminal };
    case 'dispatched': return { label: 'Dispatched', icon: Monitor };
    default: return { label: 'Unknown', icon: Bot };
  }
}

function isDispatched(agent: SoloAgent): boolean {
  return agent.source === 'dispatched' || agent.cwd.includes('agent-kanban-worktrees');
}

function AgentCard({ agent, ticket, onNavigateToTicket }: {
  agent: SoloAgent;
  ticket?: Ticket;
  onNavigateToTicket?: (projectId: string, ticketId: string) => void;
}) {
  const isActive = agent.status === 'active';
  const dispatched = isDispatched(agent);
  const { label: srcLabel, icon: SrcIcon } = sourceLabel(dispatched ? 'dispatched' : agent.source);

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        dispatched
          ? isActive
            ? 'bg-accent-cyan/5 border-accent-cyan/50 ring-1 ring-accent-cyan/20'
            : 'bg-accent-cyan/5 border-accent-cyan/30'
          : isActive
            ? 'bg-surface-700 border-accent-green/40'
            : 'bg-surface-800 border-surface-600'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {dispatched ? (
            <Rocket className="w-3.5 h-3.5 text-accent-cyan shrink-0" />
          ) : (
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isActive
                  ? 'bg-accent-green animate-pulse'
                  : 'bg-slate-500'
              }`}
            />
          )}
          <span className="font-medium text-sm text-slate-100 truncate">
            {dispatched ? humanName(agent, ticket) : (agent.slug || agent.sessionId.slice(0, 8))}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {dispatched && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-cyan/20 text-accent-cyan">
              Kanban
            </span>
          )}
          <span
            className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              isActive
                ? 'bg-accent-green/20 text-accent-green'
                : 'bg-slate-700 text-slate-400'
            }`}
          >
            {isActive ? 'Working' : 'Idle'}
          </span>
        </div>
      </div>

      <div className="mt-2 space-y-1 text-xs text-slate-400">
        {agent.gitBranch && agent.gitBranch !== 'HEAD' && !(dispatched && ticket) && (
          <div className="flex items-center gap-1.5">
            <GitBranch className="w-3 h-3 text-accent-purple shrink-0" />
            <span className="font-mono truncate text-accent-purple">{shortenUuids(agent.gitBranch)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <SrcIcon className="w-3 h-3 shrink-0" />
          <span>{srcLabel}</span>
          {agent.model && (
            <>
              <span className="text-slate-600">·</span>
              <span className="truncate">{agent.model}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 shrink-0" />
          <span>{formatTimestamp(agent.lastActiveAt)}</span>
        </div>
      </div>

      {/* Prompt */}
      {agent.prompt && (
        <div className="mt-2 pt-2 border-t border-surface-600">
          <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">
            <MessageSquare className="w-2.5 h-2.5" />
            Prompt
          </div>
          <p className="text-xs text-slate-300 line-clamp-2">{agent.prompt}</p>
        </div>
      )}

      {/* Last output */}
      {agent.lastOutput && (
        <div className="mt-2 pt-2 border-t border-surface-600">
          <div className="text-[10px] text-slate-500 mb-1">Last output</div>
          <p className="text-[11px] text-slate-400 line-clamp-3 font-mono leading-relaxed">
            {agent.lastOutput}
          </p>
        </div>
      )}

      {/* View ticket button for dispatched agents */}
      {dispatched && ticket && onNavigateToTicket && (
        <button
          onClick={() => onNavigateToTicket(ticket.projectId, ticket.id)}
          className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 transition-colors border border-accent-cyan/30"
        >
          <ExternalLink className="w-3 h-3" />
          View Ticket #{ticket.id.slice(0, 8)}
        </button>
      )}
    </div>
  );
}

/** Match an agent to a ticket by branch name */
function findTicketForAgent(agent: SoloAgent, tickets: Ticket[]): Ticket | undefined {
  if (!agent.gitBranch) return undefined;
  return tickets.find(t => t.branchName && t.branchName === agent.gitBranch);
}

export function AgentKanban({ agents, tickets, onNavigateToTicket }: AgentKanbanProps) {
  // Group agents by project (derived from cwd)
  const byProject = new Map<string, { cwd: string; agents: SoloAgent[] }>();

  for (const agent of agents) {
    const key = agent.cwd;
    if (!byProject.has(key)) {
      byProject.set(key, { cwd: agent.cwd, agents: [] });
    }
    byProject.get(key)!.agents.push(agent);
  }

  // Sort projects: ones with active agents first, then by most recent activity
  const columns = [...byProject.values()].sort((a, b) => {
    const aActive = a.agents.some(ag => ag.status === 'active') ? 1 : 0;
    const bActive = b.agents.some(ag => ag.status === 'active') ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aMax = Math.max(...a.agents.map(ag => ag.lastActiveAt));
    const bMax = Math.max(...b.agents.map(ag => ag.lastActiveAt));
    return bMax - aMax;
  });

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <div className="text-center">
          <Bot className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No active agents detected</p>
          <p className="text-xs mt-1">Start a Claude session in any ~/development project</p>
        </div>
      </div>
    );
  }

  const activeCount = agents.filter(a => a.status === 'active').length;
  const idleCount = agents.filter(a => a.status === 'idle').length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-b border-surface-700 text-xs">
        <span className="text-slate-400">
          {agents.length} agent{agents.length !== 1 ? 's' : ''} across {columns.length} project{columns.length !== 1 ? 's' : ''}
        </span>
        {activeCount > 0 && (
          <span className="flex items-center gap-1.5 text-accent-green">
            <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
            {activeCount} working
          </span>
        )}
        {idleCount > 0 && (
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            {idleCount} idle
          </span>
        )}
      </div>

      {/* Columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex gap-4 h-full min-w-min">
          {columns.map(({ cwd, agents: projectAgents }) => {
            const projectName = cwd.split('/').pop() || cwd;
            const repoPath = cwd.split('/').slice(-2).join('/');
            const hasActive = projectAgents.some(a => a.status === 'active');
            const hasDispatched = projectAgents.some(a => isDispatched(a));

            return (
              <div
                key={cwd}
                className={`w-80 shrink-0 flex flex-col rounded-xl border ${
                  hasDispatched
                    ? 'bg-accent-cyan/5 border-accent-cyan/30'
                    : 'bg-surface-800/50 border-surface-700'
                }`}
              >
                {/* Column header */}
                <div className="px-4 py-3 border-b border-surface-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {hasActive && (
                        <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse shrink-0" />
                      )}
                      <h3 className="font-semibold text-sm text-slate-100 truncate">
                        {projectName}
                      </h3>
                      <span className="text-xs text-slate-500 bg-surface-700 px-1.5 py-0.5 rounded">
                        {projectAgents.length}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                    {repoPath}
                  </p>
                </div>

                {/* Agent cards */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {projectAgents
                    .sort((a, b) => {
                      // Active first, then by recency
                      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
                      return b.lastActiveAt - a.lastActiveAt;
                    })
                    .map(agent => (
                      <AgentCard
                        key={agent.sessionId}
                        agent={agent}
                        ticket={findTicketForAgent(agent, tickets)}
                        onNavigateToTicket={onNavigateToTicket}
                      />
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
