# Agent Observability Architecture

## Overview

The observability system captures live agent output, parses it into structured activity
and effort data, and broadcasts it over WebSocket for real-time display in the frontend.
This enables monitoring of what agents are thinking, which tools they're using, and how
much effort each ticket consumes.

```
claude --output-format stream-json
       │
       │  stdout (one JSON object per line)
       ▼
  processStreamLine()
       │
       ├──► AgentActivity ring buffer (last 20 entries)
       ├──► TicketEffort accumulator (turns, tools, tokens, cost)
       ├──► lastThinking / lastOutput
       │
       ▼
  updateTicket() ──► broadcast('ticket_updated') ──► WebSocket ──► React
```

**Source**: `server/dispatcher.ts` (processStreamLine), `src/types.ts`

## Stream-JSON Parsing Pipeline

Agent stdout is read in chunks, accumulated in a `lineBuffer`, and split on `\n`.
Each complete line is JSON-parsed and dispatched by event type in `processStreamLine()`.

### Event Types

| Event | Content Type | Extracted Data |
|-------|-------------|---------------|
| `assistant` | `thinking` | Reasoning text (last 1000 chars retained) |
| `assistant` | `text` | Agent prose (appended to fullText) |
| `assistant` | `tool_use` | Tool name + input JSON |
| `assistant` | `tool_result` | Tool output content |
| `result` | — | Final cost_usd and token usage |

Each `assistant` event also carries token usage (`input_tokens`, `output_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens`) which feeds into effort tracking.

### Deduplication

Stream-JSON emits the same assistant message once per content block (e.g., a message with
3 content blocks produces 3 events with the same `message.id`). The dispatcher maintains a
`seenMessageIds` set and only counts tokens and turns for the first occurrence.

This is important: without deduplication, token counts would be inflated by 2-3x.

## AgentActivity Ring Buffer

Each parsed event produces an `AgentActivity` entry:

```ts
interface AgentActivity {
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result';
  tool?: string;     // tool name (tool_use events only)
  content: string;   // truncated summary
  timestamp: number;
}
```

The buffer holds the last **20 entries** (`MAX_ACTIVITY_ENTRIES = 20`). Older entries are
spliced from the front when the limit is exceeded.

### Truncation Rules

| Activity Type | Max Content Length |
|--------------|-------------------|
| `thinking` | 200 characters |
| `text` | 200 characters |
| `tool_use` | 150 characters (of serialized input) |
| `tool_result` | 150 characters |

The full thinking text is separately stored in `ticket.lastThinking` (up to 1000 chars).

## Effort Tracking

Cumulative metrics are tracked in a `TicketEffort` object on each ticket:

```ts
interface TicketEffort {
  turns: number;         // unique assistant message IDs (API round-trips)
  toolCalls: number;     // total tool_use blocks
  inputTokens?: number;  // input + cache_read + cache_creation tokens
  outputTokens?: number;
  costUsd?: number;      // from result event's cost_usd
  durationMs?: number;   // startedAt to completedAt
}
```

- **turns** are counted by unique `message.id` (deduplicated)
- **toolCalls** are incremented on every `tool_use` content block
- **tokens** are accumulated from deduplicated message events
- **cost** comes from the `result` event at the end of the session
- **duration** is computed in the process `close` handler

## Approval Detection

The dispatcher detects two types of agent waits:

### Permission Approval (non-YOLO only)

For non-YOLO tickets (`yolo: false`), the dispatcher tracks pending tool approvals:

1. A `tool_use` event sets `pendingToolApproval = true`
2. If the ticket is `in_progress` and 15s elapse with no `tool_result`, it transitions to `needs_approval`
3. A subsequent `tool_result` event clears `pendingToolApproval`
4. If the ticket was `needs_approval`, it transitions back to `in_progress`

### Interactive Tool Detection (all agents)

Certain tools require user input regardless of yolo mode (e.g., `AskUserQuestion`,
`EnterPlanMode`). When these are detected in the stream:

1. A `tool_use` for an interactive tool sets `pendingUserInput = true`
2. If the ticket is `in_progress` and 15s elapse with no `tool_result`, it transitions to `needs_approval`
3. A subsequent `tool_result` clears `pendingUserInput`
4. If the ticket was `needs_approval`, it transitions back to `in_progress`

Both mechanisms transition the ticket to `needs_approval`, but the UI distinguishes them:

- **Tool approval** (non-YOLO): orange "Waiting for approval" badge and banner
- **User input** (interactive tools): amber "HAS QUESTION" badge and "Agent has a question" banner, with `needsInput: true` set on the ticket

The `needsInput` flag is auto-set by the store when the state reason is `waiting_user_input`,
and cleared when the ticket transitions to any other status.

## WebSocket Broadcasting

After every processed stream line, `updateTicket()` is called with:
- `lastOutput`: last 500 characters of accumulated text
- `agentActivity`: copy of the ring buffer
- `lastThinking`: current reasoning text
- `effort`: current effort metrics

This triggers a `ticket_updated` WebSocket broadcast, which the React frontend uses to
update kanban cards (inline metrics) and the ticket detail modal (activity feed, effort bar).

## Frontend Display

| Location | What's Shown |
|----------|-------------|
| Kanban card | Inline effort: `$0.42 · 2m 15s · 12t/47tc` |
| Kanban card | Brain/Terminal icons when thinking/tool activity is active |
| Detail modal | Effort bar (cost, duration, turns, tool calls) |
| Detail modal | Live activity feed with thinking/tool entries |
| Detail modal | Purple "Agent Reasoning" section with last thinking text |
