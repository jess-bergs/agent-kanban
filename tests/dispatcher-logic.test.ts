import { describe, it, expect } from 'vitest';
import { detectUsageLimit, MAX_AUTO_RETRIES, RETRY_WAIT_MS, countOrphanRecoveries } from '../server/dispatcher.ts';
import type { Ticket } from '../src/types.ts';

describe('detectUsageLimit', () => {
  it('returns null for empty text', () => {
    expect(detectUsageLimit('')).toBeNull();
  });

  it('returns null for normal error messages', () => {
    expect(detectUsageLimit('Error: file not found')).toBeNull();
    expect(detectUsageLimit('SyntaxError: unexpected token')).toBeNull();
    expect(detectUsageLimit('Connection refused')).toBeNull();
  });

  it('detects "rate limit" keyword', () => {
    const result = detectUsageLimit('Error: rate limit exceeded');
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(Date.now());
  });

  it('detects "usage limit" keyword', () => {
    const result = detectUsageLimit("You've exceeded your usage limit");
    expect(result).not.toBeNull();
  });

  it('detects "quota exceeded" keyword', () => {
    const result = detectUsageLimit('API quota exceeded, please wait');
    expect(result).not.toBeNull();
  });

  it('detects "too many requests" keyword', () => {
    const result = detectUsageLimit('429 Too Many Requests');
    expect(result).not.toBeNull();
  });

  it('detects "you\'ve hit your limit" keyword', () => {
    const result = detectUsageLimit("You've hit your limit · resets 3am");
    expect(result).not.toBeNull();
  });

  it('detects "resource_exhausted" keyword', () => {
    const result = detectUsageLimit('error: resource_exhausted');
    expect(result).not.toBeNull();
  });

  it('parses "resets in N minutes"', () => {
    const before = Date.now();
    const result = detectUsageLimit('Rate limit exceeded, resets in 30 minutes');
    expect(result).not.toBeNull();
    // Should be ~30 minutes from now
    const delta = result! - before;
    expect(delta).toBeGreaterThan(29 * 60_000);
    expect(delta).toBeLessThan(31 * 60_000);
  });

  it('parses "resets in N hours"', () => {
    const before = Date.now();
    const result = detectUsageLimit('Usage limit reached. Resets in 2 hours');
    expect(result).not.toBeNull();
    const delta = result! - before;
    expect(delta).toBeGreaterThan(1.9 * 3600_000);
    expect(delta).toBeLessThan(2.1 * 3600_000);
  });

  it('defaults to 1 hour for generic limit messages', () => {
    const before = Date.now();
    const result = detectUsageLimit('rate limit');
    expect(result).not.toBeNull();
    const delta = result! - before;
    expect(delta).toBeGreaterThan(59 * 60_000);
    expect(delta).toBeLessThan(61 * 60_000);
  });
});

describe('PR URL regex', () => {
  // Test the same regex used in dispatcher.ts for PR detection
  const prUrlRegex = /https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/;

  it('matches standard GitHub PR URLs', () => {
    const match = 'Created PR: https://github.com/user/repo/pull/42'.match(prUrlRegex);
    expect(match).not.toBeNull();
    expect(match![0]).toBe('https://github.com/user/repo/pull/42');
    expect(match![1]).toBe('42');
  });

  it('matches PR URLs with org/repo names containing hyphens', () => {
    const match = 'https://github.com/jess-bergs/agent-kanban/pull/105'.match(prUrlRegex);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('105');
  });

  it('does not match non-PR GitHub URLs', () => {
    expect('https://github.com/user/repo/issues/1'.match(prUrlRegex)).toBeNull();
    expect('https://github.com/user/repo'.match(prUrlRegex)).toBeNull();
  });

  it('extracts first PR URL from multi-line output', () => {
    const output = `
Working on the task...
Created https://github.com/org/repo/pull/99
Done!
    `;
    const match = output.match(prUrlRegex);
    expect(match![1]).toBe('99');
  });
});

describe('retry cooldown constants', () => {
  it('MAX_AUTO_RETRIES is 3', () => {
    expect(MAX_AUTO_RETRIES).toBe(3);
  });

  it('RETRY_WAIT_MS is 30 seconds', () => {
    expect(RETRY_WAIT_MS).toBe(30_000);
  });
});

describe('countOrphanRecoveries', () => {
  const baseTicket: Ticket = {
    id: 'test-1',
    projectId: 'proj-1',
    subject: 'Test ticket',
    body: '',
    status: 'todo',
    createdAt: Date.now(),
  };

  it('returns 0 for ticket with no stateLog', () => {
    expect(countOrphanRecoveries(baseTicket)).toBe(0);
  });

  it('returns 0 for ticket with unrelated state log entries', () => {
    expect(countOrphanRecoveries({
      ...baseTicket,
      stateLog: [
        { status: 'in_progress', timestamp: 1, reason: 'agent_started' },
        { status: 'failed', timestamp: 2, reason: 'agent_exit' },
      ],
    })).toBe(0);
  });

  it('counts orphan_recovery entries', () => {
    expect(countOrphanRecoveries({
      ...baseTicket,
      stateLog: [
        { status: 'todo', timestamp: 1, reason: 'orphan_recovery' },
        { status: 'in_progress', timestamp: 2, reason: 'agent_started' },
        { status: 'todo', timestamp: 3, reason: 'orphan_recovery' },
      ],
    })).toBe(2);
  });

  it('counts auto_retry entries', () => {
    expect(countOrphanRecoveries({
      ...baseTicket,
      stateLog: [
        { status: 'todo', timestamp: 1, reason: 'auto_retry' },
        { status: 'in_progress', timestamp: 2, reason: 'agent_started' },
      ],
    })).toBe(1);
  });

  it('counts both orphan_recovery and auto_retry', () => {
    expect(countOrphanRecoveries({
      ...baseTicket,
      stateLog: [
        { status: 'todo', timestamp: 1, reason: 'orphan_recovery' },
        { status: 'todo', timestamp: 2, reason: 'auto_retry' },
        { status: 'todo', timestamp: 3, reason: 'auto_retry' },
      ],
    })).toBe(3);
  });
});

describe('completion status routing', () => {
  // Tests the logic used in the close handler:
  // const completionStatus = prUrl ? 'in_review' : 'done';
  const completionStatus = (prUrl: string | undefined) =>
    prUrl ? 'in_review' : 'done';

  it('routes to in_review when a PR URL is present', () => {
    expect(completionStatus('https://github.com/user/repo/pull/42')).toBe('in_review');
  });

  it('routes to done when no PR URL is found', () => {
    expect(completionStatus(undefined)).toBe('done');
  });

  it('routes to done for empty string PR URL', () => {
    // Empty string is falsy — treat as no PR
    expect(completionStatus('')).toBe('done');
  });
});

describe('retryAfter dispatch filtering', () => {
  // Tests the filtering logic used in dispatcherTick:
  // tickets.filter(t => t.status === 'todo' && (!t.retryAfter || t.retryAfter <= now))
  const dispatchFilter = (ticket: Ticket, now: number) =>
    ticket.status === 'todo' && (!ticket.retryAfter || ticket.retryAfter <= now);

  const baseTicket: Ticket = {
    id: 'test-1',
    projectId: 'proj-1',
    subject: 'Test ticket',
    body: '',
    status: 'todo',
    createdAt: Date.now(),
  };

  it('includes todo ticket with no retryAfter', () => {
    expect(dispatchFilter(baseTicket, Date.now())).toBe(true);
  });

  it('excludes ticket with future retryAfter', () => {
    const ticket = { ...baseTicket, retryAfter: Date.now() + 30_000 };
    expect(dispatchFilter(ticket, Date.now())).toBe(false);
  });

  it('includes ticket with expired retryAfter', () => {
    const ticket = { ...baseTicket, retryAfter: Date.now() - 1000 };
    expect(dispatchFilter(ticket, Date.now())).toBe(true);
  });

  it('includes ticket with retryAfter exactly equal to now', () => {
    const now = Date.now();
    const ticket = { ...baseTicket, retryAfter: now };
    expect(dispatchFilter(ticket, now)).toBe(true);
  });

  it('excludes non-todo tickets regardless of retryAfter', () => {
    const ticket = { ...baseTicket, status: 'in_progress' as const };
    expect(dispatchFilter(ticket, Date.now())).toBe(false);
  });
});
