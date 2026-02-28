# Security Architecture

## Threat Model

Agent Kanban is a **local development tool** — the server runs on `localhost` and is not intended for public exposure. The primary attack surface is:

- **Untrusted data flowing into shell commands** — ticket fields (subject, instructions) and project fields (repo path, branch name) are interpolated into shell calls in `dispatcher.ts` and `screenshots.ts`.
- **Path traversal via IDs** — ticket and project IDs are used to construct file paths in `store.ts` (e.g., `join(TICKETS_DIR, id + ".json")`). A crafted ID could escape the data directory.
- **Open PATCH endpoint** — `PATCH /api/tickets/:id` accepts arbitrary fields in `req.body` and merges them into the ticket with no allowlist, so an attacker on the local network could overwrite internal fields like `agentPid`, `prUrl`, or `status`.

## Mitigations in Place

### ID Validation (server/index.ts)

All `:id` route parameters are validated against a UUID format regex before reaching any store or dispatcher logic. This prevents path traversal and injection through IDs.

### Shell Argument Handling (server/dispatcher.ts)

- Branch names are derived from `ticket.id` (a validated UUID) plus a slugified subject (`slugify()` strips all non-alphanumeric characters).
- The `claude` CLI is invoked via `spawn()` with an args array, which avoids shell interpretation of the prompt content.
- String-interpolated shell calls that use branch names or paths are wrapped in double quotes, though this is not a complete defense — prefer `execFileSync` with argument arrays for stronger guarantees.

## Known Risks & Areas for Improvement

### 1. Shell calls with string interpolation

Multiple calls in `dispatcher.ts` and `screenshots.ts` build command strings via template literals. While current inputs are sanitized upstream (slugified branch names, UUID-based paths), this pattern is fragile. Prefer `spawn()` or `execFileSync()` with argument arrays — these are safe by construction since arguments bypass the shell.

### 2. Unvalidated PATCH body

`PATCH /api/tickets/:id` passes `req.body` directly to `updateTicket()` with no field allowlist. This means any JSON field can be written to the ticket, including internal fields like `agentPid`, `worktreePath`, or `status`. While this is acceptable for a local dev tool, new endpoints should validate and allowlist update fields.

### 3. No authentication

There is no auth on the API. This is by design (local tool), but endpoints should not expose sensitive data (environment variables, API keys, file contents outside the project) without considering this.

### 4. Screenshots and file operations

`screenshots.ts` uses `execFileSync` for most operations (good), but runs `npm run dev` via `spawn` with `shell: true`. Avoid introducing new `shell: true` usage.
