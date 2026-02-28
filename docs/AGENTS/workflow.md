# Workflow Rules for Agents

## Core Rules

- **Always raise a PR** — never push directly to main.
- **File a ticket** — before starting work, ask the user if we should file a ticket on the kanban (`POST /api/tickets`). This keeps all work tracked and visible.

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
