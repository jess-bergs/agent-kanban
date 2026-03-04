import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  listProjects,
  createProject,
  deleteProject,
  listTickets,
  listTicketsFiltered,
  createTicket,
  resolveTicket,
  updateTicket,
  deleteTicket,
  getProject,
} from './store.ts';
import {
  listSchedules,
  listSchedulesByProject,
  getSchedule,
  createSchedule,
  updateSchedule as updateAuditSchedule,
  deleteSchedule,
  listRuns as listAuditRuns,
  listRunsBySchedule,
  getRun as getAuditRun,
} from './audit-store.ts';
import { listTemplates, getTemplate } from './audit-templates.ts';
import { triggerAudit } from './audit-scheduler.ts';
import { prepareRetryFields, checkAndReconcilePrState } from './dispatcher.ts';
import type { AuditTemplateId, TicketStatus } from '../src/types.ts';

/** All valid ticket statuses, kept in sync with src/types.ts TicketStatus */
const TICKET_STATUSES = [
  'todo', 'in_progress', 'needs_approval', 'in_review',
  'on_hold', 'done', 'merged', 'failed', 'error',
] as const satisfies readonly TicketStatus[];

const server = new McpServer({
  name: 'agent-kanban',
  version: '0.1.0',
});

// ─── Projects ───────────────────────────────────────────────────

server.tool('list_projects', 'List all registered projects', {}, async () => {
  const projects = await listProjects();
  return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
});

server.tool(
  'create_project',
  'Register a git repository as a project for ticket dispatch',
  {
    repoPath: z.string().describe('Absolute path to the git repository'),
    name: z.string().optional().describe('Display name (defaults to directory name)'),
    defaultBranch: z.string().optional().describe('Default branch (defaults to "main")'),
  },
  async ({ repoPath, name, defaultBranch }) => {
    const project = await createProject({
      name: name || repoPath.split('/').pop() || repoPath,
      repoPath,
      defaultBranch: defaultBranch || 'main',
    });
    return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
  },
);

server.tool(
  'delete_project',
  'Delete a project by ID',
  { projectId: z.string().describe('Project UUID') },
  async ({ projectId }) => {
    const ok = await deleteProject(projectId);
    if (!ok) return { content: [{ type: 'text', text: 'Project not found' }], isError: true };
    return { content: [{ type: 'text', text: 'Project deleted' }] };
  },
);

// ─── Tickets ────────────────────────────────────────────────────

server.tool(
  'list_tickets',
  'List tickets with optional filtering and pagination. Returns { tickets, total, limit, offset }.',
  {
    projectId: z.string().optional().describe('Filter by project UUID'),
    status: z.enum(TICKET_STATUSES).optional().describe('Filter by ticket status'),
    limit: z.number().optional().describe('Max tickets to return (default 50)'),
    offset: z.number().optional().describe('Number of tickets to skip (default 0)'),
  },
  async ({ projectId, status, limit, offset }) => {
    const result = await listTicketsFiltered({ projectId, status, limit, offset });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'create_ticket',
  'Create a new ticket to dispatch a Claude Code agent',
  {
    projectId: z.string().describe('Project UUID to create the ticket in'),
    subject: z.string().describe('Short title for the ticket'),
    instructions: z.string().describe('Detailed instructions for the agent'),
    yolo: z.boolean().default(true).optional().describe('Run agent in YOLO mode (no confirmations). Defaults to true.'),
    autoMerge: z.boolean().default(true).optional().describe('Auto-merge PR when checks pass. Defaults to true.'),
    queued: z.boolean().optional().describe('Queue ticket instead of dispatching immediately'),
    useRalph: z.boolean().optional().describe('Use Ralph mode for the agent'),
  },
  async ({ projectId, subject, instructions, yolo, autoMerge, queued, useRalph }) => {
    // Validate the project exists
    const project = await getProject(projectId);
    if (!project) {
      return { content: [{ type: 'text', text: `Project ${projectId} not found` }], isError: true };
    }
    const ticket = await createTicket({
      projectId,
      subject,
      instructions,
      yolo: !!yolo,
      autoMerge: !!autoMerge,
      queued: !!queued,
      useRalph: !!useRalph,
    });
    return { content: [{ type: 'text', text: JSON.stringify(ticket, null, 2) }] };
  },
);

server.tool(
  'get_ticket',
  'Get a single ticket by ID or short prefix (minimum 4 characters)',
  { ticketId: z.string().describe('Full ticket UUID or short prefix (min 4 chars)') },
  async ({ ticketId }) => {
    const ticket = await resolveTicket(ticketId);
    if (!ticket) return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(ticket, null, 2) }] };
  },
);

server.tool(
  'update_ticket',
  'Update fields on an existing ticket',
  {
    ticketId: z.string().describe('Ticket UUID'),
    status: z.enum(TICKET_STATUSES).optional().describe('New status'),
    subject: z.string().optional().describe('Updated subject'),
    instructions: z.string().optional().describe('Updated instructions'),
    yolo: z.boolean().optional().describe('YOLO mode flag'),
    autoMerge: z.boolean().optional().describe('Auto-merge flag'),
    queued: z.boolean().optional().describe('Queued flag'),
  },
  async ({ ticketId, ...updates }) => {
    // Strip undefined values
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined),
    );
    const ticket = await updateTicket(ticketId, cleanUpdates);
    if (!ticket) return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(ticket, null, 2) }] };
  },
);

server.tool(
  'delete_ticket',
  'Delete a ticket by ID or short prefix (minimum 4 characters)',
  { ticketId: z.string().describe('Full ticket UUID or short prefix (min 4 chars)') },
  async ({ ticketId }) => {
    // Resolve prefix to full ID first
    const ticket = await resolveTicket(ticketId);
    if (!ticket) return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
    const ok = await deleteTicket(ticket.id);
    if (!ok) return { content: [{ type: 'text', text: 'Failed to delete ticket' }], isError: true };
    return { content: [{ type: 'text', text: `Ticket ${ticket.id} deleted` }] };
  },
);

server.tool(
  'retry_ticket',
  'Reset a failed/error ticket back to todo so the dispatcher picks it up again. Preserves resumable state (branch + session) when possible.',
  { ticketId: z.string().describe('Full ticket UUID or short prefix (min 4 chars)') },
  async ({ ticketId }) => {
    // Resolve prefix to full ID
    const resolved = await resolveTicket(ticketId);
    if (!resolved) return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };

    // Check if PR is already merged/closed before blindly resetting
    if (resolved.prUrl) {
      const reconciled = await checkAndReconcilePrState(resolved);
      if (reconciled) {
        const fresh = await resolveTicket(resolved.id);
        return { content: [{ type: 'text', text: JSON.stringify(fresh, null, 2) }] };
      }
    }

    const retryFields = await prepareRetryFields(resolved);
    const ticket = await updateTicket(resolved.id, {
      ...retryFields,
      // Manual retry also clears automation-specific fields
      teamName: undefined,
      automationIteration: undefined,
      postAgentAction: undefined,
      holdUntil: undefined,
    }, 'user_retry');
    if (!ticket) return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(ticket, null, 2) }] };
  },
);

server.tool(
  'status_check',
  'List tickets that need attention: failed, error, on_hold, or needs_approval. Useful for monitoring and triage.',
  {
    projectId: z.string().optional().describe('Filter by project UUID'),
    includeOnHold: z.boolean().default(true).optional().describe('Include on_hold tickets (default true)'),
    includeNeedsApproval: z.boolean().default(false).optional().describe('Include needs_approval tickets (default false)'),
  },
  async ({ projectId, includeOnHold, includeNeedsApproval }) => {
    let tickets = (await listTicketsFiltered({ projectId })).tickets;
    const problemStatuses: TicketStatus[] = ['failed', 'error'];
    if (includeOnHold !== false) problemStatuses.push('on_hold');
    if (includeNeedsApproval) problemStatuses.push('needs_approval');

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
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  },
);

// ─── Resources (read-only views) ────────────────────────────────

server.resource(
  'projects',
  'kanban://projects',
  { description: 'All registered projects', mimeType: 'application/json' },
  async () => {
    const projects = await listProjects();
    return { contents: [{ uri: 'kanban://projects', text: JSON.stringify(projects, null, 2), mimeType: 'application/json' }] };
  },
);

server.resource(
  'tickets',
  'kanban://tickets',
  { description: 'All tickets across all projects', mimeType: 'application/json' },
  async () => {
    const tickets = await listTickets();
    return { contents: [{ uri: 'kanban://tickets', text: JSON.stringify(tickets, null, 2), mimeType: 'application/json' }] };
  },
);

// ─── Audit Templates ────────────────────────────────────────────

server.tool('list_audit_templates', 'List all built-in audit templates', {}, async () => {
  const templates = listTemplates();
  return { content: [{ type: 'text', text: JSON.stringify(templates, null, 2) }] };
});

server.tool(
  'get_audit_template',
  'Get a single audit template by ID',
  { templateId: z.string().describe('Template ID (e.g. "security-scan", "readme-freshness")') },
  async ({ templateId }) => {
    const template = getTemplate(templateId as AuditTemplateId);
    if (!template) return { content: [{ type: 'text', text: 'Template not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(template, null, 2) }] };
  },
);

// ─── Audit Schedules ────────────────────────────────────────────

server.tool(
  'list_audit_schedules',
  'List audit schedules, optionally filtered by project',
  { projectId: z.string().optional().describe('Filter by project UUID') },
  async ({ projectId }) => {
    const schedules = projectId
      ? await listSchedulesByProject(projectId)
      : await listSchedules();
    return { content: [{ type: 'text', text: JSON.stringify(schedules, null, 2) }] };
  },
);

server.tool(
  'create_audit_schedule',
  'Create a new scheduled audit for a project',
  {
    projectId: z.string().describe('Project UUID'),
    name: z.string().describe('Display name for this schedule'),
    templateId: z.string().optional().describe('Built-in template ID (provides default prompt)'),
    prompt: z.string().optional().describe('Custom audit prompt (overrides template prompt)'),
    cadence: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'manual']).describe('How often to run'),
    mode: z.enum(['report', 'fix']).describe('Report mode (read-only) or fix mode (creates PRs)'),
    yolo: z.boolean().default(true).optional().describe('Skip permissions in fix mode. Defaults to true.'),
    autoMerge: z.boolean().default(true).optional().describe('Auto-merge PRs in fix mode. Defaults to true.'),
  },
  async ({ projectId, name, templateId, prompt, cadence, mode, yolo, autoMerge }) => {
    const project = await getProject(projectId);
    if (!project) {
      return { content: [{ type: 'text', text: `Project ${projectId} not found` }], isError: true };
    }

    let finalPrompt = prompt;
    if (templateId && !prompt) {
      const template = getTemplate(templateId as AuditTemplateId);
      if (!template) {
        return { content: [{ type: 'text', text: `Unknown template: ${templateId}` }], isError: true };
      }
      finalPrompt = template.prompt;
    }

    if (!finalPrompt) {
      return { content: [{ type: 'text', text: 'Either prompt or templateId is required' }], isError: true };
    }

    const schedule = await createSchedule({
      projectId,
      name,
      templateId: templateId as AuditTemplateId | undefined,
      prompt: finalPrompt,
      cadence,
      mode,
      status: 'active',
      yolo: !!yolo,
      autoMerge: !!autoMerge,
    });
    return { content: [{ type: 'text', text: JSON.stringify(schedule, null, 2) }] };
  },
);

server.tool(
  'get_audit_schedule',
  'Get a single audit schedule by ID',
  { scheduleId: z.string().describe('Schedule UUID') },
  async ({ scheduleId }) => {
    const schedule = await getSchedule(scheduleId);
    if (!schedule) return { content: [{ type: 'text', text: 'Audit schedule not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(schedule, null, 2) }] };
  },
);

server.tool(
  'update_audit_schedule',
  'Update fields on an existing audit schedule',
  {
    scheduleId: z.string().describe('Schedule UUID'),
    name: z.string().optional().describe('Updated name'),
    cadence: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'manual']).optional().describe('Updated cadence'),
    mode: z.enum(['report', 'fix']).optional().describe('Updated mode'),
    status: z.enum(['active', 'paused']).optional().describe('Pause or resume the schedule'),
    prompt: z.string().optional().describe('Updated audit prompt'),
    yolo: z.boolean().optional().describe('Updated YOLO flag'),
    autoMerge: z.boolean().optional().describe('Updated auto-merge flag'),
  },
  async ({ scheduleId, ...updates }) => {
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined),
    );
    const schedule = await updateAuditSchedule(scheduleId, cleanUpdates);
    if (!schedule) return { content: [{ type: 'text', text: 'Audit schedule not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(schedule, null, 2) }] };
  },
);

server.tool(
  'delete_audit_schedule',
  'Delete an audit schedule by ID',
  { scheduleId: z.string().describe('Schedule UUID') },
  async ({ scheduleId }) => {
    const ok = await deleteSchedule(scheduleId);
    if (!ok) return { content: [{ type: 'text', text: 'Audit schedule not found' }], isError: true };
    return { content: [{ type: 'text', text: 'Audit schedule deleted' }] };
  },
);

server.tool(
  'trigger_audit',
  'Manually trigger an immediate run of an audit schedule',
  { scheduleId: z.string().describe('Schedule UUID') },
  async ({ scheduleId }) => {
    const run = await triggerAudit(scheduleId);
    if (!run) return { content: [{ type: 'text', text: 'Audit schedule not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(run, null, 2) }] };
  },
);

// ─── Audit Runs ─────────────────────────────────────────────────

server.tool(
  'list_audit_runs',
  'List audit runs, optionally filtered by schedule',
  { scheduleId: z.string().optional().describe('Filter by schedule UUID') },
  async ({ scheduleId }) => {
    const runs = scheduleId
      ? await listRunsBySchedule(scheduleId)
      : await listAuditRuns();
    runs.sort((a, b) => b.startedAt - a.startedAt);
    return { content: [{ type: 'text', text: JSON.stringify(runs, null, 2) }] };
  },
);

server.tool(
  'get_audit_run',
  'Get a single audit run by ID (includes report and structured results)',
  { runId: z.string().describe('Run UUID') },
  async ({ runId }) => {
    const run = await getAuditRun(runId);
    if (!run) return { content: [{ type: 'text', text: 'Audit run not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(run, null, 2) }] };
  },
);

// ─── Audit Resources (read-only views) ──────────────────────────

server.resource(
  'audit-templates',
  'kanban://audit-templates',
  { description: 'All built-in audit templates', mimeType: 'application/json' },
  async () => {
    const templates = listTemplates();
    return { contents: [{ uri: 'kanban://audit-templates', text: JSON.stringify(templates, null, 2), mimeType: 'application/json' }] };
  },
);

server.resource(
  'audit-schedules',
  'kanban://audit-schedules',
  { description: 'All audit schedules', mimeType: 'application/json' },
  async () => {
    const schedules = await listSchedules();
    return { contents: [{ uri: 'kanban://audit-schedules', text: JSON.stringify(schedules, null, 2), mimeType: 'application/json' }] };
  },
);

server.resource(
  'audit-runs',
  'kanban://audit-runs',
  { description: 'All audit runs', mimeType: 'application/json' },
  async () => {
    const runs = await listAuditRuns();
    return { contents: [{ uri: 'kanban://audit-runs', text: JSON.stringify(runs, null, 2), mimeType: 'application/json' }] };
  },
);

// ─── Start ──────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
