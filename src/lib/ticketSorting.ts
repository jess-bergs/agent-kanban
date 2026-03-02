import type { Ticket, TicketStatus } from '../types';

/**
 * Get the sort timestamp for a ticket based on its status.
 * - Done tickets: use completedAt
 * - Failed/Error tickets: use latest failed/error transition from stateLog
 * - Other tickets: use createdAt
 */
export function getSortTimestamp(ticket: Ticket, status: TicketStatus): number {
  if (status === 'done') {
    return ticket.completedAt ?? ticket.createdAt;
  }

  if (status === 'failed' || status === 'error') {
    if (!ticket.stateLog || ticket.stateLog.length === 0) {
      return ticket.createdAt;
    }
    // Find the most recent failed or error entry
    const failEntries = ticket.stateLog.filter(
      e => e.status === 'failed' || e.status === 'error'
    );
    if (failEntries.length === 0) {
      return ticket.createdAt;
    }
    return Math.max(...failEntries.map(e => e.timestamp));
  }

  return ticket.createdAt;
}

/**
 * Sort tickets for a specific status column.
 * Returns a new sorted array (does not mutate input).
 */
export function sortTicketsForStatus(
  tickets: Ticket[],
  status: TicketStatus
): Ticket[] {
  return [...tickets].sort((a, b) => {
    const timestampB = getSortTimestamp(b, status);
    const timestampA = getSortTimestamp(a, status);
    return timestampB - timestampA; // Newest first
  });
}
