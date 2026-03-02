import type { Ticket, TicketStatus, TicketEffort } from '../types';

const VALID_STATUSES = new Set<string>([
  'todo', 'in_progress', 'needs_approval', 'in_review',
  'on_hold', 'done', 'merged', 'failed', 'error',
]);

export type TicketGeneration = 1 | 2 | 3;

export interface TicketCompatInfo {
  generation: TicketGeneration;
  isFullyModern: boolean;
  missingFeatures: string[];
  hasUnknownStatus: boolean;
}

export function analyzeTicketCompat(ticket: Ticket): TicketCompatInfo {
  const missing: string[] = [];
  const hasUnknownStatus = !VALID_STATUSES.has(ticket.status);

  if (!ticket.stateLog || ticket.stateLog.length === 0) {
    missing.push('stateLog');
  }

  if (!ticket.effort && ticket.status !== 'todo') {
    missing.push('effort');
  }

  const hasUuidId = ticket.id.length > 8 || /[a-f]/.test(ticket.id);
  if (!hasUuidId) {
    missing.push('uuidId');
  }

  let generation: TicketGeneration;
  if (!hasUuidId && !ticket.effort) {
    generation = 1;
  } else if (!hasUuidId) {
    generation = 2;
  } else {
    generation = 3;
  }

  const isFullyModern =
    hasUuidId &&
    !hasUnknownStatus &&
    !!ticket.stateLog &&
    ticket.stateLog.length > 0;

  return { generation, isFullyModern, missingFeatures: missing, hasUnknownStatus };
}

/** Falls back to 'error' for unknown status values so Record<TicketStatus, T> lookups never return undefined */
export function safeStatus(status: string): TicketStatus {
  return VALID_STATUSES.has(status) ? (status as TicketStatus) : 'error';
}

/** Guards against NaN/undefined in effort fields */
export function safeEffort(effort: TicketEffort | undefined): {
  turns: number;
  toolCalls: number;
  costUsd?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
} {
  if (!effort) return { turns: 0, toolCalls: 0 };
  return {
    turns: Number.isFinite(effort.turns) ? effort.turns : 0,
    toolCalls: Number.isFinite(effort.toolCalls) ? effort.toolCalls : 0,
    costUsd: effort.costUsd != null && Number.isFinite(effort.costUsd) ? effort.costUsd : undefined,
    durationMs: effort.durationMs != null && Number.isFinite(effort.durationMs) ? effort.durationMs : undefined,
    inputTokens: effort.inputTokens != null && Number.isFinite(effort.inputTokens) ? effort.inputTokens : undefined,
    outputTokens: effort.outputTokens != null && Number.isFinite(effort.outputTokens) ? effort.outputTokens : undefined,
  };
}
