# Workflow Rules for Agents

## Core Rules

- **Always raise a PR** — never push directly to main.
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

## Ticket Lifecycle

Tickets flow: `todo` → `in_progress` → `in_review` → `done` / `merged` / `failed` / `error`

See [Dispatcher Architecture](../architecture/dispatcher.md) for details on worktree creation, agent spawning, and PR detection.

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
