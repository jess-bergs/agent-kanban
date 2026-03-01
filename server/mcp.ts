import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  listProjects,
  createProject,
  deleteProject,
  listTickets,
  listTicketsByProject,
  createTicket,
  getTicket,
  updateTicket,
  deleteTicket,
  getProject,
} from './store.ts';

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
  'List tickets, optionally filtered by project',
  { projectId: z.string().optional().describe('Filter by project UUID') },
  async ({ projectId }) => {
    const tickets = projectId
      ? await listTicketsByProject(projectId)
      : await listTickets();
    return { content: [{ type: 'text', text: JSON.stringify(tickets, null, 2) }] };
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
  'Get a single ticket by ID',
  { ticketId: z.string().describe('Ticket UUID') },
  async ({ ticketId }) => {
    const ticket = await getTicket(ticketId);
    if (!ticket) return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(ticket, null, 2) }] };
  },
);

server.tool(
  'update_ticket',
  'Update fields on an existing ticket',
  {
    ticketId: z.string().describe('Ticket UUID'),
    status: z.enum(['todo', 'in_progress', 'needs_approval', 'in_review', 'done', 'merged', 'failed', 'error']).optional().describe('New status'),
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
  'Delete a ticket by ID',
  { ticketId: z.string().describe('Ticket UUID') },
  async ({ ticketId }) => {
    const ok = await deleteTicket(ticketId);
    if (!ok) return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
    return { content: [{ type: 'text', text: 'Ticket deleted' }] };
  },
);

server.tool(
  'retry_ticket',
  'Reset a failed/error ticket back to todo so the dispatcher picks it up again',
  { ticketId: z.string().describe('Ticket UUID') },
  async ({ ticketId }) => {
    const ticket = await updateTicket(ticketId, {
      status: 'todo',
      error: undefined,
      branchName: undefined,
      worktreePath: undefined,
      startedAt: undefined,
      completedAt: undefined,
      lastOutput: undefined,
      agentPid: undefined,
    });
    if (!ticket) return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(ticket, null, 2) }] };
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

// ─── Start ──────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
