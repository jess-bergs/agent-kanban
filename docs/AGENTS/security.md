# Security Checklist for Agents

For the full threat model, mitigations, and known risks, see [Security Architecture](../architecture/security.md).

## Before You Start

Read the [Security Architecture](../architecture/security.md) doc if you're touching server-side code, especially `dispatcher.ts`, `screenshots.ts`, or `server/index.ts`.

## Checklist

When working on tickets that touch the server:

- [ ] **Never interpolate untrusted input into shell command strings** — use `execFileSync()` or `spawn()` with args arrays
- [ ] **Validate route parameters** — ensure `:id` params match expected formats before using them
- [ ] **Allowlist update fields** on PATCH/PUT endpoints when possible
- [ ] **Don't expose sensitive data** — no env vars, API keys, or arbitrary file reads through the API
- [ ] **Sanitize data before shell use** — if a user-provided string must go to a shell, strip or escape metacharacters
- [ ] **Prefer `execFileSync` over string-interpolated commands** — argument arrays prevent injection by construction
