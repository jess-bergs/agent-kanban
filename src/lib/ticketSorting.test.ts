import { describe, it, expect } from 'vitest';
import { getSortTimestamp, sortTicketsForStatus } from './ticketSorting';
import type { Ticket } from '../types';

// Helper to create a minimal ticket for testing
const createTicket = (overrides: Partial<Ticket>): Ticket => ({
  id: 'test-id',
  projectId: 'test-project',
  subject: 'Test ticket',
  instructions: 'Test instructions',
  status: 'todo',
  createdAt: 1000,
  ...overrides,
});

describe('getSortTimestamp', () => {
  describe('done status', () => {
    it('should use completedAt when available', () => {
      const ticket = createTicket({
        status: 'done',
        createdAt: 1000,
        completedAt: 2000,
      });
      expect(getSortTimestamp(ticket, 'done')).toBe(2000);
    });

    it('should fallback to createdAt when completedAt is missing', () => {
      const ticket = createTicket({
        status: 'done',
        createdAt: 1000,
        completedAt: undefined,
      });
      expect(getSortTimestamp(ticket, 'done')).toBe(1000);
    });
  });

  describe('failed status', () => {
    it('should use latest failed entry from stateLog', () => {
      const ticket = createTicket({
        status: 'failed',
        createdAt: 1000,
        stateLog: [
          { status: 'todo', timestamp: 1000 },
          { status: 'in_progress', timestamp: 1100 },
          { status: 'failed', timestamp: 1200 },
        ],
      });
      expect(getSortTimestamp(ticket, 'failed')).toBe(1200);
    });

    it('should use most recent failed entry when multiple exist', () => {
      const ticket = createTicket({
        status: 'failed',
        createdAt: 1000,
        stateLog: [
          { status: 'failed', timestamp: 1200 },
          { status: 'in_progress', timestamp: 1300 },
          { status: 'failed', timestamp: 1400 },
        ],
      });
      expect(getSortTimestamp(ticket, 'failed')).toBe(1400);
    });

    it('should fallback to createdAt when stateLog is missing', () => {
      const ticket = createTicket({
        status: 'failed',
        createdAt: 1000,
        stateLog: undefined,
      });
      expect(getSortTimestamp(ticket, 'failed')).toBe(1000);
    });

    it('should fallback to createdAt when stateLog is empty', () => {
      const ticket = createTicket({
        status: 'failed',
        createdAt: 1000,
        stateLog: [],
      });
      expect(getSortTimestamp(ticket, 'failed')).toBe(1000);
    });

    it('should fallback to createdAt when no failed entries exist', () => {
      const ticket = createTicket({
        status: 'failed',
        createdAt: 1000,
        stateLog: [
          { status: 'todo', timestamp: 1000 },
          { status: 'in_progress', timestamp: 1100 },
        ],
      });
      expect(getSortTimestamp(ticket, 'failed')).toBe(1000);
    });
  });

  describe('error status', () => {
    it('should use latest error entry from stateLog', () => {
      const ticket = createTicket({
        status: 'error',
        createdAt: 1000,
        stateLog: [
          { status: 'todo', timestamp: 1000 },
          { status: 'in_progress', timestamp: 1100 },
          { status: 'error', timestamp: 1200 },
        ],
      });
      expect(getSortTimestamp(ticket, 'error')).toBe(1200);
    });

    it('should consider both failed and error entries', () => {
      const ticket = createTicket({
        status: 'error',
        createdAt: 1000,
        stateLog: [
          { status: 'failed', timestamp: 1200 },
          { status: 'in_progress', timestamp: 1300 },
          { status: 'error', timestamp: 1400 },
        ],
      });
      expect(getSortTimestamp(ticket, 'error')).toBe(1400);
    });
  });

  describe('other statuses', () => {
    it('should use createdAt for todo', () => {
      const ticket = createTicket({
        status: 'todo',
        createdAt: 1000,
      });
      expect(getSortTimestamp(ticket, 'todo')).toBe(1000);
    });

    it('should use createdAt for in_progress', () => {
      const ticket = createTicket({
        status: 'in_progress',
        createdAt: 1500,
      });
      expect(getSortTimestamp(ticket, 'in_progress')).toBe(1500);
    });

    it('should use createdAt for in_review', () => {
      const ticket = createTicket({
        status: 'in_review',
        createdAt: 2000,
      });
      expect(getSortTimestamp(ticket, 'in_review')).toBe(2000);
    });
  });
});

describe('sortTicketsForStatus', () => {
  it('should sort done tickets by completedAt (newest first)', () => {
    const tickets = [
      createTicket({ id: 'a', status: 'done', createdAt: 1000, completedAt: 2000 }),
      createTicket({ id: 'b', status: 'done', createdAt: 1100, completedAt: 2200 }),
      createTicket({ id: 'c', status: 'done', createdAt: 1200, completedAt: 2100 }),
    ];

    const sorted = sortTicketsForStatus(tickets, 'done');

    expect(sorted.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('should sort failed tickets by latest failure timestamp (newest first)', () => {
    const tickets = [
      createTicket({
        id: 'a',
        status: 'failed',
        createdAt: 1000,
        stateLog: [{ status: 'failed', timestamp: 1500 }],
      }),
      createTicket({
        id: 'b',
        status: 'failed',
        createdAt: 1100,
        stateLog: [{ status: 'failed', timestamp: 1700 }],
      }),
      createTicket({
        id: 'c',
        status: 'failed',
        createdAt: 1200,
        stateLog: [{ status: 'failed', timestamp: 1600 }],
      }),
    ];

    const sorted = sortTicketsForStatus(tickets, 'failed');

    expect(sorted.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('should sort todo tickets by createdAt (newest first)', () => {
    const tickets = [
      createTicket({ id: 'a', status: 'todo', createdAt: 1000 }),
      createTicket({ id: 'b', status: 'todo', createdAt: 1200 }),
      createTicket({ id: 'c', status: 'todo', createdAt: 1100 }),
    ];

    const sorted = sortTicketsForStatus(tickets, 'todo');

    expect(sorted.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('should not mutate the original array', () => {
    const tickets = [
      createTicket({ id: 'a', status: 'todo', createdAt: 1000 }),
      createTicket({ id: 'b', status: 'todo', createdAt: 1200 }),
    ];

    const original = [...tickets];
    sortTicketsForStatus(tickets, 'todo');

    expect(tickets).toEqual(original);
  });

  it('should handle empty array', () => {
    const sorted = sortTicketsForStatus([], 'todo');
    expect(sorted).toEqual([]);
  });

  it('should handle single ticket', () => {
    const tickets = [createTicket({ id: 'a', status: 'todo', createdAt: 1000 })];
    const sorted = sortTicketsForStatus(tickets, 'todo');
    expect(sorted).toEqual(tickets);
  });
});
