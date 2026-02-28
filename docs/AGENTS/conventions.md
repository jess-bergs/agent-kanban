# Conventions for Agents

## Quick Start

```bash
npm install
npm run dev        # starts both server and client concurrently
npm run build      # tsc -b && vite build
```

- **Client**: http://localhost:5174 (Vite + React)
- **Server**: http://localhost:3002 (Express + WebSocket)

## Key Conventions

- TypeScript strict mode throughout
- Shared types in `src/types.ts` — imported by both frontend and server
- Path alias: `@/` maps to `src/`
- Server TypeScript config: `tsconfig.server.json`
- Tailwind CSS for styling
- No test framework currently configured

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
  screenshots.ts   # Post-PR screenshot capture & upload to GitHub
  auditor.ts       # Local PR auditor — watchlist-based PR review agent
  audit-scheduler.ts # Scheduled codebase audits — recurring agent-based reviews
  audit-store.ts   # Persistence for audit schedules and run results
  audit-templates.ts # Built-in audit prompt templates
scripts/           # Screenshot generation tooling (npm run screenshot)
.github/           # PR template
```
