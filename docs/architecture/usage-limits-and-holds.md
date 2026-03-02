# Usage Limits & On-Hold Status

## Overview

When an agent hits an API rate/usage limit, the dispatcher automatically places the ticket
in the `on_hold` status and pauses all new dispatches until the limit resets. This prevents
wasting agent spawns against a limit that applies account-wide.

## How It Works

### Detection

`detectUsageLimit()` in `server/dispatcher.ts` parses the agent's stderr output for patterns
indicating a rate or usage limit:

- Keywords: `rate limit`, `usage limit`, `quota exceeded`, `too many requests`, `429`
- Anthropic-specific: `x-ratelimit-reset-tokens` header values
- Generic: timestamp patterns like `resets at HH:MM` or `try again in N minutes`

If a limit is detected, the function returns a `resetsAt` timestamp. If the reset time
can't be parsed, it defaults to 1 hour from now.

### Hold Placement

When a ticket fails with a detected usage limit:

1. Ticket status → `on_hold`
2. `holdUntil` set to `resetsAt + USAGE_LIMIT_RESUME_BUFFER_MS` (5 min buffer)
3. `failureReason` set to `{ type: 'usage_limit', resetsAt }`
4. Minimum hold duration enforced: `USAGE_LIMIT_MIN_HOLD_MS` (3 min)

### Dispatch Gate

While any ticket is `on_hold` with an active `holdUntil`:

- No new agents are spawned (all todo tickets wait)
- Reasoning: all tickets share the same API account, so they'd all hit the same limit

### Auto-Resume

On each `dispatcherTick()` (every 3 seconds):

1. Check all `on_hold` tickets with `holdUntil`
2. If `holdUntil <= now`, transition back to `todo` with reason `hold_resumed`
3. Clear error, failureReason, holdUntil, completedAt, agentPid
4. Ticket is re-dispatched on the next tick

The health check (every 30 seconds) also detects expired holds as a safety net.

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `USAGE_LIMIT_RESUME_BUFFER_MS` | 5 minutes | Extra delay after reported reset time |
| `USAGE_LIMIT_MIN_HOLD_MS` | 3 minutes | Minimum hold even if reset is sooner |

## UI Representation

- Status color: orange (matches other warning states)
- Card shows `ON HOLD` badge
- Detail modal shows hold reason and `holdUntil` timestamp
