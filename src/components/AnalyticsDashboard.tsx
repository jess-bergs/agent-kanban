import { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  GitPullRequest,
  PlayCircle,
  RefreshCw,
  Shield,
  TrendingDown,
  TrendingUp,
  XCircle,
  Minus,
  AlertCircle,
  Zap,
  Eye,
} from 'lucide-react';
import { formatDuration, formatTokenCount } from '../types';

// ─── Types (mirroring server/analytics.ts) ─────────────────────

interface DispatcherRunSummary {
  ticketId: string;
  subject: string;
  projectId: string;
  status: string;
  costUsd?: number;
  durationMs?: number;
  turns?: number;
  toolCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  prUrl?: string;
  error?: string;
  failureType?: string;
  startedAt?: number;
  completedAt?: number;
}

interface DispatcherStats {
  byStatus: Record<string, number>;
  totalCostUsd: number;
  totalTokens: number;
  avgDurationMs: number;
  recentRuns: DispatcherRunSummary[];
  failureBreakdown: Record<string, number>;
  totalDispatched: number;
  currentlyRunning: number;
}

interface AuditorReviewSummary {
  prUrl: string;
  repo: string;
  prNumber: number;
  ticketId?: string;
  reviewCount: number;
  lastVerdict?: string;
  lastReviewedAt?: number;
  resolved: boolean;
  rubricSummary?: Array<{ aspect: string; rating: string }>;
}

interface AuditorStats {
  totalWatched: number;
  activeWatchCount: number;
  totalReviews: number;
  verdictBreakdown: Record<string, number>;
  recentReviews: AuditorReviewSummary[];
}

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

interface SchedulerRunSummary {
  runId: string;
  scheduleId: string;
  projectId: string;
  mode: string;
  status: string;
  overallScore?: number;
  overallVerdict?: string;
  severityCounts?: SeverityCounts;
  trendDirection?: string;
  trendDelta?: number;
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

interface SchedulerStats {
  byStatus: Record<string, number>;
  totalCompleted: number;
  totalFailed: number;
  recentRuns: SchedulerRunSummary[];
  aggregateSeverity: SeverityCounts;
}

interface IssueEntry {
  source: string;
  id: string;
  summary: string;
  detail?: string;
  severity: string;
  timestamp: number;
}

interface AnalyticsPayload {
  dispatcher: DispatcherStats;
  auditor: AuditorStats;
  scheduler: SchedulerStats;
  issues: IssueEntry[];
  coverageGaps: string[];
  generatedAt: number;
}

// ─── Component ──────────────────────────────────────────────────

export function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchAnalytics() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analytics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading analytics...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex-1 flex items-center justify-center text-accent-red">
        <AlertTriangle className="w-5 h-5 mr-2" />
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <Activity className="w-5 h-5 text-accent-blue" />
          Analytics Dashboard
        </h1>
        <button
          onClick={fetchAnalytics}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-surface-700 hover:bg-surface-600 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Top-level stats cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Dispatched"
          value={data.dispatcher.totalDispatched}
          sub={`${data.dispatcher.currentlyRunning} running`}
          icon={<PlayCircle className="w-4 h-4" />}
          color="blue"
        />
        <StatCard
          label="Total Cost"
          value={`$${data.dispatcher.totalCostUsd.toFixed(2)}`}
          sub={`${formatTokenCount(data.dispatcher.totalTokens)} tokens`}
          icon={<DollarSign className="w-4 h-4" />}
          color="green"
        />
        <StatCard
          label="PR Reviews"
          value={data.auditor.totalReviews}
          sub={`${data.auditor.activeWatchCount} active`}
          icon={<Eye className="w-4 h-4" />}
          color="cyan"
        />
        <StatCard
          label="Issues"
          value={data.issues.length}
          sub={`${data.issues.filter(i => i.severity === 'error').length} errors`}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={data.issues.length > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Dispatcher Runs */}
      <Section title="Dispatcher Runs" icon={<Zap className="w-4 h-4 text-accent-blue" />}>
        <div className="grid grid-cols-8 gap-2 mb-4">
          {(['todo', 'in_progress', 'needs_approval', 'in_review', 'done', 'merged', 'failed', 'error'] as const).map(s => (
            <MiniStat
              key={s}
              label={s.replace('_', ' ')}
              value={data.dispatcher.byStatus[s] || 0}
              color={statusColor(s)}
            />
          ))}
        </div>
        {data.dispatcher.avgDurationMs > 0 && (
          <div className="text-xs text-slate-500 mb-3">
            Avg duration: <span className="text-slate-300">{formatDuration(data.dispatcher.avgDurationMs)}</span>
            {Object.keys(data.dispatcher.failureBreakdown).length > 0 && (
              <span className="ml-4">
                Failures:{' '}
                {Object.entries(data.dispatcher.failureBreakdown).map(([reason, count]) => (
                  <span key={reason} className="inline-flex items-center gap-1 ml-2 text-accent-red">
                    {reason}: {count}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
        {data.dispatcher.recentRuns.length > 0 ? (
          <RunTable runs={data.dispatcher.recentRuns} />
        ) : (
          <EmptySection message="No dispatcher runs yet" />
        )}
      </Section>

      {/* PR Review Activity */}
      <Section title="PR Review Activity" icon={<Shield className="w-4 h-4 text-accent-cyan" />}>
        {data.auditor.totalWatched > 0 && (
          <div className="flex gap-4 mb-4 text-xs">
            <span className="text-slate-500">
              Watched: <span className="text-slate-300">{data.auditor.totalWatched}</span>
            </span>
            {Object.entries(data.auditor.verdictBreakdown).map(([verdict, count]) => (
              <span key={verdict} className="flex items-center gap-1">
                <VerdictIcon verdict={verdict} />
                <span className={verdictTextColor(verdict)}>{verdict}: {count}</span>
              </span>
            ))}
          </div>
        )}
        {data.auditor.recentReviews.length > 0 ? (
          <AuditorTable reviews={data.auditor.recentReviews} />
        ) : (
          <EmptySection message="No PR reviews yet" />
        )}
      </Section>

      {/* Scheduler Runs */}
      <Section title="Scheduler Runs" icon={<Clock className="w-4 h-4 text-accent-purple" />}>
        <div className="flex gap-4 mb-4">
          {(['pending', 'running', 'completed', 'failed'] as const).map(s => (
            <MiniStat
              key={s}
              label={s}
              value={data.scheduler.byStatus[s] || 0}
              color={s === 'completed' ? 'green' : s === 'failed' ? 'red' : s === 'running' ? 'blue' : 'amber'}
            />
          ))}
          <div className="flex-1" />
          <SeverityBar counts={data.scheduler.aggregateSeverity} />
        </div>
        {data.scheduler.recentRuns.length > 0 ? (
          <SchedulerTable runs={data.scheduler.recentRuns} />
        ) : (
          <EmptySection message="No scheduled review runs yet" />
        )}
      </Section>

      {/* Issues */}
      <Section title="Issues & Errors" icon={<AlertCircle className="w-4 h-4 text-accent-red" />}>
        {data.issues.length > 0 ? (
          <IssuesTable issues={data.issues} />
        ) : (
          <div className="text-center py-6 text-sm text-accent-green flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            No issues detected
          </div>
        )}
      </Section>

      {/* Coverage Gaps */}
      {data.coverageGaps.length > 0 && (
        <Section title="Data Coverage Gaps" icon={<AlertTriangle className="w-4 h-4 text-accent-amber" />}>
          <ul className="space-y-2">
            {data.coverageGaps.map((gap, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-amber mt-1.5 shrink-0" />
                {gap}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ReactNode;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'text-accent-blue border-accent-blue/30',
    green: 'text-accent-green border-accent-green/30',
    cyan: 'text-accent-cyan border-accent-cyan/30',
    red: 'text-accent-red border-accent-red/30',
    amber: 'text-accent-amber border-accent-amber/30',
    purple: 'text-accent-purple border-accent-purple/30',
  };
  return (
    <div className={`bg-surface-800 rounded-xl border ${colorMap[color] || 'border-surface-600'} p-4`}>
      <div className={`flex items-center gap-2 text-xs ${colorMap[color]?.split(' ')[0] || 'text-slate-400'} mb-1`}>
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-100">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface-800 rounded-xl border border-surface-600 p-5">
      <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'text-accent-blue',
    green: 'text-accent-green',
    cyan: 'text-accent-cyan',
    red: 'text-accent-red',
    amber: 'text-accent-amber',
    purple: 'text-accent-purple',
  };
  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${colorMap[color] || 'text-slate-300'}`}>{value}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function EmptySection({ message }: { message: string }) {
  return (
    <div className="text-center py-6 text-sm text-slate-500">{message}</div>
  );
}

// ─── Dispatcher Run Table ────────────────────────────────────────

function RunTable({ runs }: { runs: DispatcherRunSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-surface-600">
            <th className="pb-2 pr-3 font-medium">Subject</th>
            <th className="pb-2 pr-3 font-medium">Status</th>
            <th className="pb-2 pr-3 font-medium">Cost</th>
            <th className="pb-2 pr-3 font-medium">Duration</th>
            <th className="pb-2 pr-3 font-medium">Turns</th>
            <th className="pb-2 pr-3 font-medium">Tools</th>
            <th className="pb-2 pr-3 font-medium">Tokens</th>
            <th className="pb-2 font-medium">PR</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(run => (
            <tr key={run.ticketId} className="border-b border-surface-700/50 hover:bg-surface-700/30">
              <td className="py-2 pr-3 text-slate-300 max-w-[200px] truncate" title={run.subject}>
                {run.subject}
              </td>
              <td className="py-2 pr-3">
                <StatusBadge status={run.status} />
              </td>
              <td className="py-2 pr-3 text-slate-400">
                {run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : '-'}
              </td>
              <td className="py-2 pr-3 text-slate-400">
                {run.durationMs ? formatDuration(run.durationMs) : '-'}
              </td>
              <td className="py-2 pr-3 text-slate-400">{run.turns ?? '-'}</td>
              <td className="py-2 pr-3 text-slate-400">{run.toolCalls ?? '-'}</td>
              <td className="py-2 pr-3 text-slate-400">
                {run.inputTokens || run.outputTokens
                  ? `${formatTokenCount(run.inputTokens || 0)}/${formatTokenCount(run.outputTokens || 0)}`
                  : '-'}
              </td>
              <td className="py-2">
                {run.prUrl ? (
                  <a
                    href={run.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-blue hover:underline flex items-center gap-1"
                  >
                    <GitPullRequest className="w-3 h-3" />
                    PR
                  </a>
                ) : run.error ? (
                  <span className="text-accent-red truncate max-w-[120px] inline-block" title={run.error}>
                    {run.error.slice(0, 30)}
                  </span>
                ) : (
                  '-'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Auditor Review Table ────────────────────────────────────────

function AuditorTable({ reviews }: { reviews: AuditorReviewSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-surface-600">
            <th className="pb-2 pr-3 font-medium">PR</th>
            <th className="pb-2 pr-3 font-medium">Repo</th>
            <th className="pb-2 pr-3 font-medium">Verdict</th>
            <th className="pb-2 pr-3 font-medium">Reviews</th>
            <th className="pb-2 pr-3 font-medium">Rubric</th>
            <th className="pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map(review => (
            <tr key={review.prUrl} className="border-b border-surface-700/50 hover:bg-surface-700/30">
              <td className="py-2 pr-3">
                <a
                  href={review.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-blue hover:underline"
                >
                  #{review.prNumber}
                </a>
              </td>
              <td className="py-2 pr-3 text-slate-400 max-w-[150px] truncate">{review.repo}</td>
              <td className="py-2 pr-3">
                {review.lastVerdict ? (
                  <span className="flex items-center gap-1">
                    <VerdictIcon verdict={review.lastVerdict} />
                    <span className={verdictTextColor(review.lastVerdict)}>
                      {review.lastVerdict}
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-500">-</span>
                )}
              </td>
              <td className="py-2 pr-3 text-slate-400">{review.reviewCount}</td>
              <td className="py-2 pr-3">
                {review.rubricSummary ? (
                  <div className="flex gap-1">
                    {review.rubricSummary.map((r, i) => (
                      <span
                        key={i}
                        title={`${r.aspect}: ${r.rating}`}
                        className={`w-2 h-2 rounded-full ${
                          r.rating === 'pass' ? 'bg-accent-green' :
                          r.rating === 'concern' ? 'bg-accent-amber' :
                          'bg-accent-red'
                        }`}
                      />
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-500">-</span>
                )}
              </td>
              <td className="py-2">
                {review.resolved ? (
                  <span className="text-slate-500">resolved</span>
                ) : (
                  <span className="text-accent-green">active</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Scheduler Run Table ─────────────────────────────────────────

function SchedulerTable({ runs }: { runs: SchedulerRunSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-surface-600">
            <th className="pb-2 pr-3 font-medium">Mode</th>
            <th className="pb-2 pr-3 font-medium">Status</th>
            <th className="pb-2 pr-3 font-medium">Score</th>
            <th className="pb-2 pr-3 font-medium">Trend</th>
            <th className="pb-2 pr-3 font-medium">Severity</th>
            <th className="pb-2 pr-3 font-medium">Duration</th>
            <th className="pb-2 font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(run => (
            <tr key={run.runId} className="border-b border-surface-700/50 hover:bg-surface-700/30">
              <td className="py-2 pr-3">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  run.mode === 'fix'
                    ? 'bg-accent-purple/20 text-accent-purple'
                    : 'bg-accent-cyan/20 text-accent-cyan'
                }`}>
                  {run.mode}
                </span>
              </td>
              <td className="py-2 pr-3">
                <StatusBadge status={run.status} />
              </td>
              <td className="py-2 pr-3">
                {run.overallScore != null ? (
                  <span className={
                    run.overallScore >= 8 ? 'text-accent-green' :
                    run.overallScore >= 5 ? 'text-accent-amber' :
                    'text-accent-red'
                  }>
                    {run.overallScore.toFixed(1)}
                  </span>
                ) : (
                  <span className="text-slate-500">-</span>
                )}
              </td>
              <td className="py-2 pr-3">
                {run.trendDirection ? (
                  <span className="flex items-center gap-1">
                    <TrendIcon direction={run.trendDirection} />
                    <span className={
                      run.trendDirection === 'improving' ? 'text-accent-green' :
                      run.trendDirection === 'declining' ? 'text-accent-red' :
                      'text-slate-500'
                    }>
                      {run.trendDelta != null ? `${run.trendDelta > 0 ? '+' : ''}${run.trendDelta.toFixed(1)}` : run.trendDirection}
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-500">-</span>
                )}
              </td>
              <td className="py-2 pr-3">
                {run.severityCounts ? (
                  <SeverityBadges counts={run.severityCounts} />
                ) : (
                  <span className="text-slate-500">-</span>
                )}
              </td>
              <td className="py-2 pr-3 text-slate-400">
                {run.durationMs ? formatDuration(run.durationMs) : '-'}
              </td>
              <td className="py-2">
                {run.error ? (
                  <span className="text-accent-red truncate max-w-[150px] inline-block" title={run.error}>
                    {run.error.slice(0, 40)}
                  </span>
                ) : (
                  '-'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Issues Table ────────────────────────────────────────────────

function IssuesTable({ issues }: { issues: IssueEntry[] }) {
  return (
    <div className="space-y-2">
      {issues.map((issue, i) => (
        <div
          key={`${issue.id}-${i}`}
          className={`flex items-start gap-3 p-3 rounded-lg border ${
            issue.severity === 'error'
              ? 'border-accent-red/30 bg-accent-red/5'
              : issue.severity === 'warning'
              ? 'border-accent-amber/30 bg-accent-amber/5'
              : 'border-surface-600 bg-surface-700/30'
          }`}
        >
          <div className="shrink-0 mt-0.5">
            {issue.severity === 'error' ? (
              <XCircle className="w-4 h-4 text-accent-red" />
            ) : issue.severity === 'warning' ? (
              <AlertTriangle className="w-4 h-4 text-accent-amber" />
            ) : (
              <AlertCircle className="w-4 h-4 text-accent-blue" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-200">{issue.summary}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                issue.source === 'dispatcher'
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : issue.source === 'auditor'
                  ? 'bg-accent-cyan/20 text-accent-cyan'
                  : 'bg-accent-purple/20 text-accent-purple'
              }`}>
                {issue.source}
              </span>
            </div>
            {issue.detail && (
              <p className="text-[11px] text-slate-500 mt-1 truncate">{issue.detail}</p>
            )}
          </div>
          <span className="text-[10px] text-slate-600 shrink-0">
            {formatRelativeTime(issue.timestamp)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Shared Helpers ──────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    todo: 'bg-accent-amber/20 text-accent-amber',
    in_progress: 'bg-accent-blue/20 text-accent-blue',
    needs_approval: 'bg-accent-orange/20 text-accent-orange',
    in_review: 'bg-accent-cyan/20 text-accent-cyan',
    done: 'bg-accent-green/20 text-accent-green',
    merged: 'bg-accent-purple/20 text-accent-purple',
    failed: 'bg-accent-red/20 text-accent-red',
    error: 'bg-accent-red/20 text-accent-red',
    pending: 'bg-accent-amber/20 text-accent-amber',
    running: 'bg-accent-blue/20 text-accent-blue',
    completed: 'bg-accent-green/20 text-accent-green',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${colors[status] || 'bg-surface-600 text-slate-400'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function VerdictIcon({ verdict }: { verdict: string }) {
  switch (verdict) {
    case 'approve': return <CheckCircle2 className="w-3 h-3 text-accent-green" />;
    case 'request_changes': return <XCircle className="w-3 h-3 text-accent-red" />;
    case 'comment': return <AlertCircle className="w-3 h-3 text-accent-amber" />;
    default: return null;
  }
}

function verdictTextColor(verdict: string): string {
  switch (verdict) {
    case 'approve': return 'text-accent-green';
    case 'request_changes': return 'text-accent-red';
    case 'comment': return 'text-accent-amber';
    default: return 'text-slate-400';
  }
}

function TrendIcon({ direction }: { direction: string }) {
  switch (direction) {
    case 'improving': return <TrendingUp className="w-3 h-3 text-accent-green" />;
    case 'declining': return <TrendingDown className="w-3 h-3 text-accent-red" />;
    default: return <Minus className="w-3 h-3 text-slate-500" />;
  }
}

function SeverityBar({ counts }: { counts: SeverityCounts }) {
  const total = counts.critical + counts.high + counts.medium + counts.low + counts.info;
  if (total === 0) return null;
  return (
    <div className="flex items-center gap-1 text-[10px]">
      {counts.critical > 0 && <span className="text-accent-red font-bold">{counts.critical}C</span>}
      {counts.high > 0 && <span className="text-accent-orange">{counts.high}H</span>}
      {counts.medium > 0 && <span className="text-accent-amber">{counts.medium}M</span>}
      {counts.low > 0 && <span className="text-slate-400">{counts.low}L</span>}
      {counts.info > 0 && <span className="text-slate-500">{counts.info}I</span>}
    </div>
  );
}

function SeverityBadges({ counts }: { counts: SeverityCounts }) {
  return (
    <div className="flex items-center gap-1">
      {counts.critical > 0 && (
        <span className="px-1 py-0.5 rounded bg-accent-red/20 text-accent-red text-[10px] font-bold">
          {counts.critical}C
        </span>
      )}
      {counts.high > 0 && (
        <span className="px-1 py-0.5 rounded bg-accent-orange/20 text-accent-orange text-[10px]">
          {counts.high}H
        </span>
      )}
      {counts.medium > 0 && (
        <span className="px-1 py-0.5 rounded bg-accent-amber/20 text-accent-amber text-[10px]">
          {counts.medium}M
        </span>
      )}
      {counts.low > 0 && (
        <span className="px-1 py-0.5 rounded bg-surface-600 text-slate-400 text-[10px]">
          {counts.low}L
        </span>
      )}
      {counts.info > 0 && (
        <span className="px-1 py-0.5 rounded bg-surface-600 text-slate-500 text-[10px]">
          {counts.info}I
        </span>
      )}
    </div>
  );
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    todo: 'amber',
    in_progress: 'blue',
    needs_approval: 'amber',
    in_review: 'cyan',
    done: 'green',
    merged: 'purple',
    failed: 'red',
    error: 'red',
  };
  return map[status] || 'blue';
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}
