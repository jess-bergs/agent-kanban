# Agent Kanban — Feature List

> Generated 2026-03-02. Complete audit of all implemented features.

---

## I. Core Infrastructure

### A. Real-Time WebSocket Communication
- **Files**: `server/index.ts`, `src/hooks/useWebSocket.ts`, `server/watcher.ts`
- WebSocket server broadcasts live updates to all connected clients
- Event types: `initial`, `team_updated`, `task_updated`, `inbox_updated`, `ticket_updated`, `ticket_deleted`, `projects_updated`, `agents_updated`, `auditor_updated`, `audit_schedules_updated`, `audit_run_updated`
- Auto-reconnection with exponential backoff (1s → 30s max)
- Debounced file watchers to prevent duplicate events

### B. File System Monitoring
- **Files**: `server/watcher.ts`, `server/claude-data.ts`
- Watches `~/.claude/teams/{name}/config.json` — team configuration
- Watches `~/.claude/teams/{name}/inboxes/{agent}.json` — agent inbox messages
- Watches `~/.claude/tasks/{name}/{id}.json` — task definitions
- Filters out `.lock`, `.highwatermark`, and dotfiles

### C. Atomic File Storage & Locking
- **Files**: `server/store.ts`
- Per-file write locks to prevent race conditions
- Atomic writes (write to `.tmp` then rename)
- Automatic JSON repair for corrupted files
- Safe JSON parsing with fallback recovery

---

## II. Ticket Dispatcher System

### A. Ticket Lifecycle Management
- **Files**: `server/store.ts`, `server/dispatcher.ts`, `src/types.ts`
- 9 ticket statuses: `todo`, `in_progress`, `needs_approval`, `on_hold`, `in_review`, `done`, `merged`, `failed`, `error`
- UUID-based ticket IDs (Generation 1→3 compatibility)
- State change log with timestamps and transition reasons
- Effort metrics: turns, tool calls, tokens (input/output), cost, duration

### B. Agent Dispatching & Execution
- **Files**: `server/dispatcher.ts`
- Spawns Claude Code agents in git worktrees
- Concurrent execution control (MAX_CONCURRENT = 5)
- Dispatch modes:
  - **YOLO mode** — no-confirmation agent execution
  - **Ralph mode** — alternative model selection
  - **Team mode** — multi-agent team dispatch
  - **Plan-only mode** — generate plan without execution, extracts `planSummary`
  - **Queued mode** — wait for manual dispatch
- Output stream capture (JSON lines with structured events)
- Activity tracking: thinking, tool calls, text output (20-entry ring buffer)
- Agent abort/interrupt handling

### C. Usage Limit Detection & Auto-Hold
- **Files**: `server/dispatcher.ts`
- Parses error messages for rate/usage limit keywords
- Extracts reset time from error messages (multi-vendor regex)
- Auto-transitions ticket to `on_hold` with `holdUntil` timestamp
- 5-minute buffer added to reset time
- 3-minute minimum hold period
- Health check auto-resumes expired holds

### D. PR Integration & Auto-Merge
- **Files**: `server/dispatcher.ts`
- Automatic PR URL extraction from agent stdout
- PR status polling every 3 seconds
- Auto-merge with CI check-pass requirements
- Exponential backoff on merge polling
- Conflict detection & resolution dispatch (auto-retry up to 2x)
- PR screenshot capture (dev server spin-up + Playwright)
- Ticket ID injection via HTML comment in PR body

### E. Session Resumption & Retry
- **Files**: `server/dispatcher.ts`
- Stores `agentSessionId` for `--resume` mode
- `resumePrompt` injection for conflict resolution / review fixes
- `automationIteration` tracking (max 5 re-dispatches)
- Max turns enforcement (50 turns = timeout)

### F. Failure Classification
- **Files**: `server/dispatcher.ts`, `src/types.ts`
- Structured failure types: `server_crash`, `agent_exit`, `signal_exit`, `user_abort`, `project_not_found`, `worktree_setup_failed`, `retry_budget_exhausted`, `automation_budget_exhausted`, `usage_limit`, `other`

### G. Health Check & Self-Healing
- **Files**: `server/dispatcher.ts`
- 30-second health check loop
- Orphaned ticket recovery (PID no longer running)
- Stuck ticket detection (30-minute grace period)
- No-PR in_review ticket detection (PR lookup by branch)
- Hold expiry detection and auto-resume
- Health check log (`data/health-check-log.jsonl`)

---

## III. PR Auditor System

### A. Watchlist Management
- **Files**: `server/auditor.ts`
- Tracks open PRs from dispatched tickets
- Persisted to `data/auditor-watchlist.json`
- PR merge/close detection and cleanup
- 30-second polling interval

### B. Automated Code Review
- **Files**: `server/auditor.ts`
- PR template compliance checking (checkbox groups, required sections)
- Rubric-based code quality assessment
- Three verdicts: `approve`, `request_changes`, `comment`
- Review comment posting via `gh` CLI
- Template caching with SHA-256 hashing
- Max 5 re-reviews per PR
- Stale review reset on server restart

### C. Audit Gate for Auto-Merge
- **Files**: `server/dispatcher.ts`
- Blocks auto-merge while auditor is pending or requested changes
- Only merges when audit status is `approved` or no audit exists

---

## IV. Scheduled Audit System

### A. Audit Scheduler
- **Files**: `server/audit-scheduler.ts`, `server/audit-store.ts`
- Cadences: hourly, daily, weekly, monthly, manual
- 3-hour polling interval
- Modes: report (read-only analysis), fix (auto-create PRs)
- 2 concurrent report audits max
- Run history persistence in `data/audit-runs/`

### B. Built-in Audit Templates
- **Files**: `server/audit-templates.ts`
- 6 templates:
  1. **README Freshness** — documentation accuracy verification
  2. **Architecture Review** — module boundaries, coupling, consistency
  3. **Improvement Opportunities** — refactoring candidates, tech debt
  4. **Dependency Review** — currency, security, unused deps, licenses
  5. **Security Scan** — OWASP Top 10 + secret detection
  6. **AI Security** — AI-specific code security review

### C. Audit Report Parsing & Trends
- **Files**: `server/audit-report-parser.ts`, `server/audit-trend.ts`
- JSON fence extraction from agent output
- Finding ID generation (stable fingerprints)
- Severity counting: critical, high, medium, low, info
- Cross-run trend analysis (improving/stable/declining)
- Finding lifecycle: new, resolved, recurring

---

## V. Frontend UI

### A. Layout & Navigation
- **Files**: `src/components/Layout.tsx`, `src/components/Sidebar.tsx`
- Dark theme (surface-900 base), Tailwind CSS, lucide-react icons
- 3-panel layout: sidebar | kanban board | activity feed
- View modes: Projects, Teams, Agents, Analytics
- Connection status indicator
- Solo agents activity bar

### B. Sidebar
- **Files**: `src/components/Sidebar.tsx`
- Project list with ticket counts (in-progress, completed)
- Team list with member counts and creation timestamps
- Solo agents grouped by project/cwd
- Delete project confirmation
- Pending ticket indicators, active agent status

### C. Ticket Kanban Board
- **Files**: `src/components/TicketKanban.tsx`, `src/components/TicketCard.tsx`
- Columns: todo, in_progress, needs_approval, on_hold, in_review, done, failed, error
- Pagination (10 items/page with "Show More")
- Search by ID, subject, or instructions (Cmd+K)
- Create ticket shortcut (Cmd+N)
- Card flags: QUEUED, YOLO, AUTO-MERGE, PLAN, TEAM, IMAGES, NEEDS ATTENTION, HAS QUESTION, CONFLICT, APPROVED
- Effort badge (cost, duration, turns, tool calls)
- Abort button on hover

### D. Team Task Kanban
- **Files**: `src/components/KanbanBoard.tsx`, `src/components/TaskCard.tsx`
- Columns: pending, in_progress, completed
- Task cards with IDs, status, click-to-detail

### E. Agent Kanban
- **Files**: `src/components/AgentKanban.tsx`
- Columns grouped by project (cwd)
- Agent cards: status (active/idle), source badge (terminal, VS Code, dispatched), model, last activity, prompt, output
- Dispatched agents highlighted in cyan, active agents sorted to top

### F. Ticket Detail Modal
- **Files**: `src/components/TicketDetailModal.tsx`
- Full ticket details: status, ID (with copy), subject, instructions
- Image gallery (expandable)
- Agent activity stream (thinking, tool use, results, text)
- State change log with reasons
- Effort metrics display
- Audit status and verdict
- PR URL with external link
- Actions: Retry, Delete, Refresh Status, Abort, Mark Done
- Image upload: paste, drag-drop, file picker

### G. Create Ticket Modal
- **Files**: `src/components/CreateTicketModal.tsx`
- Fields: subject, instructions, YOLO, auto-merge, queued, Ralph, team, plan-only
- Image attachments (paste, drag-drop, remove)
- Keyboard: Escape to close, Cmd+Enter to submit

### H. Activity Feed
- **Files**: `src/components/ActivityFeed.tsx`
- Real-time inbox messages, filters idle notifications
- Agent badges with color coding, expandable messages, timestamps

### I. Analytics Dashboard
- **Files**: `src/components/AnalyticsDashboard.tsx`
- Dispatcher stats: tickets by status, cost, tokens, failures
- Auditor stats: watched PRs, reviews, verdicts
- Scheduler stats: audit runs, severity breakdown
- Reports sub-tab with run batch grouping and stats summary
- Trend indicators (up/down/stable)

### J. Chat Popover
- **Files**: `src/components/ChatPopover.tsx`
- AI chat interface
- Per-project file browsing and attachment

### K. Project Management
- **Files**: `src/components/AddProjectModal.tsx`, `src/components/FolderPicker.tsx`
- Add projects via folder picker with git detection
- Directory browser for folder selection

### L. Loading Screen
- **Files**: `src/components/LoadingScreen.tsx`
- Initial connection/data loading animation

### M. PWA Installation
- **Files**: `src/main.tsx` (service worker)
- Installable via Chrome/Edge
- Minimal service worker (no caching — real-time data)

---

## VI. Solo Agent Detection

- **Files**: `server/solo-agents.ts`
- Process monitoring via `ps` command
- CWD extraction via `lsof`
- Source identification: terminal, VS Code, dispatched
- Prompt extraction from project history (head + tail bytes)
- Last output capture, active status via stream monitoring
- Branch and model detection

---

## VII. REST API

### Projects
- `GET /api/projects` — list with ticket summaries
- `POST /api/projects` — register (auto-detects branch, remote)
- `DELETE /api/projects/:id` — remove from list
- `GET /api/browse` — directory browser

### Tickets
- `POST /api/tickets` — create
- `PATCH /api/tickets/:id` — update status/fields
- `POST /api/tickets/:id/retry` — retry failed
- `POST /api/tickets/:id/abort` — abort running agent
- `POST /api/tickets/:id/refresh-status` — refresh PR status
- `DELETE /api/tickets/:id` — delete
- `POST /api/tickets/:id/images` — upload image
- `DELETE /api/tickets/:id/images/:filename` — remove image
- `GET /api/ticket-images/:filename` — serve image

### Teams
- `GET /api/teams` — all teams with data

### Solo Agents
- `GET /api/agents` — detect running Claude processes

### Audit Schedules
- `GET /api/audit-schedules` — list
- `POST /api/audit-schedules` — create
- `GET /api/audit-schedules/:id` — get
- `PATCH /api/audit-schedules/:id` — update
- `DELETE /api/audit-schedules/:id` — delete
- `POST /api/audit-schedules/:id/trigger` — manual trigger

### Audit Runs & Templates
- `GET /api/audit-runs` — list
- `GET /api/audit-runs/:id` — get with report
- `GET /api/audit-templates` — list
- `GET /api/audit-templates/:id` — get details

### Analytics & Chat
- `GET /api/analytics` — aggregated stats
- `POST /api/chat` — send chat message
- `GET /api/chat/files` — browse project files

---

## VIII. MCP Server

- **Files**: `server/mcp.ts`
- Full MCP protocol implementation for all CRUD operations
- Tools: `list_projects`, `create_project`, `delete_project`, `list_tickets`, `create_ticket`, `get_ticket`, `update_ticket`, `delete_ticket`, `retry_ticket`
- Audit tools: `list_audit_schedules`, `create_audit_schedule`, `get_audit_schedule`, `update_audit_schedule`, `delete_audit_schedule`, `trigger_audit`, `list_audit_runs`, `get_audit_run`, `list_audit_templates`, `get_audit_template`

---

## IX. Data Persistence

```
data/
├── projects/              # Project metadata (UUID.json)
├── tickets/               # Ticket state (UUID.json)
├── ticket-images/         # Uploaded images
├── audit-schedules/       # Schedule definitions
├── audit-runs/            # Run results & reports
├── reports/               # Generated markdown reports
├── auditor-watchlist.json # PR watchlist persistence
└── health-check-log.jsonl # Recovery action log
```

### Ticket Compatibility System
- **Files**: `src/lib/ticketCompat.ts`
- Gen 1: short ID, no effort metrics
- Gen 2: short ID, with effort metrics
- Gen 3: UUID, effort, stateLog, modern format
- Safe accessors: `safeStatus()`, `safeEffort()`
