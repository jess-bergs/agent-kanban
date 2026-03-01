import { spawn, type ChildProcess } from 'node:child_process';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { getProject, getTicket, updateTicket, listTickets, getImagesDir } from './store.ts';
import { captureAndUploadScreenshots } from './screenshots.ts';
import { runAudit } from './auditor.ts';
import type { Ticket, AgentActivity, TicketEffort, WSEvent, FailureReason } from '../src/types.ts';
import { envWithNvmNode } from './nvm.ts';

const MAX_CONCURRENT = 5;
const MAX_AUTO_RETRIES = 2;
const MAX_ACTIVITY_ENTRIES = 20;
const APPROVAL_WAIT_THRESHOLD_MS = 15_000; // 15s without tool_result = likely waiting for approval
const running = new Map<string, ChildProcess>();
/** Tracks the last stream activity time per ticket, for detecting approval waits */
const lastStreamActivity = new Map<string, number>();
/** Tracks whether the last emitted event was a tool_use without a matching tool_result */
const pendingToolApproval = new Map<string, boolean>();
/** Tracks ticket IDs that were explicitly aborted by the user (vs crashing) */
const abortedTickets = new Set<string>();

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
      failureReason: { type: 'project_not_found', projectId: ticket.projectId },
    }, 'project_not_found');
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
    }, 'agent_started');
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
      } catch { /* worktree may not exist */ }

      // Try to delete the branch if it exists from a previous run
      try {
        execSync(`git branch -D "${branchName}"`, {
          cwd: project.repoPath,
          stdio: 'ignore',
        });
      } catch { /* branch may not exist */ }

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
        failureReason: { type: 'worktree_setup_failed', detail: errMsg },
      }, 'worktree_setup_failed');
      if (errTicket) await broadcastTicket(errTicket);
      return;
    }
  } else {
    // No commits — work directly in the repo
    agentCwd = project.repoPath;
    const updated = await updateTicket(ticket.id, {
      status: 'in_progress',
      startedAt: Date.now(),
    }, 'agent_started');
    if (updated) await broadcastTicket(updated);
  }

  // Build the task description for the agent
  const taskLines: string[] = [];

  // If images are attached, tell the agent about them first
  if (ticket.images && ticket.images.length > 0) {
    const imagesDir = getImagesDir();
    taskLines.push(
      'so i can show you screenshots etc where i spot issues',
      '',
    );
    for (const img of ticket.images) {
      taskLines.push(join(imagesDir, img.filename));
    }
    taskLines.push('');
  }

  taskLines.push(ticket.instructions, '', '---');

  // Investigation-first instructions for all dispatched agents
  taskLines.push(
    '## Investigation-First Approach',
    '',
    'Before writing ANY code, you MUST thoroughly investigate the relevant parts of the codebase:',
    '',
    '1. **Understand the context** — Read CLAUDE.md, AGENTS.md, and any referenced docs to learn project conventions, architecture, and patterns.',
    '2. **Trace the existing code** — Find and read ALL files related to the feature or bug. Follow imports, check call sites, and understand how data flows through the system.',
    '3. **Identify the scope** — Map out every file that will need changes. Look for related tests, types, documentation, and downstream consumers.',
    '4. **Check for prior art** — Search for similar patterns already in the codebase. Match existing conventions rather than inventing new ones.',
    '5. **Form a plan** — Only after understanding the full picture, decide on your approach. If the change is non-trivial, outline what you will do before doing it.',
    '',
    'Do NOT skip investigation. Jumping straight to code leads to incomplete fixes, missed edge cases, and inconsistent patterns.',
    '',
    '---',
  );

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
      '',
      `Ticket-ID: ${ticket.id}`,
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

  if (ticket.useTeam) {
    taskLines.push(
      '',
      'IMPORTANT: You should spawn a team of sub-agents to help you accomplish this task. Use the TeamCreate and Agent tools to coordinate parallel work across teammates. This is a heavy-lifting task that benefits from multiple agents working together.',
    );
  }

  const taskDescription = taskLines.join('\n');

  console.log(`[dispatcher] Starting agent for ticket #${ticket.id}: ${ticket.subject}`);
  if (ticket.useTeam) {
    console.log(`[dispatcher] Team mode enabled (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)`);
  }
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

  // Remove env vars that would override subscription auth or block nested sessions
  const cleanEnv: Record<string, string | undefined> = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE;
  delete cleanEnv.ANTHROPIC_API_KEY;

  // Enable or disable agent teams based on ticket option
  cleanEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = ticket.useTeam ? '1' : '0';

  const proc = spawn('claude', args, {
    cwd: agentCwd,
    env: envWithNvmNode(cleanEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  running.set(ticket.id, proc);
  lastStreamActivity.set(ticket.id, Date.now());
  pendingToolApproval.set(ticket.id, false);

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
  // Track the latest pending stream write so close handler can wait for it
  let pendingStreamWrite: Promise<unknown> = Promise.resolve();
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
    lastStreamActivity.set(ticket.id, now);

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
            // Mark that we're waiting for a tool result (non-YOLO agents may need approval)
            if (!ticket.yolo) {
              pendingToolApproval.set(ticket.id, true);
            }
          } else if (block.type === 'tool_result') {
            const content = typeof block.content === 'string'
              ? block.content.slice(0, 150)
              : '';
            pushActivity({
              type: 'tool_result',
              content,
              timestamp: now,
            });
            // Tool result received — agent is no longer waiting for approval
            if (pendingToolApproval.get(ticket.id)) {
              pendingToolApproval.set(ticket.id, false);
              // Transition back to in_progress if we were in needs_approval
              getTicket(ticket.id).then(t => {
                if (t && t.status === 'needs_approval') {
                  updateTicket(ticket.id, { status: 'in_progress' }, 'tool_approved').then(u => {
                    if (u) broadcastTicket(u);
                  });
                }
              });
            }
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

    pendingStreamWrite = updateTicket(ticket.id, {
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
    // Wait for any in-flight stream writes to finish before the final status update
    await pendingStreamWrite;

    running.delete(ticket.id);
    lastStreamActivity.delete(ticket.id);
    pendingToolApproval.delete(ticket.id);
    const wasAborted = abortedTickets.delete(ticket.id);
    console.log(`[dispatcher] Agent for ticket #${ticket.id} exited with code ${code}${wasAborted ? ' (aborted by user)' : ''}`);

    // Compute duration for effort
    const completedAt = Date.now();
    const currentTicket = await getTicket(ticket.id);
    if (currentTicket?.startedAt) {
      effort.durationMs = completedAt - currentTicket.startedAt;
    }

    if (code !== 0) {
      const failureReason: FailureReason = wasAborted
        ? { type: 'user_abort' }
        : { type: 'agent_exit', code: code ?? 1 };
      const failedTicket = await updateTicket(ticket.id, {
        status: 'failed',
        error: wasAborted ? 'Aborted by user' : (stderr.slice(-500) || `Agent exited with code ${code}`),
        failureReason,
        completedAt,
        agentPid: undefined,
        effort: { ...effort },
      }, wasAborted ? 'user_abort' : 'agent_failed');
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
    }, 'agent_completed');
    if (reviewTicket) await broadcastTicket(reviewTicket);

    console.log(
      `[dispatcher] Ticket #${ticket.id} completed` +
        (prUrl ? ` — PR: ${prUrl}` : ' (no PR detected)'),
    );

    // Ensure ticket ID is in the PR body for cross-referencing
    if (prUrl) {
      try {
        ensureTicketIdInPr(prUrl, ticket.id, agentCwd);
      } catch (err) {
        console.error(`[dispatcher] Failed to add ticket ID to PR #${ticket.id}:`, err);
      }
    }

    // Best-effort screenshot capture for PRs (before worktree cleanup)
    if (prUrl && useWorktree) {
      try {
        await captureAndUploadScreenshots(reviewTicket || ticket);
      } catch (err) {
        console.error(`[dispatcher] Screenshot capture failed for ticket #${ticket.id}:`, err);
      }
    }

    cleanupWorktree(project.repoPath, worktreePath);

    // Run local auditor review on the PR (best-effort, non-blocking)
    if (prUrl) {
      const auditTicket = await getTicket(ticket.id);
      if (auditTicket) {
        runAudit(auditTicket).catch(err => {
          console.error(`[dispatcher] Auditor failed for ticket #${ticket.id}:`, err);
        });
      }
    }
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

// ─── Ticket ID ↔ PR Cross-Referencing ───────────────────────────

const TICKET_ID_MARKER = '<!-- ticket-id:';
const TICKET_ID_PATTERN = /<!-- ticket-id:([a-f0-9-]+) -->/;

/**
 * Ensures the PR body contains a machine-readable ticket ID marker.
 * Idempotent — skips if the marker is already present.
 */
function ensureTicketIdInPr(prUrl: string, ticketId: string, cwd: string) {
  const body = execSync(
    `gh pr view "${prUrl}" --json body --jq '.body'`,
    { cwd, encoding: 'utf-8', timeout: 10000 },
  ).trim();

  if (body.includes(`${TICKET_ID_MARKER}${ticketId} -->`)) {
    return; // already present
  }

  const marker = `${TICKET_ID_MARKER}${ticketId} -->`;
  const footer = `\n\n---\nTicket-ID: \`${ticketId}\`\n${marker}`;
  const newBody = body + footer;

  execSync(
    `gh pr edit "${prUrl}" --body ${JSON.stringify(newBody)}`,
    { cwd, encoding: 'utf-8', timeout: 10000 },
  );
  console.log(`[dispatcher] Added ticket ID ${ticketId} to PR: ${prUrl}`);
}

/**
 * Extracts a ticket ID from a PR body, if present.
 * Useful for reverse-lookups (PR → ticket) during self-healing.
 */
export function extractTicketIdFromPr(prBody: string): string | null {
  const match = prBody.match(TICKET_ID_PATTERN);
  return match ? match[1] : null;
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
      `gh pr view "${ticket.prUrl}" --json state,mergeable`,
      { cwd: project.repoPath, encoding: 'utf-8', timeout: 15000 },
    ).trim();

    const pr: { state: string; mergeable: string } = JSON.parse(prJson);

    if (pr.state === 'MERGED') {
      const merged = await updateTicket(ticket.id, { status: 'merged', hasConflict: false }, 'pr_merged');
      if (merged) await broadcastTicket(merged);
      console.log(`[pr-monitor] Ticket #${ticket.id} PR has been merged`);
      return;
    }

    // Update conflict status on every PR status check
    const isConflicting = pr.mergeable === 'CONFLICTING';
    if (isConflicting !== !!ticket.hasConflict) {
      const updates: Partial<Ticket> = { hasConflict: isConflicting };
      if (isConflicting) {
        updates.conflictDetectedAt = ticket.conflictDetectedAt || Date.now();
      } else {
        updates.conflictDetectedAt = undefined;
      }
      const updated = await updateTicket(ticket.id, updates);
      if (updated) {
        await broadcastTicket(updated);
        console.log(`[pr-monitor] Ticket #${ticket.id} conflict status: ${isConflicting}`);
      }
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
      const merged = await updateTicket(ticket.id, { status: 'merged' }, 'pr_merged');
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
      const merged = await updateTicket(ticket.id, { status: 'merged' }, 'auto_merged');
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

// ─── Hourly Conflict Detection ──────────────────────────────────

async function checkPrConflicts(ticket: Ticket) {
  if (!ticket.prUrl || ticket.status !== 'in_review') return;

  const project = await getProject(ticket.projectId);
  if (!project) return;

  try {
    const prJson = execSync(
      `gh pr view "${ticket.prUrl}" --json mergeable,state`,
      { cwd: project.repoPath, encoding: 'utf-8', timeout: 15000 },
    ).trim();

    const pr: { mergeable: string; state: string } = JSON.parse(prJson);

    // Skip closed/merged PRs
    if (pr.state === 'MERGED' || pr.state === 'CLOSED') return;

    const isConflicting = pr.mergeable === 'CONFLICTING';

    if (isConflicting && !ticket.hasConflict) {
      // Newly detected conflict
      const updated = await updateTicket(ticket.id, {
        hasConflict: true,
        conflictDetectedAt: Date.now(),
      });
      if (updated) {
        await broadcastTicket(updated);
        console.log(`[conflict-check] Ticket #${ticket.id} PR has merge conflicts`);
      }
    } else if (!isConflicting && ticket.hasConflict) {
      // Conflict resolved
      const updated = await updateTicket(ticket.id, {
        hasConflict: false,
        conflictDetectedAt: undefined,
      });
      if (updated) {
        await broadcastTicket(updated);
        console.log(`[conflict-check] Ticket #${ticket.id} conflicts resolved`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[conflict-check] Error checking ticket #${ticket.id}: ${msg}`);
  }
}

export async function conflictCheckTick() {
  const tickets = await listTickets();
  const inReview = tickets.filter(t => t.status === 'in_review' && t.prUrl);

  for (const ticket of inReview) {
    await checkPrConflicts(ticket);
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

  // Check for non-YOLO agents that may be waiting for permission approval
  const inProgressTickets = tickets.filter(
    t => t.status === 'in_progress' && !t.yolo && running.has(t.id),
  );
  const now = Date.now();
  for (const ticket of inProgressTickets) {
    const lastActivity = lastStreamActivity.get(ticket.id);
    const hasPendingTool = pendingToolApproval.get(ticket.id);
    if (hasPendingTool && lastActivity && (now - lastActivity) > APPROVAL_WAIT_THRESHOLD_MS) {
      const updated = await updateTicket(ticket.id, { status: 'needs_approval' }, 'waiting_tool_approval');
      if (updated) await broadcastTicket(updated);
      console.log(`[dispatcher] Ticket #${ticket.id} appears to be waiting for tool approval`);
    }
  }

  // Check PR status for all in_review tickets
  const inReviewTickets = tickets.filter(
    t => t.status === 'in_review' && t.prUrl,
  );
  for (const ticket of inReviewTickets) {
    // Check if PR has been merged externally
    await checkPrStatus(ticket);

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

/** Abort a running agent — marks it as user-initiated so the close handler shows a friendly message */
export function abortAgent(ticketId: string): boolean {
  const proc = running.get(ticketId);
  if (proc) {
    console.log(`[dispatcher] Aborting agent for ticket #${ticketId} (user-initiated)`);
    abortedTickets.add(ticketId);
    proc.kill('SIGTERM');
    // Don't delete from running — let the close handler do cleanup
    return true;
  }
  return false;
}

let intervalId: ReturnType<typeof setInterval> | null = null;
let conflictIntervalId: ReturnType<typeof setInterval> | null = null;

const CONFLICT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function countOrphanRecoveries(ticket: Ticket): number {
  if (!ticket.stateLog) return 0;
  return ticket.stateLog.filter(
    e => e.reason === 'orphan_recovery' || e.reason === 'auto_retry',
  ).length;
}

async function recoverOrphanedTickets() {
  const tickets = await listTickets();
  const orphaned = tickets.filter(
    t => t.status === 'in_progress' && !running.has(t.id),
  );

  let retried = 0;
  let failed = 0;

  for (const ticket of orphaned) {
    const alive = ticket.agentPid && isProcessAlive(ticket.agentPid);
    if (alive) continue;

    // Clean up stale worktree in all cases (startAgent creates a fresh one)
    if (ticket.worktreePath) {
      const project = await getProject(ticket.projectId);
      if (project) cleanupWorktree(project.repoPath, ticket.worktreePath);
    }

    const priorAttempts = countOrphanRecoveries(ticket);

    if (priorAttempts < MAX_AUTO_RETRIES) {
      // Under budget — reset to todo for automatic re-dispatch
      console.log(`[dispatcher] Auto-retrying orphaned ticket #${ticket.id}: ${ticket.subject} (attempt ${priorAttempts + 1}/${MAX_AUTO_RETRIES})`);
      const updated = await updateTicket(ticket.id, {
        status: 'todo',
        error: undefined,
        failureReason: undefined,
        branchName: undefined,
        worktreePath: undefined,
        startedAt: undefined,
        completedAt: undefined,
        lastOutput: undefined,
        agentPid: undefined,
      }, 'auto_retry');
      if (updated) broadcastTicket(updated);
      retried++;
    } else {
      // Budget exhausted — mark failed
      console.log(`[dispatcher] Orphaned ticket #${ticket.id} exceeded auto-retry budget (${priorAttempts}/${MAX_AUTO_RETRIES})`);
      const updated = await updateTicket(ticket.id, {
        status: 'failed',
        error: `Auto-retry budget exhausted (${priorAttempts} attempts)`,
        failureReason: { type: 'retry_budget_exhausted', attempts: priorAttempts },
        completedAt: Date.now(),
        agentPid: undefined,
      }, 'orphan_recovery');
      if (updated) broadcastTicket(updated);
      failed++;
    }
  }

  if (retried > 0 || failed > 0) {
    console.log(`[dispatcher] Orphan recovery: ${retried} auto-retried, ${failed} marked failed`);
  }
}

export async function startDispatcher() {
  console.log('[dispatcher] Started (polling every 3s, max concurrent: ' + MAX_CONCURRENT + ')');
  // Recover tickets orphaned by previous server shutdown
  await recoverOrphanedTickets();
  // Initial tick
  dispatcherTick();
  // Poll for new tickets
  intervalId = setInterval(dispatcherTick, 3000);
  // Hourly conflict check for all in-review PRs
  conflictCheckTick();
  conflictIntervalId = setInterval(conflictCheckTick, CONFLICT_CHECK_INTERVAL_MS);
  console.log('[dispatcher] Conflict check scheduled (every 1h)');
}

export function stopDispatcher() {
  if (intervalId) clearInterval(intervalId);
  if (conflictIntervalId) clearInterval(conflictIntervalId);
  // Kill running agents
  for (const [id, proc] of running) {
    console.log(`[dispatcher] Killing agent for ticket #${id}`);
    proc.kill('SIGTERM');
  }
  running.clear();
}
