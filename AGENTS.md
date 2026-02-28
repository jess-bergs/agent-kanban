# Agents

See [CLAUDE.md](./CLAUDE.md) for project conventions, architecture, and development instructions.

## Security

Before working on server-side code, read [SECURITY.md](./SECURITY.md) for:
- Threat model and known risks
- Shell command safety guidelines (prefer `execFileSync`/`spawn` with argument arrays)
- Route parameter validation requirements
- Checklist for agents touching the API or dispatcher
