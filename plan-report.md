# Plan Report: Severity-Ordered Issue Triage for Agent Kanban

## Summary

A comprehensive audit of the Agent Kanban codebase — spanning the Express/WebSocket server, React frontend, documentation, and configuration — identified **35 issues** across security, reliability, correctness, UX, and documentation categories. Issues are organized by severity (Critical → Low) to enable targeted ticket creation for each fix. The most urgent issues involve a dead steering-message API (code path impossible due to closed stdin), silent error swallowing across the frontend, race conditions in watchlist persistence, and significant documentation drift from the actual codebase. Each issue below is scoped as a discrete, independently-fixable ticket.

---

## Relevant Files

### Server
| File | Role |
|------|------|
| `server/index.ts` | Express HTTP server, WebSocket setup, REST API endpoints |
| `server/dispatcher.ts` | Agent lifecycle: spawn, stream parsing, retry, merge, conflict resolution |
| `server/auditor.ts` | PR review watchlist, Claude-based code review, polling loop |
| `server/store.ts` | JSON-file persistence with atomic writes and per-file locking |
| `server/solo-agents.ts` | Detects running Claude Code sessions via JSONL + process scanning |
| `server/screenshots.ts` | Post-PR screenshot capture via Playwright |
| `server/audit-scheduler.ts` | Cron-like scheduled audit execution |
| `server/audit-store.ts` | Persistence for audit schedules and runs |
| `server/audit-templates.ts` | Built-in audit prompt templates |
| `server/analytics.ts` | Aggregated metrics (dispatcher, auditor, scheduler) |
| `server/external-pr-scanner.ts` | Scans projects for external PRs (Dependabot, etc.) |
| `server/auth-monitor.ts` | OAuth token monitoring and proactive refresh |
| `server/mcp.ts` | MCP server for tool-based access to kanban data |
| `server/nvm.ts` | NVM-aware PATH resolution for spawned processes |

### Client
| File | Role |
|------|------|
| `src/App.tsx` | Root component, routing |
| `src/types.ts` | Shared TypeScript types and utility functions |
| `src/hooks/useWebSocket.ts` | WebSocket connection, reconnection, message dispatch |
| `src/components/TicketDetailModal.tsx` | Ticket detail view with activity feed |
| `src/components/CreateTicketModal.tsx` | Ticket creation form |
| `src/components/ChatPopover.tsx` | Chat interface for ticket conversations |
| `src/components/AnalyticsDashboard.tsx` | Analytics dashboard with charts |
| `src/components/Sidebar.tsx` | Project navigation sidebar |
| `src/components/Layout.tsx` | Main layout shell |
| `src/components/TicketKanban.tsx` | Kanban board view |
| `src/components/AgentKanban.tsx` | Solo agent monitoring view |
| `src/hooks/useTheme.ts` | Theme persistence hook |

### Documentation
| File | Role |
|------|------|
| `CLAUDE.md` | Project overview and quick-start guide |
| `AGENTS.md` | Agent conventions, workflow rules, security checklist |
| `docs/architecture/dispatcher.md` | Dispatcher architecture documentation |
| `docs/architecture/auditor.md` | Auditor architecture documentation |
| `docs/architecture/scheduler.md` | Scheduler architecture documentation |
| `docs/architecture/mcp-server.md` | MCP server documentation |
| `docs/architecture/agent-observability.md` | Agent observability documentation |
| `package.json` | Project configuration and scripts |

---

## Current Architecture

Agent Kanban is a Node.js/React application that manages Claude Code agent lifecycles:

1. **Server** (`server/index.ts`): Express server on port 3003 with WebSocket for real-time updates. REST API for CRUD on projects, tickets, audit schedules.

2. **Dispatcher** (`server/dispatcher.ts`): Core orchestrator. Creates git worktrees, spawns Claude Code agents with `--output-format stream-json`, parses live output, manages state transitions (todo → in_progress → in_review → merged/failed), handles retries, usage-limit holds, and conflict resolution.

3. **Auditor** (`server/auditor.ts`): Watches PRs, spawns review agents, parses structured JSON results, triggers re-dispatches on `request_changes`, auto-merges on `approve`.

4. **Store** (`server/store.ts`): File-based JSON persistence with atomic writes (write-to-temp + rename) and per-file write locks to prevent concurrent corruption.

5. **Frontend** (`src/`): React SPA with WebSocket-driven state, Kanban board, ticket detail modals, analytics dashboard, and agent monitoring views.

---

## Issues by Severity

### CRITICAL (Tickets 1–5)

These issues involve broken functionality, dead code paths, or data integrity risks.

---

#### Issue 1: Steering message API is dead code — stdin is closed at spawn

- **File**: `server/dispatcher.ts:742, 1553–1561`
- **Category**: Bug / Dead Code
- **Description**: `sendSteeringMessage()` at line 1553 tries to write to `proc.stdin`, but `proc.stdin.end()` is called at line 742 immediately after spawning the agent. The comment at line 739 even acknowledges this: *"Note: this disables sendSteeringMessage(); use --resume for mid-flight intervention."* Yet the function is still exposed and the `/api/tickets/:id/steer` REST endpoint (in `index.ts`) calls it, returning success even though the message is silently discarded.
- **Impact**: Users (or automation) calling the steering API believe their message was delivered. It never is.
- **Fix**: Either remove `sendSteeringMessage()` and the REST endpoint, or implement stdin as a kept-open pipe with explicit EOF management. Given the comment suggests `--resume` is the intended mechanism, removal is the simpler fix.

---

#### Issue 2: Race condition in auditor watchlist persistence

- **File**: `server/auditor.ts:69, 87–90, 266–267, 329`
- **Category**: Race Condition / Data Integrity
- **Description**: The watchlist is an in-memory array mutated by multiple async paths (`addToWatchlist`, `removeFromWatchlist`, `resetStuckReviews`, `pollPr`, review callbacks). While each path calls `saveWatchlist()`, there is no locking — unlike `store.ts` which uses `withLock()`. Two concurrent saves can interleave: one reads the array, another mutates and saves, then the first overwrites with stale data.
- **Impact**: Watchlist entries can be silently lost or duplicated after concurrent mutations (e.g., a PR finishes review while a new PR is being added).
- **Fix**: Use the same `withLock()` pattern from `store.ts` for all watchlist mutations, or switch to a single-writer queue.

---

#### Issue 3: Silent error swallowing in frontend API calls

- **Files**: `src/components/TicketDetailModal.tsx:127–179`, `src/components/CreateTicketModal.tsx:100`, `src/components/ChatPopover.tsx:54`
- **Category**: Error Handling / UX
- **Description**: Multiple critical user actions (retry, delete, abort, create ticket, image upload) catch errors and either `console.error()` them or silently `return` without any user-facing feedback. For example, `CreateTicketModal` line 100: `if (!res.ok) return;` — no toast, no error message, no indication that ticket creation failed.
- **Impact**: Users perform actions that fail silently. They may believe a ticket was created, an agent was aborted, or an image was uploaded when none of these actually happened.
- **Fix**: Add a toast/notification system and surface errors from all API calls.

---

#### Issue 4: Unbounded stderr accumulation in dispatcher and auditor

- **Files**: `server/dispatcher.ts:913–915`, `server/auditor.ts:573–575`
- **Category**: Resource Leak / Memory
- **Description**: Both the dispatcher and auditor concatenate all stderr output into a single string (`stderr += chunk.toString()`) with no size limit. A long-running agent or one that produces excessive warnings can cause unbounded memory growth.
- **Impact**: Server process memory grows without bound for long-running agents. Could cause OOM crashes during multi-hour runs.
- **Fix**: Cap stderr accumulation (e.g., ring buffer or keep only last 10KB), similar to how stdout's `lineBuffer` is capped at 1MB (line 902).

---

#### Issue 5: `execSync` used for PR operations with string interpolation

- **Files**: `server/dispatcher.ts:209–212, 256–258, 1037, 1229–1231, 1272–1274, 1322–1324, 1363–1365, 1609–1611`
- **Category**: Security / Code Quality
- **Description**: Several `execSync` calls construct shell commands with `ticket.prUrl` interpolated via template strings (e.g., `` `gh pr view "${ticket.prUrl}" --json ...` ``). While prUrl is typically set by the agent's own output and passes through a regex filter, the pattern is fragile. Some calls already use `execFileSync` (safe), but others use `execSync` with string interpolation.
- **Impact**: If a malformed PR URL containing shell metacharacters is ever stored (e.g., via a corrupted JSON file or MCP tool), it could lead to command injection.
- **Fix**: Convert all `execSync` calls to `execFileSync` with array arguments, matching the pattern already used for git operations elsewhere in the file.

---

### HIGH (Tickets 6–14)

These issues cause incorrect behavior, data loss risks, or significant UX degradation.

---

#### Issue 6: Documentation port mismatch — CLAUDE.md says 3002, actual is 3003

- **File**: `CLAUDE.md:14`
- **Category**: Documentation / Onboarding
- **Description**: CLAUDE.md states "Server: http://localhost:3002" but `server/index.ts` line 81 sets `const PORT = 3003`. New users and agents following the docs will fail to connect.
- **Fix**: Update CLAUDE.md line 14 to say port 3003.

---

#### Issue 7: Image upload race condition — no await, no cancellation

- **File**: `src/components/TicketDetailModal.tsx:181–195`
- **Category**: Race Condition
- **Description**: `uploadImageFiles()` loops through files and fires fetch calls without awaiting them. If the user closes the modal, requests complete after unmount.
- **Fix**: Await all uploads (e.g., `Promise.all`), add AbortController cleanup on unmount.

---

#### Issue 8: MCP `update_ticket` allows arbitrary status transitions

- **File**: `server/mcp.ts:131–152`
- **Category**: Data Integrity
- **Description**: The MCP `update_ticket` tool accepts any valid `TicketStatus` value and passes it directly to `updateTicket()` without checking whether the transition is valid. The REST API has some guards but the MCP tool bypasses them.
- **Impact**: External MCP clients can put tickets into inconsistent states that confuse the dispatcher.
- **Fix**: Share validation logic between REST and MCP paths.

---

#### Issue 9: No test coverage

- **Files**: Project-wide
- **Category**: Quality / Reliability
- **Description**: Despite having `vitest` configured, there are no test files in the project. The duplicate `"test"` scripts in `package.json` suggest tests were intended but never written.
- **Fix**: Add tests for critical paths: store CRUD operations, dispatcher state machine transitions, auditor result parsing.

---

#### Issue 10: Screenshots module uses hardcoded port 5174

- **File**: `server/screenshots.ts:301`
- **Category**: Bug / Hardcoded Config
- **Description**: `const appUrl = 'http://localhost:5174'` is hardcoded. If the dev server runs on a different port, screenshot capture silently fails.
- **Fix**: Read port from vite.config.ts or accept it as a parameter.

---

#### Issue 11: WebSocket reconnection can fire stale handlers

- **File**: `src/hooks/useWebSocket.ts:174`
- **Category**: React Anti-pattern / Bug
- **Description**: The `connect` function captures `handleMessage` in closure. When the WebSocket reconnects, it may use a stale `handleMessage` reference.
- **Fix**: Use a ref for the message handler to ensure the latest version is always used.

---

#### Issue 12: Array-index keys in dynamic lists

- **Files**: `src/components/TicketDetailModal.tsx:689, 862`, `src/components/ChatPopover.tsx:323`
- **Category**: React Anti-pattern
- **Description**: `agentActivity`, `stateLog`, and chat messages use array index as React keys despite being dynamically appended.
- **Fix**: Use timestamp-based or content-hash keys.

---

#### Issue 13: Auditor's initial `auditorTick()` not awaited

- **File**: `server/auditor.ts:801`
- **Category**: Error Handling
- **Description**: `startAuditor()` calls `auditorTick()` without `await`. If the initial tick throws, the error is unhandled.
- **Fix**: `await auditorTick()` or add `.catch()`.

---

#### Issue 14: `parseInline()` regex with global flag has stateful bug

- **File**: `src/components/ChatPopover.tsx:369–397`
- **Category**: Bug
- **Description**: Global regex retains `lastIndex` state across calls, causing alternating matches to be skipped on consecutive invocations.
- **Fix**: Create new regex instances inside each call, or reset `lastIndex = 0`.

---

### MEDIUM (Tickets 15–26)

---

#### Issue 15: Duplicate npm scripts in package.json

- **File**: `package.json:17–18, 22–23`
- **Category**: Config / Code Quality
- **Description**: `"test"` and `"test:watch"` are defined twice.
- **Fix**: Remove the duplicates.

---

#### Issue 16: Five implemented features missing from architecture docs

- **Files**: `docs/architecture/` (missing entries)
- **Category**: Documentation
- **Description**: These fully-implemented features have no architecture docs: External PR Scanner, Auth Monitor, Team Agent Mode, Plan-Only Mode, Analytics system.
- **Fix**: Create architecture docs for each feature.

---

#### Issue 17: MCP docs list `remoteUrl` parameter that doesn't exist

- **File**: `docs/architecture/mcp-server.md:32`
- **Category**: Documentation
- **Fix**: Remove `remoteUrl` from the MCP parameter table.

---

#### Issue 18: Broken cross-reference in scheduler docs

- **File**: `docs/architecture/scheduler.md:131`
- **Category**: Documentation
- **Fix**: Fix or remove the dead link to `CLAUDE.md#api-endpoints-2`.

---

#### Issue 19: Auto-scroll jitter in activity feed

- **File**: `src/components/TicketDetailModal.tsx:638–642`
- **Category**: UX
- **Description**: Ref callback runs on every render, causing constant scroll jumps even when user is reading earlier entries.
- **Fix**: Only auto-scroll if user is already at bottom.

---

#### Issue 20: AnalyticsDashboard polling lacks unmount cleanup

- **File**: `src/components/AnalyticsDashboard.tsx:187–191`
- **Category**: Resource Leak
- **Fix**: Add AbortController and clear interval in useEffect cleanup.

---

#### Issue 21: Unsafe `as` type casts on API responses

- **Files**: `src/components/TicketDetailModal.tsx:212`, `src/hooks/useTheme.ts:15`, `server/auditor.ts:77`
- **Category**: Type Safety
- **Fix**: Add runtime validation at system boundaries.

---

#### Issue 22: Sidebar project deletion shows generic alert

- **File**: `src/components/Sidebar.tsx:49–68`
- **Category**: Error Handling / UX
- **Fix**: Show specific error from response body.

---

#### Issue 23: ChatPopover shows "Empty directory" on API failure

- **File**: `src/components/ChatPopover.tsx:48–58`
- **Category**: UX
- **Fix**: Track error state separately and display error indicator.

---

#### Issue 24: `localStorage` theme value not validated

- **File**: `src/hooks/useTheme.ts:15`
- **Category**: Type Safety
- **Fix**: Validate against known theme values, fallback to default.

---

#### Issue 25: `groupRunsByBatch` doesn't handle out-of-order timestamps

- **File**: `src/components/AnalyticsDashboard.tsx:433–442`
- **Category**: Logic Bug
- **Fix**: Sort runs by `startedAt` before grouping.

---

#### Issue 26: `StatusBadge` uses `replace('_', ' ')` — only replaces first underscore

- **File**: `src/components/AnalyticsDashboard.tsx:1473`
- **Category**: Bug (minor)
- **Fix**: Use `replaceAll('_', ' ')` or regex with `/g`.

---

### LOW (Tickets 27–35)

---

#### Issue 27: Module-level counter for image IDs not reset across HMR
- **File**: `src/components/CreateTicketModal.tsx:17`
- **Fix**: Use `useRef` or `crypto.randomUUID()`.

#### Issue 28: `EffortBadge` recomputes parts array on every render
- **File**: `src/components/TicketCard.tsx:42–53`
- **Fix**: Wrap in `useMemo`.

#### Issue 29: Agent cards re-render due to non-memoized map creation
- **File**: `src/components/AgentKanban.tsx:160–178`
- **Fix**: Wrap in `useMemo`.

#### Issue 30: `isIdleNotification()` does unsafe JSON parse
- **File**: `src/types.ts:512–518`
- **Fix**: Add explicit type check after parse.

#### Issue 31: Complex nested ternaries in Layout.tsx
- **File**: `src/components/Layout.tsx:202`
- **Fix**: Extract to named function.

#### Issue 32: ActivityFeed uses composite key with array index
- **File**: `src/components/ActivityFeed.tsx:57`
- **Fix**: Use hash without index.

#### Issue 33: Sidebar ticket stats don't validate `ticket.status`
- **File**: `src/components/Sidebar.tsx:149`
- **Fix**: Add fallback for unknown statuses.

#### Issue 34: `sendSteeringMessage` returns true on destroyed stdin
- **File**: `server/dispatcher.ts:1553–1561`
- **Fix**: Part of Issue 1 — remove or properly implement.

#### Issue 35: Non-critical missing interactive tools documentation
- **File**: `docs/architecture/agent-observability.md`
- **Fix**: Document which tools are classified as "interactive" for approval detection.

---

## Proposed Approach — Ticket Creation Order

### Phase 1: Critical (Tickets 1–5)
1. Remove dead `sendSteeringMessage()` API and endpoint
2. Add write locking to auditor watchlist persistence
3. Implement toast/notification system for frontend error feedback
4. Cap stderr accumulation in dispatcher and auditor
5. Convert remaining `execSync` to `execFileSync` with array arguments

### Phase 2: High (Tickets 6–14)
6. Fix CLAUDE.md port number (3002 → 3003)
7. Fix image upload race condition with await + AbortController
8. Add status transition validation to MCP `update_ticket`
9. Bootstrap test infrastructure with initial test suite
10. Make screenshot port configurable
11. Fix WebSocket reconnection stale handler closure
12. Replace array-index keys in dynamic lists
13. Await or catch `auditorTick()` initial call
14. Fix `parseInline()` global regex statefulness

### Phase 3: Medium (Tickets 15–26)
15–26. Documentation fixes, UX improvements, type safety, and minor bug fixes.

### Phase 4: Low (Tickets 27–35)
27–35. Performance optimizations, code quality, and minor improvements.

---

## Files to Modify

| File | Changes Needed |
|------|---------------|
| `server/dispatcher.ts` | Remove `sendSteeringMessage()`, cap stderr, convert `execSync` → `execFileSync` |
| `server/index.ts` | Remove `/api/tickets/:id/steer` endpoint |
| `server/auditor.ts` | Add `withLock()` to watchlist mutations, cap stderr, await initial tick |
| `CLAUDE.md` | Fix port 3002 → 3003 |
| `package.json` | Remove duplicate test scripts |
| `src/components/TicketDetailModal.tsx` | Add error toasts, fix image upload race, fix array-index keys, fix auto-scroll |
| `src/components/CreateTicketModal.tsx` | Add error feedback, fix image ID generation |
| `src/components/ChatPopover.tsx` | Fix `parseInline()` regex, add error state, fix message keys |
| `src/hooks/useWebSocket.ts` | Fix stale closure in reconnection handler |
| `src/components/AnalyticsDashboard.tsx` | Add polling cleanup, fix `groupRunsByBatch`, fix `StatusBadge` replace |
| `src/hooks/useTheme.ts` | Validate localStorage theme value |
| `src/components/Sidebar.tsx` | Improve error messages, validate ticket stats |
| `server/mcp.ts` | Add status transition validation |
| `server/screenshots.ts` | Make port configurable |
| `docs/architecture/mcp-server.md` | Remove `remoteUrl` from parameter table |
| `docs/architecture/scheduler.md` | Fix broken cross-reference |
| `docs/architecture/` (new files) | Add docs for external-pr-scanner, auth-monitor, team-mode, plan-only, analytics |

---

## Risks & Edge Cases

1. **Removing `sendSteeringMessage()`**: Any external automation relying on `/api/tickets/:id/steer` will break. Verify no MCP tools or scripts use it before removal.

2. **Adding locking to auditor watchlist**: The lock must be non-blocking for the polling loop. Use `withLock()` keyed on the watchlist file path.

3. **Toast system for errors**: Requires a new shared UI component. Consider a centralized `apiFetch()` wrapper that handles all error display.

4. **Test infrastructure**: Prioritize the dispatcher state machine and store CRUD since those have the most subtle edge cases.

5. **Converting `execSync` to `execFileSync`**: Verify that splitting computed values (e.g., `ownerRepo`) into array arguments handles all edge cases.

6. **WebSocket reconnection fix**: Changing to refs alters closure semantics. Verify initial connection and unmount cleanup still work.

---

## Open Questions

1. **Steering message removal vs. reimplementation**: Remove entirely (simpler) or reimplement with kept-open stdin (more capability)? The existing comment suggests `--resume` is preferred.

2. **Toast library choice**: Use a library (react-hot-toast, sonner) or build minimal custom toast? The project has no UI library dependencies beyond React + Lucide icons.

3. **Test scope for initial ticket**: Framework + smoke tests, or comprehensive suite? A minimal set covering store.ts and dispatcher transitions is practical as a first pass.

4. **Documentation tickets**: One large ticket for all 5 missing docs, or 5 separate tickets? Separate tickets allow parallel work.

5. **MCP status validation**: What transitions should be allowed? Should MCP match REST API restrictions exactly?
