# Future Development Opportunities
<!-- Last reviewed: 2026-02-28 -->

## Data Storage
- **S3-backed storage**: Migrate ticket/project JSON from local `data/` directory to S3 for durability, multi-device access, and backup. Could use versioned buckets for automatic history.
- Currently using git-tracked `data/` as interim backup strategy.

## Audit System
- **Automatic action on report results**: When a report audit surfaces critical/high findings, automatically create fix-mode tickets to address them. Could use configurable thresholds (e.g. auto-ticket anything scoring below 4/10, or any finding with severity >= high).
- **Audit dashboard UI**: Add a dedicated view in the kanban dashboard for audit schedules and reports — schedule list with status/cadence, run history with score trends over time, per-run report viewer with rubric scores and findings, and trend charts showing improvement/decline per template.

## Ticket Schema Validation
- **Two layers**: (1) A scheduled audit that scans all non-completed tickets (not `merged`/`done`/`closed`) against the current schema, flagging missing or malformed fields for retrofitting. (2) A runtime guard in `safeReadJson` (`server/store.ts`) using Zod or manual checks, so malformed tickets are caught on read with logged warnings and optional auto-repair of missing fields with defaults. The audit catches drift periodically; the store-level guard catches corruption at the source.

## Known Improvements
- **Conflict-aware auto-merge**: Detect and auto-resolve simple merge conflicts in agent PRs. Ticket `2ab12413` implements the first pass: rebase-before-push in agent prompts + auto-update conflicting PR branches via GitHub API. Future layers include per-project concurrency limits and sequential queue gating.
- **Agent retry with context**: When retrying failed tickets, pass previous attempt's output as context so the agent doesn't start from scratch.



---
problems on server restart: agents fail and tickts move to failed section. can we EITHER make the process more robust so that agents don't fail but at the and at the same time we do not risk dangling processes or anything. And then the next idea would be that we have another process so that tickets auto heal if possible otherwise they are flagged to me. 


--- 
flag bugs or improvements via voice/external messaging
will reuquire this service to be deployed ...

---

automatically address comments, audit reports and merge conflicts. make sure branch is kept up to date