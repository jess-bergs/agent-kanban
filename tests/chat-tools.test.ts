import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock store/dispatcher/audit modules ─────────────────────────
vi.mock('../server/store.ts', () => ({
  listProjects: vi.fn(),
  listTicketsFiltered: vi.fn(),
  createTicket: vi.fn(),
  resolveTicket: vi.fn(),
  getProject: vi.fn(),
  updateTicket: vi.fn(),
  deleteTicket: vi.fn(),
}));

vi.mock('../server/dispatcher.ts', () => ({
  prepareRetryFields: vi.fn(),
  checkAndReconcilePrState: vi.fn(),
}));

vi.mock('../server/audit-store.ts', () => ({
  listSchedules: vi.fn(),
  listSchedulesByProject: vi.fn(),
  getSchedule: vi.fn(),
}));

vi.mock('../server/audit-templates.ts', () => ({
  listTemplates: vi.fn(),
}));

vi.mock('../server/audit-scheduler.ts', () => ({
  triggerAudit: vi.fn(),
}));

import { chatTools, executeTool } from '../server/chat-tools.ts';
import { listProjects, listTicketsFiltered, resolveTicket, updateTicket, deleteTicket, getProject, createTicket } from '../server/store.ts';
import { prepareRetryFields, checkAndReconcilePrState } from '../server/dispatcher.ts';
import { listSchedules, getSchedule } from '../server/audit-store.ts';
import { triggerAudit } from '../server/audit-scheduler.ts';
import { listTemplates } from '../server/audit-templates.ts';

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── Tool schema validation ──────────────────────────────────────

describe('chatTools schema array', () => {
  it('exports a non-empty array of tool definitions', () => {
    expect(Array.isArray(chatTools)).toBe(true);
    expect(chatTools.length).toBeGreaterThan(0);
  });

  it('each tool has name, description, and input_schema', () => {
    for (const tool of chatTools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toBeDefined();
    }
  });

  it('includes critical action tools', () => {
    const names = chatTools.map(t => t.name);
    expect(names).toContain('retry_ticket');
    expect(names).toContain('create_ticket');
    expect(names).toContain('update_ticket');
    expect(names).toContain('status_check');
  });
});

// ─── executeTool: basic dispatch ─────────────────────────────────

describe('executeTool', () => {
  it('returns result for list_projects', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: 'p1', name: 'Test', repoPath: '/tmp/test', defaultBranch: 'main', createdAt: 0 },
    ]);
    const { result, isError } = await executeTool('list_projects', {});
    expect(isError).toBeUndefined();
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Test');
  });

  it('returns isError for unknown tool', async () => {
    const { result, isError } = await executeTool('nonexistent_tool', {});
    expect(isError).toBe(true);
    expect(result).toContain('Unknown tool');
  });

  it('catches errors from store functions', async () => {
    vi.mocked(listProjects).mockRejectedValue(new Error('disk full'));
    const { result, isError } = await executeTool('list_projects', {});
    expect(isError).toBe(true);
    expect(result).toContain('disk full');
  });

  // ─── list_tickets ────────────────────────────────────────────

  it('passes filter params to listTicketsFiltered', async () => {
    vi.mocked(listTicketsFiltered).mockResolvedValue({ tickets: [], total: 0, limit: 50, offset: 0 });
    await executeTool('list_tickets', { projectId: 'p1', status: 'failed' });
    expect(listTicketsFiltered).toHaveBeenCalledWith({
      projectId: 'p1',
      status: 'failed',
      limit: undefined,
      offset: undefined,
    });
  });

  // ─── create_ticket ───────────────────────────────────────────

  it('creates a ticket with defaults', async () => {
    vi.mocked(getProject).mockResolvedValue({ id: 'p1', name: 'T', repoPath: '/', defaultBranch: 'main', createdAt: 0 });
    vi.mocked(createTicket).mockResolvedValue({ id: 't1', projectId: 'p1', subject: 'test', instructions: 'do it', status: 'todo', yolo: true, autoMerge: true, queued: false, useRalph: false, createdAt: 0, stateLog: [] } as any);
    const { isError } = await executeTool('create_ticket', {
      projectId: 'p1', subject: 'test', instructions: 'do it',
    });
    expect(isError).toBeUndefined();
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({
      yolo: true,
      autoMerge: true,
    }));
  });

  it('returns error when project not found for create_ticket', async () => {
    vi.mocked(getProject).mockResolvedValue(null);
    const { isError } = await executeTool('create_ticket', {
      projectId: 'bad', subject: 's', instructions: 'i',
    });
    expect(isError).toBe(true);
  });

  // ─── get_ticket ──────────────────────────────────────────────

  it('resolves ticket by prefix', async () => {
    vi.mocked(resolveTicket).mockResolvedValue({ id: 'abc-123', subject: 'hi' } as any);
    const { result } = await executeTool('get_ticket', { ticketId: 'abc-' });
    expect(JSON.parse(result).subject).toBe('hi');
  });

  it('returns error for unknown ticket', async () => {
    vi.mocked(resolveTicket).mockResolvedValue(null);
    const { isError } = await executeTool('get_ticket', { ticketId: 'xxx' });
    expect(isError).toBe(true);
  });

  // ─── delete_ticket ───────────────────────────────────────────

  it('deletes ticket by id', async () => {
    vi.mocked(resolveTicket).mockResolvedValue({ id: 'abc' } as any);
    vi.mocked(deleteTicket).mockResolvedValue(true);
    const { result, isError } = await executeTool('delete_ticket', { ticketId: 'abc' });
    expect(isError).toBeUndefined();
    expect(result).toContain('deleted');
  });

  // ─── retry_ticket ────────────────────────────────────────────

  it('retries a failed ticket', async () => {
    const ticket = { id: 'r1', status: 'failed' } as any;
    vi.mocked(resolveTicket).mockResolvedValue(ticket);
    vi.mocked(prepareRetryFields).mockResolvedValue({ status: 'todo' });
    vi.mocked(updateTicket).mockResolvedValue({ ...ticket, status: 'todo' });
    const { isError } = await executeTool('retry_ticket', { ticketId: 'r1' });
    expect(isError).toBeUndefined();
    expect(updateTicket).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'todo' }), 'user_retry');
  });

  it('checks PR state before retry when ticket has prUrl', async () => {
    const ticket = { id: 'r2', status: 'failed', prUrl: 'https://github.com/pr/1' } as any;
    vi.mocked(resolveTicket).mockResolvedValue(ticket);
    vi.mocked(checkAndReconcilePrState).mockResolvedValue(true);
    // After reconciliation, resolveTicket returns updated ticket
    vi.mocked(resolveTicket).mockResolvedValueOnce(ticket).mockResolvedValueOnce({ ...ticket, status: 'done' });
    const { result, isError } = await executeTool('retry_ticket', { ticketId: 'r2' });
    expect(isError).toBeUndefined();
    expect(checkAndReconcilePrState).toHaveBeenCalledWith(ticket);
    // Should NOT have called updateTicket because reconciliation handled it
    expect(updateTicket).not.toHaveBeenCalled();
  });

  // ─── status_check ────────────────────────────────────────────

  it('filters tickets needing attention', async () => {
    vi.mocked(listTicketsFiltered).mockResolvedValue({
      tickets: [
        { id: 't1', status: 'failed', subject: 'a' },
        { id: 't2', status: 'done', subject: 'b' },
        { id: 't3', status: 'error', subject: 'c' },
        { id: 't4', status: 'on_hold', subject: 'd' },
      ] as any,
      total: 4, limit: 50, offset: 0,
    });
    const { result } = await executeTool('status_check', {});
    const parsed = JSON.parse(result);
    expect(parsed.total).toBe(3); // failed + error + on_hold
    expect(parsed.tickets.map((t: any) => t.id).sort()).toEqual(['t1', 't3', 't4']);
  });

  // ─── audit tools ─────────────────────────────────────────────

  it('lists audit schedules', async () => {
    vi.mocked(listSchedules).mockResolvedValue([]);
    const { result } = await executeTool('list_audit_schedules', {});
    expect(JSON.parse(result)).toEqual([]);
  });

  it('triggers audit', async () => {
    vi.mocked(getSchedule).mockResolvedValue({ id: 's1' } as any);
    vi.mocked(triggerAudit).mockResolvedValue({ id: 'run1' } as any);
    const { result } = await executeTool('trigger_audit', { scheduleId: 's1' });
    expect(JSON.parse(result).id).toBe('run1');
  });

  it('returns error for missing audit schedule', async () => {
    vi.mocked(getSchedule).mockResolvedValue(null);
    const { isError } = await executeTool('trigger_audit', { scheduleId: 'bad' });
    expect(isError).toBe(true);
  });

  it('lists audit templates', async () => {
    vi.mocked(listTemplates).mockReturnValue([{ id: 'tmpl1', name: 'Security' }] as any);
    const { result } = await executeTool('list_audit_templates', {});
    expect(JSON.parse(result)[0].id).toBe('tmpl1');
  });
});

// ─── update_ticket field allowlisting (security) ────────────────

describe('executeTool update_ticket allowlisting', () => {
  it('only passes allowed fields to updateTicket', async () => {
    vi.mocked(updateTicket).mockResolvedValue({ id: 't1', status: 'on_hold' } as any);
    await executeTool('update_ticket', {
      ticketId: 't1',
      status: 'on_hold',
      subject: 'new subject',
      // These should be stripped:
      agentSessionId: 'hacked-session',
      prUrl: 'https://evil.com',
      error: 'injected error',
      branchName: 'evil-branch',
      stateLog: [],
    });
    expect(updateTicket).toHaveBeenCalledWith('t1', {
      status: 'on_hold',
      subject: 'new subject',
    });
  });

  it('strips all non-allowed fields', async () => {
    vi.mocked(updateTicket).mockResolvedValue({ id: 't2' } as any);
    await executeTool('update_ticket', {
      ticketId: 't2',
      completedAt: 999,
      failureReason: 'server_crash',
      effort: { turns: 100, cost: 999 },
    });
    // Should pass empty object — no allowed fields present
    expect(updateTicket).toHaveBeenCalledWith('t2', {});
  });

  it('passes all allowed fields when present', async () => {
    vi.mocked(updateTicket).mockResolvedValue({ id: 't3' } as any);
    await executeTool('update_ticket', {
      ticketId: 't3',
      status: 'todo',
      subject: 'updated',
      instructions: 'new instructions',
      yolo: false,
      autoMerge: false,
      queued: true,
    });
    expect(updateTicket).toHaveBeenCalledWith('t3', {
      status: 'todo',
      subject: 'updated',
      instructions: 'new instructions',
      yolo: false,
      autoMerge: false,
      queued: true,
    });
  });
});

// ─── Tool-use loop simulation ────────────────────────────────────
// Verifies the pattern used by /api/chat: multiple sequential tool
// calls with results fed back, as happens during a tool_use loop.

describe('multi-tool-call sequence (loop simulation)', () => {
  it('can execute a status_check → retry sequence', async () => {
    // Step 1: Model calls status_check and finds a failed ticket
    vi.mocked(listTicketsFiltered).mockResolvedValue({
      tickets: [
        { id: 'fail-1', status: 'failed', subject: 'Broken build', error: 'exit 1' },
      ] as any,
      total: 1, limit: 50, offset: 0,
    });

    const step1 = await executeTool('status_check', {});
    const step1Parsed = JSON.parse(step1.result);
    expect(step1Parsed.total).toBe(1);
    expect(step1Parsed.tickets[0].id).toBe('fail-1');

    // Step 2: Model calls retry_ticket using the ID from step 1
    vi.mocked(resolveTicket).mockResolvedValue({ id: 'fail-1', status: 'failed' } as any);
    vi.mocked(prepareRetryFields).mockResolvedValue({ status: 'todo' });
    vi.mocked(updateTicket).mockResolvedValue({ id: 'fail-1', status: 'todo' } as any);

    const step2 = await executeTool('retry_ticket', { ticketId: step1Parsed.tickets[0].id });
    expect(step2.isError).toBeUndefined();
    const step2Parsed = JSON.parse(step2.result);
    expect(step2Parsed.status).toBe('todo');
  });

  it('handles errors gracefully in a multi-step sequence', async () => {
    // Step 1: list_tickets succeeds
    vi.mocked(listTicketsFiltered).mockResolvedValue({
      tickets: [{ id: 'x1', status: 'error' }] as any,
      total: 1, limit: 50, offset: 0,
    });
    const step1 = await executeTool('list_tickets', { status: 'error' });
    expect(step1.isError).toBeUndefined();

    // Step 2: retry fails because ticket no longer exists
    vi.mocked(resolveTicket).mockResolvedValue(null);
    const step2 = await executeTool('retry_ticket', { ticketId: 'x1' });
    expect(step2.isError).toBe(true);
    expect(step2.result).toContain('not found');
  });
});

// ─── chatTools schema correctness for Anthropic API ──────────────

describe('chatTools Anthropic API compatibility', () => {
  it('all tools have valid input_schema.type = object', () => {
    for (const tool of chatTools) {
      expect(tool.input_schema.type).toBe('object');
      expect(typeof tool.input_schema.properties).toBe('object');
    }
  });

  it('required fields are subsets of defined properties', () => {
    for (const tool of chatTools) {
      const propKeys = Object.keys(tool.input_schema.properties);
      const required = tool.input_schema.required ?? [];
      for (const req of required) {
        expect(propKeys).toContain(req);
      }
    }
  });

  it('property types are valid Anthropic JSON Schema types', () => {
    const validTypes = ['string', 'number', 'boolean', 'array', 'object'];
    for (const tool of chatTools) {
      for (const [, prop] of Object.entries(tool.input_schema.properties)) {
        expect(validTypes).toContain(prop.type);
      }
    }
  });
});
