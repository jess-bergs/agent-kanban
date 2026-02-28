# Agents

See [CLAUDE.md](./CLAUDE.md) for project conventions, architecture, and development instructions.

## Security

Before working on server-side code, read [SECURITY.md](./SECURITY.md) for:
- Threat model and known risks
- Shell command safety guidelines (prefer `execFileSync`/`spawn` with argument arrays)
- Route parameter validation requirements
- Checklist for agents touching the API or dispatcher

## Architecture Documentation

When adding a significant new feature or subsystem, add an architecture doc to
`docs/architecture/`. This should cover:
- High-level overview and where it fits in the system
- Data model (types, persistence)
- Execution flow (sequence/data flow diagrams welcome)
- Concurrency and lifecycle considerations
- File layout

Existing architecture docs:
- [Audit Scheduler](./docs/architecture/scheduler.md) — recurring codebase audits

Include a link to the new architecture doc in your PR description.
