# PR Lifecycle Architecture

## Overview

Once an agent creates a PR, the dispatcher manages its lifecycle through status polling,
auto-merge, conflict detection, screenshot capture, and ticket ID injection. This document
covers the post-creation PR pipeline.

```
Agent creates PR
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Screenshot  │────►│   Worktree   │────►│   Auditor    │
│  Capture     │     │   Cleanup    │     │   Review     │
└──────────────┘     └──────────────┘     └──────────────┘
       │
       ▼
  Ticket → in_review
       │
       ├── dispatcherTick (3s) ──► checkPrStatus()
       │                          checkAutoMerge()
       │
       └── conflictCheckTick (1h) ──► checkPrConflicts()
```

**Source**: `server/dispatcher.ts`, `server/screenshots.ts`

## PR Status Polling

Every 3 seconds, `dispatcherTick()` calls `checkPrStatus()` for each `in_review` ticket.

`checkPrStatus()` runs:
```
gh pr view {prUrl} --json state,mergeable
```

| PR State | Ticket Action |
|----------|--------------|
| `MERGED` | Status → `merged`, set `completedAt` |
| `CLOSED` | Status → `done`, set `completedAt` |
| mergeable = `CONFLICTING` | Set `hasConflict: true`, `conflictDetectedAt` |
| mergeable ≠ `CONFLICTING` | Clear `hasConflict`, clear `conflictDetectedAt` |

This means conflict detection effectively runs every 3 seconds for all in-review PRs,
in addition to the dedicated hourly scan.

### Manual Refresh

`POST /api/tickets/:id/refresh-status` calls `checkPrStatus()` on demand.

## Auto-Merge

For tickets with `autoMerge: true`, `checkAutoMerge()` runs each tick. It evaluates four
conditions via `gh pr view --json state,mergeable,reviewDecision,statusCheckRollup`:

```
All conditions must pass:
  ✓ state is not MERGED or CLOSED
  ✓ reviewDecision is not CHANGES_REQUESTED or REVIEW_REQUIRED
  ✓ all status checks are SUCCESS (or no checks exist)
  ✓ mergeable === 'MERGEABLE'
```

Merge command (30s timeout):
```
gh pr merge "{prUrl}" --squash --delete-branch
```

On success, ticket moves to `merged`. On failure, the error is logged but the ticket
stays `in_review` for the next tick to retry.

## Conflict Detection

Two overlapping mechanisms detect merge conflicts:

| Mechanism | Interval | Scope |
|-----------|----------|-------|
| `checkPrStatus()` | 3s (via dispatcherTick) | Per in-review ticket with prUrl |
| `conflictCheckTick()` | 1 hour | All in-review tickets with prUrl |

Both update the same ticket fields:

```ts
hasConflict: boolean        // Whether PR currently has merge conflicts
conflictDetectedAt: number  // Timestamp when conflict was first detected
```

The conflict flag is cleared automatically when the PR becomes mergeable again.

**Manual trigger**: `POST /api/tickets/check-conflicts` invokes `conflictCheckTick()` on demand.

**Note**: There is no auto-rebase. Conflicts are detected and surfaced in the UI (pulsing
red badge on cards, conflict banner in detail modal) but must be resolved manually.

## Screenshot Capture

After a successful run produces a PR URL and a worktree exists, `captureAndUploadScreenshots()`
runs **before** worktree cleanup (Playwright needs the worktree's files).

**Source**: `server/screenshots.ts`

Pipeline:
1. Symlink `node_modules` from main repo into worktree if missing
2. Start the dev server (`npm run dev`) in the worktree, wait up to 30s for `http://localhost:5174`
3. Generate a Playwright script (`_capture.mjs`) that navigates to `/` at 1440×900 viewport
4. Capture screenshot to `{worktreePath}/screenshots/`
5. Commit and push the screenshot to the branch
6. Update PR body with `## Screenshots` section containing GitHub CDN image links
7. If PR body update fails, fall back to posting a PR comment

**Timeout**: 60 seconds total (`SCREENSHOT_TIMEOUT_MS`).
**Best-effort**: Failures don't block the ticket or worktree cleanup.

## Ticket ID Injection

`ensureTicketIdInPr()` idempotently adds a machine-readable HTML comment to the PR body:

```html
<!-- ticket-id:{ticketId} -->
```

This enables `extractTicketIdFromPr()` to find the originating ticket from a PR URL.
The injection runs immediately after PR detection, before screenshots.
