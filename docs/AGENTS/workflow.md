# Workflow Rules for Agents

## Core Rules

- **Raise a PR when appropriate** — never push directly to main. If the task doesn't warrant a PR (e.g., pure research, trivial config, no meaningful code changes), the agent may skip PR creation and the ticket will be marked done directly.
- **File a ticket** — before starting work, ask the user if we should file a ticket on the kanban (`POST /api/tickets`). This keeps all work tracked and visible.
- **Investigate before coding** — thoroughly understand the relevant codebase before making changes. See [Investigation-First Approach](#investigation-first-approach) below.

## Investigation-First Approach

Before writing any code, agents must investigate the codebase to understand context, conventions, and scope. Skipping this leads to incomplete fixes, missed edge cases, and inconsistent patterns.

### Required Steps

1. **Read project docs** — Start with CLAUDE.md, AGENTS.md, and any referenced documentation. Understand project conventions, architecture, and build commands.
2. **Trace existing code** — Find and read all files related to the feature or bug. Follow imports, check call sites, and understand how data flows through the system. Don't stop at the first file you find — follow the chain.
3. **Identify the full scope** — Map out every file that will need changes. Check for related types, tests, documentation, and downstream consumers that may be affected.
4. **Check for prior art** — Search for similar patterns already in the codebase. Reuse existing utilities, match naming conventions, and follow established architectural patterns rather than inventing new ones.
5. **Plan the approach** — After understanding the full picture, decide on your approach. For non-trivial changes, outline what you will do before writing code.

### Common Investigation Mistakes

- Reading only one file instead of tracing the full call chain
- Ignoring shared types in `src/types.ts` that may need updating
- Missing convention docs that explain *why* something is done a certain way
- Skipping the search for existing utilities that already solve part of the problem
- Not checking whether similar features exist and should be extended rather than duplicated

## PR Template Compliance

When creating a PR, agents **must** use the repo's PR template at `.github/pull_request_template.md`. The dispatcher injects explicit instructions for this into every agent's task prompt.

**Key rules:**
- Do NOT use `gh pr create --fill` — it ignores the template entirely.
- Read the template file, fill in every section (Description, Changes, Type of Change, Testing, Checklist), and pass it as the PR body via `--body`.
- Mark applicable checkboxes with `[x]`.
- The PR auditor will flag non-compliant PRs and request changes.

## Ticket Lifecycle

```
todo → in_progress → in_review → done / merged
                 ↓         ↓
          needs_approval    failed / error
                 ↓
          on_hold (usage limit → auto-resume)
```

**Key statuses:**
- `needs_approval` — agent is waiting for user input (interactive tool like AskUserQuestion or EnterPlanMode)
- `on_hold` — agent hit an API usage/rate limit; auto-resumes after the limit resets (see [Usage Limits](../architecture/usage-limits-and-holds.md))
- `failed` / `error` — agent crashed or exhausted its retry budget

**Dispatch modes:**
- **Queued** — ticket waits for manual dispatch (only runs when no other agents are active)
- **Plan-only** — agent generates a plan summary without full implementation; result stored in `planSummary`
- **Team** — dispatches a multi-agent team instead of a solo agent
- **YOLO** — agent runs without interactive tool confirmations
- **Ralph** — uses an alternative model

See [Dispatcher Architecture](../architecture/dispatcher.md) for worktree creation, agent spawning, PR detection, and [Usage Limits](../architecture/usage-limits-and-holds.md) for hold behavior.

## Self-Healing & Retry Safety

The dispatcher runs a continuous health check (every 30s) that detects and recovers from three failure modes:

1. **Orphan PID detection** — If an agent process dies (server restart, crash) while a ticket is `in_progress`, the health check detects the dead PID and auto-retries up to `MAX_AUTO_RETRIES` (3). Each retry has a 30-second cooldown (`RETRY_WAIT_MS`) before the ticket is eligible for re-dispatch. Tickets exceeding the retry budget are marked `failed` with `needsAttention: true`.

2. **Stuck audit detection** — If `auditStatus` stays `running` for >10 minutes, the health check resets it and re-triggers the audit. Also resets stuck watchlist entries.

3. **No-PR in-review** — If a ticket is `in_review` without a `prUrl` for >5 minutes, it's marked `failed` (agent exited before creating a PR).

All interventions are logged to `data/health-check-log.jsonl`.

### PR State Reconciliation

Before retrying any ticket (health check, startup recovery, or manual retry button), the system checks if the ticket's PR has already been merged or closed on GitHub via `checkAndReconcilePrState()`. This prevents:

- Blindly resetting a ticket whose PR is already merged (wasting an agent run)
- Re-dispatching work that's already complete after a server restart

If the PR is `MERGED`, the ticket is moved to `merged` status. If `CLOSED`, it's marked `failed`. Only if the PR is still `OPEN` (or no PR exists) does the retry proceed normally.

## Post-PR Pipeline

After a PR is created:
1. Screenshot capture → uploaded to PR body
2. Worktree cleanup
3. PR auditor reviews against a structured rubric

See [PR Lifecycle](../architecture/pr-lifecycle.md) for the full post-creation pipeline (auto-merge, conflict detection, screenshots).

## PR Auditor

PRs are reviewed by a local Claude Code agent, not GitHub Actions. The auditor evaluates completeness, code quality, test coverage, security, conventions, and PR checklist adherence.

Trigger a re-review by commenting `@auditor`, `re-review`, or `please review` on the PR.

See [Auditor Architecture](../architecture/auditor.md) for watchlist model, rubric, and API endpoints.

## Scheduled Audits

Recurring codebase audits (security, dependency, architecture reviews) run on configurable cadences. Six built-in templates are available.

See [Scheduler Architecture](../architecture/scheduler.md) for execution modes, cadence, and API endpoints.
