# MCP Server Architecture

## Overview

Agent Kanban exposes its REST API as an MCP (Model Context Protocol) server, allowing
external AI agents and tools to interact with projects and tickets programmatically.
The server uses stdio transport and the `@modelcontextprotocol/sdk` package.

**Source**: `server/mcp.ts`

## Transport

The MCP server runs over **stdio** (stdin/stdout), not HTTP. It is invoked as a standalone
process:

```
npx tsx server/mcp.ts
```

This means it does not share the Express server's process — it makes HTTP requests to
the kanban API (at `http://localhost:3003`) to read and write data.

## Tools

The server exposes 20 tools across four domains:

### Project Management

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list_projects` | — | List all registered projects |
| `create_project` | `name`, `repoPath`, `defaultBranch`, `remoteUrl?` | Register a new project |
| `delete_project` | `id` | Remove a project |

### Ticket Management

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list_tickets` | `projectId?`, `status?` | List tickets, optionally filtered |
| `create_ticket` | `projectId`, `subject`, `instructions`, `yolo?`, `autoMerge?`, `queued?`, `useRalph?` | Create a new ticket |
| `get_ticket` | `id` | Get a single ticket by ID |
| `update_ticket` | `id`, `status?`, `subject?`, `instructions?` | Update ticket fields |
| `delete_ticket` | `id` | Delete a ticket |
| `retry_ticket` | `ticketId` | Reset a failed/error ticket back to `todo`, preserving resumable state (branch + session) when possible and checking PR merge status before retrying |
| `status_check` | `projectId?`, `includeOnHold?`, `includeNeedsApproval?` | List tickets needing attention (failed, error, on_hold) with summary counts for monitoring and triage |

The `create_ticket` tool supports all dispatch options: `yolo` (skip permissions),
`autoMerge` (squash-merge when checks pass), `queued` (defer dispatch), and `useRalph`
(iterative self-correction via Ralph Wiggum).

### Audit Templates

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list_audit_templates` | — | List all built-in audit templates |
| `get_audit_template` | `templateId` | Get a single template by ID |

### Audit Schedules

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list_audit_schedules` | `projectId?` | List schedules, optionally filtered by project |
| `create_audit_schedule` | `projectId`, `name`, `templateId?`, `prompt?`, `cadence`, `mode`, `yolo?`, `autoMerge?` | Create a new scheduled audit |
| `get_audit_schedule` | `scheduleId` | Get a single schedule by ID |
| `update_audit_schedule` | `scheduleId`, `name?`, `cadence?`, `mode?`, `status?`, `prompt?`, `yolo?`, `autoMerge?` | Update schedule fields (including pause/resume) |
| `delete_audit_schedule` | `scheduleId` | Delete a schedule |
| `trigger_audit` | `scheduleId` | Manually trigger an immediate run |

### Audit Runs

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list_audit_runs` | `scheduleId?` | List runs, optionally filtered by schedule |
| `get_audit_run` | `runId` | Get a single run (includes report and structured results) |

## Resources

Five read-only resources are exposed:

| URI | Description |
|-----|-------------|
| `kanban://projects` | JSON array of all projects |
| `kanban://tickets` | JSON array of all tickets |
| `kanban://audit-templates` | JSON array of all built-in audit templates |
| `kanban://audit-schedules` | JSON array of all audit schedules |
| `kanban://audit-runs` | JSON array of all audit runs |

## Usage

To connect from another MCP client (e.g., Claude Code), add to `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-kanban": {
      "command": "npx",
      "args": ["tsx", "server/mcp.ts"],
      "cwd": "/path/to/agent-kanban"
    }
  }
}
```

## Chat Popover Tool Integration

The chat popover (`POST /api/chat`) exposes a subset of MCP tools via the Anthropic
tool_use API, allowing users to take actions through natural language (e.g., "retry all
failed tickets").

**Source**: `server/chat-tools.ts`

### How it works

1. Tool schemas are defined in Anthropic's native format (not Zod)
2. The `/api/chat` endpoint sends these tools with each API request
3. When the model responds with `tool_use` blocks, the server executes them in-process
4. Results are sent back as `tool_result` blocks and the loop continues (max 5 rounds)

### Available tools (chat subset)

| Tool | Description |
|------|-------------|
| `list_projects` | List all registered projects |
| `list_tickets` | List tickets with optional filtering |
| `create_ticket` | Create a new ticket |
| `get_ticket` | Get a single ticket by ID or prefix |
| `update_ticket` | Update ticket fields (allowlisted: status, subject, instructions, yolo, autoMerge, queued) |
| `delete_ticket` | Delete a ticket |
| `retry_ticket` | Reset failed/error ticket to todo |
| `status_check` | List tickets needing attention |
| `list_audit_schedules` | List audit schedules |
| `trigger_audit` | Manually trigger an audit run |
| `list_audit_templates` | List built-in audit templates |

Unlike the MCP server (which uses Zod for input validation), the chat tools use an
explicit field allowlist for `update_ticket` to prevent the LLM from injecting internal
fields.

### Differences from MCP server

- **No project/schedule CRUD**: The chat does not expose `create_project`, `delete_project`,
  `create_audit_schedule`, `update_audit_schedule`, or `delete_audit_schedule` to keep
  destructive operations behind explicit UI actions
- **In-process execution**: Calls store/dispatcher functions directly instead of HTTP
- **Anthropic tool format**: Uses `input_schema` (JSON Schema) instead of Zod schemas

## File Layout

```
server/
  mcp.ts         # MCP server definition, tool handlers, resource handlers
  chat-tools.ts  # Chat popover tool schemas and executor (Anthropic tool_use format)
```
