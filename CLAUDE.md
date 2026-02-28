# Agent Kanban

A real-time dashboard for monitoring and dispatching Claude Code agents. It watches `~/.claude/teams/` and `~/.claude/tasks/` for live team/task/inbox data, and provides a ticket dispatcher that spawns Claude Code agents in git worktrees.

## Quick Start

```bash
npm install
npm run dev        # starts both server and client concurrently
```

- **Client**: http://localhost:5174 (Vite + React)
- **Server**: http://localhost:3002 (Express + WebSocket)

## Build

```bash
npm run build      # tsc -b && vite build
```

## Project Structure

```
src/               # React frontend (Vite, Tailwind CSS)
  components/      # UI components (kanban boards, modals, cards)
  hooks/           # React hooks (useWebSocket, etc.)
  types.ts         # Shared TypeScript types (used by both client and server)
  App.tsx          # Main app with routing between team monitor and dispatch views
server/            # Express backend
  index.ts         # HTTP + WebSocket server, all REST endpoints
  claude-data.ts   # Reads Claude Code team/task/inbox JSON files from ~/.claude/
  watcher.ts       # Chokidar file watcher for live updates
  dispatcher.ts    # Ticket dispatcher — spawns Claude Code agents in git worktrees
  store.ts         # JSON file-based persistence for projects and tickets
  solo-agents.ts   # Detects standalone Claude Code sessions
scripts/           # Screenshot generation tooling
.github/           # PR template, Claude PR review workflow
```

## Architecture

- **Team Monitor**: Watches `~/.claude/teams/` and `~/.claude/tasks/` directories via chokidar, broadcasts changes over WebSocket to the React frontend.
- **Ticket Dispatcher**: Users create projects (linked to git repos) and tickets (work items). The dispatcher polls every 3s, picks up `todo` tickets, creates git worktrees, and spawns `claude` CLI processes. It tracks agent output and detects PR URLs on completion.
- **Solo Agent Detection**: Polls for standalone Claude Code sessions running outside of teams.
- **WebSocket Events**: All state changes (team updates, task changes, inbox messages, ticket status) are broadcast as typed JSON events.

## Key Conventions

- TypeScript strict mode throughout
- Shared types in `src/types.ts` — imported by both frontend and server
- Path alias: `@/` maps to `src/`
- Server TypeScript config: `tsconfig.server.json`
- Tailwind CSS for styling
- No test framework currently configured

## Ticket Workflow

Tickets flow through: `todo` → `in_progress` → `in_review` → `done`/`merged`/`failed`/`error`

When a ticket is dispatched:
1. A git worktree is created from the project's default branch
2. A Claude Code agent is spawned with the ticket instructions
3. The agent works, commits, pushes, and creates a PR
4. The dispatcher detects the PR URL and moves the ticket to `in_review`
5. Optional auto-merge when PR checks pass and reviews are approved
