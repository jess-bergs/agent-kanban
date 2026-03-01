# PR Auditor Architecture

## Overview

The auditor is a local PR review agent that replaces GitHub Actions-based code review
workflows. It maintains a watchlist of PRs, spawns Claude Code agents to review them
against a structured rubric, and posts review comments directly on the PR.

It was introduced to avoid GHA costs and cold-start latency, and to give the review
agent access to local project context (AGENTS.md, CLAUDE.md, PR templates).

**Source**: `server/auditor.ts`

## Watchlist Model

The auditor is **watchlist-driven** — it only reviews PRs that are explicitly added.

```
  addToWatchlist(prUrl, ticketId?)
         │
         ▼
  ┌─────────────────┐
  │  Watchlist Entry │
  │  ───────────────  │
  │  prUrl           │
  │  ticketId?       │
  │  status: active  │
  │  lastReviewedAt  │
  │  reviewCount     │
  └────────┬────────┘
           │
           ▼
  reviewPr(entry)  ──►  Post review comment on PR
           │
           │  (30s poll loop)
           ▼
  checkWatchlist()
    ├── PR merged/closed? → remove from watchlist
    ├── Re-review comment? → reviewPr(entry) again
    └── Otherwise → skip
```

**Repo allowlist**: Only PRs from repos that have a registered project in Agent Kanban can be
watched. This prevents the auditor from being pointed at arbitrary repositories.

**Data**: Watchlist state is persisted to `data/auditor-watchlist.json`.

### Entry Lifecycle

PRs are added to the watchlist via:
- **Automatic**: When a dispatcher agent creates a PR, `runAudit(ticket)` adds it
- **Manual**: `POST /api/auditor/watch { prUrl, ticketId? }`
- **Ticket action**: `POST /api/tickets/:id/audit`

PRs are removed from the watchlist when:
- **Auto-resolution**: The 30s poll detects the PR is merged or closed
- **Manual**: `POST /api/auditor/unwatch { prUrl }`

## Review Process

The auditor spawns a Claude Code agent for each review:

```
claude -p "{rubric-prompt}" --output-format stream-json --verbose
       --dangerously-skip-permissions
```

The agent always runs in YOLO mode (reviews are read-only analysis).

### Context Loading

Before spawning, the auditor reads project-level context files from the repo:
- `AGENTS.md`
- `CLAUDE.md`
- `.github/pull_request_template.md` — parsed into compact requirements (see below)

These are injected into the review prompt so the agent can check convention compliance.

### PR Template Parsing

The raw PR template is **not** passed verbatim into the review prompt. Instead, the auditor
parses it into a `TemplateRequirements` object that extracts:
- **Required text sections**: Headings like "Description" and "Changes" that must have content
- **Checkbox sections**: Each group with its items and a rule (`all` = every box checked, `any` = at least one)
- **Compact summary**: A one-line spec string used in the prompt

The parsed result is cached per repo path with a content hash. Every poll tick calls
`refreshTemplateCache()`, which re-reads the file and re-parses only if the hash changed.
This keeps the review prompt focused and ensures the auditor always uses the latest template.

### Rubric

Each review evaluates 6 aspects:

| Aspect | What It Checks |
|--------|---------------|
| **Completeness** | Does the PR fully address the ticket/issue? |
| **Code Quality** | Clean code, no dead code, consistent patterns |
| **Test Coverage** | Are changes adequately tested? |
| **Security** | No secrets, injection vulnerabilities, or unsafe patterns |
| **Project Conventions** | Follows AGENTS.md/CLAUDE.md guidelines |
| **PR Checklist** | PR template requirements satisfied |

Each aspect receives a rating: `pass`, `concern`, or `fail`, with notes.

**Rating strictness**: `concern` is reserved for minor cosmetic/style issues that don't affect correctness. Anything that could cause bugs, leaves docs stale, skips PR template requirements, or misses edge cases is rated `fail`. One `fail` = `request_changes` verdict.

### Verdict Parsing

The agent is prompted to output a structured JSON block in its response:

```json
{
  "verdict": "approve" | "request_changes" | "comment",
  "aspects": [ { "name": "...", "rating": "...", "notes": "..." } ],
  "summary": "..."
}
```

The auditor extracts this from a ` ```json ` fenced block in the output, then formats
it as a structured markdown review comment posted via `gh pr comment`.

## Polling

The auditor polls active watchlist entries every **30 seconds** (`POLL_INTERVAL_MS`).

Each poll checks:
1. **Merge/close status**: `gh pr view --json state` → if merged/closed, remove from watchlist
2. **Re-review triggers**: `gh pr view --json comments` → scan for trigger keywords

### Re-Review Triggers

A new review is triggered when a PR comment contains any of these keywords:
- `@auditor`
- `re-review`
- `rereview`
- `please review`
- `audit again`

Only comments posted after `lastReviewedAt` are considered. This prevents re-reviewing
on every poll cycle.

**Manual trigger**: `POST /api/auditor/re-review { prUrl }`

## Ticket Integration

When triggered via the dispatcher pipeline, the auditor updates the ticket:
- `auditStatus: 'pending'` → `'running'` → `'done'` | `'error'`
- `auditResult`: stores the formatted review text

## API Surface

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auditor/watchlist` | GET | List active watchlist entries |
| `/api/auditor/watch` | POST | Add PR to watchlist |
| `/api/auditor/unwatch` | POST | Remove PR from watchlist |
| `/api/auditor/re-review` | POST | Manually trigger re-review |
| `/api/tickets/:id/audit` | POST | Trigger audit for a ticket |

## File Layout

```
server/
  auditor.ts                    # Watchlist, review spawning, polling, comment posting
data/
  auditor-watchlist.json        # Persisted watchlist state
```
