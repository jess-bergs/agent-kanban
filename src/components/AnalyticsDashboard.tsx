import { useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Clock,
  CheckCircle,
  XCircle,
  Zap,
  Activity,
  Target,
} from 'lucide-react';
import type { Ticket, Project } from '../types';
import { formatDuration, formatTokenCount } from '../types';

interface AnalyticsDashboardProps {
  tickets: Ticket[];
  projects: Project[];
}

interface ProjectStats {
  projectId: string;
  projectName: string;
  total: number;
  succeeded: number;
  failed: number;
  inProgress: number;
  avgDurationMs: number;
  totalCost: number;
  totalTokens: number;
  avgTurns: number;
  successRate: number;
}

function computeProjectStats(tickets: Ticket[], projects: Project[]): ProjectStats[] {
  const projectMap = new Map(projects.map(p => [p.id, p]));
  const grouped = new Map<string, Ticket[]>();

  for (const t of tickets) {
    const existing = grouped.get(t.projectId) ?? [];
    existing.push(t);
    grouped.set(t.projectId, existing);
  }

  return [...grouped.entries()].map(([projectId, projectTickets]) => {
    const project = projectMap.get(projectId);
    const completed = projectTickets.filter(t =>
      ['in_review', 'done', 'merged'].includes(t.status)
    );
    const failedTickets = projectTickets.filter(t =>
      ['failed', 'error'].includes(t.status)
    );
    const inProgress = projectTickets.filter(t => t.status === 'in_progress');

    const durations = completed
      .map(t => t.effort?.durationMs)
      .filter((d): d is number => d != null);
    const costs = projectTickets
      .map(t => t.effort?.costUsd)
      .filter((c): c is number => c != null);
    const tokens = projectTickets
      .map(t => (t.effort?.inputTokens ?? 0) + (t.effort?.outputTokens ?? 0))
      .filter(t => t > 0);
    const turns = projectTickets
      .map(t => t.effort?.turns)
      .filter((t): t is number => t != null && t > 0);

    const total = completed.length + failedTickets.length;
    return {
      projectId,
      projectName: project?.name ?? projectId,
      total: projectTickets.length,
      succeeded: completed.length,
      failed: failedTickets.length,
      inProgress: inProgress.length,
      avgDurationMs: durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0,
      totalCost: costs.reduce((a, b) => a + b, 0),
      totalTokens: tokens.reduce((a, b) => a + b, 0),
      avgTurns: turns.length > 0
        ? Math.round(turns.reduce((a, b) => a + b, 0) / turns.length)
        : 0,
      successRate: total > 0 ? completed.length / total : 0,
    };
  }).sort((a, b) => b.total - a.total);
}

function StatCard({ icon: Icon, label, value, subValue, color }: {
  icon: typeof Clock;
  label: string;
  value: string;
  subValue?: string;
  color: string;
}) {
  return (
    <div className="bg-surface-800 rounded-xl p-4 border border-surface-700">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-100 font-mono">{value}</p>
      {subValue && <p className="text-xs text-slate-500 mt-1">{subValue}</p>}
    </div>
  );
}

function SuccessRateBar({ rate, label }: { rate: number; label: string }) {
  const pct = Math.round(rate * 100);
  const color = pct >= 80 ? 'bg-accent-green' : pct >= 50 ? 'bg-accent-amber' : 'bg-accent-red';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-300 truncate">{label}</span>
        <span className="text-slate-400 font-mono">{pct}%</span>
      </div>
      <div className="w-full h-2 bg-surface-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function AnalyticsDashboard({ tickets, projects }: AnalyticsDashboardProps) {
  const stats = useMemo(() => computeProjectStats(tickets, projects), [tickets, projects]);

  const globalStats = useMemo(() => {
    const all = tickets;
    const completed = all.filter(t => ['in_review', 'done', 'merged'].includes(t.status));
    const failed = all.filter(t => ['failed', 'error'].includes(t.status));
    const total = completed.length + failed.length;
    const costs = all.map(t => t.effort?.costUsd).filter((c): c is number => c != null);
    const durations = completed.map(t => t.effort?.durationMs).filter((d): d is number => d != null);
    const allTokens = all.map(t => (t.effort?.inputTokens ?? 0) + (t.effort?.outputTokens ?? 0)).filter(t => t > 0);
    const allTurns = all.map(t => t.effort?.turns).filter((t): t is number => t != null && t > 0);

    return {
      totalTickets: all.length,
      completedTickets: completed.length,
      failedTickets: failed.length,
      inProgressTickets: all.filter(t => t.status === 'in_progress').length,
      successRate: total > 0 ? completed.length / total : 0,
      totalCost: costs.reduce((a, b) => a + b, 0),
      avgCostPerTicket: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
      avgDuration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      totalTokens: allTokens.reduce((a, b) => a + b, 0),
      avgTurns: allTurns.length > 0 ? Math.round(allTurns.reduce((a, b) => a + b, 0) / allTurns.length) : 0,
    };
  }, [tickets]);

  // Status distribution for the donut-style breakdown
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
    return counts;
  }, [tickets]);

  const statusStyles: Record<string, { color: string; label: string }> = {
    todo: { color: 'bg-accent-amber', label: 'To Do' },
    in_progress: { color: 'bg-accent-blue', label: 'In Progress' },
    in_review: { color: 'bg-accent-cyan', label: 'In Review' },
    done: { color: 'bg-accent-green', label: 'Done' },
    merged: { color: 'bg-accent-purple', label: 'Merged' },
    failed: { color: 'bg-accent-red', label: 'Failed' },
    error: { color: 'bg-accent-red/60', label: 'Error' },
  };

  if (tickets.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        <div className="text-center">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 text-slate-600" />
          <p>No ticket data yet</p>
          <p className="text-xs text-slate-600 mt-1">Analytics will appear once agents start working</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Global summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Target}
          label="Success Rate"
          value={`${Math.round(globalStats.successRate * 100)}%`}
          subValue={`${globalStats.completedTickets} succeeded, ${globalStats.failedTickets} failed`}
          color="text-accent-green"
        />
        <StatCard
          icon={DollarSign}
          label="Total Spend"
          value={`$${globalStats.totalCost.toFixed(2)}`}
          subValue={`~$${globalStats.avgCostPerTicket.toFixed(3)} per ticket`}
          color="text-accent-amber"
        />
        <StatCard
          icon={Clock}
          label="Avg Duration"
          value={globalStats.avgDuration > 0 ? formatDuration(globalStats.avgDuration) : '—'}
          subValue={`${globalStats.avgTurns} avg turns per ticket`}
          color="text-accent-blue"
        />
        <StatCard
          icon={Zap}
          label="Total Tokens"
          value={formatTokenCount(globalStats.totalTokens)}
          subValue={`Across ${globalStats.totalTickets} tickets`}
          color="text-accent-cyan"
        />
      </div>

      {/* Status distribution */}
      <div className="bg-surface-800 rounded-xl p-5 border border-surface-700">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-200">Ticket Distribution</h3>
        </div>

        {/* Horizontal stacked bar */}
        <div className="flex h-6 rounded-full overflow-hidden bg-surface-700 mb-3">
          {Object.entries(statusCounts)
            .filter(([, count]) => count > 0)
            .sort(([a], [b]) => {
              const order = ['todo', 'in_progress', 'in_review', 'done', 'merged', 'failed', 'error'];
              return order.indexOf(a) - order.indexOf(b);
            })
            .map(([status, count]) => {
              const pct = (count / tickets.length) * 100;
              const style = statusStyles[status];
              return (
                <div
                  key={status}
                  className={`${style?.color ?? 'bg-slate-600'} transition-all duration-300 relative group`}
                  style={{ width: `${pct}%` }}
                  title={`${style?.label}: ${count}`}
                >
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block">
                    <div className="bg-surface-900 border border-surface-600 rounded px-2 py-1 text-[10px] text-slate-300 whitespace-nowrap shadow-lg">
                      {style?.label}: {count}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3">
          {Object.entries(statusCounts)
            .filter(([, count]) => count > 0)
            .map(([status, count]) => {
              const style = statusStyles[status];
              return (
                <div key={status} className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-sm ${style?.color ?? 'bg-slate-600'}`} />
                  <span className="text-xs text-slate-400">
                    {style?.label} <span className="font-mono text-slate-500">({count})</span>
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      {/* Per-project breakdown */}
      <div className="bg-surface-800 rounded-xl p-5 border border-surface-700">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-200">Project Performance</h3>
        </div>

        <div className="space-y-4">
          {stats.map(ps => (
            <div key={ps.projectId} className="bg-surface-900 rounded-lg p-4 border border-surface-700">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-200">{ps.projectName}</span>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {ps.inProgress > 0 && (
                    <span className="text-accent-blue">{ps.inProgress} running</span>
                  )}
                  <span>{ps.total} tickets</span>
                </div>
              </div>

              <SuccessRateBar rate={ps.successRate} label="Success rate" />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Avg Duration</p>
                  <p className="text-sm font-mono text-slate-300">
                    {ps.avgDurationMs > 0 ? formatDuration(ps.avgDurationMs) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Cost</p>
                  <p className="text-sm font-mono text-accent-amber">
                    {ps.totalCost > 0 ? `$${ps.totalCost.toFixed(2)}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Tokens</p>
                  <p className="text-sm font-mono text-slate-300">
                    {ps.totalTokens > 0 ? formatTokenCount(ps.totalTokens) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Avg Turns</p>
                  <p className="text-sm font-mono text-slate-300">
                    {ps.avgTurns > 0 ? ps.avgTurns : '—'}
                  </p>
                </div>
              </div>

              {/* Completed vs failed mini bars */}
              <div className="flex items-center gap-2 mt-3 text-[10px]">
                <div className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-accent-green" />
                  <span className="text-accent-green font-mono">{ps.succeeded}</span>
                </div>
                <div className="flex items-center gap-1">
                  <XCircle className="w-3 h-3 text-accent-red" />
                  <span className="text-accent-red font-mono">{ps.failed}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
