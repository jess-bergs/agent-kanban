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

The server exposes 19 tools across four domains:

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
| `retry_ticket` | `id` | Reset a failed ticket back to `todo` |

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

## File Layout

```
server/
  mcp.ts    # MCP server definition, tool handlers, resource handlers
```
