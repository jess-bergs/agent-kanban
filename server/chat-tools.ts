/**
 * Chat tool definitions for the Anthropic tool_use API.
 *
 * Mirrors a subset of tools from server/mcp.ts but in Anthropic's native
 * tool schema format, with a dispatcher that executes them in-process
 * (no separate MCP subprocess needed).
 */

import {
  listProjects,
  listTicketsFiltered,
  createTicket,
  resolveTicket,
  updateTicket,
  deleteTicket,
  getProject,
} from './store.ts';
import { prepareRetryFields, checkAndReconcilePrState } from './dispatcher.ts';
import {
  listSchedules,
  listSchedulesByProject,
  getSchedule,
} from './audit-store.ts';
import { listTemplates } from './audit-templates.ts';
import { triggerAudit } from './audit-scheduler.ts';
import type { TicketStatus } from '../src/types.ts';

const TICKET_STATUSES = [
  'todo', 'in_progress', 'needs_approval', 'in_review',
  'on_hold', 'done', 'merged', 'failed', 'error',
] as const satisfies readonly TicketStatus[];

// ─── Anthropic tool schema type ──────────────────────────────────

interface ToolParam {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, ToolParam>;
    required?: string[];
  };
}

// ─── Tool definitions ────────────────────────────────────────────

export const chatTools: AnthropicTool[] = [
  {
    name: 'list_projects',
    description: 'List all registered projects',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_tickets',
    description: 'List tickets with optional filtering. Returns { tickets, total, limit, offset }.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filter by project UUID' },
        status: { type: 'string', description: 'Filter by status', enum: [...TICKET_STATUSES] },
        limit: { type: 'number', description: 'Max tickets (default 50)' },
        offset: { type: 'number', description: 'Number to skip (default 0)' },
      },
    },
  },
  {
    name: 'create_ticket',
    description: 'Create a new ticket to dispatch a Claude Code agent',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project UUID' },
        subject: { type: 'string', description: 'Short title' },
        instructions: { type: 'string', description: 'Detailed instructions for the agent' },
        yolo: { type: 'boolean', description: 'YOLO mode (default true)', default: true },
        autoMerge: { type: 'boolean', description: 'Auto-merge (default true)', default: true },
        queued: { type: 'boolean', description: 'Queue instead of immediate dispatch' },
        useRalph: { type: 'boolean', description: 'Use Ralph mode' },
      },
      required: ['projectId', 'subject', 'instructions'],
    },
  },
  {
    name: 'get_ticket',
    description: 'Get a single ticket by ID or short prefix (min 4 chars)',
    input_schema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: 'Full UUID or short prefix' },
      },
      required: ['ticketId'],
    },
  },
  {
    name: 'update_ticket',
    description: 'Update fields on an existing ticket',
    input_schema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: 'Ticket UUID' },
        status: { type: 'string', description: 'New status', enum: [...TICKET_STATUSES] },
        subject: { type: 'string', description: 'Updated subject' },
        instructions: { type: 'string', description: 'Updated instructions' },
        yolo: { type: 'boolean', description: 'YOLO mode flag' },
        autoMerge: { type: 'boolean', description: 'Auto-merge flag' },
        queued: { type: 'boolean', description: 'Queued flag' },
      },
      required: ['ticketId'],
    },
  },
  {
    name: 'delete_ticket',
    description: 'Delete a ticket by ID or short prefix (min 4 chars)',
    input_schema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: 'Full UUID or short prefix' },
      },
      required: ['ticketId'],
    },
  },
  {
    name: 'retry_ticket',
    description: 'Reset a failed/error ticket back to todo so the dispatcher picks it up again. Preserves resumable state when possible.',
    input_schema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: 'Full UUID or short prefix' },
      },
      required: ['ticketId'],
    },
  },
  {
    name: 'status_check',
    description: 'List tickets needing attention: failed, error, on_hold, or needs_approval.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filter by project UUID' },
        includeOnHold: { type: 'boolean', description: 'Include on_hold (default true)', default: true },
        includeNeedsApproval: { type: 'boolean', description: 'Include needs_approval (default false)', default: false },
      },
    },
  },
  {
    name: 'list_audit_schedules',
    description: 'List audit schedules, optionally filtered by project',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filter by project UUID' },
      },
    },
  },
  {
    name: 'trigger_audit',
    description: 'Manually trigger an immediate run of an audit schedule',
    input_schema: {
      type: 'object',
      properties: {
        scheduleId: { type: 'string', description: 'Schedule UUID' },
      },
      required: ['scheduleId'],
    },
  },
  {
    name: 'list_audit_templates',
    description: 'List all built-in audit templates',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

// ─── Tool executor ───────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function executeTool(
  name: string,
  input: Record<string, any>,
): Promise<{ result: string; isError?: boolean }> {
  try {
    switch (name) {
      case 'list_projects': {
        const projects = await listProjects();
        return { result: JSON.stringify(projects, null, 2) };
      }

      case 'list_tickets': {
        const data = await listTicketsFiltered({
          projectId: input.projectId,
          status: input.status,
          limit: input.limit,
          offset: input.offset,
        });
        return { result: JSON.stringify(data, null, 2) };
      }

      case 'create_ticket': {
        const project = await getProject(input.projectId);
        if (!project) return { result: `Project ${input.projectId} not found`, isError: true };
        const ticket = await createTicket({
          projectId: input.projectId,
          subject: input.subject,
          instructions: input.instructions,
          yolo: input.yolo ?? true,
          autoMerge: input.autoMerge ?? true,
          queued: !!input.queued,
          useRalph: !!input.useRalph,
        });
        return { result: JSON.stringify(ticket, null, 2) };
      }

      case 'get_ticket': {
        const ticket = await resolveTicket(input.ticketId);
        if (!ticket) return { result: 'Ticket not found', isError: true };
        return { result: JSON.stringify(ticket, null, 2) };
      }

      case 'update_ticket': {
        const ALLOWED_UPDATE_FIELDS = ['status', 'subject', 'instructions', 'yolo', 'autoMerge', 'queued'] as const;
        const cleanUpdates: Record<string, unknown> = {};
        for (const key of ALLOWED_UPDATE_FIELDS) {
          if (input[key] !== undefined) cleanUpdates[key] = input[key];
        }
        const ticket = await updateTicket(input.ticketId, cleanUpdates);
        if (!ticket) return { result: 'Ticket not found', isError: true };
        return { result: JSON.stringify(ticket, null, 2) };
      }

      case 'delete_ticket': {
        const toDelete = await resolveTicket(input.ticketId);
        if (!toDelete) return { result: 'Ticket not found', isError: true };
        const ok = await deleteTicket(toDelete.id);
        if (!ok) return { result: 'Failed to delete ticket', isError: true };
        return { result: `Ticket ${toDelete.id} deleted` };
      }

      case 'retry_ticket': {
        const resolved = await resolveTicket(input.ticketId);
        if (!resolved) return { result: 'Ticket not found', isError: true };

        if (resolved.prUrl) {
          const reconciled = await checkAndReconcilePrState(resolved);
          if (reconciled) {
            const fresh = await resolveTicket(resolved.id);
            return { result: JSON.stringify(fresh, null, 2) };
          }
        }

        const retryFields = await prepareRetryFields(resolved);
        const ticket = await updateTicket(resolved.id, {
          ...retryFields,
          teamName: undefined,
          automationIteration: undefined,
          postAgentAction: undefined,
          holdUntil: undefined,
        }, 'user_retry');
        if (!ticket) return { result: 'Ticket not found', isError: true };
        return { result: JSON.stringify(ticket, null, 2) };
      }

      case 'status_check': {
        let tickets = (await listTicketsFiltered({ projectId: input.projectId })).tickets;
        const problemStatuses: TicketStatus[] = ['failed', 'error'];
        if (input.includeOnHold !== false) problemStatuses.push('on_hold');
        if (input.includeNeedsApproval) problemStatuses.push('needs_approval');
        tickets = tickets.filter(t => problemStatuses.includes(t.status));

        const summary = {
          total: tickets.length,
          byStatus: Object.fromEntries(
            problemStatuses.map(s => [s, tickets.filter(t => t.status === s).length]),
          ),
          tickets: tickets.map(t => ({
            id: t.id,
            subject: t.subject,
            status: t.status,
            error: t.error,
            failureReason: t.failureReason,
            holdUntil: t.holdUntil,
            needsAttention: t.needsAttention,
            needsInput: t.needsInput,
            prUrl: t.prUrl,
            createdAt: t.createdAt,
            completedAt: t.completedAt,
          })),
        };
        return { result: JSON.stringify(summary, null, 2) };
      }

      case 'list_audit_schedules': {
        const schedules = input.projectId
          ? await listSchedulesByProject(input.projectId)
          : await listSchedules();
        return { result: JSON.stringify(schedules, null, 2) };
      }

      case 'trigger_audit': {
        const schedule = await getSchedule(input.scheduleId);
        if (!schedule) return { result: 'Audit schedule not found', isError: true };
        const run = await triggerAudit(input.scheduleId);
        if (!run) return { result: 'Failed to trigger audit', isError: true };
        return { result: JSON.stringify(run, null, 2) };
      }

      case 'list_audit_templates': {
        const templates = listTemplates();
        return { result: JSON.stringify(templates, null, 2) };
      }

      default:
        return { result: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { result: `Tool error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
