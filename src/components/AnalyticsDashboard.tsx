import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  FileText,
  GitPullRequest,
  Layers,
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
  Target,
  BarChart3,
} from 'lucide-react';
import { formatDuration, formatTokenCount } from '../types';
import type { AuditReport, AuditRubricScore, AuditFinding, SeverityCounts as SeverityCountsType } from '../types';

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

// ─── Report Types (from audit-runs API) ─────────────────────────

interface AuditRunEntry {
  id: string;
  scheduleId: string;
  projectId: string;
  mode: string;
  status: string;
  structuredReport?: AuditReport;
  severityCounts?: SeverityCountsType;
  trend?: {
    previousRunId: string;
    previousScore: number;
    currentScore: number;
    delta: number;
    direction: string;
    newFindings: string[];
    resolvedFindings: string[];
    recurringFindings: string[];
  };
  error?: string;
  startedAt: number;
  completedAt?: number;
}

interface AuditScheduleEntry {
  id: string;
  projectId: string;
  name: string;
}

type AnalyticsTab = 'overview' | 'reports';

// ─── Component ──────────────────────────────────────────────────

export function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');

  async function fetchAnalytics() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/analytics');
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
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-accent-blue" />
            Analytics
          </h1>
          <div className="flex gap-1 bg-surface-700 rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'overview'
                  ? 'bg-surface-600 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'reports'
                  ? 'bg-surface-600 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3 h-3" />
              Reports
            </button>
          </div>
        </div>
        {activeTab === 'overview' && (
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-surface-700 hover:bg-surface-600 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      {activeTab === 'reports' ? (
        <ReportsView />
      ) : (
      <>
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

      {/* Issues — pulled above the fold so errors are immediately visible */}
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

      {/* Dispatcher Runs */}
      <Section
        title="Dispatcher Runs"
        icon={<Zap className="w-4 h-4 text-accent-blue" />}
        collapsible
        summary={`${data.dispatcher.totalDispatched} dispatched, ${data.dispatcher.currentlyRunning} running`}
      >
        <div className="grid grid-cols-9 gap-2 mb-4">
          {(['todo', 'in_progress', 'needs_approval', 'on_hold', 'in_review', 'done', 'merged', 'failed', 'error'] as const).map(s => (
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
      <Section
        title="PR Review Activity"
        icon={<Shield className="w-4 h-4 text-accent-cyan" />}
        collapsible
        summary={`${data.auditor.totalReviews} reviews, ${data.auditor.activeWatchCount} active`}
      >
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
      <Section
        title="Scheduler Runs"
        icon={<Clock className="w-4 h-4 text-accent-purple" />}
        collapsible
        summary={`${data.scheduler.totalCompleted} completed, ${data.scheduler.totalFailed} failed`}
      >
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

      </>
      )}
    </div>
  );
}

// ─── Reports View ───────────────────────────────────────────────

interface RunBatch {
  startedAt: number;
  runs: AuditRunEntry[];
}

/** Group runs into batches by time proximity (runs started within 5 minutes of each other). */
function groupRunsByBatch(runs: AuditRunEntry[]): RunBatch[] {
  if (runs.length === 0) return [];
  // runs are already sorted newest-first by the API
  const batches: RunBatch[] = [];
  let currentBatch: RunBatch = { startedAt: runs[0].startedAt, runs: [runs[0]] };

  for (let i = 1; i < runs.length; i++) {
    const gap = currentBatch.runs[currentBatch.runs.length - 1].startedAt - runs[i].startedAt;
    if (gap <= 5 * 60 * 1000) {
      currentBatch.runs.push(runs[i]);
    } else {
      batches.push(currentBatch);
      currentBatch = { startedAt: runs[i].startedAt, runs: [runs[i]] };
    }
  }
  batches.push(currentBatch);
  return batches;
}

function formatBatchTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const date = new Date(ts);

  if (diff < 86_400_000) {
    // Today — show time only
    return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diff < 2 * 86_400_000) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ` at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function ReportsView() {
  const [runs, setRuns] = useState<AuditRunEntry[]>([]);
  const [schedules, setSchedules] = useState<AuditScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReports() {
      setLoading(true);
      setError(null);
      try {
        const [runsRes, schedulesRes] = await Promise.all([
          apiFetch('/api/audit-runs'),
          apiFetch('/api/audit-schedules'),
        ]);
        if (!runsRes.ok) throw new Error(`Runs: HTTP ${runsRes.status}`);
        if (!schedulesRes.ok) throw new Error(`Schedules: HTTP ${schedulesRes.status}`);
        const runsData: AuditRunEntry[] = await runsRes.json();
        const schedulesData: AuditScheduleEntry[] = await schedulesRes.json();
        setRuns(runsData.filter(r => r.status === 'completed' && r.structuredReport));
        setSchedules(schedulesData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch');
      } finally {
        setLoading(false);
      }
    }
    fetchReports();
  }, []);

  const scheduleMap = new Map(schedules.map(s => [s.id, s]));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading reports...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-accent-red">
        <AlertTriangle className="w-5 h-5 mr-2" />
        {error}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No completed reports yet</p>
        <p className="text-xs mt-1">Reports appear here when scheduled audits complete</p>
      </div>
    );
  }

  // ── Aggregate stats across all completed reports ──
  const stats = computeReportStats(runs);

  return (
    <div className="space-y-4">
      {/* Summary stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Avg Score"
          value={stats.avgScore.toFixed(1)}
          sub={`${runs.length} report${runs.length !== 1 ? 's' : ''}`}
          icon={<Target className="w-4 h-4" />}
          color={stats.avgScore >= 8 ? 'green' : stats.avgScore >= 5 ? 'amber' : 'red'}
        />
        <StatCard
          label="Needs Attention"
          value={stats.needsAttention}
          sub={stats.needsAttention > 0 ? `${stats.criticalFindings}C ${stats.highFindings}H findings` : 'All clear'}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={stats.needsAttention > 0 ? 'red' : 'green'}
        />
        <StatCard
          label="Total Findings"
          value={stats.totalFindings}
          sub={`${stats.criticalFindings + stats.highFindings} critical/high`}
          icon={<BarChart3 className="w-4 h-4" />}
          color={stats.criticalFindings > 0 ? 'red' : stats.highFindings > 0 ? 'amber' : 'cyan'}
        />
        <StatCard
          label="Trend"
          value={stats.improvingCount > stats.decliningCount ? 'Improving' : stats.decliningCount > stats.improvingCount ? 'Declining' : 'Stable'}
          sub={`${stats.improvingCount}↑ ${stats.decliningCount}↓ ${stats.stableCount}→`}
          icon={stats.improvingCount > stats.decliningCount
            ? <TrendingUp className="w-4 h-4" />
            : stats.decliningCount > stats.improvingCount
            ? <TrendingDown className="w-4 h-4" />
            : <Minus className="w-4 h-4" />}
          color={stats.improvingCount > stats.decliningCount ? 'green' : stats.decliningCount > stats.improvingCount ? 'red' : 'cyan'}
        />
      </div>

      {/* Score distribution bar */}
      {runs.length > 1 && (
        <div className="bg-surface-800 rounded-xl border border-surface-600 p-4">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Score Distribution</h3>
          <div className="flex items-end gap-1 h-16">
            {stats.scoreBuckets.map((count, i) => {
              const maxCount = Math.max(...stats.scoreBuckets, 1);
              const height = count > 0 ? Math.max((count / maxCount) * 100, 8) : 0;
              const bucketColor = i >= 8 ? 'bg-accent-green' : i >= 5 ? 'bg-accent-amber' : 'bg-accent-red';
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col items-center justify-end" style={{ height: '48px' }}>
                    {count > 0 && (
                      <span className="text-[9px] text-slate-500 mb-0.5">{count}</span>
                    )}
                    <div
                      className={`w-full rounded-sm ${bucketColor} ${count === 0 ? 'opacity-10' : 'opacity-70'}`}
                      style={{ height: `${height}%`, minHeight: count > 0 ? '4px' : '2px' }}
                    />
                  </div>
                  <span className="text-[9px] text-slate-600">{i}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Report cards grouped by batch */}
      <div className="space-y-6">
      {groupRunsByBatch(runs).map((batch, batchIdx) => {
        const batchScores = batch.runs.map(r => r.structuredReport!.overallScore);
        const batchAvg = batchScores.reduce((a, b) => a + b, 0) / batchScores.length;
        const batchAvgColor = batchAvg >= 8 ? 'text-accent-green' : batchAvg >= 5 ? 'text-accent-amber' : 'text-accent-red';

        return (
          <div key={batchIdx}>
            {/* Batch header */}
            <div className="flex items-center gap-3 mb-2">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs font-medium text-slate-400">
                {formatBatchTime(batch.startedAt)}
              </span>
              <span className="text-[10px] text-slate-600">
                {batch.runs.length} report{batch.runs.length !== 1 ? 's' : ''}
              </span>
              <span className={`text-[10px] font-medium ${batchAvgColor}`}>
                avg {batchAvg.toFixed(1)}
              </span>
              <div className="flex-1 border-t border-surface-700" />
              <span className="text-[10px] text-slate-600">
                {formatRelativeTime(batch.startedAt)}
              </span>
            </div>

            {/* Runs in this batch */}
            <div className="space-y-3">
            {batch.runs.map(run => {
              const report = run.structuredReport!;
              const schedule = scheduleMap.get(run.scheduleId);
              const isExpanded = expandedRunId === run.id;
              const isAttention = stats.attentionRunIds.has(run.id);

              return (
                <div
                  key={run.id}
                  className={`bg-surface-800 rounded-xl border overflow-hidden ${
                    isAttention ? 'border-accent-red/40' : 'border-surface-600'
                  }`}
                >
                  {/* Report header row — clickable */}
                  <button
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-surface-700/30 transition-colors"
                  >
                    <div className="shrink-0">
                      <ScoreRing score={report.overallScore} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-200 truncate">
                          {schedule?.name || run.scheduleId.slice(0, 8)}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          run.mode === 'fix'
                            ? 'bg-accent-purple/20 text-accent-purple'
                            : 'bg-accent-cyan/20 text-accent-cyan'
                        }`}>
                          {run.mode}
                        </span>
                        {run.trend && (
                          <span className="flex items-center gap-0.5">
                            <TrendIcon direction={run.trend.direction} />
                            <span className={`text-[10px] ${
                              run.trend.direction === 'improving' ? 'text-accent-green' :
                              run.trend.direction === 'declining' ? 'text-accent-red' :
                              'text-slate-500'
                            }`}>
                              {run.trend.delta > 0 ? '+' : ''}{run.trend.delta.toFixed(1)}
                            </span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {report.overallVerdict}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-3">
                      {run.severityCounts && <SeverityBadges counts={run.severityCounts} />}
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-slate-500" />
                        : <ChevronDown className="w-4 h-4 text-slate-500" />}
                    </div>
                  </button>

                  {/* Expanded report detail */}
                  {isExpanded && (
                    <div className="border-t border-surface-600 p-5 space-y-5">
                      {/* Summary */}
                      <div>
                        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Summary</h3>
                        <p className="text-sm text-slate-400 leading-relaxed">{report.summary}</p>
                      </div>

                      {/* Rubric scores */}
                      {report.rubric.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Rubric Scores</h3>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-slate-500 border-b border-surface-600">
                                  <th className="pb-2 pr-3 font-medium">Aspect</th>
                                  <th className="pb-2 pr-3 font-medium">Score</th>
                                  <th className="pb-2 pr-3 font-medium">Rating</th>
                                  <th className="pb-2 pr-3 font-medium">Findings</th>
                                  <th className="pb-2 font-medium">Notes</th>
                                </tr>
                              </thead>
                              <tbody>
                                {report.rubric.map((item, i) => (
                                  <tr key={i} className="border-b border-surface-700/50">
                                    <td className="py-2 pr-3 text-slate-300">{item.aspect}</td>
                                    <td className="py-2 pr-3">
                                      <span className={
                                        item.score >= 8 ? 'text-accent-green' :
                                        item.score >= 4 ? 'text-accent-amber' :
                                        'text-accent-red'
                                      }>
                                        {item.score.toFixed(1)}
                                      </span>
                                    </td>
                                    <td className="py-2 pr-3">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                        item.rating === 'pass' ? 'bg-accent-green/20 text-accent-green' :
                                        item.rating === 'concern' ? 'bg-accent-amber/20 text-accent-amber' :
                                        'bg-accent-red/20 text-accent-red'
                                      }`}>
                                        {item.rating}
                                      </span>
                                    </td>
                                    <td className="py-2 pr-3 text-slate-400">{item.findingCount}</td>
                                    <td className="py-2 text-slate-500 max-w-[300px] truncate" title={item.summary}>
                                      {item.summary}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Findings */}
                      {report.findings.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                            Findings ({report.findings.length})
                          </h3>
                          <div className="space-y-2">
                            {(['critical', 'high', 'medium', 'low', 'info'] as const).map(sev => {
                              const items = report.findings.filter(f => f.severity === sev);
                              if (items.length === 0) return null;
                              return (
                                <div key={sev}>
                                  <div className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{
                                    color: sev === 'critical' ? 'var(--color-accent-red)' :
                                           sev === 'high' ? 'var(--color-accent-orange)' :
                                           sev === 'medium' ? 'var(--color-accent-amber)' :
                                           'var(--color-slate-500)',
                                  }}>
                                    {sev} ({items.length})
                                  </div>
                                  {items.map(finding => (
                                    <div
                                      key={finding.id}
                                      className={`p-3 rounded-lg border mb-1.5 ${
                                        sev === 'critical' ? 'border-accent-red/30 bg-accent-red/5' :
                                        sev === 'high' ? 'border-accent-orange/30 bg-accent-orange/5' :
                                        sev === 'medium' ? 'border-accent-amber/30 bg-accent-amber/5' :
                                        'border-surface-600 bg-surface-700/30'
                                      }`}
                                    >
                                      <div className="flex items-start gap-2">
                                        <div className="flex-1 min-w-0">
                                          <div className="text-xs font-medium text-slate-200">
                                            {finding.title}
                                          </div>
                                          {finding.location && (
                                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                              {finding.location}
                                            </div>
                                          )}
                                          <p className="text-[11px] text-slate-400 mt-1">
                                            {finding.description}
                                          </p>
                                          {finding.recommendation && (
                                            <p className="text-[11px] text-accent-cyan mt-1">
                                              {finding.recommendation}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Trend details */}
                      {run.trend && (
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          <span>Previous score: {run.trend.previousScore.toFixed(1)}</span>
                          <span>Current: {run.trend.currentScore.toFixed(1)}</span>
                          {run.trend.newFindings.length > 0 && (
                            <span className="text-accent-red">+{run.trend.newFindings.length} new</span>
                          )}
                          {run.trend.resolvedFindings.length > 0 && (
                            <span className="text-accent-green">{run.trend.resolvedFindings.length} resolved</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

/** Compute aggregate statistics from completed report runs */
function computeReportStats(runs: AuditRunEntry[]) {
  let totalScore = 0;
  let totalFindings = 0;
  let criticalFindings = 0;
  let highFindings = 0;
  let improvingCount = 0;
  let decliningCount = 0;
  let stableCount = 0;
  // Score buckets 0-10 (index = integer score)
  const scoreBuckets = new Array(11).fill(0);
  const attentionRunIds = new Set<string>();

  for (const run of runs) {
    const report = run.structuredReport!;
    totalScore += report.overallScore;
    totalFindings += report.findings.length;

    const sev = run.severityCounts || report.severityCounts;
    if (sev) {
      criticalFindings += sev.critical;
      highFindings += sev.high;
    }

    if (run.trend) {
      if (run.trend.direction === 'improving') improvingCount++;
      else if (run.trend.direction === 'declining') decliningCount++;
      else stableCount++;
    }

    const bucketIdx = Math.min(10, Math.max(0, Math.floor(report.overallScore)));
    scoreBuckets[bucketIdx]++;

    // Flag for attention: score < 5, or has critical/high findings
    const hasCriticalOrHigh = (sev?.critical || 0) > 0 || (sev?.high || 0) > 0;
    if (report.overallScore < 5 || hasCriticalOrHigh) {
      attentionRunIds.add(run.id);
    }
  }

  return {
    avgScore: runs.length > 0 ? totalScore / runs.length : 0,
    totalFindings,
    criticalFindings,
    highFindings,
    needsAttention: attentionRunIds.size,
    improvingCount,
    decliningCount,
    stableCount,
    scoreBuckets,
    attentionRunIds,
  };
}

/** Small circular score indicator */
function ScoreRing({ score }: { score: number }) {
  const color = score >= 8 ? 'text-accent-green' : score >= 5 ? 'text-accent-amber' : 'text-accent-red';
  const bgColor = score >= 8 ? 'border-accent-green/30' : score >= 5 ? 'border-accent-amber/30' : 'border-accent-red/30';
  return (
    <div className={`w-10 h-10 rounded-full border-2 ${bgColor} flex items-center justify-center`}>
      <span className={`text-sm font-bold ${color}`}>{score.toFixed(1)}</span>
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
  collapsible = false,
  defaultCollapsed = false,
  summary,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  summary?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="bg-surface-800 rounded-xl border border-surface-600 p-5">
      <h2
        className={`text-sm font-semibold text-slate-200 flex items-center gap-2 ${
          collapsible ? 'cursor-pointer select-none' : 'mb-4'
        } ${collapsible && !collapsed ? 'mb-4' : ''}`}
        onClick={collapsible ? () => setCollapsed(c => !c) : undefined}
      >
        {icon}
        {title}
        {collapsible && (
          <>
            <span className="flex-1" />
            {collapsed && summary && <span className="text-xs font-normal text-slate-500">{summary}</span>}
            {collapsed
              ? <ChevronDown className="w-4 h-4 text-slate-500" />
              : <ChevronUp className="w-4 h-4 text-slate-500" />}
          </>
        )}
      </h2>
      {!collapsed && children}
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

// Usage thresholds for flagging extreme runs
const USAGE_THRESHOLDS = {
  turns: 40,
  toolCalls: 60,
  inputTokens: 3_000_000,
  durationMs: 10 * 60_000, // 10 min
};

function isExtremeUsage(run: DispatcherRunSummary): boolean {
  return (
    (run.turns ?? 0) >= USAGE_THRESHOLDS.turns ||
    (run.toolCalls ?? 0) >= USAGE_THRESHOLDS.toolCalls ||
    (run.inputTokens ?? 0) >= USAGE_THRESHOLDS.inputTokens ||
    (run.durationMs ?? 0) >= USAGE_THRESHOLDS.durationMs
  );
}

function UsageCell({ value, threshold, format }: { value?: number; threshold: number; format?: (v: number) => string }) {
  if (value == null) return <span className="text-slate-400">-</span>;
  const over = value >= threshold;
  const formatted = format ? format(value) : String(value);
  return (
    <span className={over ? 'text-accent-red font-medium' : 'text-slate-400'}>
      {formatted}{over && ' !'}
    </span>
  );
}

function RunTable({ runs }: { runs: DispatcherRunSummary[] }) {
  const extremeRuns = runs.filter(isExtremeUsage);

  return (
    <div>
      {extremeRuns.length > 0 && (
        <div className="mb-3 bg-accent-red/5 border border-accent-red/20 rounded px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-accent-red font-medium mb-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {extremeRuns.length} run{extremeRuns.length > 1 ? 's' : ''} with extreme usage
          </div>
          <div className="text-[10px] text-slate-500">
            Thresholds: {'>='}{USAGE_THRESHOLDS.turns} turns, {'>='}{USAGE_THRESHOLDS.toolCalls} tools, {'>='}{formatTokenCount(USAGE_THRESHOLDS.inputTokens)} input tokens, {'>='}{formatDuration(USAGE_THRESHOLDS.durationMs)}
          </div>
        </div>
      )}
      <div className="overflow-auto max-h-64">
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
            {runs.map(run => {
              const extreme = isExtremeUsage(run);
              return (
                <tr key={run.ticketId} className={`border-b border-surface-700/50 hover:bg-surface-700/30 ${extreme ? 'bg-accent-red/5' : ''}`}>
                  <td className="py-2 pr-3 text-slate-300 max-w-[200px] truncate" title={run.subject}>
                    {extreme && <AlertTriangle className="w-3 h-3 text-accent-red inline mr-1" />}
                    {run.subject}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="py-2 pr-3 text-slate-400">
                    {run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 pr-3">
                    <UsageCell value={run.durationMs} threshold={USAGE_THRESHOLDS.durationMs} format={formatDuration} />
                  </td>
                  <td className="py-2 pr-3">
                    <UsageCell value={run.turns} threshold={USAGE_THRESHOLDS.turns} />
                  </td>
                  <td className="py-2 pr-3">
                    <UsageCell value={run.toolCalls} threshold={USAGE_THRESHOLDS.toolCalls} />
                  </td>
                  <td className="py-2 pr-3">
                    {run.inputTokens || run.outputTokens ? (
                      <UsageCell
                        value={run.inputTokens}
                        threshold={USAGE_THRESHOLDS.inputTokens}
                        format={v => `${formatTokenCount(v)}/${formatTokenCount(run.outputTokens || 0)}`}
                      />
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Auditor Review Table ────────────────────────────────────────

function AuditorTable({ reviews }: { reviews: AuditorReviewSummary[] }) {
  return (
    <div className="overflow-auto max-h-64">
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
    <div className="overflow-auto max-h-64">
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
    on_hold: 'orange',
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
