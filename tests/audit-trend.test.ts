import { describe, it, expect } from 'vitest';
import { computeTrend } from '../server/audit-trend.ts';
import type { AuditReport } from '../src/types.ts';

function makeReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    overallScore: 7,
    overallVerdict: 'Good',
    summary: 'Test report',
    rubric: [],
    findings: [],
    severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    generatedAt: Date.now(),
    ...overrides,
  };
}

describe('computeTrend', () => {
  it('detects improving trend (delta > 0.5)', () => {
    const prev = makeReport({ overallScore: 5 });
    const curr = makeReport({ overallScore: 7 });
    const trend = computeTrend(curr, prev, 'run-1');
    expect(trend.direction).toBe('improving');
    expect(trend.delta).toBe(2);
    expect(trend.previousScore).toBe(5);
    expect(trend.currentScore).toBe(7);
    expect(trend.previousRunId).toBe('run-1');
  });

  it('detects declining trend (delta < -0.5)', () => {
    const prev = makeReport({ overallScore: 8 });
    const curr = makeReport({ overallScore: 6 });
    const trend = computeTrend(curr, prev, 'run-2');
    expect(trend.direction).toBe('declining');
    expect(trend.delta).toBe(-2);
  });

  it('detects stable trend (|delta| <= 0.5)', () => {
    const prev = makeReport({ overallScore: 7 });
    const curr = makeReport({ overallScore: 7.3 });
    const trend = computeTrend(curr, prev, 'run-3');
    expect(trend.direction).toBe('stable');
  });

  it('tracks new, resolved, and recurring findings', () => {
    const prev = makeReport({
      findings: [
        { id: 'f1', severity: 'high', aspect: 'A', title: 'T1', description: 'D1' },
        { id: 'f2', severity: 'low', aspect: 'B', title: 'T2', description: 'D2' },
      ],
    });
    const curr = makeReport({
      findings: [
        { id: 'f2', severity: 'low', aspect: 'B', title: 'T2', description: 'D2' },
        { id: 'f3', severity: 'medium', aspect: 'C', title: 'T3', description: 'D3' },
      ],
    });
    const trend = computeTrend(curr, prev, 'run-4');
    expect(trend.newFindings).toEqual(['f3']);
    expect(trend.resolvedFindings).toEqual(['f1']);
    expect(trend.recurringFindings).toEqual(['f2']);
  });

  it('computes per-aspect score deltas', () => {
    const prev = makeReport({
      rubric: [
        { aspect: 'Quality', score: 6, rating: 'concern', summary: '', findingCount: 0 },
        { aspect: 'Security', score: 8, rating: 'pass', summary: '', findingCount: 0 },
      ],
    });
    const curr = makeReport({
      rubric: [
        { aspect: 'Quality', score: 9, rating: 'pass', summary: '', findingCount: 0 },
        { aspect: 'Security', score: 5, rating: 'concern', summary: '', findingCount: 0 },
      ],
    });
    const trend = computeTrend(curr, prev, 'run-5');
    expect(trend.aspectDeltas).toEqual([
      { aspect: 'Quality', currentScore: 9, previousScore: 6, delta: 3 },
      { aspect: 'Security', currentScore: 5, previousScore: 8, delta: -3 },
    ]);
  });

  it('handles new aspects (not in previous run)', () => {
    const prev = makeReport({ rubric: [] });
    const curr = makeReport({
      rubric: [
        { aspect: 'NewAspect', score: 7, rating: 'concern', summary: '', findingCount: 0 },
      ],
    });
    const trend = computeTrend(curr, prev, 'run-6');
    expect(trend.aspectDeltas[0].previousScore).toBe(0);
    expect(trend.aspectDeltas[0].delta).toBe(7);
  });
});
