import { spawn, type ChildProcess } from 'node:child_process';
import { execSync } from 'node:child_process';
import { getProject, getTicket, updateTicket, listTickets } from './store.ts';
import type { Ticket, WSEvent } from '../src/types.ts';

const MAX_CONCURRENT = 5;
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

  // Build the prompt for Claude
  const promptLines = [ticket.instructions, '', '---'];

  if (useWorktree) {
    promptLines.push(
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
    promptLines.push(
      `You are working directly in: ${project.repoPath}`,
      'This repo has no commits yet, so no worktree was created.',
      '',
      'When you have completed all the work:',
      '1. Stage and commit all changes with clear commit messages',
    );
  }
  const prompt = promptLines.join('\n');

  console.log(`[dispatcher] Starting agent for ticket #${ticket.id}: ${ticket.subject}`);
  console.log(`[dispatcher] Working dir: ${agentCwd}${useWorktree ? ' (worktree)' : ' (direct)'}`);

  const args = ['-p', prompt, '--output-format', 'text'];
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

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
    // Periodically update lastOutput (last 500 chars)
    const last = stdout.slice(-500);
    updateTicket(ticket.id, { lastOutput: last }).then(t => {
      if (t) broadcastTicket(t);
    });
  });

  proc.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  proc.on('close', async (code) => {
    running.delete(ticket.id);
    console.log(`[dispatcher] Agent for ticket #${ticket.id} exited with code ${code}`);

    if (code !== 0) {
      const failedTicket = await updateTicket(ticket.id, {
        status: 'failed',
        error: stderr.slice(-500) || `Agent exited with code ${code}`,
        completedAt: Date.now(),
        agentPid: undefined,
      });
      if (failedTicket) await broadcastTicket(failedTicket);
      if (useWorktree) cleanupWorktree(project.repoPath, worktreePath);
      return;
    }

    // Try to find PR URL in output
    let prUrl: string | undefined;
    let prNumber: number | undefined;

    // Look for github PR URL in stdout
    const prUrlMatch = stdout.match(
      /https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/,
    );
    if (prUrlMatch) {
      prUrl = prUrlMatch[0];
      prNumber = parseInt(prUrlMatch[1], 10);
    }

    // If no PR found in output, try gh CLI
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
      completedAt: Date.now(),
      lastOutput: stdout.slice(-1000),
      agentPid: undefined,
    });
    if (reviewTicket) await broadcastTicket(reviewTicket);

    console.log(
      `[dispatcher] Ticket #${ticket.id} completed` +
        (prUrl ? ` — PR: ${prUrl}` : ' (no PR detected)'),
    );

    // Clean up worktree (keep the branch for the PR)
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

async function checkPrStatus(ticket: Ticket) {
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

    // Check conditions: approved + checks pass + mergeable
    const isApproved = pr.reviewDecision === 'APPROVED';
    const checks = pr.statusCheckRollup || [];
    const checksPassed = checks.length === 0 ||
      checks.every(c => c.state === 'SUCCESS');
    const isMergeable = pr.mergeable === 'MERGEABLE';

    if (isApproved && checksPassed && isMergeable) {
      console.log(`[auto-merge] Merging PR for ticket #${ticket.id}: ${ticket.prUrl}`);
      execSync(
        `gh pr merge "${ticket.prUrl}" --squash --delete-branch`,
        { cwd: project.repoPath, encoding: 'utf-8', timeout: 30000 },
      );
      const merged = await updateTicket(ticket.id, { status: 'merged' });
      if (merged) await broadcastTicket(merged);
      console.log(`[auto-merge] Ticket #${ticket.id} merged successfully`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[auto-merge] Error checking ticket #${ticket.id}: ${msg}`);
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
    // Check if PR has been merged
    await checkPrStatus(ticket);

    // If ticket has autoMerge enabled and still in_review, try to auto-merge
    if (ticket.autoMerge) {
      await checkAutoMerge(ticket);
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
