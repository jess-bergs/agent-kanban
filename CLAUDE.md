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

## Install as Desktop App (PWA)

The app is installable as a standalone desktop app via Chrome/Edge's PWA support.

```bash
npm run build      # build the frontend
npm start          # start the production server (serves API + built frontend)
```

Then open http://localhost:3003 in Chrome or Edge and click the install icon in the URL bar (or use the browser menu > "Install Agent Kanban").

**Notes:**
- `npm run dev` also works for development but the install prompt may not appear since Vite's dev server runs on a separate port from the API server
- No offline mode — the app requires a live server connection for WebSocket data
- The service worker is intentionally minimal (no caching) since real-time data is the core function

## Documentation

See [AGENTS.md](./AGENTS.md) for all agent guidance: conventions, workflow rules, security checklist, and architecture docs.
