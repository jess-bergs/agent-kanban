import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getProject, getTicket, updateTicket } from './store.ts';
import type { Ticket, WSEvent } from '../src/types.ts';

type BroadcastFn = (event: WSEvent) => void;
let broadcastFn: BroadcastFn = () => {};

export function setAuditorBroadcast(fn: BroadcastFn) {
  broadcastFn = fn;
}

const runningAudits = new Map<string, ChildProcess>();

/** Check whether an audit is currently running for a ticket */
export function isAuditRunning(ticketId: string): boolean {
  return runningAudits.has(ticketId);
}

/**
 * Run a local auditor agent against a ticket's PR.
 *
 * The auditor spawns a `claude` CLI process that:
 * 1. Reads the PR diff via `gh pr diff`
 * 2. Reviews for code quality, security, PR checklist, and AGENTS.md compliance
 * 3. Posts a review comment on the PR via `gh pr review`
 */
export async function runAudit(ticket: Ticket): Promise<void> {
  if (!ticket.prUrl || !ticket.branchName) {
    console.log(`[auditor] Ticket #${ticket.id} has no PR URL or branch — skipping audit`);
    return;
  }

  if (runningAudits.has(ticket.id)) {
    console.log(`[auditor] Audit already running for ticket #${ticket.id}`);
    return;
  }

  const project = await getProject(ticket.projectId);
  if (!project) {
    console.error(`[auditor] Project ${ticket.projectId} not found for ticket #${ticket.id}`);
    return;
  }

  // Mark audit as started
  const updated = await updateTicket(ticket.id, { auditStatus: 'running' });
  if (updated) broadcastFn({ type: 'ticket_updated', data: updated });

  console.log(`[auditor] Starting audit for ticket #${ticket.id}: ${ticket.prUrl}`);

  // Build the audit prompt
  const prompt = await buildAuditPrompt(ticket, project.repoPath, project.defaultBranch);

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];

  // Remove env vars that would override subscription auth
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE;
  delete cleanEnv.ANTHROPIC_API_KEY;

  const proc = spawn('claude', args, {
    cwd: project.repoPath,
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runningAudits.set(ticket.id, proc);

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
    runningAudits.delete(ticket.id);

    console.log(`[auditor] Audit for ticket #${ticket.id} exited with code ${code}`);

    if (code !== 0) {
      const failed = await updateTicket(ticket.id, {
        auditStatus: 'error',
        auditResult: stderr.slice(-1000) || `Auditor exited with code ${code}`,
      });
      if (failed) broadcastFn({ type: 'ticket_updated', data: failed });
      return;
    }

    const auditResult = fullText.slice(-2000);

    const done = await updateTicket(ticket.id, {
      auditStatus: 'done',
      auditResult,
    });
    if (done) broadcastFn({ type: 'ticket_updated', data: done });

    console.log(`[auditor] Audit complete for ticket #${ticket.id}`);
  });
}

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return '';
  }
}

async function buildAuditPrompt(
  ticket: Ticket,
  repoPath: string,
  defaultBranch: string,
): Promise<string> {
  const prChecklist = await readFileOrEmpty(join(repoPath, '.github', 'pull_request_template.md'));
  const agentsMd = await readFileOrEmpty(join(repoPath, 'AGENTS.md'));
  const claudeMd = await readFileOrEmpty(join(repoPath, 'CLAUDE.md'));
  const conventions = [agentsMd, claudeMd].filter(Boolean).join('\n\n');

  return `You are a local PR auditor. Review the pull request for ticket: "${ticket.subject}"

PR URL: ${ticket.prUrl}
Branch: ${ticket.branchName}
Base: ${defaultBranch}

## Your Tasks

1. **Fetch the PR diff** by running: gh pr diff "${ticket.prUrl}"
2. **Review the code** for the following criteria:

### Code Quality
- Code follows project conventions and style
- No obvious bugs, logic errors, or regressions
- No unnecessary complexity or over-engineering
- Changes are focused and match the ticket subject

### Security
- No hardcoded secrets, API keys, or credentials
- No command injection, XSS, or SQL injection vulnerabilities
- No unsafe use of eval, innerHTML, or similar patterns
- Proper input validation at system boundaries

### PR Checklist Adherence
${prChecklist ? `Review against this PR template:\n${prChecklist}` : 'No PR template found — check for clear commit messages and focused changes.'}

### Project Conventions (AGENTS.md / CLAUDE.md)
${conventions ? `Check adherence to these project conventions:\n${conventions}` : 'No AGENTS.md or CLAUDE.md found.'}

### Completeness
- Does the PR fully address the ticket subject: "${ticket.subject}"?
- Are there any missing pieces or unfinished work?
- Are edge cases handled?

## Output

After reviewing, post your review as a comment on the PR:

gh pr review "${ticket.prUrl}" --comment --body "YOUR_REVIEW_HERE"

Format your review as a structured markdown comment with sections for each criterion above.
Use checkmarks for passing items and warnings for concerns. Be constructive and specific.

Start with a one-line summary: either "LGTM — [brief reason]" or "Changes requested — [brief reason]"

If you find critical issues (security vulnerabilities, data loss risks, or breaking changes), use:
gh pr review "${ticket.prUrl}" --request-changes --body "YOUR_REVIEW_HERE"

If everything looks good, use:
gh pr review "${ticket.prUrl}" --approve --body "YOUR_REVIEW_HERE"
`;
}
