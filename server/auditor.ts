import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { listProjects, getTicket, updateTicket } from './store.ts';
import type { Ticket, Project, WSEvent } from '../src/types.ts';
import { envWithNvmNode } from './nvm.ts';

// ─── Types ──────────────────────────────────────────────────────

export interface AuditRubricItem {
  aspect: string;
  rating: 'pass' | 'concern' | 'fail';
  summary: string;
}

export interface AuditResult {
  prUrl: string;
  overallVerdict: 'approve' | 'request_changes' | 'comment';
  summary: string;
  rubric: AuditRubricItem[];
  reviewedAt: number;
}

export interface WatchlistEntry {
  prUrl: string;
  /** owner/repo extracted from URL */
  repo: string;
  prNumber: number;
  /** The project ID this PR's repo belongs to */
  projectId: string;
  /** Local repo path for running gh commands */
  repoPath: string;
  /** Ticket ID if this PR came from a dispatched ticket */
  ticketId?: string;
  addedAt: number;
  lastReviewedAt?: number;
  /** Timestamp of the most recent PR comment we've seen */
  lastCommentCheckedAt?: number;
  /** Whether a review is currently in progress */
  reviewing: boolean;
  /** Number of reviews performed */
  reviewCount: number;
  /** Most recent audit result */
  lastResult?: AuditResult;
  /** Set to true once the PR is merged/closed and removed from active monitoring */
  resolved: boolean;
}

// ─── State ──────────────────────────────────────────────────────

const MAX_AUTOMATION_ITERATIONS = 5;

type BroadcastFn = (event: WSEvent) => void;
let broadcastFn: BroadcastFn = () => {};

export function setAuditorBroadcast(fn: BroadcastFn) {
  broadcastFn = fn;
}

type MergeFn = (ticket: Ticket) => Promise<void>;
let attemptMergeFn: MergeFn = async () => {};
export function setAttemptMergeFn(fn: MergeFn) { attemptMergeFn = fn; }

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const WATCHLIST_FILE = join(DATA_DIR, 'auditor-watchlist.json');

let watchlist: WatchlistEntry[] = [];
const runningReviews = new Map<string, ChildProcess>();

// ─── Persistence ────────────────────────────────────────────────

async function loadWatchlist(): Promise<void> {
  try {
    const data = await readFile(WATCHLIST_FILE, 'utf-8');
    watchlist = JSON.parse(data) as WatchlistEntry[];
    // Reset any stale "reviewing" flags from a previous server run
    for (const entry of watchlist) {
      if (entry.reviewing) entry.reviewing = false;
    }
  } catch {
    watchlist = [];
  }
}

async function saveWatchlist(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(WATCHLIST_FILE, JSON.stringify(watchlist, null, 2));
}

// ─── PR Template Parsing & Cache ─────────────────────────────────

interface CheckboxSection {
  heading: string;
  items: string[];
  /** 'all' = every box must be checked; 'any' = at least one */
  rule: 'all' | 'any';
}

interface TemplateRequirements {
  /** Headings that must have non-placeholder content */
  requiredSections: string[];
  /** Checkbox groups extracted from the template */
  checkboxSections: CheckboxSection[];
  /** Compact one-line summary per section for the prompt */
  compact: string;
}

interface TemplateCacheEntry {
  hash: string;
  requirements: TemplateRequirements;
}

const templateCache = new Map<string, TemplateCacheEntry>();

/** Parse a PR template into compact requirements */
function parseTemplateRequirements(raw: string): TemplateRequirements {
  const lines = raw.split('\n');
  const requiredSections: string[] = [];
  const checkboxSections: CheckboxSection[] = [];
  let currentHeading = '';
  let currentCheckboxes: string[] = [];

  function flushCheckboxes() {
    if (currentHeading && currentCheckboxes.length > 0) {
      // "Checklist" items must ALL be checked; others need at least one
      const rule = currentHeading.toLowerCase() === 'checklist' ? 'all' as const : 'any' as const;
      checkboxSections.push({ heading: currentHeading, items: [...currentCheckboxes], rule });
      currentCheckboxes = [];
    }
  }

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      flushCheckboxes();
      currentHeading = headingMatch[1].trim();
      // Sections that need content (not just checkboxes)
      if (['Description', 'Changes'].includes(currentHeading)) {
        requiredSections.push(currentHeading);
      }
      continue;
    }
    const cbMatch = line.match(/^- \[[ x]\]\s+(.+)/);
    if (cbMatch) {
      currentCheckboxes.push(cbMatch[1].trim());
    }
  }
  flushCheckboxes();

  // Build compact summary
  const parts: string[] = [];
  for (const s of requiredSections) {
    parts.push(`"${s}" must be filled in`);
  }
  for (const cb of checkboxSections) {
    if (cb.rule === 'all') {
      parts.push(`"${cb.heading}" — all ${cb.items.length} checkboxes must be [x]`);
    } else {
      parts.push(`"${cb.heading}" — at least 1 of ${cb.items.length} checkboxes must be [x]`);
    }
  }
  const compact = parts.join('; ');

  return { requiredSections, checkboxSections, compact };
}

/** Get cached template requirements, refreshing if the file changed */
async function getTemplateRequirements(repoPath: string): Promise<TemplateRequirements | null> {
  const templatePath = join(repoPath, '.github', 'pull_request_template.md');
  let raw: string;
  try {
    raw = await readFile(templatePath, 'utf-8');
  } catch {
    templateCache.delete(repoPath);
    return null;
  }

  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const cached = templateCache.get(repoPath);
  if (cached && cached.hash === hash) return cached.requirements;

  const requirements = parseTemplateRequirements(raw);
  templateCache.set(repoPath, { hash, requirements });
  console.log(`[auditor] Template requirements updated for ${repoPath} (hash: ${hash})`);
  return requirements;
}

// ─── Allowlist (derived from registered projects) ───────────────

/** Parse "owner/repo" from a GitHub PR URL */
function parseGitHubPrUrl(url: string): { repo: string; prNumber: number } | null {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { repo: match[1], prNumber: parseInt(match[2], 10) };
}

/** Get the set of allowed owner/repo strings from registered projects */
async function getAllowedRepos(): Promise<Map<string, Project>> {
  const projects = await listProjects();
  const allowed = new Map<string, Project>();

  for (const project of projects) {
    if (!project.remoteUrl) continue;
    // Extract owner/repo from remote URL (supports both HTTPS and SSH)
    const httpsMatch = project.remoteUrl.match(/github\.com\/([^/]+\/[^/.]+)/);
    const sshMatch = project.remoteUrl.match(/github\.com:([^/]+\/[^/.]+)/);
    const repo = (httpsMatch?.[1] || sshMatch?.[1])?.replace(/\.git$/, '');
    if (repo) {
      allowed.set(repo, project);
    }
  }

  return allowed;
}

// ─── Public API ─────────────────────────────────────────────────

/** Add a PR to the watchlist. Returns the entry or null if the repo is not allowed. */
export async function addToWatchlist(
  prUrl: string,
  ticketId?: string,
): Promise<WatchlistEntry | null> {
  const parsed = parseGitHubPrUrl(prUrl);
  if (!parsed) return null;

  // Check allowlist
  const allowed = await getAllowedRepos();
  const project = allowed.get(parsed.repo);
  if (!project) {
    console.log(`[auditor] Repo ${parsed.repo} is not in the allowlist — ignoring ${prUrl}`);
    return null;
  }

  // Check if already on watchlist
  const existing = watchlist.find(e => e.prUrl === prUrl);
  if (existing) {
    // Update ticket association if provided
    if (ticketId && !existing.ticketId) {
      existing.ticketId = ticketId;
      await saveWatchlist();
    }
    // Trigger a re-review if not currently reviewing
    if (!existing.reviewing) {
      reviewPr(existing).catch(err => {
        console.error(`[auditor] Re-review failed for ${prUrl}:`, err);
      });
    }
    return existing;
  }

  const entry: WatchlistEntry = {
    prUrl,
    repo: parsed.repo,
    prNumber: parsed.prNumber,
    projectId: project.id,
    repoPath: project.repoPath,
    ticketId,
    addedAt: Date.now(),
    reviewing: false,
    reviewCount: 0,
    resolved: false,
  };

  watchlist.push(entry);
  await saveWatchlist();
  broadcastFn({ type: 'auditor_updated', data: getWatchlistStatus() });
  console.log(`[auditor] Added ${prUrl} to watchlist`);

  // Trigger initial review immediately
  reviewPr(entry).catch(err => {
    console.error(`[auditor] Initial review failed for ${prUrl}:`, err);
  });

  return entry;
}

/** Remove a PR from the watchlist */
export async function removeFromWatchlist(prUrl: string): Promise<boolean> {
  const idx = watchlist.findIndex(e => e.prUrl === prUrl);
  if (idx === -1) return false;

  // Kill any running review for this PR
  const proc = runningReviews.get(prUrl);
  if (proc) {
    proc.kill('SIGTERM');
    runningReviews.delete(prUrl);
  }

  watchlist.splice(idx, 1);
  await saveWatchlist();
  broadcastFn({ type: 'auditor_updated', data: getWatchlistStatus() });
  console.log(`[auditor] Removed ${prUrl} from watchlist`);
  return true;
}

/** Get current watchlist status */
export function getWatchlistStatus(): WatchlistEntry[] {
  return watchlist.filter(e => !e.resolved);
}

/** Get full watchlist including resolved entries */
export function getFullWatchlist(): WatchlistEntry[] {
  return [...watchlist];
}

/** Check if a review is currently running for a PR */
export function isAuditRunning(prUrl: string): boolean {
  return runningReviews.has(prUrl);
}

/**
 * Reset watchlist entries stuck in `reviewing: true` for longer than maxAgeMs.
 * Returns the count of entries reset so the next auditorTick() re-picks them up.
 */
export async function resetStuckReviews(maxAgeMs: number): Promise<number> {
  const now = Date.now();
  let count = 0;
  for (const entry of watchlist) {
    if (!entry.reviewing || entry.resolved) continue;
    const reviewStarted = entry.lastReviewedAt || entry.addedAt;
    if (now - reviewStarted > maxAgeMs && !runningReviews.has(entry.prUrl)) {
      entry.reviewing = false;
      count++;
    }
  }
  if (count > 0) {
    await saveWatchlist();
    broadcastFn({ type: 'auditor_updated', data: getWatchlistStatus() });
  }
  return count;
}

/** Manually trigger a re-review for a PR on the watchlist */
export async function triggerReReview(prUrl: string): Promise<boolean> {
  const entry = watchlist.find(e => e.prUrl === prUrl && !e.resolved);
  if (!entry) return false;
  if (entry.reviewing) return false;

  reviewPr(entry).catch(err => {
    console.error(`[auditor] Re-review failed for ${prUrl}:`, err);
  });
  return true;
}

// ─── Legacy ticket-based API (backward compat with dispatcher) ──

/** Run audit for a ticket — adds its PR to the watchlist */
export async function runAudit(ticket: Ticket): Promise<void> {
  if (!ticket.prUrl) {
    console.log(`[auditor] Ticket #${ticket.id} has no PR URL — skipping`);
    return;
  }

  // Update ticket audit status
  const updated = await updateTicket(ticket.id, { auditStatus: 'pending' });
  if (updated) broadcastFn({ type: 'ticket_updated', data: updated });

  await addToWatchlist(ticket.prUrl, ticket.id);
}

// ─── Review Engine ──────────────────────────────────────────────

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return '';
  }
}

function buildReviewPrompt(entry: WatchlistEntry, conventions: string, templateReqs: TemplateRequirements | null): string {
  return `You are a local PR auditor performing a structured code review.

PR: ${entry.prUrl}
Repository: ${entry.repo}
Review #${entry.reviewCount + 1}

## Instructions

1. Fetch the PR diff: gh pr diff ${entry.prNumber} --repo ${entry.repo}
2. Fetch the PR description: gh pr view ${entry.prNumber} --repo ${entry.repo}
3. Review the changes against the rubric below.
4. Post your structured review as a comment on the PR.

## Review Rubric

Evaluate each aspect and rate it: PASS, CONCERN, or FAIL.

**IMPORTANT — Be strict with ratings.** Use CONCERN only for minor stylistic or cosmetic issues that don't affect correctness. If an issue could cause bugs, break invariants, leave docs stale, or means the PR is incomplete, rate it FAIL — not CONCERN.

**Rating guide:**
- **PASS**: No issues, or only trivial nitpicks that aren't worth mentioning.
- **CONCERN**: Minor cosmetic/style issues that don't affect functionality (e.g., naming preferences, comment wording, minor formatting). The PR is still safe to merge as-is.
- **FAIL**: Any of these → automatic FAIL:
  - Missing guards, validation, or edge case handling that could cause bugs
  - Stale or incorrect documentation introduced or left unfixed by the PR
  - PR template checkboxes not filled in
  - Missing tests for new logic paths
  - Conflicting or incompatible feature combinations not guarded against
  - Dead code, unused imports, or leftover TODOs from the implementation
  - Any security issue, no matter how minor

### 1. Completeness
- Does the PR fully implement what the description claims?
- Are there missing pieces or TODO items left unfinished?
- Are edge cases handled?
- FAIL if: conflicting feature combos aren't guarded, missing validation for new inputs, incomplete implementation of stated goals

### 2. Code Quality
- Is the code clean, readable, and well-structured?
- Are there unnecessary complexity or over-engineering issues?
- Does it follow existing patterns in the codebase?

### 3. Test Coverage
- Were tests added or updated for the changes?
- Do the tests cover the main paths and important edge cases?
- Are the tests meaningful (not just "test exists" but actually validates behavior)?
- FAIL if: new logic paths have no test coverage at all

### 4. Security
- No hardcoded secrets, API keys, or credentials?
- No injection vulnerabilities (command injection, XSS, SQL injection)?
- Proper input validation at system boundaries?
- No unsafe patterns (eval, innerHTML, dangerouslySetInnerHTML)?
- FAIL if: any security issue is present, regardless of severity

### 5. Project Conventions
${conventions ? `Check adherence to these project conventions:\n${conventions}` : 'No AGENTS.md or CLAUDE.md found — check for general best practices.'}
- FAIL if: architecture docs are stale/incorrect due to changes in this PR, or the PR contradicts documented conventions

### 6. PR Checklist
${templateReqs ? `The repo has a PR template. The PR body MUST satisfy these requirements:\n${templateReqs.compact}\n\n${templateReqs.checkboxSections.map(cb => `**${cb.heading}** (${cb.rule === 'all' ? 'ALL must be [x]' : 'at least 1 must be [x]'}):\n${cb.items.map(i => `  - ${i}`).join('\n')}`).join('\n')}\n\n${templateReqs.requiredSections.length > 0 ? `**Required text sections** (must not be empty/placeholder): ${templateReqs.requiredSections.join(', ')}` : ''}` : 'No PR template found — check for clear commit messages and focused changes.'}
- FAIL if: PR body doesn't follow the repo's PR template structure, required checkbox sections are missing, checkboxes are left unchecked, or required sections are empty/placeholder-only

## Output Format

You MUST output a JSON block wrapped in \`\`\`json fences with this exact structure, followed by posting the review comment:

\`\`\`json
{
  "overallVerdict": "approve" | "request_changes" | "comment",
  "summary": "One-line summary of the review",
  "rubric": [
    { "aspect": "Completeness", "rating": "pass" | "concern" | "fail", "summary": "Brief explanation" },
    { "aspect": "Code Quality", "rating": "pass" | "concern" | "fail", "summary": "Brief explanation" },
    { "aspect": "Test Coverage", "rating": "pass" | "concern" | "fail", "summary": "Brief explanation" },
    { "aspect": "Security", "rating": "pass" | "concern" | "fail", "summary": "Brief explanation" },
    { "aspect": "Project Conventions", "rating": "pass" | "concern" | "fail", "summary": "Brief explanation" },
    { "aspect": "PR Checklist", "rating": "pass" | "concern" | "fail", "summary": "Brief explanation" }
  ]
}
\`\`\`

**Verdict rules (follow strictly):**
- **request_changes**: If ANY aspect is rated "fail". One fail = request_changes, no exceptions.
- **approve**: Only if ALL aspects are "pass".
- **comment**: If no aspects are "fail" but at least one is "concern".

After outputting the JSON, post the review to the PR. Format the comment as a structured markdown review:

- Start with an overall verdict line: "## Audit Review — [APPROVED/CHANGES REQUESTED/COMMENT]"
- Then a summary line
- Then a rubric table with columns: Aspect | Rating | Notes
- Use emoji for ratings: ✅ pass, ⚠️ concern, ❌ fail
- End with specific actionable feedback if there are concerns or failures

Use the appropriate gh command based on verdict:
- approve: gh pr review ${entry.prNumber} --repo ${entry.repo} --approve --body "REVIEW"
- request_changes: gh pr review ${entry.prNumber} --repo ${entry.repo} --request-changes --body "REVIEW"
- comment: gh pr review ${entry.prNumber} --repo ${entry.repo} --comment --body "REVIEW"
`;
}

async function reviewPr(entry: WatchlistEntry): Promise<void> {
  if (entry.reviewing) return;
  if (runningReviews.has(entry.prUrl)) return;

  entry.reviewing = true;
  await saveWatchlist();
  broadcastFn({ type: 'auditor_updated', data: getWatchlistStatus() });

  // Update ticket audit status if linked
  if (entry.ticketId) {
    const ticket = await getTicket(entry.ticketId);
    if (ticket) {
      const updated = await updateTicket(entry.ticketId, { auditStatus: 'running' });
      if (updated) broadcastFn({ type: 'ticket_updated', data: updated });
    }
  }

  console.log(`[auditor] Starting review for ${entry.prUrl} (review #${entry.reviewCount + 1})`);

  // Load project conventions
  const templateReqs = await getTemplateRequirements(entry.repoPath);
  const agentsMd = await readFileOrEmpty(join(entry.repoPath, 'AGENTS.md'));
  const claudeMd = await readFileOrEmpty(join(entry.repoPath, 'CLAUDE.md'));
  const conventions = [agentsMd, claudeMd].filter(Boolean).join('\n\n');

  const prompt = buildReviewPrompt(entry, conventions, templateReqs);

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];

  // Remove env vars that would override subscription auth
  const cleanEnv: Record<string, string | undefined> = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE;
  delete cleanEnv.ANTHROPIC_API_KEY;

  const proc = spawn('claude', args, {
    cwd: entry.repoPath,
    env: envWithNvmNode(cleanEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runningReviews.set(entry.prUrl, proc);

  let stderr = '';
  let fullText = '';
  let lineBuffer = '';

  function processLine(line: string) {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.type === 'assistant') {
        const blocks = event.message?.content;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (block.type === 'text' && typeof block.text === 'string') {
              fullText += block.text + '\n';
            }
          }
        }
      } else if (event.type === 'result') {
        if (typeof event.result === 'string') {
          fullText += event.result + '\n';
        }
      }
    } catch {
      fullText += line + '\n';
    }
  }

  proc.stdout.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';
    for (const line of lines) processLine(line);
  });

  proc.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  proc.on('close', async (code) => {
    if (lineBuffer.trim()) processLine(lineBuffer);
    runningReviews.delete(entry.prUrl);

    console.log(`[auditor] Review for ${entry.prUrl} exited with code ${code}`);

    entry.reviewing = false;
    entry.reviewCount++;
    entry.lastReviewedAt = Date.now();

    if (code === 0) {
      // Try to extract the structured JSON result from output
      const result = parseAuditResult(fullText, entry.prUrl);
      if (result) {
        entry.lastResult = result;
      }
    }

    await saveWatchlist();
    broadcastFn({ type: 'auditor_updated', data: getWatchlistStatus() });

    // Update linked ticket
    if (entry.ticketId) {
      const auditStatus = code === 0 ? 'done' as const : 'error' as const;
      const auditResult = code === 0
        ? (entry.lastResult?.summary || fullText.slice(-2000))
        : (stderr.slice(-1000) || `Auditor exited with code ${code}`);
      const auditVerdict = code === 0 ? entry.lastResult?.overallVerdict : undefined;

      const updated = await updateTicket(entry.ticketId, { auditStatus, auditResult, auditVerdict });
      if (updated) broadcastFn({ type: 'ticket_updated', data: updated });

      // If auditor requested changes and ticket has a session ID, trigger re-dispatch
      if (entry.lastResult?.overallVerdict === 'request_changes') {
        const ticket = await getTicket(entry.ticketId);
        if (ticket && ticket.agentSessionId) {
          const iteration = ticket.automationIteration || 0;
          if (iteration >= MAX_AUTOMATION_ITERATIONS) {
            console.log(`[auditor] Ticket #${entry.ticketId} exceeded automation budget (${iteration}/${MAX_AUTOMATION_ITERATIONS})`);
            const failed = await updateTicket(entry.ticketId, {
              status: 'failed',
              error: `Automation budget exhausted after ${iteration} iterations`,
              failureReason: { type: 'automation_budget_exhausted', iterations: iteration },
              completedAt: Date.now(),
            }, 'automation_budget_exhausted');
            if (failed) broadcastFn({ type: 'ticket_updated', data: failed });
          } else {
            // Build feedback prompt from audit result
            const rubricDetails = entry.lastResult.rubric
              .filter(r => r.rating !== 'pass')
              .map(r => `- **${r.aspect}** (${r.rating}): ${r.summary}`)
              .join('\n');

            const feedback = [
              'The PR auditor reviewed your changes and requested changes:',
              '',
              entry.lastResult.summary,
              '',
              rubricDetails ? `Issues found:\n${rubricDetails}` : '',
              '',
              'Please address the review feedback, commit, and push.',
              'Do NOT create a new PR — push to the existing branch.',
            ].filter(Boolean).join('\n');

            console.log(`[auditor] Triggering re-dispatch for ticket #${entry.ticketId} (session: ${ticket.agentSessionId}, iteration: ${iteration + 1})`);
            const redispatch = await updateTicket(entry.ticketId, {
              status: 'todo',
              error: undefined,
              failureReason: undefined,
              completedAt: undefined,
              agentPid: undefined,
              lastOutput: undefined,
              resumePrompt: feedback,
              automationIteration: iteration + 1,
              postAgentAction: 'audit',
              // Preserve: branchName, agentSessionId (for --resume)
            }, 'audit_requested_changes');
            if (redispatch) broadcastFn({ type: 'ticket_updated', data: redispatch });
          }
        } else {
          console.log(`[auditor] Ticket #${entry.ticketId} has no session ID — skipping auto re-dispatch`);
        }
      }

      // If auditor approved and ticket has autoMerge, attempt merge immediately
      if (entry.lastResult?.overallVerdict === 'approve') {
        const ticket = await getTicket(entry.ticketId);
        if (ticket && ticket.autoMerge) {
          console.log(`[auditor] Approved + autoMerge — attempting merge for ticket #${entry.ticketId}`);
          attemptMergeFn(ticket).catch(err => {
            console.error(`[auditor] Active merge failed for ticket #${entry.ticketId}:`, err);
          });
        }
      }
    }

    console.log(`[auditor] Review complete for ${entry.prUrl} — ${entry.lastResult?.overallVerdict || 'no structured result'}`);
  });
}

function parseAuditResult(output: string, prUrl: string): AuditResult | null {
  // Look for JSON block in the output
  const jsonMatch = output.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    return {
      prUrl,
      overallVerdict: parsed.overallVerdict || 'comment',
      summary: parsed.summary || '',
      rubric: Array.isArray(parsed.rubric) ? parsed.rubric : [],
      reviewedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

// ─── Polling Loop ───────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const RE_REVIEW_KEYWORDS = ['@auditor', 're-review', 'rereview', 'please review', 'audit again'];

/**
 * Check a single PR for status changes and re-review requests.
 *
 * Note: execSync is used here with controlled inputs (numeric prNumber, validated repo slug
 * from our own project data) — not user-supplied strings. This matches the pattern used
 * throughout dispatcher.ts.
 */
async function pollPr(entry: WatchlistEntry): Promise<void> {
  if (entry.resolved || entry.reviewing) return;

  try {
    // Check PR state (open/merged/closed)
    const prJson = execSync(
      `gh pr view ${entry.prNumber} --repo ${entry.repo} --json state,comments`,
      { encoding: 'utf-8', timeout: 15000 },
    ).trim();

    const pr = JSON.parse(prJson) as {
      state: string;
      comments: Array<{ body: string; createdAt: string; author: { login: string } }>;
    };

    if (pr.state === 'MERGED' || pr.state === 'CLOSED') {
      entry.resolved = true;
      await saveWatchlist();
      broadcastFn({ type: 'auditor_updated', data: getWatchlistStatus() });
      console.log(`[auditor] PR ${entry.prUrl} is ${pr.state.toLowerCase()} — removing from active watchlist`);

      // Update linked ticket if merged
      if (entry.ticketId && pr.state === 'MERGED') {
        const ticket = await getTicket(entry.ticketId);
        if (ticket && ticket.status === 'in_review') {
          const updated = await updateTicket(entry.ticketId, { status: 'merged' }, 'pr_merged');
          if (updated) broadcastFn({ type: 'ticket_updated', data: updated });
        }
      }
      return;
    }

    // Check for re-review requests in comments since last check
    const checkSince = entry.lastCommentCheckedAt || entry.lastReviewedAt || entry.addedAt;
    const newComments = pr.comments.filter(c => {
      const commentTime = new Date(c.createdAt).getTime();
      return commentTime > checkSince;
    });

    const hasReReviewRequest = newComments.some(c =>
      RE_REVIEW_KEYWORDS.some(kw => c.body.toLowerCase().includes(kw)),
    );

    entry.lastCommentCheckedAt = Date.now();
    await saveWatchlist();

    if (hasReReviewRequest) {
      console.log(`[auditor] Re-review requested for ${entry.prUrl} via comment`);
      reviewPr(entry).catch(err => {
        console.error(`[auditor] Re-review failed for ${entry.prUrl}:`, err);
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[auditor] Error polling ${entry.prUrl}: ${msg}`);
  }
}

/** Refresh template caches for all unique repo paths on the active watchlist */
async function refreshTemplateCache(): Promise<void> {
  const repoPaths = new Set(watchlist.filter(e => !e.resolved).map(e => e.repoPath));
  for (const repoPath of repoPaths) {
    await getTemplateRequirements(repoPath);
  }
}

/** Single tick of the polling loop — checks all active watchlist entries */
export async function auditorTick(): Promise<void> {
  // Refresh template caches (cheap — only re-parses if file hash changed)
  await refreshTemplateCache();

  const active = watchlist.filter(e => !e.resolved && !e.reviewing);
  for (const entry of active) {
    await pollPr(entry);
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────

let pollIntervalId: ReturnType<typeof setInterval> | null = null;

export async function startAuditor(): Promise<void> {
  await loadWatchlist();
  const activeCount = watchlist.filter(e => !e.resolved).length;
  console.log(`[auditor] Started (polling every ${POLL_INTERVAL_MS / 1000}s, ${activeCount} active PRs)`);

  // Initial tick
  auditorTick();
  pollIntervalId = setInterval(auditorTick, POLL_INTERVAL_MS);
}

export function stopAuditor(): void {
  if (pollIntervalId) clearInterval(pollIntervalId);

  // Kill all running review processes and detach so Node can exit
  for (const [url, proc] of runningReviews) {
    console.log(`[auditor] Killing review for ${url}`);
    proc.kill('SIGTERM');
    proc.unref();
    proc.stdout?.destroy();
    proc.stderr?.destroy();
  }
  runningReviews.clear();
}
