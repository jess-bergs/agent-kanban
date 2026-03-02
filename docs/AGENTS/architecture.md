# Architecture Documentation Guide

When adding a significant new feature or subsystem, add an architecture doc to
`docs/architecture/`. It should cover:

- High-level overview and where it fits in the system
- Data model (types, persistence)
- Execution flow (sequence/data flow diagrams welcome)
- Concurrency and lifecycle considerations
- File layout

Include a link to the new doc in your PR description and in the index below.

## Existing Docs

- [Security](../architecture/security.md) — threat model, shell safety, known risks
- [Dispatcher](../architecture/dispatcher.md) — ticket dispatcher and worktree lifecycle
- [Auditor](../architecture/auditor.md) — local PR auditor and watchlist
- [Scheduler](../architecture/scheduler.md) — recurring codebase audits
- [PR Lifecycle](../architecture/pr-lifecycle.md) — PR creation through merge
- [MCP Server](../architecture/mcp-server.md) — MCP protocol integration
- [Agent Observability](../architecture/agent-observability.md) — agent monitoring and effort tracking
- [Usage Limits & Holds](../architecture/usage-limits-and-holds.md) — rate limit detection, on_hold status, auto-resume
