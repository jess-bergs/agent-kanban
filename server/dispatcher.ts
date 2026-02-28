import { spawn, type ChildProcess } from 'node:child_process';
import { execSync } from 'node:child_process';
import { getProject, getTicket, updateTicket, listTickets } from './store.ts';
import type { Ticket, AgentActivity, TicketEffort, SecurityAlert, WSEvent } from '../src/types.ts';

const MAX_CONCURRENT = 5;
const MAX_ACTIVITY_ENTRIES = 20;
const running = new Map<string, ChildProcess>();

type BroadcastFn = (event: WSEvent) => void;
let broadcastFn: BroadcastFn = () => {};

export function setDispatchBroadcast(fn: BroadcastFn) {
  broadcastFn = fn;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

async function broadcastTicket(ticket: Ticket) {
  broadcastFn({ type: 'ticket_updated', data: ticket });
}

async function startAgent(ticket: Ticket) {
  const project = await getProject(ticket.projectId);
  if (!project) {
    await updateTicket(ticket.id, {
      status: 'error',
      error: `Project ${ticket.projectId} not found`,
    });
    return;
  }

  const branchName = `agent/ticket-${ticket.id}-${slugify(ticket.subject)}`;
  const worktreePath = `/tmp/agent-kanban-worktrees/${branchName.replace(/\//g, '-')}`;

  // Check if repo has any commits
  let hasCommits = false;
  try {
    execSync('git rev-parse HEAD', { cwd: project.repoPath, stdio: 'ignore' });
    hasCommits = true;
  } catch {
    // no commits yet
  }

  let agentCwd: string;
  let useWorktree = false;

  if (hasCommits) {
    // Update ticket to in_progress with worktree info
    const updated = await updateTicket(ticket.id, {
      status: 'in_progress',
      branchName,
      worktreePath,
      startedAt: Date.now(),
    });
    if (updated) await broadcastTicket(updated);

    try {
      // Fetch latest from remote
      try {
        execSync(`git fetch origin`, { cwd: project.repoPath, stdio: 'ignore' });
      } catch {
        // may fail if no remote, continue anyway
      }

      // Clean up existing worktree if it exists
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, {
          cwd: project.repoPath,
          stdio: 'ignore',
        });
      } catch {}

      // Try to delete the branch if it exists from a previous run
      try {
        execSync(`git branch -D "${branchName}"`, {
          cwd: project.repoPath,
          stdio: 'ignore',
        });
      } catch {}

      // Determine the best base ref
      let baseRef = `origin/${project.defaultBranch}`;
      try {
        execSync(`git rev-parse --verify "${baseRef}"`, {
          cwd: project.repoPath, stdio: 'ignore',
        });
      } catch {
        try {
          execSync(`git rev-parse --verify "${project.defaultBranch}"`, {
            cwd: project.repoPath, stdio: 'ignore',
          });
          baseRef = project.defaultBranch;
        } catch {
          baseRef = 'HEAD';
        }
      }

      execSync(
        `git worktree add "${worktreePath}" -b "${branchName}" "${baseRef}"`,
        { cwd: project.repoPath, stdio: 'ignore' },
      );
      agentCwd = worktreePath;
      useWorktree = true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errTicket = await updateTicket(ticket.id, {
        status: 'error',
        error: `Git worktree setup failed: ${errMsg}`,
      });
      if (errTicket) await broadcastTicket(errTicket);
      return;
    }
  } else {
    // No commits — work directly in the repo
    agentCwd = project.repoPath;
    const updated = await updateTicket(ticket.id, {
      status: 'in_progress',
      startedAt: Date.now(),
    });
    if (updated) await broadcastTicket(updated);
  }

  // Build the task description for the agent
  const taskLines = [ticket.instructions, '', '---'];

  if (useWorktree) {
    taskLines.push(
      `You are working in a git worktree on branch "${branchName}" based on "${project.defaultBranch}".`,
      `The repository is: ${project.remoteUrl || project.repoPath}`,
      '',
      'When you have completed all the work:',
      '1. Stage and commit all changes with clear commit messages',
      `2. Push the branch: git push -u origin ${branchName}`,
      `3. Create a pull request: gh pr create --base ${project.defaultBranch} --fill`,
      '4. Output the PR URL on its own line at the end',
    );
  } else {
    taskLines.push(
      `You are working directly in: ${project.repoPath}`,
      'This repo has no commits yet, so no worktree was created.',
      '',
      'When you have completed all the work:',
      '1. Stage and commit all changes with clear commit messages',
    );
  }

  const taskDescription = taskLines.join('\n');

  console.log(`[dispatcher] Starting agent for ticket #${ticket.id}: ${ticket.subject}`);
  console.log(`[dispatcher] Working dir: ${agentCwd}${useWorktree ? ' (worktree)' : ' (direct)'}`);

  let prompt: string;
  if (ticket.useRalph) {
    console.log(`[dispatcher] Ralph Wiggum mode enabled (max 50 iterations)`);
    // Invoke ralph-loop skill with the task as the prompt
    // Escape quotes in task description for shell safety
    const escapedTask = taskDescription.replace(/"/g, '\\"');
    prompt = `/ralph-loop "${escapedTask}\n\nWhen COMPLETELY finished, output: <promise>TICKET_COMPLETE</promise>" --max-iterations 50 --completion-promise "TICKET_COMPLETE"`;
  } else {
    prompt = taskDescription;
  }

  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
  if (ticket.yolo) {
    args.push('--dangerously-skip-permissions');
  }

  // Remove CLAUDECODE env to avoid "cannot be launched inside another Claude Code session" error
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE;

  const proc = spawn('claude', args, {
    cwd: agentCwd,
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  running.set(ticket.id, proc);

  const pidUpdate = await updateTicket(ticket.id, { agentPid: proc.pid });
  if (pidUpdate) await broadcastTicket(pidUpdate);

  let stderr = '';
  // Accumulated text output (for PR URL detection and final lastOutput)
  let fullText = '';
  // Live activity feed and reasoning state
  const activity: AgentActivity[] = [];
  let lastThinking = '';
  let lineBuffer = '';
  // Effort tracking
  const effort: TicketEffort = { turns: 0, toolCalls: 0 };
  // Track message IDs to deduplicate usage stats (stream-json duplicates per content block)
  const seenMessageIds = new Set<string>();

  function pushActivity(entry: AgentActivity) {
    activity.push(entry);
    if (activity.length > MAX_ACTIVITY_ENTRIES) {
      activity.splice(0, activity.length - MAX_ACTIVITY_ENTRIES);
    }
  }

  function processStreamLine(line: string) {
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      fullText += line + '\n';
      return;
    }

    const type = event.type as string;
    const now = Date.now();

    if (type === 'assistant') {
      const msg = event.message as { id?: string; content?: Array<Record<string, unknown>>; usage?: Record<string, number> } | undefined;
      const msgId = msg?.id as string | undefined;
      // Count each unique assistant message as one API turn
      if (msgId && !seenMessageIds.has(msgId)) {
        seenMessageIds.add(msgId);
        effort.turns++;
        // Capture usage only once per message to avoid stream-json duplication
        const usage = msg?.usage;
        if (usage) {
          effort.inputTokens = (effort.inputTokens || 0) + (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
          effort.outputTokens = (effort.outputTokens || 0) + (usage.output_tokens || 0);
        }
      }
      const contentBlocks = msg?.content;
      if (Array.isArray(contentBlocks)) {
        for (const block of contentBlocks) {
          if (block.type === 'thinking' && typeof block.thinking === 'string') {
            lastThinking = (block.thinking as string).slice(-1000);
            pushActivity({
              type: 'thinking',
              content: (block.thinking as string).slice(-200),
              timestamp: now,
            });
          } else if (block.type === 'text' && typeof block.text === 'string') {
            const text = block.text as string;
            fullText += text + '\n';
            pushActivity({
              type: 'text',
              content: text.slice(-200),
              timestamp: now,
            });
          } else if (block.type === 'tool_use') {
            effort.toolCalls++;
            const toolName = (block.name as string) || 'unknown';
            const input = block.input ? JSON.stringify(block.input).slice(0, 150) : '';
            pushActivity({
              type: 'tool_use',
              tool: toolName,
              content: input,
              timestamp: now,
            });
          } else if (block.type === 'tool_result') {
            const content = typeof block.content === 'string'
              ? block.content.slice(0, 150)
              : '';
            pushActivity({
              type: 'tool_result',
              content,
              timestamp: now,
            });
          }
        }
      }
    } else if (type === 'result') {
      const resultText = event.result as string | undefined;
      if (resultText) {
        fullText += resultText + '\n';
      }
      // Capture cost from result event if available
      const costUsd = event.cost_usd as number | undefined;
      if (typeof costUsd === 'number') {
        effort.costUsd = costUsd;
      }
      // Also try usage from result event
      const resultUsage = event.usage as Record<string, number> | undefined;
      if (resultUsage && !effort.inputTokens) {
        effort.inputTokens = (resultUsage.input_tokens || 0) + (resultUsage.cache_read_input_tokens || 0);
        effort.outputTokens = resultUsage.output_tokens || 0;
      }
    }

    updateTicket(ticket.id, {
      lastOutput: fullText.slice(-500),
      agentActivity: [...activity],
      lastThinking: lastThinking || undefined,
      effort: { ...effort },
    }).then(t => {
      if (t) broadcastTicket(t);
    });
  }

  proc.stdout.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';
    for (const line of lines) {
      processStreamLine(line);
    }
  });

  proc.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  proc.on('close', async (code) => {
    if (lineBuffer.trim()) {
      processStreamLine(lineBuffer);
    }

    running.delete(ticket.id);
    console.log(`[dispatcher] Agent for ticket #${ticket.id} exited with code ${code}`);

    // Compute duration for effort
    const completedAt = Date.now();
    const currentTicket = await getTicket(ticket.id);
    if (currentTicket?.startedAt) {
      effort.durationMs = completedAt - currentTicket.startedAt;
    }

    if (code !== 0) {
      const failedTicket = await updateTicket(ticket.id, {
        status: 'failed',
        error: stderr.slice(-500) || `Agent exited with code ${code}`,
        completedAt,
        agentPid: undefined,
        effort: { ...effort },
      });
      if (failedTicket) await broadcastTicket(failedTicket);
      if (useWorktree) cleanupWorktree(project.repoPath, worktreePath);
      return;
    }

    let prUrl: string | undefined;
    let prNumber: number | undefined;

    const prUrlMatch = fullText.match(
      /https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/,
    );
    if (prUrlMatch) {
      prUrl = prUrlMatch[0];
      prNumber = parseInt(prUrlMatch[1], 10);
    }

    if (!prUrl) {
      try {
        const ghResult = execSync(
          `gh pr list --head "${branchName}" --json url,number --jq '.[0]'`,
          { cwd: agentCwd, encoding: 'utf-8', timeout: 10000 },
        ).trim();
        if (ghResult) {
          const parsed = JSON.parse(ghResult);
          prUrl = parsed.url;
          prNumber = parsed.number;
        }
      } catch {
        // no PR found
      }
    }

    const reviewTicket = await updateTicket(ticket.id, {
      status: 'in_review',
      prUrl,
      prNumber,
      completedAt,
      lastOutput: fullText.slice(-1000),
      agentActivity: [...activity],
      lastThinking: lastThinking || undefined,
      agentPid: undefined,
      effort: { ...effort },
    });
    if (reviewTicket) await broadcastTicket(reviewTicket);

    console.log(
      `[dispatcher] Ticket #${ticket.id} completed` +
        (prUrl ? ` — PR: ${prUrl}` : ' (no PR detected)'),
    );

    cleanupWorktree(project.repoPath, worktreePath);
  });
}

function cleanupWorktree(repoPath: string, worktreePath: string) {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: repoPath,
      stdio: 'ignore',
    });
  } catch {
    // non-critical
  }
}

// ─── PR Status Monitoring ───────────────────────────────────────

interface PrStatus {
  state: string;
  mergeable: string;
  reviewDecision: string;
  statusCheckRollup: { state: string }[];
}

export async function checkPrStatus(ticket: Ticket) {
  if (!ticket.prUrl || ticket.status !== 'in_review') return;

  const project = await getProject(ticket.projectId);
  if (!project) return;

  try {
    const prJson = execSync(
      `gh pr view "${ticket.prUrl}" --json state`,
      { cwd: project.repoPath, encoding: 'utf-8', timeout: 15000 },
    ).trim();

    const pr: { state: string } = JSON.parse(prJson);

    if (pr.state === 'MERGED') {
      const merged = await updateTicket(ticket.id, { status: 'merged' });
      if (merged) await broadcastTicket(merged);
      console.log(`[pr-monitor] Ticket #${ticket.id} PR has been merged`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pr-monitor] Error checking ticket #${ticket.id}: ${msg}`);
  }
}

async function checkAutoMerge(ticket: Ticket) {
  if (!ticket.autoMerge || !ticket.prUrl || ticket.status !== 'in_review') return;

  const project = await getProject(ticket.projectId);
  if (!project) return;

  try {
    // Query PR status via gh CLI
    const prJson = execSync(
      `gh pr view "${ticket.prUrl}" --json state,mergeable,reviewDecision,statusCheckRollup`,
      { cwd: project.repoPath, encoding: 'utf-8', timeout: 15000 },
    ).trim();

    const pr: PrStatus = JSON.parse(prJson);

    // Already merged or closed
    if (pr.state === 'MERGED') {
      const merged = await updateTicket(ticket.id, { status: 'merged' });
      if (merged) await broadcastTicket(merged);
      console.log(`[auto-merge] Ticket #${ticket.id} PR already merged`);
      return;
    }
    if (pr.state === 'CLOSED') return;

    // Check conditions: reviews OK + checks pass + mergeable
    // reviewDecision is "" when no reviews are required, "APPROVED" when approved,
    // "CHANGES_REQUESTED" or "REVIEW_REQUIRED" when blocking
    const reviewBlocking = pr.reviewDecision === 'CHANGES_REQUESTED' ||
      pr.reviewDecision === 'REVIEW_REQUIRED';
    const checks = pr.statusCheckRollup || [];
    const checksPassed = checks.length === 0 ||
      checks.every(c => c.state === 'SUCCESS');
    const isMergeable = pr.mergeable === 'MERGEABLE';

    if (!reviewBlocking && checksPassed && isMergeable) {
      console.log(`[auto-merge] Merging PR for ticket #${ticket.id}: ${ticket.prUrl}`);
      execSync(
        `gh pr merge "${ticket.prUrl}" --squash --delete-branch`,
        { cwd: project.repoPath, encoding: 'utf-8', timeout: 30000 },
      );
      const merged = await updateTicket(ticket.id, { status: 'merged' });
      if (merged) await broadcastTicket(merged);
      console.log(`[auto-merge] Ticket #${ticket.id} merged successfully`);
    } else {
      console.log(
        `[auto-merge] Ticket #${ticket.id} not ready — ` +
        `reviewBlocking=${reviewBlocking}, checksPassed=${checksPassed}, isMergeable=${isMergeable}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[auto-merge] Error checking ticket #${ticket.id}: ${msg}`);
  }
}

// ─── Security Alert Detection ───────────────────────────────────

/** Parse security alerts from PR review comments posted by bots */
function parseSecurityAlerts(comments: Array<{
  body: string;
  path?: string;
  line?: number;
  html_url: string;
  user?: { type?: string };
}>): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];
  for (const comment of comments) {
    // Only look at bot comments
    if (comment.user?.type !== 'Bot') continue;
    const body = comment.body || '';
    // Match the security review comment format:
    // 🤖 **Security Issue: {summary}**
    const summaryMatch = body.match(/\*\*Security Issue:\s*(.+?)\*\*/);
    if (!summaryMatch) continue;
    const severityMatch = body.match(/\*\*Severity:\*\*\s*(CRITICAL|HIGH|MEDIUM|LOW)/i);
    const categoryMatch = body.match(/\*\*Category:\*\*\s*(\S+)/);
    alerts.push({
      severity: (severityMatch?.[1]?.toUpperCase() || 'MEDIUM') as SecurityAlert['severity'],
      category: categoryMatch?.[1] || 'unknown',
      summary: summaryMatch[1].trim(),
      body,
      path: comment.path,
      line: comment.line ?? undefined,
      htmlUrl: comment.html_url,
    });
  }
  return alerts;
}

/** Fetch security alerts for a ticket's PR and update the ticket if changed */
export async function fetchSecurityAlerts(ticket: Ticket): Promise<SecurityAlert[]> {
  if (!ticket.prUrl || !ticket.prNumber) return [];

  const project = await getProject(ticket.projectId);
  if (!project?.remoteUrl) return [];

  // Extract owner/repo from remote URL
  const repoMatch = project.remoteUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);
  if (!repoMatch) return [];
  const repo = repoMatch[1].replace(/\.git$/, '');

  try {
    const json = execSync(
      `gh api repos/${repo}/pulls/${ticket.prNumber}/comments --jq '[.[] | {body, path, line, html_url, user: {type: .user.type}}]'`,
      { cwd: project.repoPath, encoding: 'utf-8', timeout: 15000 },
    ).trim();
    if (!json) return [];
    const comments = JSON.parse(json);
    return parseSecurityAlerts(comments);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[security] Error fetching PR comments for ticket #${ticket.id}: ${msg}`);
    return [];
  }
}

async function checkSecurityAlerts(ticket: Ticket) {
  if (!ticket.prUrl || !ticket.prNumber) return;
  if (ticket.status !== 'in_review') return;

  const alerts = await fetchSecurityAlerts(ticket);
  // Only update if alerts changed
  const existing = ticket.securityAlerts || [];
  if (alerts.length === existing.length &&
      alerts.every((a, i) => a.htmlUrl === existing[i]?.htmlUrl)) {
    return;
  }
  const updated = await updateTicket(ticket.id, { securityAlerts: alerts.length > 0 ? alerts : undefined });
  if (updated) await broadcastTicket(updated);
  if (alerts.length > 0) {
    console.log(`[security] Ticket #${ticket.id} has ${alerts.length} security alert(s)`);
  }
}

// ─── Dispatcher Tick ────────────────────────────────────────────

export async function dispatcherTick() {
  const tickets = await listTickets();

  // Start new agents
  if (running.size < MAX_CONCURRENT) {
    const todoTickets = tickets.filter(t => t.status === 'todo');

    // Separate queued from non-queued tickets
    const nonQueued = todoTickets.filter(t => !t.queued);
    const queued = todoTickets.filter(t => t.queued);

    // Prioritize non-queued tickets first, then queued tickets
    // Only process queued tickets if no non-queued tickets exist
    const prioritized = nonQueued.length > 0
      ? nonQueued.sort((a, b) => a.createdAt - b.createdAt)
      : queued.sort((a, b) => a.createdAt - b.createdAt);

    for (const ticket of prioritized) {
      if (running.size >= MAX_CONCURRENT) break;
      if (running.has(ticket.id)) continue;
      await startAgent(ticket);
    }
  }

  // Check PR status for all in_review tickets
  const inReviewTickets = tickets.filter(
    t => t.status === 'in_review' && t.prUrl,
  );
  for (const ticket of inReviewTickets) {
    // Check if PR has been merged externally
    await checkPrStatus(ticket);

    // Check for security alerts in PR comments
    await checkSecurityAlerts(ticket);

    // Re-read ticket from DB since checkPrStatus may have updated status to 'merged'
    if (ticket.autoMerge) {
      const fresh = await getTicket(ticket.id);
      if (fresh && fresh.status === 'in_review') {
        await checkAutoMerge(fresh);
      }
    }
  }
}

/** Kill a running agent by ticket ID */
export function killAgent(ticketId: string): boolean {
  const proc = running.get(ticketId);
  if (proc) {
    console.log(`[dispatcher] Killing agent for ticket #${ticketId}`);
    proc.kill('SIGTERM');
    running.delete(ticketId);
    return true;
  }
  return false;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startDispatcher() {
  console.log('[dispatcher] Started (polling every 3s, max concurrent: ' + MAX_CONCURRENT + ')');
  // Initial tick
  dispatcherTick();
  // Poll for new tickets
  intervalId = setInterval(dispatcherTick, 3000);
}

export function stopDispatcher() {
  if (intervalId) clearInterval(intervalId);
  // Kill running agents
  for (const [id, proc] of running) {
    console.log(`[dispatcher] Killing agent for ticket #${id}`);
    proc.kill('SIGTERM');
  }
  running.clear();
}
