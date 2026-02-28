# Agent Kanban

A real-time dashboard for monitoring and dispatching Claude Code agents. It watches `~/.claude/teams/` and `~/.claude/tasks/` for live team/task/inbox data, and provides a ticket dispatcher that spawns Claude Code agents in git worktrees.

## Quick Start

```bash
npm install
npm run dev        # starts both server and client concurrently
npm run build      # tsc -b && vite build
```

- **Client**: http://localhost:5174 (Vite + React)
- **Server**: http://localhost:3002 (Express + WebSocket)

## Documentation

See [AGENTS.md](./AGENTS.md) for all agent guidance: conventions, workflow rules, security checklist, and architecture docs.
