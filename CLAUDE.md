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
server/screenshots.ts  # Post-PR screenshot capture & upload to GitHub
  auditor.ts       # Local PR auditor — spawns Claude agent to review PRs
scripts/           # Screenshot generation tooling (npm run screenshot)
.github/           # PR template
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
5. The dispatcher captures a UI screenshot via Playwright and attaches it to the PR
6. A local auditor agent reviews the PR for code quality, security, PR checklist adherence, and AGENTS.md compliance
7. Optional auto-merge when PR checks pass and reviews are approved

## Local PR Auditor

Instead of GitHub Action workflows, PR reviews are handled by a local Claude Code agent
(`server/auditor.ts`). When a ticket enters `in_review` with a PR URL, the auditor
automatically spawns a `claude` CLI process that:
- Fetches the PR diff via `gh pr diff`
- Reviews for code quality, security, completeness, and project convention adherence
- Posts a structured review comment on the PR via `gh pr review`
- Can approve, request changes, or leave a comment

The auditor can also be triggered manually via `POST /api/tickets/:id/audit`.
Audit status is tracked on the ticket as `auditStatus` (pending/running/done/error).

## UI Screenshots

After an agent creates a PR, the dispatcher automatically captures a screenshot of the app
using headless Chromium (Playwright) and uploads it to the PR body. This happens in
`server/screenshots.ts` and is best-effort — failures don't block the ticket.

To capture screenshots manually: `npm run screenshot`
