import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
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
  listTickets,
  listTicketsByProject,
  createTicket,
  getTicket,
  updateTicket,
  deleteTicket,
  getProjectsPayload,
} from './store.ts';
import { startDispatcher, stopDispatcher, setDispatchBroadcast, killAgent, checkPrStatus, conflictCheckTick } from './dispatcher.ts';
import { detectSoloAgents } from './solo-agents.ts';
import { runAudit, isAuditRunning, setAuditorBroadcast } from './auditor.ts';
import type { TeamWithData, WSEvent } from '../src/types.ts';

const PORT = 3003;

const app = express();
app.use(cors({ origin: 'http://localhost:5174' }));
app.use(express.json());

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
      } catch {}
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
    let name = repoPath.split('/').pop() || repoPath;
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
    const { projectId, subject, instructions, yolo, autoMerge, queued, useRalph } = req.body;
    if (!projectId || !subject || !instructions) {
      res.status(400).json({ error: 'projectId, subject, and instructions are required' });
      return;
    }
    const ticket = await createTicket({
      projectId, subject, instructions,
      yolo: !!yolo,
      autoMerge: !!autoMerge,
      queued: !!queued,
      useRalph: !!useRalph,
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
  const ticket = await updateTicket(req.params.id, req.body);
  if (ticket) {
    broadcast({ type: 'ticket_updated', data: ticket });
    res.json(ticket);
  } else {
    res.status(404).json({ error: 'Ticket not found' });
  }
});

app.post('/api/tickets/:id/retry', async (req, res) => {
  const ticket = await updateTicket(req.params.id, {
    status: 'todo',
    error: undefined,
    branchName: undefined,
    worktreePath: undefined,
    startedAt: undefined,
    completedAt: undefined,
    lastOutput: undefined,
    agentPid: undefined,
  });
  if (ticket) {
    broadcast({ type: 'ticket_updated', data: ticket });
    res.json(ticket);
  } else {
    res.status(404).json({ error: 'Ticket not found' });
  }
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
  if (isAuditRunning(ticket.id)) {
    res.status(409).json({ error: 'Audit already running for this ticket' });
    return;
  }
  // Fire and forget — audit runs asynchronously
  runAudit(ticket).catch(err => {
    console.error(`[api] Audit failed for ticket #${ticket.id}:`, err);
  });
  res.json({ success: true, message: 'Audit started' });
});

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

// Start the dispatcher
startDispatcher();

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
  } catch {}
}, 5000);

// ─── Graceful Shutdown ──────────────────────────────────────────

function shutdown() {
  console.log('\n[server] Shutting down...');
  stopDispatcher();
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
