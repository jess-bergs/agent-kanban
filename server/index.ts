import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { execSync } from 'node:child_process';
import {
  getAllTeamsWithData,
  readTeamConfig,
  readTeamTasks,
  readTeamInboxes,
} from './claude-data.ts';
import { startWatcher, type ChangeEvent } from './watcher.ts';
import {
  listProjects,
  createProject,
  deleteProject,
  getProject,
  listTickets,
  listTicketsByProject,
  createTicket,
  getTicket,
  updateTicket,
  deleteTicket,
  getProjectsPayload,
  saveTicketImage,
  deleteTicketImage,
  getImagesDir,
} from './store.ts';
import { startDispatcher, stopDispatcher, setDispatchBroadcast, killAgent, abortAgent, checkPrStatus, conflictCheckTick, attemptMerge } from './dispatcher.ts';
import { detectSoloAgents } from './solo-agents.ts';
import {
  runAudit,
  isAuditRunning,
  setAuditorBroadcast,
  setAttemptMergeFn,
  startAuditor,
  stopAuditor,
  addToWatchlist,
  removeFromWatchlist,
  getWatchlistStatus,
  triggerReReview,
} from './auditor.ts';
import {
  startAuditScheduler,
  stopAuditScheduler,
  setSchedulerBroadcast,
  triggerAudit,
} from './audit-scheduler.ts';
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
import { buildAnalytics } from './analytics.ts';
import type { TeamWithData, WSEvent, AuditTemplateId, ChatMessage } from '../src/types.ts';

const PORT = 3003;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = express();
app.use(cors({ origin: 'http://localhost:5174' }));
app.use(express.json({ limit: '15mb' }));

// Serve uploaded ticket images as static files
app.use('/api/ticket-images', express.static(getImagesDir()));

// Validate :id params are UUIDs — prevents path traversal and injection
app.param('id', (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid ID format' });
    return;
  }
  next();
});

// ─── Team Monitoring API ──────────────────────────────────────────

app.get('/api/teams', async (_req, res) => {
  try {
    const teams = await getAllTeamsWithData();
    res.json(teams);
  } catch (err) {
    console.error('Error fetching teams:', err);
    res.status(500).json({ error: 'Failed to read team data' });
  }
});

// ─── Browse API ──────────────────────────────────────────────────

app.get('/api/browse', async (req, res) => {
  const { readdir, stat } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const { join, dirname } = await import('node:path');

  const requestedPath = (req.query.path as string) || homedir();

  try {
    const entries = await readdir(requestedPath, { withFileTypes: true });
    const dirs: { name: string; path: string; isGit: boolean }[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const fullPath = join(requestedPath, entry.name);
      let isGit = false;
      try {
        await stat(join(fullPath, '.git'));
        isGit = true;
      } catch { /* not a git repo */ }
      dirs.push({ name: entry.name, path: fullPath, isGit });
    }

    dirs.sort((a, b) => {
      if (a.isGit !== b.isGit) return a.isGit ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      current: requestedPath,
      parent: dirname(requestedPath) !== requestedPath ? dirname(requestedPath) : null,
      dirs,
    });
  } catch {
    res.status(400).json({ error: 'Cannot read directory' });
  }
});

// ─── Solo Agents API ─────────────────────────────────────────────

app.get('/api/agents', async (_req, res) => {
  try {
    const agents = await detectSoloAgents();
    res.json(agents);
  } catch (err) {
    console.error('Error detecting agents:', err);
    res.status(500).json({ error: 'Failed to detect agents' });
  }
});

// ─── Projects API ─────────────────────────────────────────────────

app.get('/api/projects', async (_req, res) => {
  try {
    const data = await getProjectsPayload();
    res.json(data);
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ error: 'Failed to read projects' });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { repoPath } = req.body;
    if (!repoPath || typeof repoPath !== 'string') {
      res.status(400).json({ error: 'repoPath is required' });
      return;
    }

    // Auto-detect repo info
    const name = repoPath.split('/').pop() || repoPath;
    let defaultBranch = 'main';
    let remoteUrl: string | undefined;

    try {
      defaultBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
        encoding: 'utf-8',
      }).trim();
    } catch { /* use default */ }

    try {
      remoteUrl = execSync('git remote get-url origin', {
        cwd: repoPath,
        encoding: 'utf-8',
      }).trim();
    } catch { /* no remote */ }

    const project = await createProject({
      name: req.body.name || name,
      repoPath,
      defaultBranch: req.body.defaultBranch || defaultBranch,
      remoteUrl,
    });

    broadcast({ type: 'projects_updated', data: await getProjectsPayload() });
    res.status(201).json(project);
  } catch (err) {
    console.error('Error creating project:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  const ok = await deleteProject(req.params.id);
  if (ok) {
    broadcast({ type: 'projects_updated', data: await getProjectsPayload() });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Project not found' });
  }
});

// ─── Tickets API ──────────────────────────────────────────────────

app.get('/api/tickets', async (req, res) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const tickets = projectId
      ? await listTicketsByProject(projectId)
      : await listTickets();
    res.json(tickets);
  } catch (err) {
    console.error('Error fetching tickets:', err);
    res.status(500).json({ error: 'Failed to read tickets' });
  }
});

app.post('/api/tickets', async (req, res) => {
  try {
    const { projectId, subject, instructions, yolo, autoMerge, queued, useRalph, useTeam, planOnly } = req.body;
    if (!projectId || !subject || !instructions) {
      res.status(400).json({ error: 'projectId, subject, and instructions are required' });
      return;
    }
    const ticket = await createTicket({
      projectId, subject, instructions,
      yolo: yolo !== undefined ? !!yolo : true,
      autoMerge: autoMerge !== undefined ? !!autoMerge : true,
      queued: !!queued,
      useRalph: !!useRalph,
      useTeam: !!useTeam,
      planOnly: !!planOnly,
    });
    broadcast({ type: 'ticket_updated', data: ticket });
    res.status(201).json(ticket);
  } catch (err) {
    console.error('Error creating ticket:', err);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

app.get('/api/tickets/:id', async (req, res) => {
  const ticket = await getTicket(req.params.id);
  if (ticket) {
    res.json(ticket);
  } else {
    res.status(404).json({ error: 'Ticket not found' });
  }
});

app.patch('/api/tickets/:id', async (req, res) => {
  const ticket = await updateTicket(req.params.id, req.body, req.body.status ? 'user_action' : undefined);
  if (ticket) {
    broadcast({ type: 'ticket_updated', data: ticket });
    res.json(ticket);
  } else {
    res.status(404).json({ error: 'Ticket not found' });
  }
});

// ─── Ticket Images ───────────────────────────────────────────────

app.post('/api/tickets/:id/images', async (req, res) => {
  const ticket = await getTicket(req.params.id);
  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  const { dataUrl, originalName } = req.body;
  if (!dataUrl || typeof dataUrl !== 'string') {
    res.status(400).json({ error: 'dataUrl is required' });
    return;
  }

  try {
    const image = await saveTicketImage(dataUrl, originalName || 'image.png');
    const images = [...(ticket.images || []), image];
    const updated = await updateTicket(req.params.id, { images });
    broadcast({ type: 'ticket_updated', data: updated });
    res.status(201).json(image);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save image';
    res.status(400).json({ error: message });
  }
});

app.delete('/api/tickets/:id/images/:filename', async (req, res) => {
  const ticket = await getTicket(req.params.id);
  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  const { filename } = req.params;
  const images = (ticket.images || []).filter(img => img.filename !== filename);

  if (images.length === (ticket.images || []).length) {
    res.status(404).json({ error: 'Image not found on ticket' });
    return;
  }

  await deleteTicketImage(filename);
  const updated = await updateTicket(req.params.id, { images });
  broadcast({ type: 'ticket_updated', data: updated });
  res.json({ success: true });
});

app.post('/api/tickets/:id/retry', async (req, res) => {
  const ticket = await updateTicket(req.params.id, {
    status: 'todo',
    error: undefined,
    failureReason: undefined,
    branchName: undefined,
    worktreePath: undefined,
    teamName: undefined,
    startedAt: undefined,
    completedAt: undefined,
    lastOutput: undefined,
    agentPid: undefined,
    agentSessionId: undefined,
    resumePrompt: undefined,
    automationIteration: undefined,
    postAgentAction: undefined,
    holdUntil: undefined,
  }, 'user_retry');
  if (ticket) {
    broadcast({ type: 'ticket_updated', data: ticket });
    res.json(ticket);
  } else {
    res.status(404).json({ error: 'Ticket not found' });
  }
});

app.post('/api/tickets/:id/abort', async (req, res) => {
  const ticket = await getTicket(req.params.id);
  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }
  if (ticket.status !== 'in_progress' && ticket.status !== 'needs_approval') {
    res.status(400).json({ error: 'Ticket is not currently running' });
    return;
  }
  const killed = abortAgent(req.params.id);
  if (!killed) {
    // Process not tracked — update status directly
    const updated = await updateTicket(req.params.id, {
      status: 'failed',
      error: 'Aborted by user',
      completedAt: Date.now(),
      agentPid: undefined,
    }, 'user_abort');
    if (updated) broadcast({ type: 'ticket_updated', data: updated });
  }
  res.json({ success: true });
});

app.post('/api/tickets/:id/refresh-status', async (req, res) => {
  const ticket = await getTicket(req.params.id);
  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  if (ticket.status !== 'in_review' || !ticket.prUrl) {
    res.status(400).json({ error: 'Ticket must be in review with a PR URL' });
    return;
  }

  try {
    await checkPrStatus(ticket);
    // Get the updated ticket
    const updatedTicket = await getTicket(req.params.id);
    res.json(updatedTicket);
  } catch (err) {
    console.error('Error refreshing ticket status:', err);
    res.status(500).json({ error: 'Failed to refresh status' });
  }
});

app.get('/api/tickets/:id/log', async (req, res) => {
  const ticket = await getTicket(req.params.id);
  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }
  res.json(ticket.stateLog || []);
});

app.post('/api/tickets/:id/audit', async (req, res) => {
  const ticket = await getTicket(req.params.id);
  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }
  if (!ticket.prUrl) {
    res.status(400).json({ error: 'Ticket has no PR URL' });
    return;
  }
  if (isAuditRunning(ticket.prUrl)) {
    res.status(409).json({ error: 'Audit already running for this ticket' });
    return;
  }
  // Add to watchlist (which triggers an initial review)
  runAudit(ticket).catch(err => {
    console.error(`[api] Audit failed for ticket #${ticket.id}:`, err);
  });
  res.json({ success: true, message: 'Audit started' });
});

// ─── Auditor Watchlist API ───────────────────────────────────────

app.get('/api/auditor/watchlist', (_req, res) => {
  res.json(getWatchlistStatus());
});

app.post('/api/auditor/watch', async (req, res) => {
  const { prUrl, ticketId } = req.body;
  if (!prUrl || typeof prUrl !== 'string') {
    res.status(400).json({ error: 'prUrl is required' });
    return;
  }
  const entry = await addToWatchlist(prUrl, ticketId);
  if (!entry) {
    res.status(403).json({
      error: 'Repository not in allowlist — only PRs from registered projects can be watched',
    });
    return;
  }
  res.status(201).json(entry);
});

app.post('/api/auditor/unwatch', async (req, res) => {
  const { prUrl } = req.body;
  if (!prUrl || typeof prUrl !== 'string') {
    res.status(400).json({ error: 'prUrl is required' });
    return;
  }
  const removed = await removeFromWatchlist(prUrl);
  if (!removed) {
    res.status(404).json({ error: 'PR not found on watchlist' });
    return;
  }
  res.json({ success: true });
});

app.post('/api/auditor/re-review', async (req, res) => {
  const { prUrl } = req.body;
  if (!prUrl || typeof prUrl !== 'string') {
    res.status(400).json({ error: 'prUrl is required' });
    return;
  }
  const triggered = await triggerReReview(prUrl);
  if (!triggered) {
    res.status(404).json({ error: 'PR not on active watchlist or review already in progress' });
    return;
  }
  res.json({ success: true, message: 'Re-review triggered' });
});

// ─── Audit Templates API ─────────────────────────────────────────

app.get('/api/audit-templates', (_req, res) => {
  res.json(listTemplates());
});

app.get('/api/audit-templates/:templateId', (req, res) => {
  const template = getTemplate(req.params.templateId as AuditTemplateId);
  if (template) {
    res.json(template);
  } else {
    res.status(404).json({ error: 'Template not found' });
  }
});

// ─── Audit Schedules API ─────────────────────────────────────────

app.get('/api/audit-schedules', async (req, res) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const schedules = projectId
      ? await listSchedulesByProject(projectId)
      : await listSchedules();
    res.json(schedules);
  } catch (err) {
    console.error('Error fetching audit schedules:', err);
    res.status(500).json({ error: 'Failed to read audit schedules' });
  }
});

app.post('/api/audit-schedules', async (req, res) => {
  try {
    const { projectId, name, templateId, prompt, cadence, mode, yolo, autoMerge } = req.body;
    if (!projectId || !name || !cadence || !mode) {
      res.status(400).json({
        error: 'projectId, name, cadence, and mode are required',
      });
      return;
    }

    let finalPrompt = prompt;
    if (templateId && !prompt) {
      const template = getTemplate(templateId);
      if (!template) {
        res.status(400).json({ error: `Unknown template: ${templateId}` });
        return;
      }
      finalPrompt = template.prompt;
    }

    if (!finalPrompt) {
      res.status(400).json({ error: 'Either prompt or templateId is required' });
      return;
    }

    const schedule = await createSchedule({
      projectId,
      name,
      templateId,
      prompt: finalPrompt,
      cadence,
      mode,
      status: 'active',
      yolo: yolo !== undefined ? !!yolo : true,
      autoMerge: autoMerge !== undefined ? !!autoMerge : true,
    });

    broadcast({ type: 'audit_schedules_updated', data: await listSchedules() });
    res.status(201).json(schedule);
  } catch (err) {
    console.error('Error creating audit schedule:', err);
    res.status(500).json({ error: 'Failed to create audit schedule' });
  }
});

app.get('/api/audit-schedules/:id', async (req, res) => {
  const schedule = await getSchedule(req.params.id);
  if (schedule) {
    res.json(schedule);
  } else {
    res.status(404).json({ error: 'Audit schedule not found' });
  }
});

app.patch('/api/audit-schedules/:id', async (req, res) => {
  const schedule = await updateAuditSchedule(req.params.id, req.body);
  if (schedule) {
    broadcast({ type: 'audit_schedules_updated', data: await listSchedules() });
    res.json(schedule);
  } else {
    res.status(404).json({ error: 'Audit schedule not found' });
  }
});

app.delete('/api/audit-schedules/:id', async (req, res) => {
  const ok = await deleteSchedule(req.params.id);
  if (ok) {
    broadcast({ type: 'audit_schedules_updated', data: await listSchedules() });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Audit schedule not found' });
  }
});

app.post('/api/audit-schedules/:id/trigger', async (req, res) => {
  const run = await triggerAudit(req.params.id);
  if (run) {
    res.status(201).json(run);
  } else {
    res.status(404).json({ error: 'Audit schedule not found' });
  }
});

// ─── Audit Runs API ──────────────────────────────────────────────

app.get('/api/audit-runs', async (req, res) => {
  try {
    const scheduleId = req.query.scheduleId as string | undefined;
    const runs = scheduleId
      ? await listRunsBySchedule(scheduleId)
      : await listAuditRuns();
    runs.sort((a, b) => b.startedAt - a.startedAt);
    res.json(runs);
  } catch (err) {
    console.error('Error fetching audit runs:', err);
    res.status(500).json({ error: 'Failed to read audit runs' });
  }
});

app.get('/api/audit-runs/:id', async (req, res) => {
  const run = await getAuditRun(req.params.id);
  if (run) {
    res.json(run);
  } else {
    res.status(404).json({ error: 'Audit run not found' });
  }
});

// Serve the markdown report file for a run
app.get('/api/audit-runs/:id/report', async (req, res) => {
  const run = await getAuditRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'Audit run not found' });
    return;
  }
  if (!run.reportPath) {
    res.status(404).json({ error: 'No structured report available for this run' });
    return;
  }
  try {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(run.reportPath, 'utf-8');
    res.type('text/markdown').send(content);
  } catch {
    res.status(404).json({ error: 'Report file not found on disk' });
  }
});

// Trend data for a schedule's completed runs (for charting)
app.get('/api/audit-schedules/:id/trends', async (req, res) => {
  try {
    const runs = await listRunsBySchedule(req.params.id);
    const completedRuns = runs
      .filter(r => r.status === 'completed' && r.structuredReport)
      .sort((a, b) => a.startedAt - b.startedAt);

    const trendData = completedRuns.map(r => ({
      runId: r.id,
      completedAt: r.completedAt,
      overallScore: r.structuredReport!.overallScore,
      overallVerdict: r.structuredReport!.overallVerdict,
      severityCounts: r.severityCounts,
      trend: r.trend,
    }));

    res.json(trendData);
  } catch (err) {
    console.error('Error fetching trends:', err);
    res.status(500).json({ error: 'Failed to fetch trend data' });
  }
});

// ─── Conflict Check ─────────────────────────────────────────────

app.post('/api/tickets/check-conflicts', async (_req, res) => {
  try {
    await conflictCheckTick();
    res.json({ success: true });
  } catch (err) {
    console.error('Error running conflict check:', err);
    res.status(500).json({ error: 'Failed to check conflicts' });
  }
});

app.delete('/api/tickets/:id', async (req, res) => {
  // Kill running agent process if any
  killAgent(req.params.id);

  const ok = await deleteTicket(req.params.id);
  if (ok) {
    broadcast({ type: 'ticket_deleted', data: { id: req.params.id } });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Ticket not found' });
  }
});

// ─── Analytics API ───────────────────────────────────────────────

app.get('/api/analytics', async (_req, res) => {
  try {
    const analytics = await buildAnalytics();
    res.json(analytics);
  } catch (err) {
    console.error('Error building analytics:', err);
    res.status(500).json({ error: 'Failed to build analytics' });
  }
});

// ─── Codebase Context for Chat ───────────────────────────────────

/** Key files to read from each project repo for chat context */
const CONTEXT_FILES = [
  'CLAUDE.md',
  'package.json',
  'tsconfig.json',
  'README.md',
  '.env.example',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'Makefile',
  'docker-compose.yml',
  'Dockerfile',
];

const TREE_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'target', '.turbo', '.cache', 'coverage',
]);

/** Patterns that should never be served to the chat context */
const SENSITIVE_PATTERNS = [
  /\.env$/i, /\.env\..*/i, /\.pem$/i, /\.key$/i, /\.p12$/i,
  /credentials/i, /secrets?\.ya?ml$/i, /\.secret$/i,
  /id_rsa/i, /id_ed25519/i, /\.pgpass$/i, /\.netrc$/i,
];

/** Check whether a file path is safe to read (not sensitive, within repo) */
function isPathSafe(repoPath: string, filePath: string): boolean {
  const resolved = path.resolve(repoPath, filePath);
  // Must stay within the repo directory
  if (!resolved.startsWith(path.resolve(repoPath) + path.sep) && resolved !== path.resolve(repoPath)) {
    return false;
  }
  // Block sensitive patterns
  const basename = path.basename(resolved);
  return !SENSITIVE_PATTERNS.some(p => p.test(basename));
}

/** Build a shallow file tree (2 levels deep) for a directory */
async function buildFileTree(dirPath: string, depth = 0, maxDepth = 2): Promise<string[]> {
  if (depth >= maxDepth) return [];
  const lines: string[] = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const sorted = entries
      .filter(e => !e.name.startsWith('.') || e.name === '.env.example')
      .filter(e => !TREE_IGNORE.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
    for (const entry of sorted) {
      const prefix = '  '.repeat(depth);
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        const children = await buildFileTree(path.join(dirPath, entry.name), depth + 1, maxDepth);
        lines.push(...children);
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  } catch { /* directory unreadable */ }
  return lines;
}

/** Read key config/doc files from a project repo for chat context */
async function gatherCodebaseContext(repoPath: string): Promise<string> {
  const sections: string[] = [];

  // File tree
  const tree = await buildFileTree(repoPath);
  if (tree.length > 0) {
    sections.push(`### File Tree\n\`\`\`\n${tree.join('\n')}\n\`\`\``);
  }

  // Key files
  for (const filename of CONTEXT_FILES) {
    const filePath = path.join(repoPath, filename);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() || fileStat.size > 50_000) continue;
      const content = await readFile(filePath, 'utf-8');
      // Truncate very long files to keep context manageable
      const truncated = content.length > 4000
        ? content.slice(0, 4000) + '\n... (truncated)'
        : content;
      sections.push(`### ${filename}\n\`\`\`\n${truncated}\n\`\`\``);
    } catch { /* file doesn't exist */ }
  }

  return sections.join('\n\n');
}

// ─── Chat File Browser API ───────────────────────────────────────

/** List files in a project directory (for chat file picker) */
app.get('/api/chat/files', async (req, res) => {
  const projectId = req.query.projectId as string;
  const subPath = (req.query.path as string) || '';

  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  const project = await getProject(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const dirPath = path.resolve(project.repoPath, subPath);
  // Ensure path stays within the repo
  if (!dirPath.startsWith(path.resolve(project.repoPath))) {
    res.status(403).json({ error: 'Path outside project' });
    return;
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const items: { name: string; path: string; type: 'file' | 'dir' }[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (TREE_IGNORE.has(entry.name)) continue;

      const relPath = subPath ? `${subPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        items.push({ name: entry.name, path: relPath, type: 'dir' });
      } else {
        if (SENSITIVE_PATTERNS.some(p => p.test(entry.name))) continue;
        items.push({ name: entry.name, path: relPath, type: 'file' });
      }
    }

    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ items, current: subPath || '/' });
  } catch {
    res.status(400).json({ error: 'Cannot read directory' });
  }
});

/** Read a specific file from a project repo (for chat context) */
app.get('/api/chat/file', async (req, res) => {
  const projectId = req.query.projectId as string;
  const filePath = req.query.path as string;

  if (!projectId || !filePath) {
    res.status(400).json({ error: 'projectId and path are required' });
    return;
  }

  const project = await getProject(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!isPathSafe(project.repoPath, filePath)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const fullPath = path.resolve(project.repoPath, filePath);
  try {
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile()) {
      res.status(400).json({ error: 'Not a file' });
      return;
    }
    if (fileStat.size > 100_000) {
      res.status(413).json({ error: 'File too large (>100KB)' });
      return;
    }
    const content = await readFile(fullPath, 'utf-8');
    res.json({ path: filePath, content });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// ─── Chat Bot API ────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    return;
  }

  const { messages, projectId, filePaths } = req.body as {
    messages: ChatMessage[];
    projectId?: string;
    filePaths?: string[];
  };
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  try {
    // Gather current dashboard state and codebase context
    const [projectsData, teams, agents] = await Promise.all([
      getProjectsPayload(),
      getAllTeamsWithData(),
      detectSoloAgents(),
    ]);

    // Gather codebase context — scoped to selected project if provided
    let codebaseSection = '';
    const selectedProject = projectId
      ? projectsData.projects.find(p => p.id === projectId)
      : null;

    if (selectedProject) {
      // Scoped: show only the selected project's context
      const ctx = await gatherCodebaseContext(selectedProject.repoPath);
      codebaseSection = ctx ? `## ${selectedProject.name} (${selectedProject.repoPath})\n\n${ctx}` : '';

      // Append any explicitly requested file contents
      if (filePaths && filePaths.length > 0) {
        const fileContents: string[] = [];
        for (const fp of filePaths.slice(0, 10)) { // cap at 10 files
          if (!isPathSafe(selectedProject.repoPath, fp)) continue;
          const fullPath = path.resolve(selectedProject.repoPath, fp);
          try {
            const fileStat = await stat(fullPath);
            if (!fileStat.isFile() || fileStat.size > 100_000) continue;
            const content = await readFile(fullPath, 'utf-8');
            const truncated = content.length > 8000
              ? content.slice(0, 8000) + '\n... (truncated)'
              : content;
            fileContents.push(`### ${fp}\n\`\`\`\n${truncated}\n\`\`\``);
          } catch { /* skip unreadable files */ }
        }
        if (fileContents.length > 0) {
          codebaseSection += '\n\n## Attached Files\n\n' + fileContents.join('\n\n');
        }
      }
    } else {
      // No project selected: show all projects (original behavior)
      const codebaseContexts = await Promise.all(
        projectsData.projects.map(async (p) => {
          const ctx = await gatherCodebaseContext(p.repoPath);
          return ctx ? `## ${p.name} (${p.repoPath})\n\n${ctx}` : '';
        }),
      );
      codebaseSection = codebaseContexts.filter(Boolean).join('\n\n---\n\n');
    }

    const focusNote = selectedProject
      ? `The user is currently focused on the **${selectedProject.name}** project. Answer questions in that context.`
      : '';

    const systemPrompt = `You are a helpful assistant embedded in the Agent Kanban dashboard — a real-time monitoring tool for Claude Code agents.

You have access to the current state of projects, tickets, teams, and agents, as well as key files from each project's codebase. You can answer questions about project configuration, code structure, dependencies, and setup.
${focusNote ? `\n${focusNote}\n` : ''}
# Dashboard State

## Projects (${projectsData.projects.length})
${projectsData.projects.map(p => `- **${p.name}** (${p.repoPath}) — branch: ${p.defaultBranch}${p.remoteUrl ? `, remote: ${p.remoteUrl}` : ''}`).join('\n') || 'None'}

## Tickets (${projectsData.tickets.length})
${projectsData.tickets.map(t => {
  const project = projectsData.projects.find(p => p.id === t.projectId);
  return `- [${t.status}] **${t.subject}** (project: ${project?.name ?? t.projectId})${t.prUrl ? ` — PR: ${t.prUrl}` : ''}${t.error ? ` — error: ${t.error}` : ''}${t.branchName ? ` — branch: ${t.branchName}` : ''}`;
}).join('\n') || 'None'}

## Teams (${teams.length})
${teams.map(t => `- **${t.name}**: ${t.members.length} members (${t.members.map(m => m.name).join(', ')}), ${t.tasks.length} tasks`).join('\n') || 'None'}

## Solo Agents (${agents.length})
${agents.map(a => `- **${a.projectName}** (${a.source}, ${a.status}) — branch: ${a.gitBranch ?? 'N/A'}, model: ${a.model ?? 'unknown'}`).join('\n') || 'None'}

# Codebase Context

${codebaseSection || 'No project codebases available.'}

Keep responses short and focused. Use markdown formatting. When asked about configuration, dependencies, or project structure, refer to the codebase context above.`;

    const anthropicMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: systemPrompt,
        messages: anthropicMessages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[chat] Anthropic API error:', response.status, errText);
      res.status(502).json({ error: 'Failed to get response from AI' });
      return;
    }

    const result = await response.json() as { content: { type: string; text: string }[] };
    const text = result.content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('');

    res.json({ content: text });
  } catch (err) {
    console.error('[chat] Error:', err);
    res.status(500).json({ error: 'Chat request failed' });
  }
});

// ─── Production Static Serving (PWA) ─────────────────────────────
// Serve the Vite build output when running in production mode.
// In development, Vite's dev server handles this instead.
const distDir = path.resolve(import.meta.dirname, '..', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: serve index.html for non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// ─── HTTP + WebSocket Server ─────────────────────────────────────

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(event: WSEvent) {
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// Wire dispatcher and auditor broadcasts to WebSocket
setDispatchBroadcast(broadcast);
setAuditorBroadcast(broadcast);
setSchedulerBroadcast(broadcast);
// Wire auditor → dispatcher merge callback (breaks circular import)
setAttemptMergeFn(attemptMerge);

wss.on('connection', async (ws) => {
  console.log(`[ws] Client connected (total: ${wss.clients.size})`);

  try {
    const [teams, projectsData, soloAgents] = await Promise.all([
      getAllTeamsWithData(),
      getProjectsPayload(),
      detectSoloAgents(),
    ]);
    ws.send(JSON.stringify({ type: 'initial', data: teams }));
    ws.send(JSON.stringify({ type: 'projects_updated', data: projectsData }));
    ws.send(JSON.stringify({ type: 'agents_updated', data: soloAgents }));
    ws.send(JSON.stringify({ type: 'auditor_updated', data: getWatchlistStatus() }));
    ws.send(JSON.stringify({ type: 'audit_schedules_updated', data: await listSchedules() }));
  } catch (err) {
    console.error('[ws] Error sending initial data:', err);
  }

  ws.on('close', () => {
    console.log(`[ws] Client disconnected (total: ${wss.clients.size})`);
  });
});

// ─── File Watcher (Team Monitoring) ─────────────────────────────

async function handleFileChange(event: ChangeEvent) {
  try {
    switch (event.kind) {
      case 'team_config': {
        if (event.isUnlink) {
          console.log(`[watcher] Team config deleted: ${event.teamName}`);
          broadcast({ type: 'team_removed', data: { name: event.teamName } });
          return;
        }
        const config = await readTeamConfig(event.teamName);
        if (!config) return;
        const [tasks, inboxes] = await Promise.all([
          readTeamTasks(event.teamName),
          readTeamInboxes(event.teamName),
        ]);
        const teamData: TeamWithData = { ...config, tasks, inboxes };
        broadcast({ type: 'team_updated', data: teamData });
        break;
      }
      case 'task': {
        const tasks = await readTeamTasks(event.teamName);
        const config = await readTeamConfig(event.teamName);
        if (!config) return;
        const inboxes = await readTeamInboxes(event.teamName);
        broadcast({
          type: 'team_updated',
          data: { ...config, tasks, inboxes } as TeamWithData,
        });
        break;
      }
      case 'inbox': {
        const inboxes = await readTeamInboxes(event.teamName);
        const agentName = event.detail;
        if (agentName && inboxes[agentName]) {
          broadcast({
            type: 'inbox_updated',
            data: { teamName: event.teamName, agentName, messages: inboxes[agentName] },
          });
        }
        const config = await readTeamConfig(event.teamName);
        if (config) {
          const tasks = await readTeamTasks(event.teamName);
          broadcast({
            type: 'team_updated',
            data: { ...config, tasks, inboxes } as TeamWithData,
          });
        }
        break;
      }
    }
  } catch (err) {
    console.error(`[watcher] Error handling ${event.kind} change:`, err);
  }
}

const watcher = startWatcher(handleFileChange);

// ─── Startup ────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[server] Agent Kanban backend running on http://localhost:${PORT}`);
  console.log(`[server] WebSocket available at ws://localhost:${PORT}/ws`);
  console.log(`[server] REST API at http://localhost:${PORT}/api/teams`);
  console.log(`[server] Projects API at http://localhost:${PORT}/api/projects`);
});

// Start the dispatcher, auditor, and audit scheduler
startDispatcher();
startAuditor();
startAuditScheduler();

// ─── Solo Agent Polling ──────────────────────────────────────────

let lastAgentsJson = '';
const agentPollInterval = setInterval(async () => {
  try {
    const agents = await detectSoloAgents();
    const json = JSON.stringify(agents);
    if (json !== lastAgentsJson) {
      lastAgentsJson = json;
      broadcast({ type: 'agents_updated', data: agents });
    }
  } catch { /* poll failure, retry next interval */ }
}, 5000);

// ─── Graceful Shutdown ──────────────────────────────────────────

function shutdown() {
  console.log('\n[server] Shutting down...');
  stopDispatcher();
  stopAuditor();
  stopAuditScheduler();
  clearInterval(agentPollInterval);
  watcher.close();
  wss.close();
  server.close(() => {
    console.log('[server] Stopped.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 3000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
