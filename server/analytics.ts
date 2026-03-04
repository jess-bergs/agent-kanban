import { listTickets } from './store.ts';
import { listRuns } from './audit-store.ts';
import { getWatchlistStatus } from './auditor.ts';
import type {
  Ticket,
  TicketStatus,
  AuditRun,
  AuditRunStatus,
  FindingSeverity,
  SeverityCounts,
} from '../src/types.ts';
import type { WatchlistEntry } from './auditor.ts';

// ─── Dispatcher Analytics ────────────────────────────────────────

export interface DispatcherStats {
  /** Tickets grouped by current status */
  byStatus: Record<TicketStatus, number>;
  /** Total cost across all tickets */
  totalCostUsd: number;
  /** Total tokens (input + output) */
  totalTokens: number;
  /** Average duration for completed tickets (ms) */
  avgDurationMs: number;
  /** Recent completed tickets (last 20) sorted newest-first */
  recentRuns: DispatcherRunSummary[];
  /** Failure breakdown by reason type */
  failureBreakdown: Record<string, number>;
  /** Total tickets ever dispatched (had a startedAt) */
  totalDispatched: number;
  /** Currently running */
  currentlyRunning: number;
}

export interface DispatcherRunSummary {
  ticketId: string;
  subject: string;
  projectId: string;
  status: TicketStatus;
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

// ─── Auditor Analytics ───────────────────────────────────────────

export interface AuditorStats {
  /** Total PRs watched (ever) */
  totalWatched: number;
  /** Currently active watchlist entries */
  activeWatchCount: number;
  /** Total reviews performed across all entries */
  totalReviews: number;
  /** Verdict breakdown (approve/request_changes/comment) */
  verdictBreakdown: Record<string, number>;
  /** Recent reviews (from watchlist, last 20) */
  recentReviews: AuditorReviewSummary[];
}

export interface AuditorReviewSummary {
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

// ─── Scheduler Analytics ─────────────────────────────────────────

export interface SchedulerStats {
  /** Runs grouped by status */
  byStatus: Record<AuditRunStatus, number>;
  /** Total completed runs */
  totalCompleted: number;
  /** Total failed runs */
  totalFailed: number;
  /** Recent runs (last 30) sorted newest-first */
  recentRuns: SchedulerRunSummary[];
  /** Aggregate severity counts across latest completed runs */
  aggregateSeverity: SeverityCounts;
}

export interface SchedulerRunSummary {
  runId: string;
  scheduleId: string;
  projectId: string;
  mode: string;
  status: AuditRunStatus;
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

// ─── Issues / Errors ─────────────────────────────────────────────

export interface IssueEntry {
  source: 'dispatcher' | 'auditor' | 'scheduler';
  id: string;
  summary: string;
  detail?: string;
  severity: 'error' | 'warning' | 'info';
  timestamp: number;
  /** For dispatcher extreme-usage issues, links to a specific run */
  linkedRunTicketId?: string;
}

// Usage thresholds for flagging extreme runs (mirrored in frontend)
const USAGE_THRESHOLDS = {
  turns: 40,
  toolCalls: 60,
  inputTokens: 3_000_000,
  durationMs: 10 * 60_000, // 10 min
};

// ─── Combined Response ──────────────────────────────────────────

export interface AnalyticsPayload {
  dispatcher: DispatcherStats;
  auditor: AuditorStats;
  scheduler: SchedulerStats;
  issues: IssueEntry[];
  /** Metadata gaps we've detected */
  coverageGaps: string[];
  generatedAt: number;
}

// ─── Build ──────────────────────────────────────────────────────

export async function buildAnalytics(): Promise<AnalyticsPayload> {
  const [tickets, auditRuns, watchlist] = await Promise.all([
    listTickets(),
    listRuns(),
    Promise.resolve(getWatchlistStatus() as WatchlistEntry[]),
  ]);

  const dispatcher = buildDispatcherStats(tickets);
  const auditor = buildAuditorStats(watchlist);
  const scheduler = buildSchedulerStats(auditRuns);
  const issues = buildIssues(tickets, auditRuns, watchlist);
  const coverageGaps = detectCoverageGaps(tickets, auditRuns, watchlist);

  return {
    dispatcher,
    auditor,
    scheduler,
    issues,
    coverageGaps,
    generatedAt: Date.now(),
  };
}

function buildDispatcherStats(tickets: Ticket[]): DispatcherStats {
  const byStatus = {} as Record<TicketStatus, number>;
  const statuses: TicketStatus[] = ['todo', 'in_progress', 'needs_approval', 'in_review', 'on_hold', 'done', 'merged', 'failed', 'error'];
  for (const s of statuses) byStatus[s] = 0;

  let totalCostUsd = 0;
  let totalTokens = 0;
  let totalDurationMs = 0;
  let durationCount = 0;
  const failureBreakdown: Record<string, number> = {};
  let totalDispatched = 0;
  let currentlyRunning = 0;

  const runs: DispatcherRunSummary[] = [];

  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;

    if (t.effort?.costUsd) totalCostUsd += t.effort.costUsd;
    if (t.effort?.inputTokens) totalTokens += t.effort.inputTokens;
    if (t.effort?.outputTokens) totalTokens += t.effort.outputTokens;

    if (t.startedAt) {
      totalDispatched++;
      if (t.effort?.durationMs) {
        totalDurationMs += t.effort.durationMs;
        durationCount++;
      }
    }

    if (t.status === 'in_progress' || t.status === 'needs_approval') {
      currentlyRunning++;
    }

    if (t.status === 'failed' || t.status === 'error') {
      const reason = t.failureReason?.type || 'unknown';
      failureBreakdown[reason] = (failureBreakdown[reason] || 0) + 1;
    }

    // Include tickets that have been dispatched (have startedAt)
    if (t.startedAt) {
      runs.push({
        ticketId: t.id,
        subject: t.subject,
        projectId: t.projectId,
        status: t.status,
        costUsd: t.effort?.costUsd,
        durationMs: t.effort?.durationMs,
        turns: t.effort?.turns,
        toolCalls: t.effort?.toolCalls,
        inputTokens: t.effort?.inputTokens,
        outputTokens: t.effort?.outputTokens,
        prUrl: t.prUrl,
        error: t.error,
        failureType: t.failureReason?.type,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
      });
    }
  }

  runs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

  return {
    byStatus,
    totalCostUsd,
    totalTokens,
    avgDurationMs: durationCount > 0 ? totalDurationMs / durationCount : 0,
    recentRuns: runs.slice(0, 20),
    failureBreakdown,
    totalDispatched,
    currentlyRunning,
  };
}

function buildAuditorStats(watchlist: WatchlistEntry[]): AuditorStats {
  let totalReviews = 0;
  const verdictBreakdown: Record<string, number> = {};
  const reviews: AuditorReviewSummary[] = [];

  for (const entry of watchlist) {
    totalReviews += entry.reviewCount;

    if (entry.lastResult) {
      const verdict = entry.lastResult.overallVerdict;
      verdictBreakdown[verdict] = (verdictBreakdown[verdict] || 0) + 1;
    }

    reviews.push({
      prUrl: entry.prUrl,
      repo: entry.repo,
      prNumber: entry.prNumber,
      ticketId: entry.ticketId,
      reviewCount: entry.reviewCount,
      lastVerdict: entry.lastResult?.overallVerdict,
      lastReviewedAt: entry.lastResult?.reviewedAt,
      resolved: entry.resolved,
      rubricSummary: entry.lastResult?.rubric.map(r => ({
        aspect: r.aspect,
        rating: r.rating,
      })),
    });
  }

  reviews.sort((a, b) => (b.lastReviewedAt || 0) - (a.lastReviewedAt || 0));

  return {
    totalWatched: watchlist.length,
    activeWatchCount: watchlist.filter(w => !w.resolved).length,
    totalReviews,
    verdictBreakdown,
    recentReviews: reviews.slice(0, 20),
  };
}

function buildSchedulerStats(runs: AuditRun[]): SchedulerStats {
  const byStatus = { pending: 0, running: 0, completed: 0, failed: 0 } as Record<AuditRunStatus, number>;
  const aggregateSeverity: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  const summaries: SchedulerRunSummary[] = [];

  for (const r of runs) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;

    if (r.status === 'completed' && r.severityCounts) {
      for (const sev of ['critical', 'high', 'medium', 'low', 'info'] as FindingSeverity[]) {
        aggregateSeverity[sev] += r.severityCounts[sev] || 0;
      }
    }

    const durationMs = r.completedAt && r.startedAt
      ? r.completedAt - r.startedAt
      : undefined;

    summaries.push({
      runId: r.id,
      scheduleId: r.scheduleId,
      projectId: r.projectId,
      mode: r.mode,
      status: r.status,
      overallScore: r.structuredReport?.overallScore,
      overallVerdict: r.structuredReport?.overallVerdict,
      severityCounts: r.severityCounts,
      trendDirection: r.trend?.direction,
      trendDelta: r.trend?.delta,
      error: r.error,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      durationMs,
    });
  }

  summaries.sort((a, b) => b.startedAt - a.startedAt);

  return {
    byStatus,
    totalCompleted: byStatus.completed,
    totalFailed: byStatus.failed,
    recentRuns: summaries.slice(0, 30),
    aggregateSeverity,
  };
}

function buildIssues(
  tickets: Ticket[],
  auditRuns: AuditRun[],
  watchlist: WatchlistEntry[],
): IssueEntry[] {
  const issues: IssueEntry[] = [];

  // Failed/errored tickets
  for (const t of tickets) {
    if (t.status === 'failed' || t.status === 'error') {
      issues.push({
        source: 'dispatcher',
        id: t.id,
        summary: `Ticket "${t.subject}" ${t.status}`,
        detail: t.error || t.failureReason?.type,
        severity: 'error',
        timestamp: t.completedAt || t.createdAt,
      });
    }
    if (t.status === 'on_hold') {
      issues.push({
        source: 'dispatcher',
        id: t.id,
        summary: `Ticket "${t.subject}" on hold (usage limit)`,
        detail: t.error || 'Usage limit reached',
        severity: 'warning',
        timestamp: t.completedAt || t.createdAt,
      });
    }
    if (t.hasConflict) {
      issues.push({
        source: 'dispatcher',
        id: t.id,
        summary: `PR conflict on "${t.subject}"`,
        detail: t.prUrl,
        severity: 'warning',
        timestamp: t.conflictDetectedAt || Date.now(),
      });
    }

    // Extreme usage detection
    if (t.startedAt && t.effort) {
      const exceeded: string[] = [];
      if ((t.effort.turns ?? 0) >= USAGE_THRESHOLDS.turns)
        exceeded.push(`${t.effort.turns} turns`);
      if ((t.effort.toolCalls ?? 0) >= USAGE_THRESHOLDS.toolCalls)
        exceeded.push(`${t.effort.toolCalls} tool calls`);
      if ((t.effort.inputTokens ?? 0) >= USAGE_THRESHOLDS.inputTokens)
        exceeded.push(`${Math.round((t.effort.inputTokens ?? 0) / 1_000_000)}M input tokens`);
      if ((t.effort.durationMs ?? 0) >= USAGE_THRESHOLDS.durationMs)
        exceeded.push(`${Math.round((t.effort.durationMs ?? 0) / 60_000)}min duration`);

      if (exceeded.length > 0) {
        issues.push({
          source: 'dispatcher',
          id: `extreme-${t.id}`,
          summary: `Extreme usage on "${t.subject}"`,
          detail: exceeded.join(', '),
          severity: 'warning',
          timestamp: t.completedAt || t.startedAt,
          linkedRunTicketId: t.id,
        });
      }
    }
  }

  // Failed audit runs
  for (const r of auditRuns) {
    if (r.status === 'failed') {
      issues.push({
        source: 'scheduler',
        id: r.id,
        summary: `Audit run failed (schedule ${r.scheduleId.slice(0, 8)})`,
        detail: r.error,
        severity: 'error',
        timestamp: r.completedAt || r.startedAt,
      });
    }
  }

  // Auditor entries with request_changes verdict
  for (const w of watchlist) {
    if (w.lastResult?.overallVerdict === 'request_changes') {
      issues.push({
        source: 'auditor',
        id: `${w.repo}#${w.prNumber}`,
        summary: `PR #${w.prNumber} needs changes (${w.repo})`,
        detail: w.lastResult.summary,
        severity: 'warning',
        timestamp: w.lastResult.reviewedAt,
      });
    }
  }

  // Sort newest first
  issues.sort((a, b) => b.timestamp - a.timestamp);
  return issues;
}

function detectCoverageGaps(
  tickets: Ticket[],
  auditRuns: AuditRun[],
  watchlist: WatchlistEntry[],
): string[] {
  const gaps: string[] = [];

  // Check ticket effort coverage
  const dispatched = tickets.filter(t => t.startedAt);
  const withCost = dispatched.filter(t => t.effort?.costUsd);
  const withTokens = dispatched.filter(t => t.effort?.inputTokens);
  const withStateLog = dispatched.filter(t => t.stateLog && t.stateLog.length > 0);

  if (dispatched.length > 0 && withCost.length < dispatched.length * 0.5) {
    gaps.push(`Effort cost: only ${withCost.length}/${dispatched.length} dispatched tickets have cost data`);
  }
  if (dispatched.length > 0 && withTokens.length < dispatched.length * 0.5) {
    gaps.push(`Token usage: only ${withTokens.length}/${dispatched.length} dispatched tickets have token data`);
  }
  if (dispatched.length > 0 && withStateLog.length < dispatched.length * 0.5) {
    gaps.push(`State log: only ${withStateLog.length}/${dispatched.length} dispatched tickets have state transition logs`);
  }

  // Check failure classification coverage
  const failed = tickets.filter(t => t.status === 'failed' || t.status === 'error');
  const withReason = failed.filter(t => t.failureReason);
  if (failed.length > 0 && withReason.length < failed.length) {
    gaps.push(`Failure classification: only ${withReason.length}/${failed.length} failed tickets have structured failure reasons`);
  }

  // Auditor: only lastResult is kept, no history
  const reviewed = watchlist.filter(w => w.reviewCount > 1);
  if (reviewed.length > 0) {
    gaps.push(`Auditor review history: ${reviewed.length} entries have multiple reviews but only the latest result is stored (no historical rubric data)`);
  }

  // Audit runs: check for structured reports
  const completedRuns = auditRuns.filter(r => r.status === 'completed');
  const withStructured = completedRuns.filter(r => r.structuredReport);
  if (completedRuns.length > 0 && withStructured.length < completedRuns.length) {
    gaps.push(`Structured reports: only ${withStructured.length}/${completedRuns.length} completed audit runs have parsed structured reports`);
  }

  // Agent activity is a ring buffer - mention that full history is lost
  const withActivity = dispatched.filter(t => t.agentActivity && t.agentActivity.length > 0);
  if (dispatched.length > 0) {
    gaps.push(`Agent activity: ring buffer (max 20 entries per ticket) - full tool call history is not persisted. Currently ${withActivity.length}/${dispatched.length} have activity data`);
  }

  return gaps;
}
