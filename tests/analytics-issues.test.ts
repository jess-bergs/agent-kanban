import { describe, it, expect } from 'vitest';
import { buildIssues } from '../server/analytics.ts';
import type { Ticket } from '../src/types.ts';

/** Minimal ticket factory — only fields needed by buildIssues */
function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'test-ticket-1',
    projectId: 'proj-1',
    subject: 'Test ticket',
    instructions: '',
    status: 'done',
    createdAt: Date.now() - 60_000,
    ...overrides,
  };
}

describe('buildIssues — extreme usage detection', () => {
  it('creates no extreme-usage issue for a ticket below all thresholds', () => {
    const ticket = makeTicket({
      startedAt: Date.now() - 30_000,
      completedAt: Date.now(),
      effort: { turns: 10, toolCalls: 15, inputTokens: 500_000, durationMs: 120_000 },
    });
    const issues = buildIssues([ticket], [], []);
    const extreme = issues.filter(i => i.id.startsWith('extreme-'));
    expect(extreme).toHaveLength(0);
  });

  it('creates an issue when turns exceed threshold (>=40)', () => {
    const ticket = makeTicket({
      startedAt: Date.now() - 30_000,
      completedAt: Date.now(),
      effort: { turns: 45, toolCalls: 10, inputTokens: 100_000, durationMs: 60_000 },
    });
    const issues = buildIssues([ticket], [], []);
    const extreme = issues.filter(i => i.id.startsWith('extreme-'));
    expect(extreme).toHaveLength(1);
    expect(extreme[0].summary).toContain('Extreme usage');
    expect(extreme[0].detail).toContain('45 turns');
    expect(extreme[0].severity).toBe('warning');
    expect(extreme[0].source).toBe('dispatcher');
    expect(extreme[0].linkedRunTicketId).toBe('test-ticket-1');
  });

  it('creates an issue when toolCalls exceed threshold (>=60)', () => {
    const ticket = makeTicket({
      startedAt: Date.now() - 30_000,
      effort: { turns: 5, toolCalls: 75, inputTokens: 100_000, durationMs: 60_000 },
    });
    const issues = buildIssues([ticket], [], []);
    const extreme = issues.filter(i => i.id.startsWith('extreme-'));
    expect(extreme).toHaveLength(1);
    expect(extreme[0].detail).toContain('75 tool calls');
  });

  it('creates an issue when inputTokens exceed threshold (>=3M)', () => {
    const ticket = makeTicket({
      startedAt: Date.now() - 30_000,
      effort: { turns: 5, toolCalls: 10, inputTokens: 4_500_000, durationMs: 60_000 },
    });
    const issues = buildIssues([ticket], [], []);
    const extreme = issues.filter(i => i.id.startsWith('extreme-'));
    expect(extreme).toHaveLength(1);
    expect(extreme[0].detail).toContain('5M input tokens');
  });

  it('creates an issue when durationMs exceeds threshold (>=10min)', () => {
    const ticket = makeTicket({
      startedAt: Date.now() - 30_000,
      effort: { turns: 5, toolCalls: 10, inputTokens: 100_000, durationMs: 15 * 60_000 },
    });
    const issues = buildIssues([ticket], [], []);
    const extreme = issues.filter(i => i.id.startsWith('extreme-'));
    expect(extreme).toHaveLength(1);
    expect(extreme[0].detail).toContain('15min duration');
  });

  it('lists all exceeded thresholds in detail when multiple are breached', () => {
    const ticket = makeTicket({
      startedAt: Date.now() - 30_000,
      effort: { turns: 50, toolCalls: 80, inputTokens: 5_000_000, durationMs: 20 * 60_000 },
    });
    const issues = buildIssues([ticket], [], []);
    const extreme = issues.filter(i => i.id.startsWith('extreme-'));
    expect(extreme).toHaveLength(1);
    expect(extreme[0].detail).toContain('50 turns');
    expect(extreme[0].detail).toContain('80 tool calls');
    expect(extreme[0].detail).toContain('5M input tokens');
    expect(extreme[0].detail).toContain('20min duration');
  });

  it('skips extreme-usage check when ticket has no startedAt', () => {
    const ticket = makeTicket({
      // no startedAt
      effort: { turns: 50, toolCalls: 80 },
    });
    const issues = buildIssues([ticket], [], []);
    const extreme = issues.filter(i => i.id.startsWith('extreme-'));
    expect(extreme).toHaveLength(0);
  });

  it('skips extreme-usage check when ticket has no effort', () => {
    const ticket = makeTicket({
      startedAt: Date.now() - 30_000,
      // no effort
    });
    const issues = buildIssues([ticket], [], []);
    const extreme = issues.filter(i => i.id.startsWith('extreme-'));
    expect(extreme).toHaveLength(0);
  });

  it('uses completedAt as timestamp when available, startedAt as fallback', () => {
    const completedAt = Date.now() - 5_000;
    const startedAt = Date.now() - 60_000;

    const withCompleted = makeTicket({
      startedAt,
      completedAt,
      effort: { turns: 50, toolCalls: 10 },
    });
    const issuesA = buildIssues([withCompleted], [], []);
    expect(issuesA.find(i => i.id.startsWith('extreme-'))!.timestamp).toBe(completedAt);

    const withoutCompleted = makeTicket({
      startedAt,
      // no completedAt
      effort: { turns: 50, toolCalls: 10 },
    });
    const issuesB = buildIssues([withoutCompleted], [], []);
    expect(issuesB.find(i => i.id.startsWith('extreme-'))!.timestamp).toBe(startedAt);
  });

  it('handles exact threshold values as extreme (boundary test)', () => {
    const ticket = makeTicket({
      startedAt: Date.now() - 30_000,
      effort: { turns: 40, toolCalls: 60, inputTokens: 3_000_000, durationMs: 10 * 60_000 },
    });
    const issues = buildIssues([ticket], [], []);
    const extreme = issues.filter(i => i.id.startsWith('extreme-'));
    expect(extreme).toHaveLength(1);
    // All four thresholds are at exact boundary
    expect(extreme[0].detail).toContain('40 turns');
    expect(extreme[0].detail).toContain('60 tool calls');
    expect(extreme[0].detail).toContain('3M input tokens');
    expect(extreme[0].detail).toContain('10min duration');
  });

  it('does not create extreme issue for values just below thresholds', () => {
    const ticket = makeTicket({
      startedAt: Date.now() - 30_000,
      effort: { turns: 39, toolCalls: 59, inputTokens: 2_999_999, durationMs: 9 * 60_000 + 59_999 },
    });
    const issues = buildIssues([ticket], [], []);
    const extreme = issues.filter(i => i.id.startsWith('extreme-'));
    expect(extreme).toHaveLength(0);
  });
});
