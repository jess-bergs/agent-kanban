# Audit Scheduler Architecture

## Overview

The audit scheduler is a server-side subsystem that runs recurring agent-based audits on
registered projects. It sits alongside the dispatcher and PR auditor as a third autonomous
subsystem in the agent-kanban server.

```
┌─────────────────────────────────────────────────────┐
│                   Server Process                     │
│                                                      │
│  ┌──────────────┐  ┌───────────┐  ┌──────────────┐  │
│  │  Dispatcher   │  │  Auditor  │  │  Scheduler   │  │
│  │  (3s poll)    │  │  (30s)    │  │  (5min poll)  │  │
│  └──────┬───────┘  └─────┬─────┘  └──────┬───────┘  │
│         │                │               │           │
│         └────────────────┴───────────────┘           │
│                          │                           │
│                    broadcast(WSEvent)                 │
│                          │                           │
│                     WebSocket ──► React Frontend      │
└─────────────────────────────────────────────────────┘
```

## Data Model

### AuditSchedule
Defines *what* to audit and *when*. Stored in `data/audit-schedules/{uuid}.json`.

Key fields:
- `projectId` — links to a registered project
- `templateId` / `prompt` — what the agent should audit
- `cadence` — daily, weekly, monthly, or manual
- `mode` — report (read-only) or fix (creates PRs)
- `nextRunAt` — computed timestamp; scheduler checks `now >= nextRunAt`

### AuditRun
Captures *each execution* of a schedule. Stored in `data/audit-runs/{uuid}.json`.

Key fields:
- `scheduleId` — links back to the schedule
- `status` — pending, running, completed, failed
- `report` — captured agent output (report mode only)
- `ticketId` — linked dispatcher ticket (fix mode only)

## Execution Modes

### Report Mode

The scheduler owns the full lifecycle. No worktree is created.

```
schedulerTick()
  │
  ├─ npm ci --ignore-scripts (best-effort)
  │
  ├─ spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'])
  │   cwd: project.repoPath (no worktree)
  │
  ├─ capture stream-json output → fullText
  │
  └─ on close:
      ├─ updateRun({ status: 'completed', report: fullText })
      └─ updateSchedule({ lastRunAt, nextRunAt })
```

The agent is instructed to be read-only. `--dangerously-skip-permissions` is used because
report audits don't need interactive approval — they only read files and run analysis commands.

### Fix Mode

The scheduler delegates to the existing dispatcher by creating a ticket.

```
schedulerTick()
  │
  ├─ createTicket({ subject: "[Scheduled Audit] ...", instructions: prompt })
  │
  ├─ updateRun({ status: 'running', ticketId })
  │
  └─ updateSchedule({ lastRunAt, nextRunAt })

  ... dispatcher picks up the ticket on its next 3s tick ...

  later schedulerTick():
  │
  └─ check ticket.status
      ├─ done/merged → updateRun({ status: 'completed' })
      └─ failed/error → updateRun({ status: 'failed' })
```

This reuses all dispatcher infrastructure: worktree creation, branch management, PR creation,
screenshot capture, PR auditing, auto-merge, and conflict detection.

## Cadence Calculation

`computeNextRun(cadence, lastRunAt)` adds a fixed duration to the last run time:

| Cadence  | Interval |
|----------|----------|
| daily    | 24 hours |
| weekly   | 7 days   |
| monthly  | 30 days  |
| manual   | never (only on API trigger) |

If a schedule has never run, `nextRunAt` is computed from creation time, so it runs on the
first scheduler tick after creation.

## Concurrency

- Max 2 concurrent report-mode audits (`MAX_CONCURRENT_AUDITS`)
- Fix-mode audits don't count — they're managed by the dispatcher's own concurrency limit
- Duplicate prevention: the scheduler skips a schedule if it already has a running/pending run

## File Layout

```
server/
  audit-scheduler.ts   # Lifecycle, tick loop, report/fix execution
  audit-store.ts       # CRUD for schedules and runs (reuses store.ts utilities)
  audit-templates.ts   # 6 built-in prompt templates (pure data)
data/
  audit-schedules/     # One JSON file per schedule
  audit-runs/          # One JSON file per run
```

## API Surface

See [CLAUDE.md](../../CLAUDE.md#api-endpoints-2) for the full endpoint list.

Key flows:
- Create schedule from template: `POST /api/audit-schedules { templateId, cadence, mode }`
- Manual trigger: `POST /api/audit-schedules/:id/trigger`
- Read report: `GET /api/audit-runs/:id` → `run.report`
- Pause/resume: `PATCH /api/audit-schedules/:id { status: "paused" }`
