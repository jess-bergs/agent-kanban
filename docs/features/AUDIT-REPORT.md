# Agent Kanban — Comprehensive Audit Report

> Generated 2026-03-02. Stages 2–6 of the codebase audit.

---

## Stage 2: PR/Ticket Cross-Check (March 1–2)

### Duplicate PRs (Close Immediately)

| PR | Title | Issue |
|----|-------|-------|
| **#100** | Force agents to use PR template | Duplicate of merged #98, CI failing, stale branch references `resetStuckReviews` |
| **#105** | Add startup loading screen | Duplicate of merged #95, same files |
| **#90** | Add file viewer to chat | Duplicate of merged #87, merge conflicts, stale |

**Root cause**: The dispatcher appears to re-dispatch tickets that already have merged PRs. Worth investigating the dedup logic.

### Changes Requested — Need Rework

| PR | Title | Issue | Action |
|----|-------|-------|--------|
| **#104** | Add rubric trends chart to Reports tab | PR body non-compliant: screenshots checkbox unchecked, "commented my code" checkbox deleted from template | Fix PR body only — code is approved |
| **#94** | Per-project max concurrent agents | PR body missing required template sections, merge conflicts | Fix PR body, resolve conflicts — code is sound |

### Open, No Review — Need Attention

| PR | Title | Issue | Priority |
|----|-------|-------|----------|
| **#84** | Harden chat security guardrails | Merge conflicts, no review. Security-related. | HIGH |
| **#99** | Add tooltips and aria-labels | CI passing, mergeable. Uses old PR format. | MEDIUM |
| **#88** | Fix review feedback (Tailwind classes) | Merge conflicts, no review. Small cleanup. | LOW |

### Closed Without Merge — Verify Coverage

| PR | Title | Verdict |
|----|-------|---------|
| **#96** | Health check loop | Superseded — absorbed into main via direct commits |
| **#65** | Move changes_requested to In Progress | **Unverified** — check if this feature exists on main |

### Dependabot PRs

| Action | PRs |
|--------|-----|
| **Merge now** | #74 (actions/setup-node), #75 (actions/checkout), #76 (dev-deps), #82 (lucide-react) |
| **Investigate** | #77 (express — CI failing) |
| **Defer** | #78 (Tailwind v3→v4 — major migration), #79 (plugin-react v5), #80 (Vite v7), #81 (chokidar v5) |

---

## Stage 3: Architecture Documentation Assessment

### Accuracy Summary

| Document | Accuracy | Completeness | Update Priority |
|----------|----------|--------------|-----------------|
| `dispatcher.md` | 95% | **60%** | **HIGH** |
| `auditor.md` | 100% | 95% | LOW |
| `scheduler.md` | **Wrong** | 90% | **CRITICAL** |
| `agent-observability.md` | 100% | 100% | None |
| `pr-lifecycle.md` | 100% | 95% | LOW |
| `security.md` (arch) | 100% | 90% | LOW |
| `workflow.md` | 95% | **70%** | **HIGH** |
| `conventions.md` | 100% | 100% | None |

### Critical Fix

**`scheduler.md` documents a 5-minute polling interval. The actual code uses 3 hours.** This is a 36x discrepancy (`const POLL_INTERVAL_MS = 3 * 60 * 60 * 1000`).

### Major Documentation Gaps

1. **`on_hold` status is undocumented everywhere** — a first-class ticket state with `holdUntil` field, auto-recovery logic, and dispatcher concurrency gates
2. **Usage limit detection** — entire subsystem (`detectUsageLimit()`, auto-hold, resume buffer) has zero documentation
3. **Plan-only mode** — `planOnly` flag, `planSummary` extraction undocumented
4. **Team mode** — `useTeam` flag, `teamName` derivation undocumented
5. **Session resumption** — `agentSessionId`, `resumePrompt`, `--resume` flow undocumented
6. **Automation iteration counter** — tracks re-dispatch attempts, undocumented
7. **`postAgentAction` routing** — `audit` vs `merge` action selection undocumented

### Documentation Contradictions

1. **Scheduler interval**: docs say 5min, code says 3 hours
2. **Conflict detection**: docs imply hourly only, but `checkPrStatus()` runs every 3s too
3. **Ticket lifecycle in `workflow.md`**: doesn't show `on_hold` state — incomplete state machine

---

## Stage 4: Codebase Bug Audit

### Critical Bugs

#### 1. Process Cleanup Race Condition
- **File**: `server/dispatcher.ts:1950-1955`
- Shutdown kills processes then immediately calls `running.clear()` without waiting for close handlers
- Close handler (line 893) may still be executing and accessing the cleared map
- **Risk**: Lost ticket updates on shutdown, potential crashes

#### 2. Stale Promise Overwrite in Stream Processing
- **File**: `server/dispatcher.ts:870`
- `pendingStreamWrite` is reassigned on every stream line without awaiting the previous Promise
- Close handler only waits for the last Promise — earlier writes may be lost
- **Risk**: Ticket state corruption on rapid stream output

#### 3. Dispatcher Tick Overlap
- **File**: `server/dispatcher.ts:1933`
- `setInterval(dispatcherTick, 3000)` has no lock against overlapping async ticks
- If a tick takes >3s (e.g., slow GitHub API), concurrent ticks race on dispatch decisions
- **Risk**: Duplicate agent dispatches, state races

### High Severity

#### 4. Shell Injection via Branch Names
- **File**: `server/dispatcher.ts:470-520`
- Branch names from ticket data used in `execSync` template literals
- `execSync(\`git branch -D "${branchName}"\`)` is vulnerable if branchName contains shell metacharacters
- **Risk**: Command injection (low probability — internal data, but defense-in-depth failure)

#### 5. Missing JSON Validation in Stream Processing
- **File**: `server/dispatcher.ts:757-878`
- JSON.parse succeeds but event type accessed without null/structure checks
- `const type = event.type as string` — no validation that `type` exists
- **Risk**: Crash if agent sends malformed stream-json

#### 6. State Sync Gap (Server ↔ Client)
- **File**: `server/index.ts`, `src/hooks/useWebSocket.ts`
- No ACK mechanism or message versioning on WebSocket events
- Client can miss updates during reconnection (only gets next event, not full state)
- **Risk**: Stale UI data after network hiccups

#### 7. Effort Tracking NaN Propagation
- **File**: `server/dispatcher.ts:786-789`
- `effort.inputTokens = (effort.inputTokens || 0) + (usage.input_tokens || 0)`
- If `effort.inputTokens` is already NaN (from prior failure), `NaN || 0` is `0` — silently resets
- But intermediate NaN can corrupt cost calculations elsewhere
- **Risk**: Corrupted effort metrics

### Medium Severity

#### 8. Health Check Flag Not Try-Finally Protected
- **File**: `server/dispatcher.ts:1717-1722`
- `healthCheckRunning = true` set before try block; if error thrown before the finally at line 1919, flag stays true forever
- **Risk**: Health checks permanently disabled after one error

#### 9. Watcher Debounce Timers Not Cleaned on Close
- **File**: `server/watcher.ts:62-74`
- `debounceTimers` map accumulates timers; no cleanup when watcher closes
- **Risk**: Memory leak if watcher restarts

#### 10. Auto-Merge Backoff State Not Persisted
- **File**: `server/dispatcher.ts:38, 1463`
- `autoMergeNotReadyCount` is in-memory Map — lost on server restart
- **Risk**: GitHub API rate limiting after restart (backoff resets)

#### 11. Fetch Error Handling Missing in Client
- **Files**: Multiple React components
- `await fetch(...)` calls don't check `response.ok` or handle network errors
- **Risk**: User actions silently fail with no feedback

#### 12. Stream Buffer Unbounded
- **File**: `server/dispatcher.ts:881-887`
- `lineBuffer += chunk.toString()` with no size limit
- **Risk**: Memory spike if agent outputs large data without newlines

#### 13. Unawaited Promise Chains
- **File**: `server/dispatcher.ts:841-847`
- Nested `.then()` chains for status transitions not awaited, errors silently swallowed
- **Risk**: Tool approval transitions may race or fail silently

### Low Severity

#### 14. Duplicate Length Check (Dead Code)
- **File**: `server/dispatcher.ts:391-393` — two identical `if (files.length === 0) return null` checks

#### 15. Inconsistent Log Formatting
- Throughout `dispatcher.ts`, `auditor.ts` — mixed `ticket #`, `Ticket #`, `[${ticket.id}]`

#### 16. Magic Numbers
- Various hardcoded values without named constants (15000ms, 30000ms, etc.)

---

## Stage 5: Plan of Attack

### Guiding Principles
1. **Fix broken things before improving things** — bugs before refactors
2. **Small, safe PRs** — each fix is independently mergeable
3. **Test after each change** — `npm run check` (lint + typecheck) between changes
4. **Server stability first** — backend bugs are more impactful than UI issues

### Phase 1: Housekeeping (Low Risk, Quick Wins)
**Effort: ~1 hour**

| # | Task | Risk | Files |
|---|------|------|-------|
| 1.1 | Close duplicate PRs #100, #105, #90 | None | GitHub |
| 1.2 | Merge safe Dependabot PRs #74, #75, #76, #82 | Very low | GitHub |
| 1.3 | Fix `scheduler.md` polling interval (5min → 3 hours) | None | `docs/architecture/scheduler.md` |
| 1.4 | Remove dead code: duplicate length check at `dispatcher.ts:393` | Very low | `server/dispatcher.ts` |

### Phase 2: Critical Server Bugs (High Impact)
**Effort: ~3 hours**

| # | Task | Risk | Files |
|---|------|------|-------|
| 2.1 | **Fix dispatcher tick overlap**: add a `tickRunning` lock to prevent concurrent `dispatcherTick()` calls | Low | `server/dispatcher.ts` |
| 2.2 | **Fix stream Promise chain**: chain `pendingStreamWrite` Promises instead of overwriting | Low | `server/dispatcher.ts` |
| 2.3 | **Fix shutdown race condition**: await process close handlers before `running.clear()`, or add shutdown flag | Medium | `server/dispatcher.ts` |
| 2.4 | **Fix health check flag**: wrap entire health check body in try-finally | Low | `server/dispatcher.ts` |

### Phase 3: Security & Input Validation (Defense in Depth)
**Effort: ~2 hours**

| # | Task | Risk | Files |
|---|------|------|-------|
| 3.1 | Replace `execSync` with `execFileSync` for git commands that use branch names | Low | `server/dispatcher.ts` |
| 3.2 | Add JSON structure validation in `processStreamLine` before accessing event properties | Low | `server/dispatcher.ts` |
| 3.3 | Review and merge PR #84 (chat security guardrails) after resolving conflicts | Medium | `server/index.ts`, `docs/architecture/security.md` |

### Phase 4: State Management & Reliability (Medium Impact)
**Effort: ~3 hours**

| # | Task | Risk | Files |
|---|------|------|-------|
| 4.1 | Add proper error handling to client fetch calls (check `response.ok`, show error feedback) | Low | Multiple components |
| 4.2 | Fix unawaited Promise chains in stream processor | Low | `server/dispatcher.ts` |
| 4.3 | Cap stream `lineBuffer` size to prevent unbounded growth | Low | `server/dispatcher.ts` |
| 4.4 | Clean up watcher debounce timers on close | Low | `server/watcher.ts` |
| 4.5 | Initialize effort tracking fields to 0 to prevent NaN propagation | Low | `server/dispatcher.ts` |

### Phase 5: Documentation Catch-Up
**Effort: ~2 hours**

| # | Task | Risk | Files |
|---|------|------|-------|
| 5.1 | Document `on_hold` status and usage limit detection | None | New doc + update `workflow.md`, `dispatcher.md` |
| 5.2 | Document plan-only mode, team mode, session resumption | None | `dispatcher.md` |
| 5.3 | Update `workflow.md` ticket lifecycle to include `on_hold` | None | `docs/AGENTS/workflow.md` |
| 5.4 | Document failure reason enumeration | None | `dispatcher.md` or new doc |

### Phase 6: PR Cleanup & Review
**Effort: ~2 hours**

| # | Task | Risk | Files |
|---|------|------|-------|
| 6.1 | Fix PR #104 body (add missing checklist items) | None | GitHub |
| 6.2 | Fix PR #94 body and resolve merge conflicts | Low | GitHub |
| 6.3 | Resolve conflicts on PR #88 and review | Low | GitHub |
| 6.4 | Review PR #99 (accessibility tooltips) | Low | GitHub |
| 6.5 | Investigate PR #77 (express bump CI failure) | Low | GitHub |
| 6.6 | Verify PR #65 feature coverage on main (changes_requested → in_progress) | None | Codebase check |

### Phase 7: Architecture Improvements (Lower Priority)
**Effort: ~3 hours (defer if time-constrained)**

| # | Task | Risk | Files |
|---|------|------|-------|
| 7.1 | Add WebSocket state versioning / full-state resync on reconnect | Medium | `server/index.ts`, `useWebSocket.ts` |
| 7.2 | Persist auto-merge backoff state to ticket data | Low | `server/dispatcher.ts` |
| 7.3 | Standardize log formatting across modules | Low | Multiple server files |
| 7.4 | Investigate dispatcher dedup logic — prevent re-dispatch of merged tickets | Medium | `server/dispatcher.ts` |

---

### Effort Summary

| Phase | Effort | Risk | Priority |
|-------|--------|------|----------|
| 1. Housekeeping | ~1h | Very low | Do first |
| 2. Critical server bugs | ~3h | Low-Medium | Do second |
| 2.5. Tests (alongside bug fixes) | ~2.5h | None | With Phase 2 & 4 |
| 3. Security | ~2h | Low-Medium | Do third |
| 4. State management | ~3h | Low | Do fourth |
| 5. Documentation | ~2h | None | Do fifth |
| 6. PR cleanup | ~2h | Low | Do sixth |
| 7. Architecture | ~3h | Medium | Defer if needed |
| **Total** | **~18.5h** | | |

### Safest Route

1. **Start with Phase 1** — zero-risk cleanup that immediately reduces noise
2. **Phase 2 next** — the dispatcher tick overlap and Promise chain bugs are the most likely to cause real issues in production; fix them while the codebase context is fresh
3. **Phase 3 after** — security fixes are defense-in-depth; low probability of exploit but important for robustness
4. **Phases 4-5 can run in parallel** — state management fixes and docs are independent workstreams
5. **Phase 6 is cleanup** — deal with stale PRs once the codebase is stable
6. **Phase 7 only if time permits** — these are genuine improvements but the codebase works without them

### What NOT to Do

- **Don't merge Tailwind v4 (#78)** — major migration, separate effort
- **Don't merge Vite v7 (#80) or chokidar v5 (#81)** — major version bumps need dedicated testing
- **Don't refactor the dispatcher into smaller modules yet** — it's a 2000-line file but splitting it while fixing bugs doubles the risk
- **Don't add new features** until the bug fixes are stable

---

## Testing Strategy

No tests exist today. Given the pace of development and the nature of this app (real-time dashboard, process spawning, file watching), a full TDD setup would be overkill. Instead, target the highest-value seams — the pure logic that's most bug-prone and easiest to test.

### What to Test (and What Not To)

**Test**: Pure functions and state logic that don't need a running server, file system, or browser.

**Don't test**: WebSocket plumbing, file watcher setup, React component rendering, `gh` CLI integration, process spawning. These are integration boundaries — the bugs there are caught by running the app, not by mocks.

### Setup

Add `vitest` (already compatible with the Vite toolchain — zero config needed):

```bash
npm install -D vitest
```

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

No config file needed — Vitest picks up `vite.config.ts` automatically.

### Tier 1: Store & Data Integrity (~10 tests, ~1h)
**Why**: The store is the source of truth. Corruption here ripples everywhere.

| Test | What it covers | File |
|------|---------------|------|
| `mergeUpdate` preserves unrelated fields | Prevents field-clobbering on partial updates | `server/store.ts` |
| `mergeUpdate` with `stateLog` appends, doesn't replace | State history is append-only | `server/store.ts` |
| Atomic write: concurrent writes don't corrupt | Lock prevents interleaving | `server/store.ts` |
| `safeStatus()` returns valid status for all 3 generations | Compat layer works | `src/lib/ticketCompat.ts` |
| `safeEffort()` returns zeroes for gen-1 tickets | No NaN leakage | `src/lib/ticketCompat.ts` |
| Ticket ID generation produces valid UUIDs | ID format is stable | `server/store.ts` |

### Tier 2: Dispatcher Logic (~8 tests, ~1h)
**Why**: The bugs identified in Stage 4 live here. Tests pin down the fixes.

| Test | What it covers | File |
|------|---------------|------|
| `detectUsageLimit` parses "rate limit" errors | Usage hold triggers correctly | `server/dispatcher.ts` |
| `detectUsageLimit` returns null for non-limit errors | No false positives | `server/dispatcher.ts` |
| Hold expiry logic: ticket resumes after `holdUntil` passes | Auto-resume works | `server/dispatcher.ts` |
| Concurrent dispatch gate: respects MAX_CONCURRENT | No over-dispatch | `server/dispatcher.ts` |
| Queued tickets don't auto-start | Queue mode works | `server/dispatcher.ts` |
| PR URL extraction regex handles edge cases | PR detection is reliable | `server/dispatcher.ts` |
| Failure classification maps exit codes correctly | Structured errors are accurate | `server/dispatcher.ts` |
| Automation iteration cap stops at 5 | No infinite retry loops | `server/dispatcher.ts` |

**Note**: To make these testable, extract the pure logic (limit detection, URL regex, failure classification, concurrency gate check) into standalone functions. This is a small, safe refactor — pull functions out, don't restructure.

### Tier 3: Audit Report Parsing (~5 tests, ~30min)
**Why**: Parsing agent output is fragile; structured reports are downstream of unstructured text.

| Test | What it covers | File |
|------|---------------|------|
| Extracts JSON from markdown fences | Basic parsing works | `server/audit-report-parser.ts` |
| Handles missing/malformed JSON gracefully | No crash on bad output | `server/audit-report-parser.ts` |
| Finding ID generation is deterministic | Same input → same fingerprint | `server/audit-report-parser.ts` |
| Severity counts are correct | Critical/high/medium/low tally | `server/audit-report-parser.ts` |
| Trend direction computed correctly | Improving/stable/declining | `server/audit-trend.ts` |

### What This Doesn't Cover (And That's OK)

- **React components** — visual bugs are caught by using the app. Component tests for a fast-moving UI are more maintenance than value.
- **WebSocket message flow** — would require a test server. The `useWebSocket` hook is simple enough that TypeScript catches most issues.
- **Process spawning / git worktrees** — integration-level, impractical to mock meaningfully.
- **GitHub CLI calls** — external dependency, test manually.

### When to Add More Tests

- **Before refactoring the dispatcher** — pin current behavior first
- **When a bug recurs** — write a regression test for the specific case
- **If adding a new parsing format** — audit report parser is the right place for TDD

### Estimated Effort

| Tier | Tests | Time | Priority |
|------|-------|------|----------|
| 1. Store & data | ~10 | ~1h | Add with Phase 2 bug fixes |
| 2. Dispatcher logic | ~8 | ~1h | Add with Phase 2 bug fixes |
| 3. Audit parsing | ~5 | ~30min | Add with Phase 4 |
| **Total** | **~23** | **~2.5h** | |

Slot this into the plan of attack as **Phase 2.5** — write tests alongside the critical bug fixes so the fixes are immediately pinned.

---

## Stage 6: Report Summary

### Current State
Agent Kanban is a feature-rich, functional system with **38+ distinct features** across 9 major subsystems. It has been built rapidly (50+ PRs merged in 2 days) which has led to:
- 3 duplicate PRs that need closing
- 2 PRs with changes requested (PR body formatting only)
- 5 PRs awaiting review
- 3 critical server-side bugs (race conditions, Promise handling)
- 4 high-severity issues (security, state management)
- 6 medium-severity issues (reliability, resource management)
- Significant documentation drift (40% of dispatcher features undocumented)

### Top 3 Risks Right Now
1. **Dispatcher tick overlap** — concurrent ticks could cause duplicate agent dispatches
2. **Stream Promise overwrite** — ticket state could be lost on rapid output
3. **Duplicate PR dispatching** — system creates PRs for already-merged work

### The Good News
- Core architecture is sound (file watchers, WebSocket, atomic storage)
- Audit system is well-built and accurately documented
- Agent observability is thorough and complete
- No data loss bugs found in the storage layer
- The codebase is TypeScript throughout with reasonable type safety

---

## Appendix: Implementation Status (updated 2026-03-02)

### Completed

| Phase | Task | Commit |
|-------|------|--------|
| 1.1 | Close duplicate PRs #100, #105, #90 | (GitHub) |
| 1.2 | Merge safe Dependabot PRs #74, #75, #76, #82 | (GitHub) |
| 1.3 | Fix scheduler.md polling interval | `9578caa` |
| 1.4 | Remove dead code (duplicate length check) | `52ac7f4` |
| 2.1 | Fix dispatcher tick overlap (concurrency guard) | `29fa25c` |
| 2.2 | Fix stream Promise chain (chain vs overwrite) | `df58633` |
| 2.3 | Fix shutdown race (shuttingDown flag) | `21dd359` |
| 2.4 | Health check flag — already correct (false alarm) | — |
| 3.1 | execFileSync for ticket-derived git args | `e973cde` |
| 3.2 | Validate stream event type before processing | `0ca711c` |
| 4.1 | Add response.ok checks to client fetch calls | `849fd7d` |
| 4.2 | Fix unawaited Promise chain (tool approval) | `3810aef` |
| 4.3 | Cap stream lineBuffer to 1 MB | `de09281` |
| 4.4 | Clean up watcher debounce timers on close | `c00779d` |
| 4.5 | Effort NaN propagation — verified safe (false alarm) | — |
| 5.1 | Document on_hold + usage limits (new arch doc) | `535ab3f` |
| 5.2 | Document dispatch modes in workflow.md | `535ab3f` |
| 5.3 | Update ticket lifecycle in workflow.md | `535ab3f` |
| 5.4 | Document failure reasons + session resumption | `88adedd` |

### Remaining Work

| Phase | Task | Notes |
|-------|------|-------|
| 2.5 | Add vitest + ~23 unit tests | Store, dispatcher logic, audit parser |
| 3.3 | Review/merge PR #84 (chat security guardrails) | Needs conflict resolution first |
| 6.1 | Fix PR #104 body (checklist items) | Trivial PR body edit |
| 6.2 | Fix PR #94 body + resolve conflicts | PR body + rebase |
| 6.3 | Resolve conflicts on PR #88 | Small cleanup PR |
| 6.4 | Review PR #99 (accessibility tooltips) | Needs template-compliant PR body |
| 6.5 | Investigate PR #77 (express bump CI failure) | Check breaking changes |
| 6.6 | Verify PR #65 feature coverage | Check if changes_requested→in_progress exists |
| 7.1 | WebSocket state versioning / resync on reconnect | Architectural improvement |
| 7.2 | Persist auto-merge backoff state | Minor reliability improvement |
| 7.3 | Standardize log formatting | Cosmetic |
| 7.4 | Investigate dispatcher dedup logic | Prevent re-dispatch of merged tickets |

### Touch-ups Identified During Implementation

1. **Pre-existing lint warnings (12)**: Unused imports in Sidebar, TeamHeader, TicketCard, TicketDetailModal, AnalyticsDashboard, audit-scheduler, index.ts. Not introduced by these changes but worth cleaning up.
2. **Remaining `execSync` calls in dispatcher.ts**: ~10 calls using `execSync` for `gh` CLI commands. These use controlled arguments (PR numbers, ticket IDs) and are lower risk, but could be converted to `execFileSync` for consistency.
3. **`execSync('git fetch origin')` in other server files**: Check if solo-agents.ts or other files have similar patterns.
4. **WebSocket reconnect state gap**: The `initial` event on reconnect sends full state, but there's no guarantee the client processes it atomically — rapid reconnect/disconnect cycles could leave partial state. Phase 7.1 addresses this more fully.
