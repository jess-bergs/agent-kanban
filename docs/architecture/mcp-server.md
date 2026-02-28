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

The server exposes 9 tools:

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

## Resources

Two read-only resources are exposed:

| URI | Description |
|-----|-------------|
| `kanban://projects` | JSON array of all projects |
| `kanban://tickets` | JSON array of all tickets |

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
