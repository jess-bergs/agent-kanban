# Dispatcher Architecture

## Overview

The dispatcher is the core autonomous subsystem that executes tickets. It polls for `todo`
tickets, creates git worktrees, spawns Claude Code agents, and manages the full lifecycle
through to PR creation. It runs alongside the auditor and scheduler as one of three
autonomous subsystems in the server process.

```
┌─────────────────────────────────────────────────────┐
│                   Server Process                     │
│                                                      │
│  ┌──────────────┐  ┌───────────┐  ┌──────────────┐  │
│  │  Dispatcher   │  │  Auditor  │  │  Scheduler   │  │
│  │  (3s poll)    │  │  (30s)    │  │  (3h poll)    │  │
│  └──────┬───────┘  └─────┬─────┘  └──────┬───────┘  │
│         │                │               │           │
│         └────────────────┴───────────────┘           │
│                          │                           │
│                    broadcast(WSEvent)                 │
│                          │                           │
│                     WebSocket ──► React Frontend      │
└─────────────────────────────────────────────────────┘
```

**Source**: `server/dispatcher.ts`

## Polling Loop

The dispatcher runs two independent intervals, both started by `startDispatcher()`:

| Loop | Interval | Purpose |
|------|----------|---------|
| `dispatcherTick()` | 3 seconds | Pick up todo tickets, check PR status, check auto-merge |
| `conflictCheckTick()` | 1 hour | Dedicated merge conflict scan for in-review PRs |

Both fire once immediately on startup before the intervals begin.

Each tick of `dispatcherTick()` does:
1. Skip if `running.size >= MAX_CONCURRENT` (currently **5**)
2. Find tickets with `status === 'todo'`; dispatch non-queued first, then queued only when `running.size === 0`
3. For each, call `startAgent(ticket)`
4. For `in_review` tickets: call `checkPrStatus()` and `checkAutoMerge()`
5. For `needs_approval` tickets: check if approval is still pending

## Ticket Status Flow

```
todo ──► in_progress ──► in_review ──► merged
              │               │            │
              │               ▼            │
              │           (conflict        │
              │            detected)       │
              │                            │
              ├──► needs_approval ─────────┤
              │    (non-yolo, tool         │
              │     approval pending)      │
              │                            │
              ├──► failed ◄────────────────┘
              │    (exit code != 0,         (auto-merge fail)
              │     orphan recovery)
              │
              └──► done
                   (exit 0, no PR found)
```

## Worktree Lifecycle

When `startAgent()` runs:

1. **Branch name**: `agent/ticket-{id}-{slugified-subject}` (slug capped at 40 chars)
2. **Worktree path**: `/tmp/agent-kanban-worktrees/{branch-name}`
3. **Setup**: `git fetch origin` → remove any prior worktree/branch → `git worktree add`
4. **Base ref**: prefers `origin/{defaultBranch}`, falls back to `{defaultBranch}`, then `HEAD`
5. **No-commit repos**: if the repo has no commits, skips worktree and works in-place

Cleanup (`cleanupWorktree()`) runs after screenshot capture:
```
git worktree remove "{path}" --force
```

## Agent Spawning

The dispatcher spawns the `claude` CLI binary:

```
claude -p "{prompt}" --output-format stream-json --verbose
       [--dangerously-skip-permissions]  # only if yolo: true
```

**Environment isolation**:
- Strips `CLAUDECODE_*`, `CLAUDE_CODE_*`, and `ANTHROPIC_API_KEY` from env
- Uses `envWithNvmNode()` (from `server/nvm.ts`) to prepend the nvm-managed Node bin to PATH
- stdin is piped (`'pipe'`), stdout and stderr are piped — stdin pipe enables steering (see below)

The spawned process PID is stored as `ticket.agentPid` for kill/orphan detection.

### Ralph Wiggum Mode

When `ticket.useRalph` is true, the prompt is wrapped in a `/ralph-loop` skill invocation:

```
/ralph-loop "{task}\n\nWhen COMPLETELY finished, output: <promise>TICKET_COMPLETE</promise>"
  --max-iterations 50 --completion-promise "TICKET_COMPLETE"
```

This enables iterative self-correction with up to 50 iterations.

## Output Parsing

Agent stdout is parsed as stream-JSON (one JSON object per line). Each line is dispatched
by event type:

| Event | Fields Extracted | Side Effects |
|-------|-----------------|--------------|
| `assistant` → `thinking` | Last 1000 chars saved | Activity entry (200 char truncation) |
| `assistant` → `text` | Appended to `fullText` | Activity entry |
| `assistant` → `tool_use` | Tool name, input | `effort.toolCalls++`, activity entry (150 chars) |
| `assistant` → `tool_result` | Content | Activity entry, clears `pendingToolApproval` |
| `result` | `cost_usd`, usage | Appended to `fullText`, token/cost fallback |

**Deduplication**: stream-json emits the same message once per content block. The dispatcher
tracks `seenMessageIds` and only counts tokens/turns for the first occurrence of each message.

See [agent-observability.md](agent-observability.md) for details on the activity ring buffer
and effort tracking.

## PR Detection

On successful agent exit (code 0), PR detection runs in two stages:

1. **Regex scan** of accumulated text output:
   ```
   /https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/
   ```
2. **Fallback via `gh` CLI** (10s timeout):
   ```
   gh pr list --head "{branchName}" --json url,number --jq '.[0]'
   ```

After detection, `ensureTicketIdInPr()` injects a machine-readable marker into the PR body:
```html
<!-- ticket-id:{ticketId} -->
```
This enables reverse lookup via `extractTicketIdFromPr()`.

## Post-PR Pipeline

After a PR is detected, three things happen in sequence:

1. **Screenshot capture** — Playwright starts the dev server in the worktree, captures a
   screenshot, commits it to the branch, and updates the PR body. See [pr-lifecycle.md](pr-lifecycle.md).
2. **Worktree cleanup** — `cleanupWorktree()` removes the worktree after screenshots are done.
3. **Audit trigger** — `runAudit(ticket)` adds the PR to the auditor watchlist and triggers
   an initial review. See [auditor.md](auditor.md).

## Abort & Recovery

### Kill vs Abort

Both `killAgent(ticketId)` and `abortAgent(ticketId)` send SIGTERM and add the ticket to
`abortedTickets` so the close handler can distinguish intentional stops from crashes. Neither
removes from `running` eagerly — cleanup is deferred to the close handler for consistency.

- **`killAgent`** — non-user-initiated termination (e.g., ticket deletion). The ticket is
  typically deleted immediately after, so the close handler's status update is a no-op.
- **`abortAgent`** — explicit user abort. The ticket persists as `failed` with a `user_abort`
  failure reason.

### Orphan Recovery
On server startup, `recoverOrphanedTickets()` finds any `in_progress` tickets whose `agentPid`
is no longer alive (checked via `process.kill(pid, 0)`). These are moved to `failed` with
message "Agent process died (server restart or crash)" and their worktrees are cleaned up.

## Concurrency

- `MAX_CONCURRENT = 5` — enforced at the top of `dispatcherTick()` and mid-loop
- Each running agent is tracked in a `Map<ticketId, ChildProcess>`
- The dispatcher breaks out of the ticket loop once the limit is hit

## Failure Reasons

When a ticket enters `failed` or `error`, a structured `failureReason` is attached:

| Type | Meaning |
|------|---------|
| `server_crash` | Server process died unexpectedly |
| `agent_exit` | Agent exited with a non-zero code |
| `signal_exit` | Agent killed by signal (SIGINT, SIGKILL, SIGTERM) |
| `user_abort` | User explicitly aborted the agent |
| `project_not_found` | Referenced project doesn't exist |
| `worktree_setup_failed` | Git worktree creation failed |
| `retry_budget_exhausted` | Exceeded MAX_AUTO_RETRIES (2) orphan recoveries |
| `automation_budget_exhausted` | Exceeded max automation iterations (5) for review fixes |
| `usage_limit` | API rate/usage limit hit (see [Usage Limits](usage-limits-and-holds.md)) |
| `other` | Unclassified failure |

## Session Resumption

When retrying a ticket (conflict resolution, review feedback), the dispatcher uses
`--resume` mode with the stored `agentSessionId`:

1. `agentSessionId` captured from the agent's first stream event
2. `resumePrompt` set to describe what needs fixing (conflict, review changes)
3. Worktree recreated from the existing remote branch (`origin/{branchName}`)
4. `automationIteration` incremented (capped at 5)

## Agent Steering

Users can send messages to agents from the ticket detail modal via `POST /api/tickets/:id/steer`.
The endpoint operates in two modes:

### Mode 1: stdin (live agent)

When the agent process is still running (`isAgentRunning(ticketId)` returns true),
the message is written directly to the agent's stdin via `sendSteeringMessage()`:

```
proc.stdin.write(message + '\n')
```

This is useful for answering `AskUserQuestion` prompts or redirecting the agent mid-task.
The stdin pipe was changed from `'ignore'` to `'pipe'` to enable this.

### Mode 2: resume (dead session)

When the agent has exited but has a stored `agentSessionId`, the endpoint stores the
user's message as `resumePrompt`, resets the ticket to `todo` via `prepareRetryFields()`,
and the normal dispatcher poll picks it up. The agent is then respawned with:

```
claude --resume {sessionId} -p "{resumePrompt}" --output-format stream-json
```

This continues the previous Claude conversation with the user's message as input.

### UI

The steering input appears in the ticket detail modal below the agent output section.
It shows contextual labels: "Steer Agent" with a live pulse indicator for running agents,
or "Resume & Message" for resumable dead sessions. The input is hidden when no agent
process exists and no session ID is available.

## File Layout

```
server/
  dispatcher.ts    # Polling loop, agent lifecycle, PR detection, auto-merge
  nvm.ts           # Resolves nvm-managed Node binary for child processes
  screenshots.ts   # Playwright screenshot capture & PR upload
```
