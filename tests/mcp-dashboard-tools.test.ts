import { describe, it, expect } from 'vitest';
import { filterAuditReports } from '../server/mcp.ts';
import type { AuditRun, AuditReport, SeverityCounts } from '../src/types.ts';

function makeSeverityCounts(overrides: Partial<SeverityCounts> = {}): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0, ...overrides };
}

function makeReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    overallScore: 7,
    overallVerdict: 'Good',
    summary: 'Test report',
    rubric: [],
    findings: [],
    severityCounts: makeSeverityCounts(),
    generatedAt: Date.now(),
    ...overrides,
  };
}

function makeRun(overrides: Partial<AuditRun> = {}): AuditRun {
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    scheduleId: 'sched-1',
    projectId: 'proj-1',
    mode: 'report',
    status: 'completed',
    structuredReport: makeReport(),
    severityCounts: makeSeverityCounts(),
    startedAt: Date.now(),
    completedAt: Date.now() + 1000,
    ...overrides,
  };
}

describe('filterAuditReports', () => {
  it('returns completed runs with structured reports', () => {
    const runs = [
      makeRun({ id: 'run-1' }),
      makeRun({ id: 'run-2', status: 'failed', structuredReport: undefined }),
      makeRun({ id: 'run-3', status: 'running', structuredReport: undefined }),
      makeRun({ id: 'run-4', status: 'completed', structuredReport: undefined }),
    ];

    const reports = filterAuditReports(runs, {});
    expect(reports).toHaveLength(1);
    expect(reports[0].runId).toBe('run-1');
  });

  it('sorts by startedAt descending (newest first)', () => {
    const runs = [
      makeRun({ id: 'run-old', startedAt: 1000 }),
      makeRun({ id: 'run-mid', startedAt: 2000 }),
      makeRun({ id: 'run-new', startedAt: 3000 }),
    ];

    const reports = filterAuditReports(runs, {});
    expect(reports.map(r => r.runId)).toEqual(['run-new', 'run-mid', 'run-old']);
  });

  it('filters by projectId', () => {
    const runs = [
      makeRun({ id: 'run-a', projectId: 'proj-1' }),
      makeRun({ id: 'run-b', projectId: 'proj-2' }),
      makeRun({ id: 'run-c', projectId: 'proj-1' }),
    ];

    const reports = filterAuditReports(runs, { projectId: 'proj-1' });
    expect(reports).toHaveLength(2);
    expect(reports.every(r => r.projectId === 'proj-1')).toBe(true);
  });

  it('applies limit', () => {
    const runs = Array.from({ length: 20 }, (_, i) =>
      makeRun({ id: `run-${i}`, startedAt: i * 1000 }),
    );

    const reports = filterAuditReports(runs, { limit: 5 });
    expect(reports).toHaveLength(5);
  });

  it('defaults to 10 results when no limit given', () => {
    const runs = Array.from({ length: 15 }, (_, i) =>
      makeRun({ id: `run-${i}`, startedAt: i * 1000 }),
    );

    const reports = filterAuditReports(runs, {});
    expect(reports).toHaveLength(10);
  });

  it('maps structured report fields correctly', () => {
    const report = makeReport({
      overallScore: 8.5,
      overallVerdict: 'SOUND',
      summary: 'All good',
      findings: [
        { id: 'f1', severity: 'high', aspect: 'Security', title: 'Issue', description: 'Desc' },
      ],
      rubric: [
        { aspect: 'Security', score: 8, rating: 'pass', summary: 'OK', findingCount: 1 },
      ],
    });
    const trend = {
      previousRunId: 'run-prev',
      previousScore: 6,
      currentScore: 8.5,
      delta: 2.5,
      direction: 'improving' as const,
      newFindings: ['f1'],
      resolvedFindings: [],
      recurringFindings: [],
      aspectDeltas: [],
    };
    const runs = [
      makeRun({
        id: 'run-mapped',
        scheduleId: 'sched-x',
        projectId: 'proj-y',
        structuredReport: report,
        severityCounts: makeSeverityCounts({ high: 1 }),
        trend,
        startedAt: 5000,
        completedAt: 6000,
      }),
    ];

    const [result] = filterAuditReports(runs, {});
    expect(result).toEqual({
      runId: 'run-mapped',
      scheduleId: 'sched-x',
      projectId: 'proj-y',
      overallScore: 8.5,
      overallVerdict: 'SOUND',
      summary: 'All good',
      severityCounts: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
      rubric: report.rubric,
      findings: report.findings,
      trend,
      startedAt: 5000,
      completedAt: 6000,
    });
  });

  it('combines projectId filter with limit', () => {
    const runs = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeRun({ id: `proj1-${i}`, projectId: 'proj-1', startedAt: i * 1000 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeRun({ id: `proj2-${i}`, projectId: 'proj-2', startedAt: i * 1000 }),
      ),
    ];

    const reports = filterAuditReports(runs, { projectId: 'proj-1', limit: 3 });
    expect(reports).toHaveLength(3);
    expect(reports.every(r => r.projectId === 'proj-1')).toBe(true);
  });

  it('returns empty array when no runs match', () => {
    const runs = [
      makeRun({ status: 'failed', structuredReport: undefined }),
    ];

    const reports = filterAuditReports(runs, {});
    expect(reports).toEqual([]);
  });
});
