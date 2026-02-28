import { Bot, Monitor, Code2, Terminal, GitBranch, Clock } from 'lucide-react';
import type { SoloAgent } from '../types';
import { formatTimestamp } from '../types';

interface AgentKanbanProps {
  agents: SoloAgent[];
}

function sourceLabel(source: SoloAgent['source']): { label: string; icon: typeof Bot } {
  switch (source) {
    case 'vscode': return { label: 'VS Code', icon: Code2 };
    case 'terminal': return { label: 'Terminal', icon: Terminal };
    case 'dispatched': return { label: 'Dispatched', icon: Monitor };
    default: return { label: 'Unknown', icon: Bot };
  }
}

function AgentCard({ agent }: { agent: SoloAgent }) {
  const isActive = agent.status === 'active';
  const { label: srcLabel, icon: SrcIcon } = sourceLabel(agent.source);

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        isActive
          ? 'bg-surface-700 border-accent-green/40'
          : 'bg-surface-800 border-surface-600'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isActive
                ? 'bg-accent-green animate-pulse'
                : 'bg-slate-500'
            }`}
          />
          <span className="font-medium text-sm text-slate-100 truncate">
            {agent.slug || agent.sessionId.slice(0, 8)}
          </span>
        </div>
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

      <div className="mt-2 space-y-1 text-xs text-slate-400">
        {agent.gitBranch && agent.gitBranch !== 'HEAD' && (
          <div className="flex items-center gap-1.5">
            <GitBranch className="w-3 h-3 text-accent-purple shrink-0" />
            <span className="font-mono truncate text-accent-purple">{agent.gitBranch}</span>
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
    </div>
  );
}

export function AgentKanban({ agents }: AgentKanbanProps) {
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

            return (
              <div
                key={cwd}
                className="w-80 shrink-0 flex flex-col bg-surface-800/50 rounded-xl border border-surface-700"
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
                      <AgentCard key={agent.sessionId} agent={agent} />
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
