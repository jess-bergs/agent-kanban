import { spawn, execSync, type ChildProcess } from 'node:child_process';
import {
  listSchedules,
  getSchedule,
  updateSchedule,
  createRun,
  updateRun,
  listRuns,
  listRunsBySchedule,
  getRun,
  computeNextRun,
} from './audit-store.ts';
import { getProject, createTicket, getTicket } from './store.ts';
import { getTemplate } from './audit-templates.ts';
import { parseStructuredReport, writeMarkdownReport } from './audit-report-parser.ts';
import { computeTrend } from './audit-trend.ts';
import { envWithNvmNode } from './nvm.ts';
import type { AuditSchedule, AuditRun, WSEvent } from '../src/types.ts';
import { isSignalExit, SIGNAL_NAMES } from '../src/types.ts';

const POLL_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
const MAX_CONCURRENT_AUDITS = 2;

type BroadcastFn = (event: WSEvent) => void;
let broadcastFn: BroadcastFn = () => {};

export function setSchedulerBroadcast(fn: BroadcastFn) {
  broadcastFn = fn;
}

const runningAudits = new Map<string, ChildProcess>(); // runId -> process

// ─── Rubric Prompt Construction ─────────────────────────────────

function buildRubricInstructions(schedule: AuditSchedule): string {
  const template = schedule.templateId ? getTemplate(schedule.templateId) : null;
  if (!template) return '';

  const aspectList = template.rubric
    .map((r, i) => `${i + 1}. **${r.aspect}**: ${r.description} (weight: ${r.weight})`)
    .join('\n');

  const verdicts = template.verdictLabels.join(' / ');

  return `

---

## REQUIRED: Structured Output

After completing your analysis, you MUST output a JSON block wrapped in \`\`\`json fences with this exact structure:

\`\`\`json
{
  "overallScore": 7.5,
  "overallVerdict": "${template.verdictLabels[0]}",
  "summary": "One-paragraph summary of findings",
  "rubric": [
    {
      "aspect": "Aspect Name",
      "score": 8.0,
      "summary": "Brief explanation of this score",
      "findingCount": 2
    }
  ],
  "findings": [
    {
      "severity": "high",
      "aspect": "Aspect Name",
      "location": "src/file.ts:42",
      "title": "One-line summary of finding",
      "description": "Detailed explanation",
      "recommendation": "Suggested fix"
    }
  ]
}
\`\`\`

## Evaluation Rubric

Score each of these aspects from 0 (terrible) to 10 (perfect):

${aspectList}

Scoring guide:
- 9-10: No issues found, exemplary
- 7-8: Minor issues only, good overall
- 4-6: Notable concerns that should be addressed
- 1-3: Serious problems requiring immediate attention
- 0: Critical failures or complete absence

The overallScore should be the weighted average of aspect scores.
The overallVerdict should be one of: ${verdicts}

Severity levels for findings: critical, high, medium, low, info
Each finding must reference one of the rubric aspects above.`;
}

// ─── Report Mode Execution ──────────────────────────────────────

async function executeReportAudit(schedule: AuditSchedule, run: AuditRun): Promise<void> {
  const project = await getProject(schedule.projectId);
  if (!project) {
    const failed = await updateRun(run.id, {
      status: 'failed',
      error: `Project ${schedule.projectId} not found`,
      completedAt: Date.now(),
    });
    if (failed) broadcastFn({ type: 'audit_run_updated', data: failed });
    return;
  }

  console.log(`[audit-scheduler] Starting report audit "${schedule.name}" in ${project.repoPath}`);

  // Ensure dependencies are up-to-date before auditing
  try {
    execSync('npm ci --ignore-scripts', {
      cwd: project.repoPath,
      stdio: 'ignore',
      timeout: 60_000,
      env: envWithNvmNode({ ...process.env }) as NodeJS.ProcessEnv,
    });
    console.log(`[audit-scheduler] npm ci completed for ${project.name}`);
  } catch {
    console.log(`[audit-scheduler] npm ci skipped/failed for ${project.name} (may not be an npm project)`);
  }

  const prompt = [
    `You are performing a scheduled audit of the repository at ${project.repoPath}.`,
    `Audit type: ${schedule.name}`,
    '',
    schedule.prompt,
    '',
    '---',
    'IMPORTANT: This is a READ-ONLY audit. Do NOT modify any files.',
    'Do NOT create branches, commits, or PRs.',
    'Produce a detailed report of your findings as your final output.',
    buildRubricInstructions(schedule),
  ].join('\n');

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];

  // Remove env vars that would override subscription auth or block nested sessions.
  // Clean ALL CLAUDE_CODE_* vars to future-proof against new vars added by Claude Code updates.
  const cleanEnv: Record<string, string | undefined> = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE;
  for (const key of Object.keys(cleanEnv)) {
    if (key.startsWith('CLAUDE_CODE_')) delete cleanEnv[key];
  }
  delete cleanEnv.ANTHROPIC_API_KEY;
  // Disable remote MCP servers (Gmail, Calendar, etc.) — they hang agent startup
  cleanEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';

  const proc = spawn('claude', args, {
    cwd: project.repoPath,
    env: envWithNvmNode(cleanEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runningAudits.set(run.id, proc);

  const pidUpdate = await updateRun(run.id, { agentPid: proc.pid });
  if (pidUpdate) broadcastFn({ type: 'audit_run_updated', data: pidUpdate });

  let fullText = '';
  let stderr = '';
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
    runningAudits.delete(run.id);

    const completedAt = Date.now();

    if (code !== 0) {
      const exitCode = code ?? 1;
      const signalName = SIGNAL_NAMES[exitCode];
      const errorMsg = isSignalExit(exitCode)
        ? `Audit agent was stopped (${signalName ?? `signal ${exitCode - 128}`})`
        : (stderr.slice(-500) || `Agent exited with code ${exitCode}`);
      const failedRun = await updateRun(run.id, {
        status: 'failed',
        error: errorMsg,
        completedAt,
        agentPid: undefined,
      });
      if (failedRun) broadcastFn({ type: 'audit_run_updated', data: failedRun });
    } else {
      // Parse structured report from agent output
      const structuredReport = parseStructuredReport(fullText);

      let reportPath: string | undefined;
      let trend: typeof run.trend;

      if (structuredReport) {
        // Write markdown report to data/reports/
        try {
          reportPath = await writeMarkdownReport(run, structuredReport, schedule.name, project.name);
          console.log(`[audit-scheduler] Report written to ${reportPath}`);
        } catch (err) {
          console.error(`[audit-scheduler] Failed to write markdown report:`, err);
        }

        // Compute trend against previous completed run for same schedule
        try {
          const previousRuns = (await listRunsBySchedule(schedule.id))
            .filter(r => r.id !== run.id && r.status === 'completed' && r.structuredReport)
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

          if (previousRuns.length > 0 && previousRuns[0].structuredReport) {
            trend = computeTrend(structuredReport, previousRuns[0].structuredReport, previousRuns[0].id);
            console.log(`[audit-scheduler] Trend: ${trend.direction} (${trend.delta > 0 ? '+' : ''}${trend.delta.toFixed(1)})`);
          }
        } catch (err) {
          console.error(`[audit-scheduler] Trend computation failed:`, err);
        }
      } else {
        console.log(`[audit-scheduler] No structured JSON found in output — storing raw text only`);
      }

      const completedRun = await updateRun(run.id, {
        status: 'completed',
        report: fullText,
        reportPath,
        structuredReport: structuredReport || undefined,
        severityCounts: structuredReport?.severityCounts,
        trend,
        completedAt,
        agentPid: undefined,
      });
      if (completedRun) broadcastFn({ type: 'audit_run_updated', data: completedRun });
    }

    // Update schedule with lastRunAt and compute next run
    await updateSchedule(schedule.id, {
      lastRunAt: completedAt,
      nextRunAt: computeNextRun(schedule.cadence, completedAt),
    });

    broadcastFn({ type: 'audit_schedules_updated', data: await listSchedules() });

    console.log(`[audit-scheduler] Report audit "${schedule.name}" completed (code=${code})`);
  });
}

// ─── Fix Mode Execution ─────────────────────────────────────────

async function executeFixAudit(schedule: AuditSchedule, run: AuditRun): Promise<void> {
  const project = await getProject(schedule.projectId);
  if (!project) {
    const failed = await updateRun(run.id, {
      status: 'failed',
      error: `Project ${schedule.projectId} not found`,
      completedAt: Date.now(),
    });
    if (failed) broadcastFn({ type: 'audit_run_updated', data: failed });
    return;
  }

  console.log(`[audit-scheduler] Starting fix audit "${schedule.name}" — creating ticket`);

  const ticket = await createTicket({
    projectId: schedule.projectId,
    subject: `[Scheduled Audit] ${schedule.name}`,
    instructions: schedule.prompt,
    yolo: schedule.yolo,
    autoMerge: schedule.autoMerge,
  });

  const updatedRun = await updateRun(run.id, {
    status: 'running',
    ticketId: ticket.id,
  });
  if (updatedRun) broadcastFn({ type: 'audit_run_updated', data: updatedRun });

  broadcastFn({ type: 'ticket_updated', data: ticket });

  // Update schedule timing
  const now = Date.now();
  await updateSchedule(schedule.id, {
    lastRunAt: now,
    nextRunAt: computeNextRun(schedule.cadence, now),
  });

  broadcastFn({ type: 'audit_schedules_updated', data: await listSchedules() });
}

// ─── Scheduler Tick ─────────────────────────────────────────────

async function hasRunningRunForSchedule(scheduleId: string): Promise<boolean> {
  const runs = await listRuns();
  return runs.some(
    r => r.scheduleId === scheduleId && (r.status === 'running' || r.status === 'pending'),
  );
}

export async function schedulerTick(): Promise<void> {
  const now = Date.now();
  const schedules = await listSchedules();

  // 1. Check for due schedules and start runs
  const activeSchedules = schedules.filter(
    s => s.status === 'active' && s.cadence !== 'manual',
  );

  for (const schedule of activeSchedules) {
    if (runningAudits.size >= MAX_CONCURRENT_AUDITS) break;

    // Skip if not yet due
    if (schedule.nextRunAt && now < schedule.nextRunAt) continue;

    // Skip if there's already a running audit for this schedule
    if (await hasRunningRunForSchedule(schedule.id)) continue;

    const run = await createRun({
      scheduleId: schedule.id,
      projectId: schedule.projectId,
      mode: schedule.mode,
      status: schedule.mode === 'report' ? 'running' : 'pending',
      startedAt: Date.now(),
    });

    broadcastFn({ type: 'audit_run_updated', data: run });

    if (schedule.mode === 'report') {
      executeReportAudit(schedule, run).catch(err => {
        console.error(`[audit-scheduler] Report audit failed for "${schedule.name}":`, err);
      });
    } else {
      executeFixAudit(schedule, run).catch(err => {
        console.error(`[audit-scheduler] Fix audit failed for "${schedule.name}":`, err);
      });
    }
  }

  // 2. Resolve fix-mode runs by checking their linked ticket status
  const runs = await listRuns();
  const pendingFixRuns = runs.filter(
    r => r.status === 'running' && r.mode === 'fix' && r.ticketId,
  );

  for (const run of pendingFixRuns) {
    const ticket = await getTicket(run.ticketId!);
    if (!ticket) continue;

    if (['done', 'merged'].includes(ticket.status)) {
      const updated = await updateRun(run.id, {
        status: 'completed',
        completedAt: Date.now(),
      });
      if (updated) broadcastFn({ type: 'audit_run_updated', data: updated });
    } else if (['failed', 'error'].includes(ticket.status)) {
      const updated = await updateRun(run.id, {
        status: 'failed',
        error: ticket.error || `Ticket ended with status: ${ticket.status}`,
        completedAt: Date.now(),
      });
      if (updated) broadcastFn({ type: 'audit_run_updated', data: updated });
    }
  }
}

// ─── Manual Trigger ─────────────────────────────────────────────

export async function triggerAudit(scheduleId: string): Promise<AuditRun | null> {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) return null;

  const run = await createRun({
    scheduleId: schedule.id,
    projectId: schedule.projectId,
    mode: schedule.mode,
    status: schedule.mode === 'report' ? 'running' : 'pending',
    startedAt: Date.now(),
  });

  broadcastFn({ type: 'audit_run_updated', data: run });

  if (schedule.mode === 'report') {
    executeReportAudit(schedule, run).catch(err => {
      console.error(`[audit-scheduler] Manual report audit failed:`, err);
    });
  } else {
    executeFixAudit(schedule, run).catch(err => {
      console.error(`[audit-scheduler] Manual fix audit failed:`, err);
    });
  }

  return run;
}

// ─── Lifecycle ──────────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;

export async function startAuditScheduler(): Promise<void> {
  const schedules = await listSchedules();
  const activeCount = schedules.filter(s => s.status === 'active' && s.cadence !== 'manual').length;
  console.log(`[audit-scheduler] Started (polling every ${POLL_INTERVAL_MS / 1000 / 60}min, ${activeCount} active schedule(s))`);

  schedulerTick();
  intervalId = setInterval(schedulerTick, POLL_INTERVAL_MS);
}

export function stopAuditScheduler(): void {
  if (intervalId) clearInterval(intervalId);

  for (const [runId, proc] of runningAudits) {
    console.log(`[audit-scheduler] Killing audit run ${runId}`);
    proc.kill('SIGTERM');
    proc.unref();
    proc.stdout?.destroy();
    proc.stderr?.destroy();
  }
  runningAudits.clear();
}
