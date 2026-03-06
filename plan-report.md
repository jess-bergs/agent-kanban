# Plan Report: Auto-Creating Tickets from High-Risk/Critical Report Findings

## Summary

Agent Kanban's audit scheduler already produces structured reports with severity-classified findings (`critical`, `high`, `medium`, `low`, `info`), but these findings currently sit inert in the dashboard — surfaced visually but never acted upon. This report proposes adding an **auto-ticket pipeline** that, after a report-mode audit completes, inspects the findings, and automatically creates fix-mode tickets for critical and high-severity issues. The system already has all the building blocks: structured `AuditFinding` objects with severity/location/recommendation fields, the `createTicket()` function used by the scheduler's fix-mode and external PR scanner, and configurable `AuditSchedule` records. The main work is (1) adding a configurable threshold to `AuditSchedule`, (2) hooking into the report-audit completion handler to create tickets from qualifying findings, (3) linking generated tickets back to the audit run for traceability, and (4) exposing this configuration in the frontend. No auto-merge at first — tickets are created as `todo` with `autoMerge: false`.

---

## Relevant Files

### Server (implementation targets)

| File | Role |
|------|------|
| `server/audit-scheduler.ts` | Report-mode execution, fix-mode ticket creation, scheduler polling loop. **Primary integration point** — the `proc.on('close')` handler at line 209 is where auto-ticket logic would be inserted. |
| `server/audit-store.ts` | CRUD for `AuditSchedule` and `AuditRun`. Needs schema extension for new config fields. |
| `server/audit-report-parser.ts` | Parses structured JSON from agent output into `AuditReport` with findings. Already produces the data auto-ticketing needs. |
| `server/audit-trend.ts` | Computes trend data (new/resolved/recurring findings). Could inform whether a finding is net-new or recurring. |
| `server/store.ts` | `createTicket()` function (line 185) and `updateTicket()`. Used by the scheduler's fix mode and the external PR scanner as prior art. |
| `server/index.ts` | REST API endpoints — needs new/updated endpoints for auto-ticket configuration. Schedule CRUD at lines 456-530. |
| `server/analytics.ts` | `buildSchedulerStats()` — could be extended to surface auto-ticket counts. `buildIssues()` already flags failed audit runs. |
| `server/mcp.ts` | MCP tool `create_audit_schedule` — needs to accept new config fields. |

### Shared Types

| File | Role |
|------|------|
| `src/types.ts` | `AuditSchedule`, `AuditRun`, `AuditFinding`, `AuditReport`, `SeverityCounts`, `FindingSeverity`, `Ticket` type definitions. Core schema changes go here. |

### Frontend (UI for configuration and visibility)

| File | Role |
|------|------|
| `src/components/AnalyticsDashboard.tsx` | Reports tab showing audit runs, findings, severity counts. Needs "auto-ticketed" indicator on findings. |
| `src/components/CreateTicketModal.tsx` | Reference for ticket creation UI patterns. |
| `src/components/TicketDetailModal.tsx` | Shows ticket details — may need to show "source: audit_finding" provenance. |
| `src/components/TicketCard.tsx` | Ticket card rendering — may show audit-sourced badge. |

### Documentation

| File | Role |
|------|------|
| `docs/architecture/scheduler.md` | Scheduler architecture doc — needs update for auto-ticket feature. |
| `docs/futureDevelopmentOpportunities/futureDevelopmentOpportunities.md` | **Already describes this exact feature**: "Automatic action on report results: When a report audit surfaces critical/high findings, automatically create fix-mode tickets to address them." |
| `docs/features/AUDIT-REPORT.md` | Comprehensive audit report — references remaining work items. |

---

## Current Architecture

### How Audit Reports Are Generated Today

```
AuditSchedule (mode: 'report')
  │
  ├─ schedulerTick() detects schedule is due
  │
  ├─ executeReportAudit() spawns Claude agent with rubric prompt
  │   └─ Agent outputs markdown + JSON with structured findings
  │
  ├─ parseStructuredReport() extracts AuditReport:
  │   ├─ overallScore (0-10)
  │   ├─ overallVerdict (string)
  │   ├─ findings[] (AuditFinding with severity, location, title, description, recommendation)
  │   └─ severityCounts {critical, high, medium, low, info}
  │
  ├─ computeTrend() compares to previous run
  │
  └─ updateRun() persists completed run with structuredReport + severityCounts + trend
      └─ broadcast('audit_run_updated') → WebSocket → Dashboard
```

### How Tickets Are Auto-Created Today (Prior Art)

The codebase has **three** existing auto-ticket patterns:

**1. Scheduler Fix Mode** (`audit-scheduler.ts:288-326`):
```typescript
const ticket = await createTicket({
  projectId: schedule.projectId,
  subject: `[Scheduled Audit] ${schedule.name}`,
  instructions: schedule.prompt,
  yolo: schedule.yolo,
  autoMerge: schedule.autoMerge,
});
run.ticketId = ticket.id;
```
- Trigger: Schedule with `mode: 'fix'` reaches `nextRunAt`
- Ticket has the entire audit prompt as instructions
- Tracked via `run.ticketId`

**2. External PR Scanner** (`external-pr-scanner.ts`):
```typescript
const ticket = await createTicket({
  projectId: project.id,
  subject: `[External PR] ${pr.title}`,
  instructions: `Review and potentially merge external PR...`,
  source: 'external_pr_scan',
});
```

**3. Chat Tools** (`chat-tools.ts`):
- User-initiated via MCP tool in chat UI

### Key Data Structures

**AuditFinding** (what auto-ticketing would act on):
```typescript
interface AuditFinding {
  id: string;                      // deterministic fingerprint
  severity: FindingSeverity;       // 'critical' | 'high' | 'medium' | 'low' | 'info'
  aspect: string;                  // rubric category
  location?: string;               // e.g. "src/file.ts:42"
  title: string;                   // one-line summary
  description: string;             // detailed explanation
  recommendation?: string;         // suggested fix
}
```

**AuditSchedule** (where config would be added):
```typescript
interface AuditSchedule {
  id: string;
  projectId: string;
  name: string;
  templateId?: AuditTemplateId;
  prompt: string;
  cadence: AuditCadence;
  mode: AuditMode;                 // 'report' | 'fix'
  status: AuditScheduleStatus;
  yolo?: boolean;
  autoMerge?: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  // NEW fields would go here
}
```

**Ticket.source** (existing enum):
```typescript
source?: 'user' | 'dispatcher' | 'scheduler' | 'external_pr_scan';
// Would add: 'audit_finding'
```

---

## Proposed Approach

### Design Principles

1. **Opt-in, not opt-out** — Auto-ticketing is disabled by default; users explicitly enable it per schedule.
2. **No auto-merge at first** — Tickets are created with `autoMerge: false` regardless of schedule config. This is the explicit constraint from the ticket.
3. **One ticket per critical/high finding** — Each qualifying finding gets its own ticket, scoped to a single fix. This keeps PRs small and reviewable.
4. **Deduplication** — Don't create tickets for findings that already have linked tickets from previous runs.
5. **Traceability** — Every auto-created ticket links back to its source finding and audit run.

### Step 1: Extend `AuditSchedule` Type with Auto-Ticket Config

**File**: `src/types.ts`

Add new optional fields to `AuditSchedule`:

```typescript
interface AuditSchedule {
  // ... existing fields ...

  /** Auto-ticket configuration for report-mode audits */
  autoTicket?: {
    /** Whether auto-ticket creation is enabled */
    enabled: boolean;
    /** Minimum severity to create tickets for (default: 'high') */
    minSeverity: FindingSeverity;
    /** Maximum number of tickets to create per audit run (prevents flooding) */
    maxTicketsPerRun?: number;
    /** Whether auto-created tickets should use yolo mode */
    yolo?: boolean;
  };
}
```

**Why `minSeverity` instead of separate boolean flags**: The severity levels are already ordered (`critical` > `high` > `medium` > `low` > `info`). A threshold is simpler and more intuitive than per-level toggles. Setting `minSeverity: 'high'` creates tickets for both `critical` and `high` findings.

**Why `maxTicketsPerRun`**: Safety valve. An audit that finds 30 critical issues shouldn't create 30 tickets simultaneously. Default of 5 is reasonable.

### Step 2: Add `audit_finding` to Ticket Source Type

**File**: `src/types.ts`

Extend the `source` union:

```typescript
source?: 'user' | 'dispatcher' | 'scheduler' | 'external_pr_scan' | 'audit_finding';
```

Add a new optional field to `Ticket` for linking back to the finding:

```typescript
/** ID of the audit finding that triggered this ticket (for audit_finding source) */
sourceAuditFindingId?: string;
/** ID of the audit run that produced the finding */
sourceAuditRunId?: string;
```

### Step 3: Extend `AuditRun` to Track Generated Tickets

**File**: `src/types.ts`

Add to `AuditRun`:

```typescript
interface AuditRun {
  // ... existing fields ...

  /** Ticket IDs created from auto-ticketed findings */
  autoTicketIds?: string[];
}
```

This parallels the existing `ticketId` field used in fix mode, but supports multiple tickets.

### Step 4: Implement Auto-Ticket Logic in Audit Scheduler

**File**: `server/audit-scheduler.ts`

Add a new function `createTicketsFromFindings()` and call it after the report audit completes successfully. The insertion point is `audit-scheduler.ts:271`, right after the completed run is broadcast.

```typescript
async function createTicketsFromFindings(
  schedule: AuditSchedule,
  run: AuditRun,
  report: AuditReport,
): Promise<string[]> {
  const config = schedule.autoTicket;
  if (!config?.enabled || schedule.mode !== 'report') return [];

  const severityOrder: FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
  const thresholdIndex = severityOrder.indexOf(config.minSeverity);
  const qualifyingSeverities = severityOrder.slice(0, thresholdIndex + 1);

  // Filter findings that meet the severity threshold
  const qualifyingFindings = report.findings.filter(
    f => qualifyingSeverities.includes(f.severity)
  );

  if (qualifyingFindings.length === 0) return [];

  // Check for existing tickets from previous runs to avoid duplicates
  const existingTicketIds = await getExistingFindingTickets(schedule.projectId);

  const maxTickets = config.maxTicketsPerRun ?? 5;
  const ticketIds: string[] = [];

  for (const finding of qualifyingFindings.slice(0, maxTickets)) {
    // Skip if a ticket already exists for this finding ID
    if (existingTicketIds.has(finding.id)) continue;

    const ticket = await createTicket({
      projectId: schedule.projectId,
      subject: `[${finding.severity.toUpperCase()}] ${finding.title}`,
      instructions: buildFindingInstructions(finding, schedule.name),
      yolo: config.yolo ?? false,
      autoMerge: false,  // explicit: no auto-merge at first
    });

    // Set source metadata on the ticket
    await updateTicket(ticket.id, {
      source: 'audit_finding',
      sourceAuditFindingId: finding.id,
      sourceAuditRunId: run.id,
    });

    ticketIds.push(ticket.id);
    broadcastFn({ type: 'ticket_updated', data: ticket });
  }

  return ticketIds;
}
```

The `buildFindingInstructions()` helper would format the finding into actionable agent instructions:

```typescript
function buildFindingInstructions(finding: AuditFinding, auditName: string): string {
  const parts = [
    `This ticket was auto-created from a ${finding.severity}-severity finding in the "${auditName}" audit.`,
    '',
    `## Finding: ${finding.title}`,
    '',
    finding.description,
  ];

  if (finding.location) {
    parts.push('', `**Location**: ${finding.location}`);
  }

  if (finding.recommendation) {
    parts.push('', `## Recommended Fix`, '', finding.recommendation);
  }

  parts.push(
    '',
    '## Scope',
    '',
    'Fix ONLY this specific issue. Do not refactor surrounding code or fix unrelated problems.',
    'Keep the change as small and focused as possible.',
  );

  return parts.join('\n');
}
```

### Step 5: Integrate into Report Audit Completion Handler

**File**: `server/audit-scheduler.ts`

In the `proc.on('close')` handler of `executeReportAudit()`, after line 271 (after `broadcastFn({ type: 'audit_run_updated', data: completedRun })`), add:

```typescript
// Auto-create tickets for critical/high findings if configured
if (structuredReport && schedule.autoTicket?.enabled) {
  try {
    const ticketIds = await createTicketsFromFindings(schedule, completedRun!, structuredReport);
    if (ticketIds.length > 0) {
      await updateRun(run.id, { autoTicketIds: ticketIds });
      console.log(`[audit-scheduler] Auto-created ${ticketIds.length} ticket(s) from findings`);
    }
  } catch (err) {
    console.error(`[audit-scheduler] Failed to auto-create tickets from findings:`, err);
  }
}
```

### Step 6: Add Deduplication Logic

**File**: `server/audit-scheduler.ts` (new helper)

Prevent creating duplicate tickets for the same finding across runs:

```typescript
async function getExistingFindingTickets(projectId: string): Promise<Set<string>> {
  const tickets = await listTickets();
  const existingIds = new Set<string>();

  for (const ticket of tickets) {
    if (
      ticket.projectId === projectId &&
      ticket.source === 'audit_finding' &&
      ticket.sourceAuditFindingId &&
      !['done', 'merged'].includes(ticket.status) // re-create if previous attempt completed
    ) {
      existingIds.add(ticket.sourceAuditFindingId);
    }
  }

  return existingIds;
}
```

**Key behavior**: If a finding's ticket reached `done` or `merged`, the finding ID is removed from the dedup set. This means if the finding recurs in a subsequent audit (wasn't actually fixed), a new ticket can be created. If the ticket is still `in_progress`, `failed`, or `todo`, no duplicate is created.

### Step 7: Expose Auto-Ticket Config in REST API

**File**: `server/index.ts`

The existing `POST /api/audit-schedules` and `PATCH /api/audit-schedules/:id` endpoints already accept the full `AuditSchedule` body. Since the new `autoTicket` field is an optional property on `AuditSchedule`, no endpoint changes are strictly required — the field will be persisted as-is.

However, add validation to the create/update endpoints:

```typescript
// In POST /api/audit-schedules handler:
if (body.autoTicket) {
  const validSeverities = ['critical', 'high', 'medium', 'low', 'info'];
  if (!validSeverities.includes(body.autoTicket.minSeverity)) {
    return res.status(400).json({ error: 'Invalid minSeverity value' });
  }
  if (body.mode !== 'report') {
    return res.status(400).json({ error: 'autoTicket is only valid for report-mode schedules' });
  }
}
```

### Step 8: Update MCP Tool

**File**: `server/mcp.ts`

Update the `create_audit_schedule` MCP tool to accept the new `autoTicket` parameter:

```typescript
// In create_audit_schedule tool definition, add to inputSchema.properties:
autoTicket: {
  type: 'object',
  description: 'Auto-ticket configuration for report-mode audits',
  properties: {
    enabled: { type: 'boolean' },
    minSeverity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    maxTicketsPerRun: { type: 'number' },
    yolo: { type: 'boolean' },
  },
  required: ['enabled', 'minSeverity'],
},
```

### Step 9: Add Frontend Configuration UI

**File**: `src/components/AnalyticsDashboard.tsx` (or new schedule config modal)

Add auto-ticket toggle in the audit schedule creation/editing UI:

- **Toggle**: "Auto-create tickets from findings" (default: off)
- **Severity threshold dropdown**: "Minimum severity" → critical / high / medium / low
- **Max tickets input**: "Maximum tickets per run" → number input (default: 5)
- **YOLO toggle**: "Run fix agents in YOLO mode" (default: off)
- **Note**: "Auto-merge is disabled. Tickets are created for manual review."

### Step 10: Add Auto-Ticket Indicators to Dashboard

**File**: `src/components/AnalyticsDashboard.tsx`

In the Reports tab's findings list, add a badge next to findings that have been auto-ticketed:

- Show a "Ticketed" badge with link to the created ticket
- Show ticket status inline (todo/in_progress/merged/failed)
- In the run summary, show "3 tickets created" count

### Step 11: Update Analytics

**File**: `server/analytics.ts`

Extend `SchedulerStats` or add to `buildIssues()`:

```typescript
// In SchedulerStats:
autoTicketCount: number;  // total auto-created tickets across all runs
```

### Step 12: Update Documentation

**File**: `docs/architecture/scheduler.md`

Add a new section documenting the auto-ticket feature, configuration options, and deduplication behavior.

---

## Files to Modify

| File | Changes Needed |
|------|---------------|
| `src/types.ts` | Add `autoTicket` config to `AuditSchedule`, add `autoTicketIds` to `AuditRun`, add `'audit_finding'` to `Ticket.source`, add `sourceAuditFindingId` and `sourceAuditRunId` to `Ticket` |
| `server/audit-scheduler.ts` | Add `createTicketsFromFindings()`, `buildFindingInstructions()`, `getExistingFindingTickets()`. Hook into `executeReportAudit()` completion handler. Import `listTickets` and `updateTicket` from store. |
| `server/index.ts` | Add validation for `autoTicket` field in schedule create/update endpoints |
| `server/mcp.ts` | Add `autoTicket` to `create_audit_schedule` tool schema |
| `server/analytics.ts` | Add `autoTicketCount` to `SchedulerStats`, count tickets with `source: 'audit_finding'` |
| `src/components/AnalyticsDashboard.tsx` | Add auto-ticket config UI in schedule editor, add "Ticketed" badge on findings, show ticket count per run |
| `docs/architecture/scheduler.md` | Document auto-ticket feature, configuration, deduplication |
| `docs/futureDevelopmentOpportunities/futureDevelopmentOpportunities.md` | Mark this item as implemented/in-progress |

---

## Risks & Edge Cases

### 1. Ticket Flooding

**Risk**: An audit with 20+ critical findings creates 20+ tickets simultaneously, overwhelming the dispatcher and consuming agent budget.

**Mitigation**: The `maxTicketsPerRun` cap (default: 5) prevents flooding. Additionally, the dispatcher's existing `MAX_CONCURRENT` limit (5 agents) naturally throttles execution. Consider ordering findings by severity (critical before high) so the most important ones get tickets first.

### 2. Stale/Recurring Findings

**Risk**: The same finding appears in every audit run. Without deduplication, the system creates a new ticket each time.

**Mitigation**: The deduplication logic checks for existing non-completed tickets with the same `sourceAuditFindingId`. The `AuditFinding.id` is a deterministic fingerprint (generated by `audit-report-parser.ts`), so the same finding across runs produces the same ID. If a previous ticket for the finding is still open (todo/in_progress/failed), no duplicate is created.

**Edge case**: If the finding's description changes slightly between runs, the fingerprint changes and deduplication won't catch it. This is acceptable — the agent will see it as a distinct issue.

### 3. Finding Quality Variance

**Risk**: The audit agent may produce findings that are vague, incorrect, or too broad for a single ticket ("Refactor the entire dispatcher"). Auto-creating tickets from low-quality findings wastes agent budget.

**Mitigation**:
- Start with `minSeverity: 'critical'` or `'high'` only — these tend to be specific, actionable issues.
- The `buildFindingInstructions()` function includes scope constraints ("Fix ONLY this specific issue").
- The `autoMerge: false` constraint ensures every fix gets human review before landing.
- Users can delete or modify auto-created tickets before they're dispatched.

### 4. Inconsistent Finding IDs

**Risk**: If `audit-report-parser.ts` changes its fingerprinting algorithm, all existing finding IDs become invalid, breaking deduplication.

**Mitigation**: The fingerprinting logic should be stable and documented. If it changes, it's equivalent to "all findings are new" — which just means tickets may be created for already-fixed issues. This is safe since auto-merge is off.

### 5. Race Condition: Concurrent Audit Runs

**Risk**: Two audit runs for the same schedule complete near-simultaneously. Both check for existing tickets, find none, and both create tickets for the same findings.

**Mitigation**: The existing `hasRunningRunForSchedule()` guard prevents concurrent runs for the same schedule. Different schedules auditing the same project could theoretically find overlapping issues, but this is unlikely and the impact is minor (duplicate tickets, not data corruption).

### 6. No Auto-Merge Safety Net

**Risk**: By design, auto-merge is disabled. But if a future change accidentally enables it, auto-created tickets could merge without review.

**Mitigation**: The `autoMerge: false` is set explicitly in `createTicketsFromFindings()`, overriding any schedule-level config. Add a comment explaining this is intentional and should only be changed after the feature matures.

### 7. Ticket Instructions May Be Insufficient

**Risk**: The `buildFindingInstructions()` function constructs instructions from the finding's fields. If the finding lacks a `recommendation` or has a vague `description`, the agent may struggle.

**Mitigation**: The finding format already includes structured fields (title, description, location, recommendation). The rubric prompt in `buildRubricInstructions()` requires agents to fill these fields. If recommendation is missing, the instructions still include the description and location, which is usually enough for targeted fixes.

---

## Open Questions

### 1. Should auto-ticket be a new schedule `mode` or a modifier on `report` mode?

**Options**:
- **(a) Modifier on report mode** (recommended) — `mode: 'report'` + `autoTicket: { enabled: true }`. Report runs as normal; ticket creation is a post-processing step. This preserves backward compatibility — existing report-mode schedules are unaffected.
- **(b) New mode `'report-and-fix'`** — A third mode that combines report + auto-ticketing. Cleaner semantically but requires updating all mode-checking logic throughout the codebase.

**Recommendation**: (a) — modifier approach. It's additive and doesn't change existing behavior.

### 2. Should each finding get its own ticket, or should findings be batched into one ticket?

**Options**:
- **(a) One ticket per finding** (recommended) — Produces small, focused PRs. Easier to review. Follows the "small, safe PRs" principle from the project's audit report. Deduplication is straightforward (by finding ID).
- **(b) One ticket per audit run** — Bundles all critical/high findings into a single ticket. Agent gets full context but produces a large PR. Harder to review.
- **(c) One ticket per rubric aspect** — Groups findings by category. Middle ground but adds complexity.

**Recommendation**: (a) — one per finding. Aligns with the project's existing philosophy of small, independently-mergeable changes.

### 3. What should happen when an auto-created ticket fails?

**Options**:
- **(a) Mark as failed, flag for attention** (recommended) — Use existing `needsAttention: true` mechanism. Finding remains in dedup set, so no new ticket is created until the failed one is manually resolved (deleted or retried).
- **(b) Auto-retry with backoff** — Reuse the dispatcher's retry logic. Risk of wasting agent budget on inherently unfixable issues.

**Recommendation**: (a) — fail and flag. Auto-retry is too aggressive for findings that may require human judgment.

### 4. Should the trend system influence auto-ticketing?

The `AuditTrend` system already tracks `newFindings` vs `recurringFindings` vs `resolvedFindings`. Should auto-ticketing only target `newFindings` (issues that weren't in the previous run)?

**Recommendation**: Start without trend filtering. Create tickets for all qualifying findings (subject to dedup). Trend-aware ticketing can be added later as refinement — it would require the trend system to operate on individual finding IDs, which it already does via `newFindings[]`.

### 5. Should auto-ticketing work with manual triggers?

When a user manually triggers an audit via `POST /api/audit-schedules/:id/trigger`, should auto-ticketing run if configured?

**Recommendation**: Yes — `triggerAudit()` calls `executeReportAudit()` which would include the auto-ticket logic. The same code path handles both scheduled and manual triggers.
