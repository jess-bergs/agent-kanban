import { spawn, type ChildProcess } from 'node:child_process';
import { execSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { getProject, getTicket, updateTicket, listTickets, getImagesDir } from './store.ts';
import { captureAndUploadScreenshots } from './screenshots.ts';
import { runAudit, resetStuckReviews } from './auditor.ts';
import type { Ticket, AgentActivity, TicketEffort, WSEvent, FailureReason } from '../src/types.ts';
import { isSignalExit, SIGNAL_NAMES } from '../src/types.ts';
import { envWithNvmNode } from './nvm.ts';

const MAX_CONCURRENT = 5;
const MAX_AUTO_RETRIES = 2;
const MAX_AUTOMATION_ITERATIONS = 5;
const MAX_ACTIVITY_ENTRIES = 20;
const MAX_AGENT_TURNS = 50;
const APPROVAL_WAIT_THRESHOLD_MS = 15_000; // 15s without tool_result = likely waiting for approval
const running = new Map<string, ChildProcess>();
/** Tracks the last stream activity time per ticket, for detecting approval waits */
const lastStreamActivity = new Map<string, number>();
/** Tracks whether the last emitted event was a tool_use without a matching tool_result */
const pendingToolApproval = new Map<string, boolean>();
/** Tracks whether the agent called an interactive tool (AskUserQuestion, EnterPlanMode) that needs user input */
const pendingUserInput = new Map<string, boolean>();
/** Tools that require user input regardless of yolo mode */
const INTERACTIVE_TOOLS = new Set(['AskUserQuestion', 'EnterPlanMode']);
/** Tracks ticket IDs that were explicitly aborted by the user (vs crashing) */
const abortedTickets = new Set<string>();
/** Tracks ticket IDs that were terminated for exceeding max turns */
const maxTurnsExceeded = new Set<string>();
/** Tracks the last auto-merge check time per ticket to throttle gh CLI calls */
const lastAutoMergeCheck = new Map<string, number>();
/** Tracks the last auto-merge "not ready" reason per ticket to avoid duplicate logs */
const autoMergeLastState = new Map<string, string>();
/** Tracks consecutive not-ready checks per ticket for exponential backoff */
const autoMergeNotReadyCount = new Map<string, number>();
const AUTO_MERGE_CHECK_INTERVAL_MS = 30_000; // 30 seconds between checks per ticket
const AUTO_MERGE_MAX_INTERVAL_MS = 5 * 60_000; // 5 minutes max backoff
/** Extra delay added after usage limit reset before resuming (avoids racing the reset) */
const USAGE_LIMIT_RESUME_BUFFER_MS = 5 * 60_000; // 5 minutes
/** Minimum hold duration — if the reset is less than this far away, just wait; otherwise hold */
const USAGE_LIMIT_MIN_HOLD_MS = 3 * 60_000; // 3 minutes

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

/**
 * Detect a usage/rate limit error from agent output or stderr.
 * Returns the parsed reset timestamp (Unix ms) if detected, or null.
 *
 * Known patterns:
 * - Anthropic: "You've hit your limit · resets 3am (Europe/London)"
 * - Generic:   "rate limit", "usage limit", "quota exceeded"
 * - Claude CLI: "error: Rate limit exceeded" or similar
 */
function detectUsageLimit(text: string): number | null {
  if (!text) return null;

  // Pattern 1: "resets <time> (<timezone>)" — e.g., "resets 3am (Europe/London)"
  const resetTimeMatch = text.match(
    /resets?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*\(([^)]+)\)/i,
  );
  if (resetTimeMatch) {
    const timeStr = resetTimeMatch[1].trim();
    const tz = resetTimeMatch[2].trim();
    const resetTs = parseResetTime(timeStr, tz);
    if (resetTs) return resetTs;
  }

  // Pattern 2: "resets at <ISO time>" or "resets at <time>"
  const resetAtMatch = text.match(
    /resets?\s+at\s+(\d{4}-\d{2}-\d{2}T[\d:.Z+-]+|\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
  );
  if (resetAtMatch) {
    const isoAttempt = Date.parse(resetAtMatch[1]);
    if (!isNaN(isoAttempt)) return isoAttempt;
    // Fallback: assume local timezone
    const resetTs = parseResetTime(resetAtMatch[1].trim(), undefined);
    if (resetTs) return resetTs;
  }

  // Pattern 3: "resets in <N> minutes/hours"
  const resetInMatch = text.match(
    /resets?\s+in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)/i,
  );
  if (resetInMatch) {
    const amount = parseInt(resetInMatch[1], 10);
    const unit = resetInMatch[2].toLowerCase();
    const ms = unit.startsWith('h') ? amount * 3600_000 : amount * 60_000;
    return Date.now() + ms;
  }

  // Check for generic usage limit keywords (no parseable reset time → default 1 hour)
  const limitPatterns = [
    /you've hit your limit/i,
    /usage limit/i,
    /rate limit/i,
    /quota exceeded/i,
    /too many requests/i,
    /resource_exhausted/i,
    /overloaded/i,
  ];
  for (const pattern of limitPatterns) {
    if (pattern.test(text)) {
      // Default: assume 1 hour reset
      return Date.now() + 3600_000;
    }
  }

  return null;
}

/**
 * Parse a reset time like "3am" or "3:00pm" into a Unix timestamp.
 * If the resulting time is in the past, assumes it means tomorrow.
 */
function parseResetTime(timeStr: string, tz: string | undefined): number | null {
  const match = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3].toLowerCase();

  if (period === 'pm' && hours !== 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;

  // Build a date string for today at the given time in the given timezone
  const now = new Date();

  // Use Intl to figure out the current date in the target timezone
  let targetDate: Date;
  try {
    // Format today's date in the target timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const dateStr = formatter.format(now); // YYYY-MM-DD
    targetDate = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);

    // Convert from target timezone to UTC using offset estimation
    // Get the timezone offset by comparing formatted time
    const inTz = new Date(targetDate.toLocaleString('en-US', { timeZone: tz || undefined }));
    const inLocal = new Date(targetDate.toLocaleString('en-US'));
    const offset = inLocal.getTime() - inTz.getTime();
    targetDate = new Date(targetDate.getTime() + offset);
  } catch {
    // Fallback if timezone is invalid: use local timezone
    targetDate = new Date();
    targetDate.setHours(hours, minutes, 0, 0);
  }

  // If the time has already passed today, it means tomorrow
  if (targetDate.getTime() <= now.getTime()) {
    targetDate.setTime(targetDate.getTime() + 24 * 3600_000);
  }

  return targetDate.getTime();
}

async function broadcastTicket(ticket: Ticket) {
  broadcastFn({ type: 'ticket_updated', data: ticket });
}

// ─── Active Merge + Conflict Resolution ─────────────────────────

/**
 * Parse "owner/repo" from a GitHub remote URL (HTTPS or SSH).
 */
function parseOwnerRepo(remoteUrl: string): string | null {
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/.]+)/);
  const sshMatch = remoteUrl.match(/github\.com:([^/]+\/[^/.]+)/);
  const repo = (httpsMatch?.[1] || sshMatch?.[1])?.replace(/\.git$/, '');
  return repo || null;
}

/**
 * Attempt to merge a PR for a ticket. Handles MERGEABLE, BEHIND, CONFLICTING states.
 */
export async function attemptMerge(ticket: Ticket): Promise<void> {
  if (!ticket.prUrl || !ticket.prNumber) return;

  const project = await getProject(ticket.projectId);
  if (!project) return;

  try {
    const prJson = execSync(
      `gh pr view "${ticket.prUrl}" --json state,mergeable,reviewDecision,statusCheckRollup`,
      { cwd: project.repoPath, encoding: 'utf-8', timeout: 15000 },
    ).trim();

    const pr: {
      state: string;
      mergeable: string;
      reviewDecision: string;
      statusCheckRollup: { status: string; conclusion: string; state?: string }[];
    } = JSON.parse(prJson);

    if (pr.state === 'MERGED') {
      const merged = await updateTicket(ticket.id, { status: 'merged', hasConflict: false }, 'pr_merged');
      if (merged) await broadcastTicket(merged);
      console.log(`[merge] Ticket #${ticket.id} PR already merged`);
      return;
    }
    if (pr.state === 'CLOSED') return;

    const checks = pr.statusCheckRollup || [];
    const checksPassed = checks.length === 0 || checks.every(c =>
      c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED'
    );
    const checksFailed = checks.some(c =>
      c.conclusion === 'FAILURE' || c.conclusion === 'ERROR' || c.conclusion === 'TIMED_OUT'
    );

    // Gate: don't merge unless auditor has completed successfully
    const freshTicket = await getTicket(ticket.id);
    const auditStatus = freshTicket?.auditStatus;
    const auditVerdict = freshTicket?.auditVerdict;
    if (auditStatus === 'running' || auditStatus === 'pending') {
      console.log(`[merge] Ticket #${ticket.id} audit still ${auditStatus} — deferring merge`);
      return;
    }
    if (auditStatus === 'error') {
      console.log(`[merge] Ticket #${ticket.id} audit errored — blocking merge until audit succeeds`);
      return;
    }
    if (auditVerdict === 'request_changes') {
      console.log(`[merge] Ticket #${ticket.id} audit requested changes — skipping merge`);
      return;
    }

    if (pr.mergeable === 'MERGEABLE' && checksPassed) {
      console.log(`[merge] Merging PR for ticket #${ticket.id}: ${ticket.prUrl}`);
      execSync(
        `gh pr merge "${ticket.prUrl}" --squash --delete-branch`,
        { cwd: project.repoPath, encoding: 'utf-8', timeout: 30000 },
      );
      const merged = await updateTicket(ticket.id, { status: 'merged', hasConflict: false }, 'auto_merged');
      if (merged) await broadcastTicket(merged);
      console.log(`[merge] Ticket #${ticket.id} merged successfully`);
      return;
    }

    if (pr.mergeable === 'UNKNOWN') {
      console.log(`[merge] Ticket #${ticket.id} mergeable=UNKNOWN, will retry on next tick`);
      return;
    }

    if (checksFailed) {
      console.log(`[merge] Ticket #${ticket.id} CI checks failed`);
      const failed = await updateTicket(ticket.id, {
        status: 'failed',
        error: 'CI checks failed on PR',
        failureReason: { type: 'other', detail: 'ci_checks_failed' },
        completedAt: Date.now(),
      }, 'ci_checks_failed');
      if (failed) await broadcastTicket(failed);
      return;
    }

    if (pr.mergeable === 'CONFLICTING') {
      await dispatchConflictResolution(ticket, project);
      return;
    }

    // BEHIND or checks still pending — try branch update, let poller retry
    if (!checksPassed && !checksFailed) {
      console.log(`[merge] Ticket #${ticket.id} checks still pending, will retry on next tick`);
      return;
    }

    await updatePrBranch(ticket, project);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[merge] Error for ticket #${ticket.id}: ${msg}`);
  }
}

/**
 * Update PR branch via GitHub API (for when branch is behind base).
 */
async function updatePrBranch(ticket: Ticket, project: { repoPath: string; remoteUrl?: string }): Promise<void> {
  if (!ticket.prNumber || !project.remoteUrl) return;

  const ownerRepo = parseOwnerRepo(project.remoteUrl);
  if (!ownerRepo) return;

  try {
    console.log(`[merge] Updating branch for PR #${ticket.prNumber} on ${ownerRepo}`);
    execSync(
      `gh api -X PUT repos/${ownerRepo}/pulls/${ticket.prNumber}/update-branch`,
      { cwd: project.repoPath, encoding: 'utf-8', timeout: 15000 },
    );
    console.log(`[merge] Branch update requested for ticket #${ticket.id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[merge] Branch update failed for ticket #${ticket.id}: ${msg}`);
  }
}

/**
 * Dispatch an agent to resolve merge conflicts on the PR branch.
 */
async function dispatchConflictResolution(ticket: Ticket, project: { repoPath: string; defaultBranch: string }): Promise<void> {
  const iteration = ticket.automationIteration || 0;

  if (iteration >= MAX_AUTOMATION_ITERATIONS) {
    console.log(`[merge] Ticket #${ticket.id} conflict resolution exceeded automation budget (${iteration}/${MAX_AUTOMATION_ITERATIONS})`);
    const failed = await updateTicket(ticket.id, {
      status: 'failed',
      error: `Automation budget exhausted after ${iteration} iterations (conflict resolution)`,
      failureReason: { type: 'automation_budget_exhausted', iterations: iteration },
      completedAt: Date.now(),
    }, 'automation_budget_exhausted');
    if (failed) await broadcastTicket(failed);
    return;
  }

  const conflictPrompt = [
    `The PR branch has merge conflicts with ${project.defaultBranch}.`,
    '',
    'Please resolve the conflicts:',
    `1. Merge the base branch: git merge origin/${project.defaultBranch}`,
    '2. Resolve any conflicts in the affected files',
    '3. Stage the resolved files and commit',
    '4. Push the updated branch',
    '',
    'Do NOT create a new PR — push to the existing branch.',
  ].join('\n');

  console.log(`[merge] Dispatching conflict resolution for ticket #${ticket.id} (iteration: ${iteration + 1})`);
  const updated = await updateTicket(ticket.id, {
    status: 'todo',
    error: undefined,
    failureReason: undefined,
    completedAt: undefined,
    agentPid: undefined,
    lastOutput: undefined,
    hasConflict: true,
    resumePrompt: conflictPrompt,
    automationIteration: iteration + 1,
    postAgentAction: 'merge',
  }, 'conflict_resolution_dispatched');
  if (updated) await broadcastTicket(updated);
}

/**
 * Discover the Claude Code session ID from JSONL files in the projects directory.
 * Claude stores sessions at ~/.claude/projects/{slug}/{session-id}.jsonl
 * where slug = worktreePath with '/' replaced by '-' and leading '/' stripped, prefixed with '-'.
 */
function discoverSessionId(worktreePath: string): string | null {
  try {
    // Resolve symlinks (macOS: /tmp → /private/tmp) to match Claude Code's session path
    let resolved = worktreePath;
    try { resolved = realpathSync(worktreePath); } catch { /* worktree may already be removed */ }

    const projectsDir = join(homedir(), '.claude', 'projects');
    // Try resolved path first, then original (fallback if realpath failed)
    const candidates = [resolved, worktreePath].map(
      p => join(projectsDir, `-${p.replace(/^\//, '').replace(/\//g, '-')}`),
    );
    // Deduplicate
    const dirs = [...new Set(candidates)];

    let files: string[] = [];
    let dir = '';
    for (const d of dirs) {
      try {
        files = readdirSync(d).filter(f => f.endsWith('.jsonl'));
        if (files.length > 0) { dir = d; break; }
      } catch { /* directory doesn't exist */ }
    }
    if (files.length === 0) return null;

    if (files.length === 0) return null;

    // Find most recently modified JSONL file
    let newest: { file: string; mtime: number } | null = null;
    for (const file of files) {
      const fullPath = join(dir, file);
      const st = statSync(fullPath);
      if (!newest || st.mtimeMs > newest.mtime) {
        newest = { file: fullPath, mtime: st.mtimeMs };
      }
    }

    if (!newest) return null;

    // Read first line to extract sessionId from metadata
    const content = readFileSync(newest.file, 'utf-8');
    const firstLine = content.split('\n')[0];
    if (!firstLine) return null;

    const metadata = JSON.parse(firstLine);
    return metadata.sessionId || null;
  } catch (err) {
    console.error(`[dispatcher] Failed to discover session ID for ${worktreePath}:`, err);
    return null;
  }
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

  // Resume mode: reuse existing branch if the auditor requested changes
  const isResume = !!(ticket.agentSessionId && ticket.branchName && ticket.resumePrompt);
  const branchName = isResume ? ticket.branchName! : `agent/ticket-${ticket.id}-${slugify(ticket.subject)}`;
  const worktreePath = `/tmp/agent-kanban-worktrees/${branchName.replace(/\//g, '-')}`;
  const teamName = ticket.useTeam ? `ticket-${ticket.id.slice(0, 8)}` : undefined;

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
      teamName,
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

      if (isResume) {
        // Resume: create worktree from existing remote branch
        console.log(`[dispatcher] Resume mode: creating worktree from origin/${branchName}`);
        try {
          // Delete stale local branch if it exists
          execSync(`git branch -D "${branchName}"`, {
            cwd: project.repoPath, stdio: 'ignore',
          });
        } catch { /* branch may not exist locally */ }

        execSync(
          `git worktree add "${worktreePath}" "origin/${branchName}"`,
          { cwd: project.repoPath, stdio: 'ignore' },
        );
      } else {
        // Fresh: create new branch from default branch
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
      }

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
      teamName,
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

  if (ticket.planOnly) {
    // Plan-only mode: investigate and produce a report, no code changes
    taskLines.push(
      '## Plan-Only Mode (Investigation & Report)',
      '',
      'You are in PLAN-ONLY mode. Do NOT write any code or make any implementation changes.',
      'Your job is to thoroughly investigate the codebase and produce a detailed report.',
      '',
      '### Investigation Steps',
      '',
      '1. **Understand the context** — Read CLAUDE.md, AGENTS.md, and any referenced docs to learn project conventions, architecture, and patterns.',
      '2. **Trace the existing code** — Find and read ALL files related to the topic. Follow imports, check call sites, and understand how data flows through the system.',
      '3. **Identify the scope** — Map out every file that would need changes. Look for related tests, types, documentation, and downstream consumers.',
      '4. **Check for prior art** — Search for similar patterns already in the codebase. Note existing conventions and utilities.',
      '5. **Assess risks and trade-offs** — Identify potential pitfalls, edge cases, breaking changes, and architectural implications.',
      '',
      '### Report Requirements',
      '',
      'After your investigation, write a comprehensive report as a Markdown file named `plan-report.md` in the root of the repository. The report MUST include:',
      '',
      '- **Summary** — One-paragraph overview of the investigation topic.',
      '- **Relevant Files** — List of all files examined with brief descriptions of their role.',
      '- **Current Architecture** — How the relevant parts of the system currently work.',
      '- **Proposed Approach** — Detailed plan for how to implement the requested changes, broken into steps.',
      '- **Files to Modify** — Specific files that would need changes, with a description of what changes are needed in each.',
      '- **Risks & Edge Cases** — Potential issues, breaking changes, and things to watch out for.',
      '- **Open Questions** — Any ambiguities or decisions that need human input before implementation.',
      '',
      'Do NOT implement any code changes. Only investigate and write the report.',
      '',
      '---',
    );
  } else {
    // Plan-first instructions: investigate, plan, then execute efficiently
    taskLines.push(
      '## Plan First, Then Execute',
      '',
      'You have a **strict budget of ' + MAX_AGENT_TURNS + ' turns**. Use them wisely by planning before coding.',
      '',
      '### Phase 1: Investigate (3-5 turns)',
      '1. Read CLAUDE.md/AGENTS.md for conventions and architecture.',
      '2. Find and read the key files related to this task. Use parallel tool calls to read multiple files at once.',
      '3. Check for prior art and existing patterns.',
      '',
      '### Phase 2: Plan (1 turn)',
      '4. Write a brief plan as a numbered list: what files to change, what changes in each, what order.',
      '',
      '### Phase 3: Execute (remaining turns)',
      '5. Implement the changes following your plan. Batch related edits together.',
      '6. Build/test to verify.',
      '',
      '**Cost control rules:**',
      '- Do NOT re-read files you have already read.',
      '- Do NOT make exploratory edits — know what you want to write before writing it.',
      '- Combine multiple independent tool calls into a single response.',
      '- If a build fails, fix the issue in one pass rather than iterating.',
      '',
      '---',
    );
  }

  if (useWorktree) {
    taskLines.push(
      `You are working in a git worktree on branch "${branchName}" based on "${project.defaultBranch}".`,
      `The repository is: ${project.remoteUrl || project.repoPath}`,
      '',
      'When you have completed all the work:',
      '1. Stage and commit all changes with clear commit messages',
      `2. Push the branch: git push -u origin ${branchName}`,
      '3. Create a pull request using the repo\'s PR template (see below)',
      '4. Output the PR URL on its own line at the end',
      '',
      `Ticket-ID: ${ticket.id}`,
      '',
      '---',
      '## PR Creation (IMPORTANT)',
      '',
      'You MUST use the PR template at `.github/pull_request_template.md` when creating the PR.',
      'Do NOT use `gh pr create --fill` — it ignores the template.',
      '',
      'Steps:',
      '1. Read `.github/pull_request_template.md`',
      '2. Fill in every section: Description, Changes, Type of Change (mark checkboxes with x),',
      '   Screenshots (if UI changes), Testing (check what you did), and Checklist (check all that apply)',
      `3. Set the Ticket section to: \`${ticket.id}\``,
      '4. Create the PR with a HEREDOC body:',
      '   ```',
      `   gh pr create --base ${project.defaultBranch} --title "your title" --body "$(cat <<'EOF'`,
      '   <filled-in template content here>',
      '   EOF',
      '   )"',
      '   ```',
      '',
      'The PR will be rejected by the auditor if the template is not followed.',
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

  if (ticket.useTeam && teamName) {
    taskLines.push(
      '',
      `IMPORTANT — Team Mode:`,
      `Your FIRST action must be to create a team using TeamCreate with the team name "${teamName}".`,
      `Then use the Task tool with team_name: "${teamName}" to spawn teammates and coordinate parallel work.`,
      'This is a heavy-lifting task that benefits from multiple agents working together.',
      `Do NOT use any other team name. The dashboard tracks this ticket by the team name "${teamName}".`,
    );
  }

  const taskDescription = taskLines.join('\n');

  console.log(`[dispatcher] Starting agent for ticket #${ticket.id}: ${ticket.subject}`);
  if (ticket.planOnly) {
    console.log(`[dispatcher] Plan-only mode enabled (investigation & report only)`);
  }
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

  let args: string[];
  if (isResume && ticket.agentSessionId) {
    // Resume existing session with auditor feedback
    console.log(`[dispatcher] Resuming session ${ticket.agentSessionId} with review feedback`);
    args = ['--resume', ticket.agentSessionId, '-p', ticket.resumePrompt!, '--output-format', 'stream-json', '--verbose'];
  } else {
    args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
  }
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
  pendingUserInput.set(ticket.id, false);

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
        // Kill agent if it exceeds max turns to prevent runaway cost
        if (effort.turns >= MAX_AGENT_TURNS && !maxTurnsExceeded.has(ticket.id)) {
          maxTurnsExceeded.add(ticket.id);
          console.log(`[dispatcher] Ticket #${ticket.id} hit max turns (${MAX_AGENT_TURNS}) — terminating agent`);
          proc.kill('SIGTERM');
        }
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
            // Interactive tools need user input regardless of yolo mode
            if (INTERACTIVE_TOOLS.has(toolName)) {
              pendingUserInput.set(ticket.id, true);
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
            if (pendingToolApproval.get(ticket.id) || pendingUserInput.get(ticket.id)) {
              pendingToolApproval.set(ticket.id, false);
              pendingUserInput.set(ticket.id, false);
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
    pendingUserInput.delete(ticket.id);
    const wasAborted = abortedTickets.delete(ticket.id);
    const hitMaxTurns = maxTurnsExceeded.delete(ticket.id);
    console.log(`[dispatcher] Agent for ticket #${ticket.id} exited with code ${code}${wasAborted ? ' (aborted by user)' : ''}${hitMaxTurns ? ` (max turns ${MAX_AGENT_TURNS})` : ''}`);

    // Compute duration for effort
    const completedAt = Date.now();
    const currentTicket = await getTicket(ticket.id);
    if (currentTicket?.startedAt) {
      effort.durationMs = completedAt - currentTicket.startedAt;
    }

    if (code !== 0) {
      const exitCode = code ?? 1;
      const signalTerminated = isSignalExit(exitCode);
      const signalName = SIGNAL_NAMES[exitCode] ?? `signal ${exitCode - 128}`;

      // Check for usage/rate limit errors before generic failure handling
      if (!wasAborted && !signalTerminated) {
        const combinedOutput = (stderr + '\n' + fullText).slice(-2000);
        const resetsAt = detectUsageLimit(combinedOutput);
        if (resetsAt) {
          const holdUntil = resetsAt + USAGE_LIMIT_RESUME_BUFFER_MS;
          const timeUntilReset = resetsAt - Date.now();

          // Only hold if the reset is more than a few minutes away
          if (timeUntilReset > USAGE_LIMIT_MIN_HOLD_MS) {
            const resetTimeStr = new Date(resetsAt).toLocaleTimeString();
            const resumeTimeStr = new Date(holdUntil).toLocaleTimeString();
            console.log(`[dispatcher] Usage limit detected for ticket #${ticket.id} — resets at ${resetTimeStr}, will resume at ${resumeTimeStr}`);

            const heldTicket = await updateTicket(ticket.id, {
              status: 'on_hold',
              error: `Usage limit reached — resets at ${resetTimeStr}`,
              failureReason: { type: 'usage_limit', resetsAt },
              holdUntil,
              agentPid: undefined,
              effort: { ...effort },
            }, 'usage_limit_hold');
            if (heldTicket) await broadcastTicket(heldTicket);
            if (useWorktree) cleanupWorktree(project.repoPath, worktreePath);
            return;
          }
          // If reset is imminent (< 3 min), fall through to normal failure handling
          // and let the user retry manually
          console.log(`[dispatcher] Usage limit detected for ticket #${ticket.id} but reset is imminent (${Math.round(timeUntilReset / 1000)}s away) — marking as failed`);
        }
      }

      let failureReason: FailureReason;
      let errorMsg: string;
      let stateReason: string;

      if (hitMaxTurns) {
        failureReason = { type: 'other', detail: `Exceeded max turns (${MAX_AGENT_TURNS})` };
        errorMsg = `Agent terminated: exceeded ${MAX_AGENT_TURNS}-turn limit (${effort.toolCalls} tool calls)`;
        stateReason = 'max_turns_exceeded';
      } else if (wasAborted) {
        failureReason = { type: 'user_abort' };
        errorMsg = 'Aborted by user';
        stateReason = 'user_abort';
      } else if (signalTerminated) {
        failureReason = { type: 'signal_exit', code: exitCode, signal: signalName };
        errorMsg = `Agent was stopped (${signalName})`;
        stateReason = 'signal_exit';
      } else {
        failureReason = { type: 'agent_exit', code: exitCode };
        errorMsg = stderr.slice(-500) || `Agent exited with code ${exitCode}`;
        stateReason = 'agent_failed';
      }

      const failedTicket = await updateTicket(ticket.id, {
        status: 'failed',
        error: errorMsg,
        failureReason,
        completedAt,
        agentPid: undefined,
        effort: { ...effort },
      }, stateReason);
      if (failedTicket) await broadcastTicket(failedTicket);
      if (useWorktree) cleanupWorktree(project.repoPath, worktreePath);
      return;
    }

    // Read the current ticket to check for existing prUrl (preserve on resume)
    const preUpdateTicket = await getTicket(ticket.id);

    let prUrl: string | undefined;
    let prNumber: number | undefined;

    // Preserve existing PR info on resume — agent shouldn't clobber it
    if (preUpdateTicket?.prUrl) {
      prUrl = preUpdateTicket.prUrl;
      prNumber = preUpdateTicket.prNumber;
    } else {
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
    }

    // Extract plan summary from plan-report.md for plan-only tickets
    let planSummary: string | undefined;
    if (ticket.planOnly) {
      try {
        const reportPath = join(agentCwd, 'plan-report.md');
        const report = await readFile(reportPath, 'utf-8');
        planSummary = extractPlanSummary(report);
        if (planSummary) {
          console.log(`[dispatcher] Extracted plan summary for ticket #${ticket.id}`);
        }
      } catch {
        // plan-report.md may not exist if agent failed to create it
      }
    }

    // Capture Claude Code session ID before worktree cleanup (JNSLs persist after cleanup)
    let agentSessionId: string | undefined;
    if (useWorktree) {
      const sessionId = discoverSessionId(worktreePath);
      if (sessionId) {
        agentSessionId = sessionId;
        console.log(`[dispatcher] Captured session ID ${sessionId} for ticket #${ticket.id}`);
      }
    }

    // Read postAgentAction before clearing it (one-shot field)
    const postAgentAction = preUpdateTicket?.postAgentAction;

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
      ...(planSummary ? { planSummary } : {}),
      agentSessionId,
      postAgentAction: undefined, // Clear one-shot field
    }, 'agent_completed');
    if (reviewTicket) await broadcastTicket(reviewTicket);

    console.log(
      `[dispatcher] Ticket #${ticket.id} completed` +
        (prUrl ? ` — PR: ${prUrl}` : ' (no PR detected)') +
        (postAgentAction ? ` (postAgentAction: ${postAgentAction})` : ''),
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

    // Post-completion action: branch on postAgentAction
    if (prUrl) {
      const freshTicket = await getTicket(ticket.id);
      if (freshTicket) {
        if (postAgentAction === 'merge') {
          // After conflict resolution → straight to merge (skip auditor)
          console.log(`[dispatcher] Post-action: attempting merge for ticket #${ticket.id}`);
          attemptMerge(freshTicket).catch(err => {
            console.error(`[dispatcher] Post-action merge failed for ticket #${ticket.id}:`, err);
          });
        } else {
          // Default ('audit' or undefined) → run auditor
          runAudit(freshTicket).catch(err => {
            console.error(`[dispatcher] Auditor failed for ticket #${ticket.id}:`, err);
          });
        }
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

/**
 * Extract a mini summary from a plan-report.md file.
 * Looks for a "Summary" heading and returns its content (up to 500 chars).
 */
function extractPlanSummary(report: string): string | undefined {
  // Match ## Summary or **Summary** heading and grab the content until the next heading
  const match = report.match(/^##\s+Summary\b[^\n]*\n([\s\S]*?)(?=\n##\s|\n\*\*[A-Z]|$)/mi);
  if (match) {
    const summary = match[1].trim();
    if (summary) return summary.slice(0, 500);
  }
  // Fallback: try the first non-heading paragraph
  const lines = report.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  if (lines.length > 0) {
    return lines.slice(0, 3).join(' ').trim().slice(0, 500);
  }
  return undefined;
}

// ─── Ticket ID ↔ PR Cross-Referencing ───────────────────────────

const TICKET_ID_MARKER = '<!-- ticket-id:';
const TICKET_ID_PATTERN = /<!-- ticket-id:([a-f0-9-]+) -->/;

/**
 * Ensures the PR body contains a machine-readable ticket ID marker.
 * Idempotent — skips if the marker is already present.
 */
function ensureTicketIdInPr(prUrl: string, ticketId: string, cwd: string) {
  // Use execFileSync to avoid shell interpretation of PR body content
  // (PR bodies can contain JSX, backticks, braces, etc.)
  const body = execFileSync(
    'gh', ['pr', 'view', prUrl, '--json', 'body', '--jq', '.body'],
    { cwd, encoding: 'utf-8', timeout: 10000 },
  ).trim();

  if (body.includes(`${TICKET_ID_MARKER}${ticketId} -->`)) {
    return; // already present
  }

  const marker = `${TICKET_ID_MARKER}${ticketId} -->`;
  const footer = `\n\n---\nTicket-ID: \`${ticketId}\`\n${marker}`;
  const newBody = body + footer;

  execFileSync(
    'gh', ['pr', 'edit', prUrl, '--body', newBody],
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
  statusCheckRollup: { state: string; conclusion: string }[];
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

    // Already merged or closed — clean up tracking state
    if (pr.state === 'MERGED') {
      const merged = await updateTicket(ticket.id, { status: 'merged' }, 'pr_merged');
      if (merged) await broadcastTicket(merged);
      lastAutoMergeCheck.delete(ticket.id);
      autoMergeLastState.delete(ticket.id);
      autoMergeNotReadyCount.delete(ticket.id);
      console.log(`[auto-merge] Ticket #${ticket.id} PR already merged`);
      return;
    }
    if (pr.state === 'CLOSED') {
      lastAutoMergeCheck.delete(ticket.id);
      autoMergeLastState.delete(ticket.id);
      autoMergeNotReadyCount.delete(ticket.id);
      return;
    }

    // Check conditions: reviews OK + checks pass + mergeable
    // reviewDecision is "" when no reviews are required, "APPROVED" when approved,
    // "CHANGES_REQUESTED" or "REVIEW_REQUIRED" when blocking
    const reviewBlocking = pr.reviewDecision === 'CHANGES_REQUESTED' ||
      pr.reviewDecision === 'REVIEW_REQUIRED';
    const checks = pr.statusCheckRollup || [];
    const checksPassed = checks.length === 0 ||
      checks.every(c => c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED');
    const isMergeable = pr.mergeable === 'MERGEABLE';

    // Gate: don't merge while auditor is still running or has requested changes
    const freshTicket = await getTicket(ticket.id);
    const auditStatus = freshTicket?.auditStatus;
    const auditVerdict = freshTicket?.auditVerdict;
    if (auditStatus === 'running' || auditStatus === 'pending') {
      console.log(`[auto-merge] Ticket #${ticket.id} audit still ${auditStatus} — deferring`);
      return;
    }
    if (auditVerdict === 'request_changes') {
      console.log(`[auto-merge] Ticket #${ticket.id} audit requested changes — skipping`);
      return;
    }

    if (!reviewBlocking && checksPassed && isMergeable) {
      console.log(`[auto-merge] Merging PR for ticket #${ticket.id}: ${ticket.prUrl}`);
      execSync(
        `gh pr merge "${ticket.prUrl}" --squash --delete-branch`,
        { cwd: project.repoPath, encoding: 'utf-8', timeout: 30000 },
      );
      const merged = await updateTicket(ticket.id, { status: 'merged' }, 'auto_merged');
      if (merged) await broadcastTicket(merged);
      lastAutoMergeCheck.delete(ticket.id);
      autoMergeLastState.delete(ticket.id);
      autoMergeNotReadyCount.delete(ticket.id);
      console.log(`[auto-merge] Ticket #${ticket.id} merged successfully`);
    } else if (!reviewBlocking && checksPassed && !isMergeable && pr.mergeable !== 'CONFLICTING') {
      // Branch is likely BEHIND — try to update it
      autoMergeNotReadyCount.delete(ticket.id);
      await updatePrBranch(ticket, project);
    } else {
      // Only log when the reason changes to avoid flooding the console;
      // increment not-ready count for exponential backoff
      const reason = `reviewBlocking=${reviewBlocking}, checksPassed=${checksPassed}, isMergeable=${isMergeable}`;
      if (autoMergeLastState.get(ticket.id) !== reason) {
        autoMergeLastState.set(ticket.id, reason);
        autoMergeNotReadyCount.set(ticket.id, 1);
        console.log(`[auto-merge] Ticket #${ticket.id} not ready — ${reason}`);
      } else {
        autoMergeNotReadyCount.set(ticket.id, (autoMergeNotReadyCount.get(ticket.id) || 0) + 1);
      }
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

  // Resume held tickets whose hold period has expired
  const now = Date.now();
  const heldTickets = tickets.filter(t => t.status === 'on_hold' && t.holdUntil);
  for (const ticket of heldTickets) {
    if (ticket.holdUntil! <= now) {
      console.log(`[dispatcher] Resuming held ticket #${ticket.id} (hold period expired)`);
      const resumed = await updateTicket(ticket.id, {
        status: 'todo',
        error: undefined,
        failureReason: undefined,
        holdUntil: undefined,
        completedAt: undefined,
        agentPid: undefined,
      }, 'hold_resumed');
      if (resumed) await broadcastTicket(resumed);
    }
  }

  // Don't dispatch new agents while any ticket is on hold due to usage limits
  // (they'll all hit the same limit)
  const anyOnHold = tickets.some(t => t.status === 'on_hold' && t.holdUntil && t.holdUntil > now);

  // Start new agents
  if (running.size < MAX_CONCURRENT && !anyOnHold) {
    const todoTickets = tickets.filter(t => t.status === 'todo');

    // Separate queued from non-queued tickets
    const nonQueued = todoTickets.filter(t => !t.queued);
    const queued = todoTickets.filter(t => t.queued);

    // Always dispatch non-queued tickets first (oldest first)
    for (const ticket of nonQueued.sort((a, b) => a.createdAt - b.createdAt)) {
      if (running.size >= MAX_CONCURRENT) break;
      if (running.has(ticket.id)) continue;
      await startAgent(ticket);
    }

    // Queued tickets only run when nothing else is running (no agents in progress).
    // This includes both dispatched agents and non-queued tickets just started above.
    if (running.size === 0 && nonQueued.length === 0) {
      for (const ticket of queued.sort((a, b) => a.createdAt - b.createdAt)) {
        if (running.size >= MAX_CONCURRENT) break;
        if (running.has(ticket.id)) continue;
        await startAgent(ticket);
      }
    }
  }

  // Check for agents that may be waiting for approval or user input
  const inProgressTickets = tickets.filter(
    t => t.status === 'in_progress' && running.has(t.id),
  );
  for (const ticket of inProgressTickets) {
    const lastActivity = lastStreamActivity.get(ticket.id);
    const hasPendingTool = !ticket.yolo && pendingToolApproval.get(ticket.id);
    const hasPendingInput = pendingUserInput.get(ticket.id);
    if ((hasPendingTool || hasPendingInput) && lastActivity && (now - lastActivity) > APPROVAL_WAIT_THRESHOLD_MS) {
      const reason = hasPendingInput ? 'waiting_user_input' : 'waiting_tool_approval';
      const updated = await updateTicket(ticket.id, { status: 'needs_approval' }, reason);
      if (updated) await broadcastTicket(updated);
      console.log(`[dispatcher] Ticket #${ticket.id} appears to be waiting for ${hasPendingInput ? 'user input' : 'tool approval'}`);
    }
  }

  // Check PR status for all in_review tickets
  const inReviewTickets = tickets.filter(
    t => t.status === 'in_review' && t.prUrl,
  );
  for (const ticket of inReviewTickets) {
    // Check if PR has been merged externally
    await checkPrStatus(ticket);

    // Auto-merge: only check tickets with autoMerge enabled, with exponential
    // backoff to avoid hammering the GitHub API for tickets that aren't ready
    if (ticket.autoMerge) {
      const lastCheck = lastAutoMergeCheck.get(ticket.id) || 0;
      const notReadyCount = autoMergeNotReadyCount.get(ticket.id) || 0;
      // Backoff: 30s base, doubling each consecutive not-ready, capped at 5min
      const interval = Math.min(
        AUTO_MERGE_CHECK_INTERVAL_MS * Math.pow(2, notReadyCount),
        AUTO_MERGE_MAX_INTERVAL_MS,
      );
      if (now - lastCheck >= interval) {
        const fresh = await getTicket(ticket.id);
        if (fresh && fresh.status === 'in_review') {
          lastAutoMergeCheck.set(ticket.id, now);
          await checkAutoMerge(fresh);
        }
      }
    }
  }
}

/**
 * Kill a running agent — for non-user-initiated stops (e.g., ticket deletion).
 * The ticket is typically deleted right after, so the close handler's status update is a no-op.
 * See also: abortAgent() for user-initiated aborts.
 */
export function killAgent(ticketId: string): boolean {
  const proc = running.get(ticketId);
  if (proc) {
    console.log(`[dispatcher] Killing agent for ticket #${ticketId}`);
    abortedTickets.add(ticketId);
    proc.kill('SIGTERM');
    // Don't delete from running — let the close handler do cleanup
    return true;
  }
  return false;
}

/**
 * Abort a running agent — for explicit user-initiated aborts.
 * The ticket persists as 'failed' with a user_abort failure reason.
 * See also: killAgent() for non-user-initiated stops.
 */
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
let healthCheckIntervalId: ReturnType<typeof setInterval> | null = null;

const CONFLICT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds
const STUCK_AUDIT_GRACE_MS = 10 * 60_000; // 10 minutes
const NO_PR_GRACE_MS = 5 * 60_000; // 5 minutes
const STUCK_TICKET_GRACE_MS = 30 * 60_000; // 30 minutes — flag tickets idle for this long

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function countOrphanRecoveries(ticket: Ticket): number {
  if (!ticket.stateLog) return 0;
  return ticket.stateLog.filter(
    e => e.reason === 'orphan_recovery' || e.reason === 'auto_retry',
  ).length;
}

/**
 * Check if a ticket's PR has already been merged on GitHub.
 * If so, update the ticket to 'merged' and return true.
 * This prevents blind retries of tickets whose work is already done.
 *
 * Note: execSync with ticket.prUrl is safe — the URL is set by our own agent
 * after PR creation, matching the same pattern used in attemptAutoMerge and
 * checkPrConflicts throughout this file.
 */
export async function checkAndReconcilePrState(ticket: Ticket): Promise<boolean> {
  if (!ticket.prUrl) return false;

  const project = await getProject(ticket.projectId);
  if (!project) return false;

  try {
    const prJson = execSync(
      `gh pr view "${ticket.prUrl}" --json state`,
      { cwd: project.repoPath, encoding: 'utf-8', timeout: 15000 },
    ).trim();
    const pr: { state: string } = JSON.parse(prJson);

    if (pr.state === 'MERGED') {
      console.log(`[dispatcher] Ticket #${ticket.id} PR is already merged — reconciling status`);
      const updated = await updateTicket(ticket.id, {
        status: 'merged',
        error: undefined,
        failureReason: undefined,
        needsAttention: undefined,
        agentPid: undefined,
      }, 'pr_merged');
      if (updated) broadcastTicket(updated);
      return true;
    }

    if (pr.state === 'CLOSED') {
      console.log(`[dispatcher] Ticket #${ticket.id} PR is closed — marking failed`);
      const updated = await updateTicket(ticket.id, {
        status: 'failed',
        error: 'PR was closed without merging',
        failureReason: { type: 'other', detail: 'PR closed' },
        agentPid: undefined,
      }, 'pr_closed');
      if (updated) broadcastTicket(updated);
      return true;
    }
  } catch (err) {
    // gh CLI failures are non-fatal — fall through to normal recovery
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[dispatcher] Could not check PR state for ticket #${ticket.id}: ${msg}`);
  }

  return false;
}

// ─── Resume-Aware Retry Helper ────────────────────────────────────

/**
 * Build the update fields for retrying a ticket.
 * If the ticket has a remote branch and a session ID, preserve them for
 * `--resume` mode in startAgent(). Otherwise, clear everything for a fresh start.
 */
export async function prepareRetryFields(ticket: Ticket): Promise<Partial<Ticket>> {
  const base: Partial<Ticket> = {
    status: 'todo',
    error: undefined,
    failureReason: undefined,
    worktreePath: undefined,
    startedAt: undefined,
    completedAt: undefined,
    lastOutput: undefined,
    agentPid: undefined,
  };

  // Check if there's resumable state: branch on remote + session ID
  if (ticket.branchName && ticket.agentSessionId) {
    const project = await getProject(ticket.projectId);
    if (project) {
      try {
        const result = execFileSync(
          'git', ['ls-remote', '--heads', 'origin', ticket.branchName],
          { cwd: project.repoPath, encoding: 'utf-8', timeout: 15000 },
        ).trim();
        if (result.length > 0) {
          // Branch exists on remote — resume mode
          console.log(`[dispatcher] Retry will resume: branch "${ticket.branchName}" exists on remote`);
          return {
            ...base,
            resumePrompt: ticket.resumePrompt || 'Continue working on this ticket. Review your previous progress and pick up where you left off.',
          };
          // branchName and agentSessionId are preserved (not in `base`)
        }
      } catch {
        // git ls-remote failed — fall through to fresh start
      }
    }
  }

  // No resumable state — fresh start
  return {
    ...base,
    branchName: undefined,
    agentSessionId: undefined,
    resumePrompt: undefined,
  };
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

    // Before retrying: check if the PR was already merged
    const reconciled = await checkAndReconcilePrState(ticket);
    if (reconciled) continue;

    // Clean up stale worktree in all cases (startAgent creates a fresh one)
    if (ticket.worktreePath) {
      const project = await getProject(ticket.projectId);
      if (project) cleanupWorktree(project.repoPath, ticket.worktreePath);
    }

    const priorAttempts = countOrphanRecoveries(ticket);

    if (priorAttempts < MAX_AUTO_RETRIES) {
      // Under budget — reset to todo for automatic re-dispatch
      console.log(`[dispatcher] Auto-retrying orphaned ticket #${ticket.id}: ${ticket.subject} (attempt ${priorAttempts + 1}/${MAX_AUTO_RETRIES})`);
      const retryFields = await prepareRetryFields(ticket);
      const updated = await updateTicket(ticket.id, retryFields, 'auto_retry');
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

// ─── Health Check Loop ────────────────────────────────────────────

const HEALTH_LOG_DIR = join(import.meta.dirname, '..', 'data');
const HEALTH_LOG_FILE = join(HEALTH_LOG_DIR, 'health-check-log.jsonl');
let healthCheckRunning = false;

interface HealthLogEntry {
  timestamp: number;
  check: 'orphan_pid' | 'stuck_audit' | 'no_pr' | 'stuck_ticket';
  ticketId: string;
  action: 'retry' | 'fail' | 'reset_audit' | 'flag';
  detail: string;
}

async function appendHealthLog(entry: HealthLogEntry): Promise<void> {
  try {
    await mkdir(HEALTH_LOG_DIR, { recursive: true });
    await appendFile(HEALTH_LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[health-check] Failed to write log:', err);
  }
}

export async function healthCheckTick(): Promise<void> {
  if (healthCheckRunning) return;
  healthCheckRunning = true;

  try {
    const tickets = await listTickets();
    const now = Date.now();

    // ── Check 1: Orphan PID Detection ──
    const inProgress = tickets.filter(t => t.status === 'in_progress' && !running.has(t.id));
    for (const ticket of inProgress) {
      if (ticket.agentPid && isProcessAlive(ticket.agentPid)) continue;

      // Before retrying: check if the PR was already merged
      const reconciled = await checkAndReconcilePrState(ticket);
      if (reconciled) continue;

      // Clean up stale worktree
      if (ticket.worktreePath) {
        const project = await getProject(ticket.projectId);
        if (project) cleanupWorktree(project.repoPath, ticket.worktreePath);
      }

      const priorAttempts = countOrphanRecoveries(ticket);

      if (priorAttempts < MAX_AUTO_RETRIES) {
        console.log(`[health-check] Orphan detected: ticket #${ticket.id} (attempt ${priorAttempts + 1}/${MAX_AUTO_RETRIES})`);
        const retryFields = await prepareRetryFields(ticket);
        const updated = await updateTicket(ticket.id, retryFields, 'health_check_orphan');
        if (updated) broadcastTicket(updated);
        await appendHealthLog({
          timestamp: now, check: 'orphan_pid', ticketId: ticket.id,
          action: 'retry', detail: `Auto-retry attempt ${priorAttempts + 1}/${MAX_AUTO_RETRIES}`,
        });
      } else {
        console.log(`[health-check] Orphan ticket #${ticket.id} exceeded retry budget (${priorAttempts}/${MAX_AUTO_RETRIES})`);
        const updated = await updateTicket(ticket.id, {
          status: 'failed',
          error: `Auto-retry budget exhausted (${priorAttempts} attempts, detected by health check)`,
          failureReason: { type: 'retry_budget_exhausted', attempts: priorAttempts },
          completedAt: now,
          agentPid: undefined,
        }, 'health_check_orphan');
        if (updated) broadcastTicket(updated);
        await appendHealthLog({
          timestamp: now, check: 'orphan_pid', ticketId: ticket.id,
          action: 'fail', detail: `Retry budget exhausted (${priorAttempts} attempts)`,
        });
      }
    }

    // ── Check 2: Stuck Audit Detection ──
    const stuckAudits = tickets.filter(t => t.auditStatus === 'running');
    for (const ticket of stuckAudits) {
      const auditStarted = ticket.stateLog
        ?.filter(e => e.reason === 'audit_started' || e.status === 'in_review')
        .at(-1)?.timestamp
        ?? ticket.completedAt ?? ticket.startedAt ?? 0;

      if (now - auditStarted < STUCK_AUDIT_GRACE_MS) continue;

      console.log(`[health-check] Stuck audit detected: ticket #${ticket.id} (running for ${Math.round((now - auditStarted) / 60_000)}min)`);
      const updated = await updateTicket(ticket.id, {
        auditStatus: undefined,
        auditResult: undefined,
        auditVerdict: undefined,
      });
      if (updated) {
        broadcastTicket(updated);
        runAudit(updated).catch(err => {
          console.error(`[health-check] Re-audit failed for ticket #${ticket.id}:`, err);
        });
      }
      await appendHealthLog({
        timestamp: now, check: 'stuck_audit', ticketId: ticket.id,
        action: 'reset_audit', detail: `Audit stuck for ${Math.round((now - auditStarted) / 60_000)}min — reset and re-triggered`,
      });
    }

    // Also reset stuck watchlist entries
    const resetCount = await resetStuckReviews(STUCK_AUDIT_GRACE_MS);
    if (resetCount > 0) {
      console.log(`[health-check] Reset ${resetCount} stuck watchlist review(s)`);
    }

    // ── Check 3: In-Review with No PR ──
    // Before failing, check GitHub for an existing PR on the branch (the stream
    // handler may have missed capturing the prUrl).
    const noPrReviews = tickets.filter(t => t.status === 'in_review' && !t.prUrl);
    for (const ticket of noPrReviews) {
      const completedAt = ticket.completedAt ?? ticket.startedAt ?? 0;
      if (now - completedAt < NO_PR_GRACE_MS) continue;

      // Try to find a PR by branch name before giving up
      if (ticket.branchName) {
        const project = await getProject(ticket.projectId);
        if (project) {
          try {
            const prListJson = execSync(
              `gh pr list --head "${ticket.branchName}" --state all --json url,number,state --limit 1`,
              { cwd: project.repoPath, encoding: 'utf-8', timeout: 15000 },
            ).trim();
            const prs: Array<{ url: string; number: number; state: string }> = JSON.parse(prListJson);
            if (prs.length > 0) {
              const pr = prs[0];
              console.log(`[health-check] Found PR #${pr.number} for ticket #${ticket.id} (was missing prUrl)`);
              const updated = await updateTicket(ticket.id, {
                prUrl: pr.url,
                prNumber: pr.number,
                ...(pr.state === 'MERGED' ? { status: 'merged' as const } : {}),
              }, pr.state === 'MERGED' ? 'pr_merged' : 'health_check_pr_found');
              if (updated) broadcastTicket(updated);
              await appendHealthLog({
                timestamp: now, check: 'no_pr', ticketId: ticket.id,
                action: 'retry', detail: `Found existing PR #${pr.number} (${pr.state}) — linked to ticket`,
              });
              continue; // Don't fail — we found the PR
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`[health-check] Could not search PRs for ticket #${ticket.id}: ${msg}`);
          }
        }
      }

      console.log(`[health-check] No-PR in_review detected: ticket #${ticket.id} (${Math.round((now - completedAt) / 60_000)}min without PR)`);
      const updated = await updateTicket(ticket.id, {
        status: 'failed',
        error: 'No PR created — agent exited without opening a pull request',
        failureReason: { type: 'other', detail: 'No PR created' },
        completedAt: now,
      }, 'health_check_no_pr');
      if (updated) broadcastTicket(updated);
      await appendHealthLog({
        timestamp: now, check: 'no_pr', ticketId: ticket.id,
        action: 'fail', detail: `In review for ${Math.round((now - completedAt) / 60_000)}min with no PR URL`,
      });
    }

    // ── Check 4: Stuck / Corrupt Ticket Detection ──
    // Catches tickets that slip through the cracks and "vanish" from attention.
    for (const ticket of tickets) {
      // Skip terminal states and tickets already flagged
      if (['done', 'merged'].includes(ticket.status)) continue;
      if (ticket.needsAttention) continue;

      const reasons: string[] = [];

      // 4a. needs_approval with no running agent process
      if (ticket.status === 'needs_approval' && !running.has(ticket.id)) {
        const alive = ticket.agentPid && isProcessAlive(ticket.agentPid);
        if (!alive) {
          reasons.push('needs_approval but agent process is gone');
        }
      }

      // 4b. on_hold with expired holdUntil that wasn't picked back up
      if (ticket.status === 'on_hold' && ticket.holdUntil && ticket.holdUntil < now - STUCK_TICKET_GRACE_MS) {
        reasons.push(`on_hold past holdUntil (expired ${Math.round((now - ticket.holdUntil) / 60_000)}min ago)`);
      }

      // 4c. in_progress for too long with no PID and not already caught by Check 1
      // (Check 1 auto-retries; this catches edge cases where retry itself failed)
      if (ticket.status === 'in_progress' && !ticket.agentPid && !running.has(ticket.id)) {
        const started = ticket.startedAt ?? ticket.createdAt;
        if (now - started > STUCK_TICKET_GRACE_MS) {
          reasons.push(`in_progress for ${Math.round((now - started) / 60_000)}min with no agent PID`);
        }
      }

      // 4d. todo for an extended period without being dispatched (possible dispatch failure)
      if (ticket.status === 'todo' && !ticket.queued) {
        const todoSince = ticket.stateLog?.filter(e => e.status === 'todo').at(-1)?.timestamp ?? ticket.createdAt;
        if (now - todoSince > STUCK_TICKET_GRACE_MS) {
          reasons.push(`todo for ${Math.round((now - todoSince) / 60_000)}min without being dispatched`);
        }
      }

      // 4e. Invalid/missing status
      if (!['todo', 'in_progress', 'needs_approval', 'in_review', 'on_hold', 'done', 'merged', 'failed', 'error'].includes(ticket.status)) {
        reasons.push(`unknown status: "${ticket.status}"`);
      }

      // 4f. Missing required fields
      if (!ticket.projectId) reasons.push('missing projectId');
      if (!ticket.subject) reasons.push('missing subject');
      if (!ticket.instructions) reasons.push('missing instructions');

      if (reasons.length > 0) {
        const detail = reasons.join('; ');
        console.log(`[health-check] Stuck/corrupt ticket #${ticket.id}: ${detail}`);
        const updated = await updateTicket(ticket.id, {
          needsAttention: true,
          error: ticket.error || `Health check: ${detail}`,
        });
        if (updated) broadcastTicket(updated);
        await appendHealthLog({
          timestamp: now, check: 'stuck_ticket', ticketId: ticket.id,
          action: 'flag', detail,
        });
      }
    }
  } catch (err) {
    console.error('[health-check] Error during health check:', err);
  } finally {
    healthCheckRunning = false;
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
  // Health check loop for orphan PIDs, stuck audits, and no-PR in-review
  healthCheckIntervalId = setInterval(healthCheckTick, HEALTH_CHECK_INTERVAL_MS);
  console.log('[dispatcher] Health check scheduled (every 30s)');
}

export function stopDispatcher() {
  if (intervalId) clearInterval(intervalId);
  if (conflictIntervalId) clearInterval(conflictIntervalId);
  if (healthCheckIntervalId) clearInterval(healthCheckIntervalId);
  // Kill running agents
  for (const [id, proc] of running) {
    console.log(`[dispatcher] Killing agent for ticket #${id}`);
    proc.kill('SIGTERM');
  }
  running.clear();
}
