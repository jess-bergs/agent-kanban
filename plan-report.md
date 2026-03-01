# Plan Report: Ticket Not Moved to Approval Column & Team Context Issues

## Summary

Two related bugs were reported: (1) when a non-YOLO ticket needs user approval for a tool call, it is not reliably moved into the "Needs Approval" kanban column, and (2) it's unclear whether team-dispatched tickets properly track team context for approval detection. Investigation reveals that approval detection is heuristic-based (15-second timeout after a `tool_use` event without a matching `tool_result`), which can miss approvals that happen quickly or misfire during slow tool executions. For team-mode tickets, the dispatcher only monitors the lead agent process — sub-agents spawned via `TeamCreate`/`Task` are invisible to the approval detection system.

## Relevant Files

| File | Role |
|------|------|
| `server/dispatcher.ts` | Core dispatcher: agent spawning, stream parsing, approval detection, PR lifecycle |
| `server/store.ts` | JSON file persistence for tickets; `updateTicket()` with state logging |
| `server/index.ts` | Express API routes for tickets (abort, retry, status refresh) |
| `server/auditor.ts` | PR auditor: review engine, watchlist, audit-driven re-dispatch |
| `src/types.ts` | Shared types: `Ticket`, `TicketStatus` (includes `needs_approval`), `AgentActivity` |
| `src/components/TicketKanban.tsx` | Kanban board: column definitions, grouping logic, visibility rules |
| `src/components/TicketCard.tsx` | Card rendering: shows "Waiting for approval" banner when `status === 'needs_approval'` |
| `src/components/TicketDetailModal.tsx` | Detail modal: approval banner, abort button for `needs_approval` tickets |
| `src/components/CreateTicketModal.tsx` | Ticket creation: `useTeam` toggle, option grid |
| `src/lib/ticketCompat.ts` | Status normalization (`safeStatus`) for legacy/unknown statuses |
| `docs/architecture/dispatcher.md` | Dispatcher architecture: polling loop, status flow, approval detection docs |
| `docs/architecture/agent-observability.md` | Observability: stream parsing, approval detection mechanism details |

## Current Architecture

### Approval Detection Mechanism

The approval detection system works via a **heuristic timeout** in the dispatcher's polling loop (`dispatcher.ts:1116-1153`):

1. **`processStreamLine()`** — When a `tool_use` event is parsed from agent stdout and the ticket is non-YOLO, `pendingToolApproval.set(ticket.id, true)` is called.

2. **`dispatcherTick()`** — Every 3 seconds, the tick function checks all `in_progress` non-YOLO tickets that have a running process. If `pendingToolApproval` is `true` AND more than `APPROVAL_WAIT_THRESHOLD_MS` (15 seconds) has elapsed since the last stream activity, the ticket transitions to `needs_approval`.

3. **`tool_result` event** — When a `tool_result` event arrives (meaning the user approved the tool), `pendingToolApproval` is cleared. If the ticket was in `needs_approval` status, it transitions back to `in_progress`.

### Team Mode Mechanics

When `useTeam: true`:

1. **Ticket creation** — `teamName` is set to `ticket-{first 8 chars of UUID}` at dispatch time (`dispatcher.ts:271`).

2. **Agent instructions** — The spawned Claude agent is told to use `TeamCreate` with the specific `teamName` and coordinate sub-agents via `Task`.

3. **Process tracking** — Only the **lead agent** process is tracked in the `running` map. Sub-agents spawned by the lead agent via `TeamCreate`/`Task` are child processes of the `claude` CLI — they are not individually visible to the dispatcher.

4. **Team display** — The sidebar (`Sidebar.tsx:293-318`) matches `ticket.teamName` to live teams detected from `~/.claude/teams/` files. This is a filesystem-based correlation, not a process-level one.

### Frontend Column Visibility

The `needs_approval` column in `TicketKanban.tsx` is **conditionally hidden** — it only appears if at least one ticket has `needs_approval` status (line 142-145):

```ts
const visibleColumns = COLUMNS.filter(
  s => !['needs_approval', 'done', 'failed', 'error'].includes(s) || grouped[s].length > 0,
);
```

This is correct behavior — the column appears when needed. The issue is that tickets aren't reaching `needs_approval` status in the first place.

## Root Cause Analysis

### Bug 1: Ticket Not Moved to Approval Column

There are **three failure modes** in the approval detection:

#### 1a. Race condition in the time-based heuristic

The 15-second threshold (`APPROVAL_WAIT_THRESHOLD_MS`) compares against `lastStreamActivity`, which is updated on **every** stream event. If the agent emits any output (thinking, text) after the `tool_use` event but before the user responds, `lastStreamActivity` resets and the 15-second timer restarts. This means a chatty agent (one that emits thinking blocks after requesting a tool) may never trigger the `needs_approval` transition even though it's genuinely blocked on user approval.

**Relevant code** (`dispatcher.ts:1141-1153`):
```ts
const inProgressTickets = tickets.filter(
    t => t.status === 'in_progress' && !t.yolo && running.has(t.id),
);
const now = Date.now();
for (const ticket of inProgressTickets) {
    const lastActivity = lastStreamActivity.get(ticket.id);
    const hasPendingTool = pendingToolApproval.get(ticket.id);
    if (hasPendingTool && lastActivity && (now - lastActivity) > APPROVAL_WAIT_THRESHOLD_MS) {
        // ... transitions to needs_approval
    }
}
```

The `lastStreamActivity` timestamp is set on **every** event type in `processStreamLine()` (line 573):
```ts
lastStreamActivity.set(ticket.id, now);
```

This means thinking events, text events, or any other stream output resets the timer.

#### 1b. `pendingToolApproval` only set for the last tool_use

If multiple `tool_use` blocks appear in a single assistant message (common with parallel tool calls), `pendingToolApproval` is set to `true` for each one. But if a `tool_result` comes back for just one of them, it's cleared (`pendingToolApproval.set(ticket.id, false)` on line 631). This means if the agent needs approval for 2 tools simultaneously, approving one clears the pending flag even though the second is still waiting.

#### 1c. The transition-back logic is async and racy

When a `tool_result` arrives, the code reads the ticket from disk and conditionally transitions it back to `in_progress` (`dispatcher.ts:634-639`):

```ts
getTicket(ticket.id).then(t => {
    if (t && t.status === 'needs_approval') {
        updateTicket(ticket.id, { status: 'in_progress' }, 'tool_approved').then(u => {
            if (u) broadcastTicket(u);
        });
    }
});
```

This is fire-and-forget (`getTicket` + `updateTicket` are not awaited), creating a potential race where the tick's `needs_approval` transition and the stream's `in_progress` transition can conflict.

### Bug 2: Team Context Not Properly Tracked

For team-dispatched tickets:

1. **The lead agent IS tracked** — Its process is in the `running` map, so approval detection works for tool calls made by the lead agent itself.

2. **Sub-agents are NOT tracked** — When the lead agent creates a team and spawns sub-agents, those sub-agents run as separate `claude` processes. The dispatcher has no visibility into these child processes. If a sub-agent (not the lead) is waiting for tool approval:
   - The lead agent's stream will show a `tool_use` for the `Task` tool (which spawns the sub-agent), followed eventually by a `tool_result`.
   - The sub-agent's own tool approval prompts are **invisible** to the dispatcher.
   - The lead agent's stream continues to flow (it can do other work while sub-agents run), so `lastStreamActivity` keeps updating, preventing the `needs_approval` transition.

3. **No mechanism to detect sub-agent approval needs** — The team coordination happens via files in `~/.claude/teams/{teamName}/`, but the dispatcher only watches these for sidebar display (via `watcher.ts`). There's no logic to detect sub-agent approval blocks from team task/inbox data.

## Proposed Approach

### Step 1: Fix the approval detection timer (Bug 1a)

Introduce a separate timestamp `lastToolUseAt` that records when the most recent `tool_use` event was emitted. The approval check should compare against this timestamp instead of `lastStreamActivity`:

- In `processStreamLine()`, when a `tool_use` event is detected, set `lastToolUseAt.set(ticket.id, Date.now())` in addition to `pendingToolApproval`.
- In `dispatcherTick()`, compare `now - lastToolUseAt` instead of `now - lastStreamActivity`.
- This prevents thinking/text events from resetting the approval timer.

### Step 2: Fix multiple pending tool approvals (Bug 1b)

Track a **count** of pending tool uses rather than a boolean:

- Change `pendingToolApproval` from `Map<string, boolean>` to `Map<string, number>` (count of pending tool_use events without matching tool_result).
- Increment on each `tool_use` event.
- Decrement on each `tool_result` event.
- Only clear `needs_approval` when the count reaches 0.

### Step 3: Await the transition-back logic (Bug 1c)

The `tool_result` handler's transition logic should not be fire-and-forget. Wrap it in the existing `pendingStreamWrite` chain so it's serialized with other ticket updates.

### Step 4: Surface team sub-agent approval needs (Bug 2)

This is more complex. Options:

**Option A (Recommended — Lightweight):** Parse the lead agent's stream output for sub-agent approval signals. When the lead agent spawns sub-agents via `Task` tool, it may output text mentioning that a sub-agent is waiting for approval. Add a regex or keyword detection in `processStreamLine()` to catch these patterns.

**Option B (More robust):** Extend the `watcher.ts` to monitor team inbox messages for approval-related signals. When a sub-agent sends an inbox message indicating it's blocked, the watcher could trigger a `needs_approval` transition on the parent ticket.

**Option C (Most robust but heaviest):** Track all spawned sub-agent PIDs and monitor their stdout independently. This would require significant refactoring of how team agents are spawned and monitored.

## Files to Modify

| File | Changes Needed |
|------|---------------|
| `server/dispatcher.ts` | (1) Add `lastToolUseAt` map alongside `lastStreamActivity`. (2) Change `pendingToolApproval` from boolean to counter. (3) Update `processStreamLine()` to track `lastToolUseAt` on tool_use and decrement counter on tool_result. (4) Update `dispatcherTick()` to use `lastToolUseAt` for threshold comparison. (5) Make tool_result transition-back logic sequential (chain onto `pendingStreamWrite`). (6) Clean up new maps in close handler. |
| `docs/architecture/agent-observability.md` | Update the "Approval Detection" section to reflect the new timer mechanism and counter-based tracking. |
| `docs/architecture/dispatcher.md` | Update the status flow diagram and approval detection description. |

For Bug 2 (team sub-agent approval), additional changes depend on which option is chosen:

| File (Option A) | Changes Needed |
|------|---------------|
| `server/dispatcher.ts` | Add keyword detection in `processStreamLine()` for sub-agent approval patterns in the lead agent's text output. |

| File (Option B) | Changes Needed |
|------|---------------|
| `server/watcher.ts` | Extend team inbox monitoring to detect approval-related messages. |
| `server/dispatcher.ts` | Add callback hook for watcher-detected approval events. |

## Risks & Edge Cases

1. **False positives on approval detection** — If the agent legitimately takes >15 seconds for a tool (e.g., a long `Bash` command), the ticket would transition to `needs_approval` incorrectly. The counter-based approach partially mitigates this since a `tool_result` will eventually decrement the counter and transition back. Consider also excluding known-slow tools (Bash, Task) from the approval heuristic.

2. **Counter drift** — If stream parsing misses a `tool_result` (e.g., due to truncation or parsing errors), the counter could stay elevated. A safety valve (timeout-based auto-clear after, say, 10 minutes) would prevent permanent `needs_approval` states.

3. **YOLO ticket handling** — YOLO tickets should continue to skip approval detection entirely. The current `!t.yolo` guard is correct.

4. **Concurrent tick + stream writes** — The `updateTicket` calls from both the polling tick and the stream handler can race. The existing `withLock` mechanism in `store.ts` serializes per-ticket writes, but the **decision** to transition is still unsynchronized. Consider using a dedicated state machine or at least reading the ticket inside the lock before deciding to transition.

5. **Team sub-agent approval scope** — For Option A (keyword detection), the lead agent may not always surface sub-agent approval blocks in its own output. This depends on how Claude Code's team system reports sub-agent status. Option B (inbox monitoring) is more reliable but adds coupling between watcher and dispatcher.

6. **Backward compatibility** — All changes to `Ticket` type and status transitions are additive. No migration needed for existing ticket JSON files.

## Open Questions

1. **Which option for team sub-agent approval detection?** Option A (keyword detection in lead agent's stream) is lightest but least reliable. Option B (inbox monitoring) is more robust. Option C (full sub-agent process tracking) is most comprehensive but requires significant refactoring. **Recommendation: Start with Option A, add Option B if keyword detection proves insufficient.**

2. **Should `APPROVAL_WAIT_THRESHOLD_MS` be configurable?** Currently hardcoded to 15 seconds. Some tools (Bash with long commands, Task with heavy sub-agents) legitimately take longer. Making this per-tool or configurable could reduce false positives.

3. **Should we show individual sub-agent approval needs?** Currently the ticket is a single entity. For team tickets, should the UI show which specific sub-agent needs approval? This would require extending the `AgentActivity` type with an `agent` field and more complex UI logic.

4. **Is there a Claude Code stream event for "waiting for user input"?** If the `stream-json` output format includes a specific event type when the CLI is waiting for user approval (rather than relying on the absence of `tool_result`), we could use that for deterministic detection instead of the current heuristic. This would eliminate all timing-based false positives/negatives.
