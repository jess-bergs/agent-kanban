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
  auditor.ts       # Local PR auditor — watchlist-based PR review agent
  audit-scheduler.ts # Scheduled codebase audits — recurring agent-based reviews
  audit-store.ts   # Persistence for audit schedules and run results
  audit-templates.ts # Built-in audit prompt templates
scripts/           # Screenshot generation tooling (npm run screenshot)
.github/           # PR template
```

## Architecture

- **Team Monitor**: Watches `~/.claude/teams/` and `~/.claude/tasks/` directories via chokidar, broadcasts changes over WebSocket to the React frontend.
- **Ticket Dispatcher**: Users create projects (linked to git repos) and tickets (work items). The dispatcher polls every 3s, picks up `todo` tickets, creates git worktrees, and spawns `claude` CLI processes. It tracks agent output and detects PR URLs on completion.
- **Solo Agent Detection**: Polls for standalone Claude Code sessions running outside of teams.
- **WebSocket Events**: All state changes (team updates, task changes, inbox messages, ticket status) are broadcast as typed JSON events.

## Workflow Rules

- **Always raise a PR**: When pushing work, always create a pull request — never push directly to main.
- **File a ticket**: Before starting work, ask the user if we should file a ticket for it on the kanban (via the Agent Kanban API at `POST /api/tickets`). This keeps all work tracked and visible in the dashboard.

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
(`server/auditor.ts`). The auditor maintains a **watchlist** of PRs it actively monitors.

### How It Works
- **Watchlist-based**: PRs are added to the watchlist via API or automatically when a ticket enters `in_review`
- **Repo allowlist**: Only PRs from repos that have registered projects in Agent Kanban can be watched
- **Rubric reviews**: Each review evaluates 6 aspects (Completeness, Code Quality, Test Coverage, Security, Project Conventions, PR Checklist) with pass/concern/fail ratings
- **Polling**: The auditor polls active watchlist PRs every 30s, checking for merge/close status and re-review requests
- **Re-review triggers**: Leave a comment on the PR containing `@auditor`, `re-review`, or `please review` to trigger a new review
- **Auto-resolution**: PRs that are merged or closed are automatically removed from the active watchlist

### Review Output
The auditor posts a structured markdown review comment on the PR with:
- Overall verdict (approve/request changes/comment)
- Rubric table with per-aspect ratings and notes
- Specific actionable feedback for concerns and failures

### API Endpoints
- `GET /api/auditor/watchlist` — Get active watchlist entries
- `POST /api/auditor/watch` — Add a PR to the watchlist (`{ prUrl, ticketId? }`)
- `POST /api/auditor/unwatch` — Remove a PR from the watchlist (`{ prUrl }`)
- `POST /api/auditor/re-review` — Manually trigger a re-review (`{ prUrl }`)
- `POST /api/tickets/:id/audit` — Trigger audit for a ticket (adds its PR to the watchlist)

### Data
Watchlist state is persisted to `data/auditor-watchlist.json`.

## UI Screenshots

After an agent creates a PR, the dispatcher automatically captures a screenshot of the app
using headless Chromium (Playwright) and uploads it to the PR body. This happens in
`server/screenshots.ts` and is best-effort — failures don't block the ticket.

To capture screenshots manually: `npm run screenshot`

## Scheduled Codebase Audits

The audit scheduler (`server/audit-scheduler.ts`) runs recurring agent-based audits on
registered projects. It polls every 5 minutes and spawns Claude agents when audits are due.

### Modes
- **report**: Runs the agent read-only in the project repo. Output is captured and stored as
  the audit report. No branches, commits, or PRs are created.
- **fix**: Creates a ticket with the audit instructions. The existing dispatcher handles
  worktree creation, agent execution, and PR creation.

### Built-in Templates
Six audit templates are available in `server/audit-templates.ts`:
- `readme-freshness` — Checks docs match the codebase (default: weekly, report)
- `architecture-review` — Coupling, consistency, tech debt analysis (default: monthly, report)
- `improvement-opportunities` — Dead code, duplication, quick wins (default: weekly, report)
- `dependency-review` — Outdated/vulnerable/unused packages (default: monthly, report)
- `security-scan` — OWASP Top 10 web security: injection, auth, crypto, SSRF (default: weekly, report)
- `ai-security` — OWASP Top 10 for LLMs: prompt injection, excessive agency, insecure output handling (default: weekly, report)

### Cadence
Schedules support `daily`, `weekly`, `monthly`, or `manual` cadence. The scheduler computes
`nextRunAt` from the last run time. Manual schedules only run when triggered via API.

### API Endpoints
- `GET /api/audit-templates` — List built-in templates
- `GET /api/audit-schedules` — List all schedules (filter with `?projectId=`)
- `POST /api/audit-schedules` — Create a schedule (`{ projectId, name, templateId|prompt, cadence, mode }`)
- `GET /api/audit-schedules/:id` — Get a schedule
- `PATCH /api/audit-schedules/:id` — Update (e.g. `{ "status": "paused" }`)
- `DELETE /api/audit-schedules/:id` — Delete a schedule
- `POST /api/audit-schedules/:id/trigger` — Manually trigger a run
- `GET /api/audit-runs` — List runs (filter with `?scheduleId=`)
- `GET /api/audit-runs/:id` — Get a run (includes `report` field for completed report-mode runs)

### Data
- Schedules: `data/audit-schedules/{uuid}.json`
- Runs: `data/audit-runs/{uuid}.json`
