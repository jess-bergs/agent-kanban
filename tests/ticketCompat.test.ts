import { describe, it, expect } from 'vitest';
import { analyzeTicketCompat, safeStatus, safeEffort } from '../src/lib/ticketCompat.ts';
import type { Ticket, TicketEffort } from '../src/types.ts';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    projectId: 'proj-1',
    subject: 'Test ticket',
    instructions: 'Do something',
    status: 'todo',
    createdAt: Date.now(),
    stateLog: [{ status: 'todo', timestamp: Date.now(), reason: 'ticket_created' }],
    ...overrides,
  };
}

describe('safeStatus', () => {
  it('returns valid statuses unchanged', () => {
    const statuses = ['todo', 'in_progress', 'needs_approval', 'in_review', 'on_hold', 'done', 'merged', 'failed', 'error'];
    for (const s of statuses) {
      expect(safeStatus(s)).toBe(s);
    }
  });

  it('returns "error" for unknown statuses', () => {
    expect(safeStatus('banana')).toBe('error');
    expect(safeStatus('')).toBe('error');
    expect(safeStatus('DONE')).toBe('error'); // case-sensitive
  });
});

describe('safeEffort', () => {
  it('returns zeroes for undefined effort', () => {
    const result = safeEffort(undefined);
    expect(result.turns).toBe(0);
    expect(result.toolCalls).toBe(0);
    expect(result.costUsd).toBeUndefined();
    expect(result.durationMs).toBeUndefined();
  });

  it('passes through valid numeric values', () => {
    const effort: TicketEffort = {
      turns: 5,
      toolCalls: 12,
      costUsd: 0.42,
      durationMs: 60000,
      inputTokens: 5000,
      outputTokens: 2000,
    };
    const result = safeEffort(effort);
    expect(result.turns).toBe(5);
    expect(result.toolCalls).toBe(12);
    expect(result.costUsd).toBe(0.42);
    expect(result.inputTokens).toBe(5000);
  });

  it('guards against NaN values', () => {
    const effort: TicketEffort = {
      turns: NaN,
      toolCalls: NaN,
      costUsd: NaN,
      inputTokens: NaN,
    };
    const result = safeEffort(effort);
    expect(result.turns).toBe(0);
    expect(result.toolCalls).toBe(0);
    expect(result.costUsd).toBeUndefined();
    expect(result.inputTokens).toBeUndefined();
  });

  it('guards against Infinity', () => {
    const effort: TicketEffort = {
      turns: Infinity,
      toolCalls: -Infinity,
    };
    const result = safeEffort(effort);
    expect(result.turns).toBe(0);
    expect(result.toolCalls).toBe(0);
  });
});

describe('analyzeTicketCompat', () => {
  it('identifies gen 3 (modern) tickets', () => {
    const info = analyzeTicketCompat(makeTicket());
    expect(info.generation).toBe(3);
    expect(info.isFullyModern).toBe(true);
    expect(info.missingFeatures).toEqual([]);
    expect(info.hasUnknownStatus).toBe(false);
  });

  it('identifies gen 1 (legacy) tickets — short ID, no effort', () => {
    const info = analyzeTicketCompat(makeTicket({
      id: '12345678',
      effort: undefined,
      status: 'in_progress',
    }));
    expect(info.generation).toBe(1);
    expect(info.isFullyModern).toBe(false);
    expect(info.missingFeatures).toContain('effort');
    expect(info.missingFeatures).toContain('uuidId');
  });

  it('identifies gen 2 tickets — short ID, has effort', () => {
    const info = analyzeTicketCompat(makeTicket({
      id: '12345678',
      effort: { turns: 3, toolCalls: 5 },
    }));
    expect(info.generation).toBe(2);
  });

  it('flags unknown statuses', () => {
    const info = analyzeTicketCompat(makeTicket({ status: 'banana' as never }));
    expect(info.hasUnknownStatus).toBe(true);
    expect(info.isFullyModern).toBe(false);
  });

  it('flags missing stateLog', () => {
    const info = analyzeTicketCompat(makeTicket({ stateLog: undefined }));
    expect(info.missingFeatures).toContain('stateLog');
    expect(info.isFullyModern).toBe(false);
  });
});
