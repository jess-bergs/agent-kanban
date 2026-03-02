# Plan Report: Optimizing Context Management for Agents

## Summary

Agent Kanban dispatches Claude Code agents into git worktrees with a 50-turn budget. These agents currently spend 3-7 turns navigating a multi-hop documentation chain (CLAUDE.md → AGENTS.md → docs/AGENTS/\* → docs/architecture/\*) before they can write a single line of code. The total documentation surface is ~1,157 lines (~12K tokens) spread across 14 Markdown files with significant redundancy, a 2-4 hop navigation chain, and no comprehensive file index. This report evaluates strategies from industry best practices — including skills-style file headers, table-of-contents indexes, progressive disclosure, and CLAUDE.md restructuring — and proposes a concrete optimization plan that reduces agent investigation turns from 5-7 to 1-2 while keeping documentation maintainable.

---

## Relevant Files

### Documentation Files (14 total, ~12K tokens)

| File | Lines | Tokens | Role |
|------|-------|--------|------|
| `CLAUDE.md` | 34 | ~350 | Project overview, Quick Start, links to AGENTS.md |
| `AGENTS.md` | 10 | ~120 | Index page linking to 4 docs in `docs/AGENTS/` |
| `docs/AGENTS/conventions.md` | 46 | ~480 | Build commands, project structure, coding standards |
| `docs/AGENTS/workflow.md` | 87 | ~1,300 | PR rules, ticket lifecycle, investigation approach |
| `docs/AGENTS/security.md` | 18 | ~260 | Security checklist for server code |
| `docs/AGENTS/architecture.md` | 22 | ~260 | How to add architecture docs, index of existing docs |
| `docs/architecture/dispatcher.md` | 189 | ~2,060 | Dispatcher internals |
| `docs/architecture/auditor.md` | 168 | ~1,490 | PR auditor internals |
| `docs/architecture/scheduler.md` | 136 | ~1,300 | Audit scheduler internals |
| `docs/architecture/pr-lifecycle.md` | 124 | ~1,120 | Post-PR pipeline |
| `docs/architecture/mcp-server.md` | 108 | ~930 | MCP protocol integration |
| `docs/architecture/agent-observability.md` | 146 | ~1,390 | Activity tracking, effort metrics |
| `docs/architecture/security.md` | 39 | ~710 | Threat model, shell safety |
| `docs/futureDevelopmentOpportunities.md` | 30 | ~630 | Future work notes |

### Source Files (key context consumers)

| File | Lines | Role |
|------|-------|------|
| `server/dispatcher.ts` | 1,820 | Core agent lifecycle — **builds the prompt injected into agents** |
| `server/auditor.ts` | 793 | PR review agent — reads AGENTS.md/CLAUDE.md for review context |
| `server/index.ts` | 1,197 | Express server, REST API, WebSocket |
| `server/store.ts` | 313 | JSON file persistence |
| `server/mcp.ts` | 421 | MCP server |
| `server/audit-scheduler.ts` | 446 | Scheduled audit system |
| `server/screenshots.ts` | 330 | Playwright screenshot pipeline |
| `server/solo-agents.ts` | 289 | Standalone Claude session detection |
| `server/analytics.ts` | 447 | Analytics endpoints |
| `src/types.ts` | 501 | Shared TypeScript types |

---

## Current Architecture

### How Agents Get Context Today

#### 1. Dispatcher-Injected Context (automatic)

When `dispatcher.ts:startAgent()` builds the agent prompt (lines 545-680), it injects:

- **Ticket instructions** — the user's task description
- **Budget warning** — "You have a strict budget of 50 turns"
- **Phase guidance** — "Read CLAUDE.md/AGENTS.md for conventions"
- **Worktree/branch info** — branch name, repo URL
- **PR template instructions** — how to create a compliant PR
- **Team mode instructions** — if applicable

Critically, agents are told *to read* CLAUDE.md and AGENTS.md but given **no map of what's in the codebase or which files implement which features**.

#### 2. Self-Discovered Context (agent must navigate)

Agents must follow this multi-hop link chain:

```
Turn 1: Read CLAUDE.md (34 lines)
  → "See AGENTS.md for all agent guidance"

Turn 2: Read AGENTS.md (10 lines)
  → Links to 4 docs in docs/AGENTS/

Turn 3: Read docs/AGENTS/conventions.md (46 lines)
  → Project structure overview (covers ~10 of 40+ files)

Turn 4: Read docs/AGENTS/workflow.md (87 lines)
  → Investigation approach, PR rules

Turn 5: Read docs/AGENTS/architecture.md (22 lines)
  → Links to 7 docs in docs/architecture/

Turns 6-7: Read specific architecture doc(s)
  → Detailed subsystem documentation
```

**Result**: 5-7 turns spent navigating documentation before agents can start coding. With a 50-turn budget, that's 10-14% consumed by navigation alone.

#### 3. Auditor Context Loading

The auditor (`auditor.ts:reviewPr()`, line 497-499) reads `AGENTS.md` and `CLAUDE.md` from the repo and injects them verbatim into the review prompt. This is ~470 tokens of conventions context.

### Specific Problems Identified

#### Problem 1: Redundant Content (~350 wasted tokens)

The Quick Start section (npm commands, port numbers) is duplicated verbatim between `CLAUDE.md` (lines 5-14) and `docs/AGENTS/conventions.md` (lines 3-13). Every agent reads both files, wasting ~350 tokens on duplicate content.

#### Problem 2: Sparse File Index

`docs/AGENTS/conventions.md` has a "Project Structure" section listing ~10 entries, but the codebase has 40+ TypeScript source files and 20+ components. Agents must `grep`/`glob` to discover what files exist and what they do.

#### Problem 3: No File-Level Headers

Only 2 of 42+ TypeScript files have file-level documentation:
- `server/nvm.ts` — 10-line JSDoc explaining strategy
- `server/screenshots.ts` — 10-line JSDoc listing pipeline steps

The remaining 40+ files start immediately with `import` statements. When an agent reads a file, it gets no quick summary of what the module does or how it fits the system.

#### Problem 4: Deep Link Chain

AGENTS.md is a pure index page (10 lines) with 4 links. Each linked doc may link further. This forces serial reading — agents can't parallelize navigation because each step reveals the next.

#### Problem 5: Architecture Docs Are Siloed

Each architecture doc is self-contained and excellent, but an agent working on a cross-cutting feature (e.g., "add a new ticket field") has no single document that says "ticket fields are defined in `src/types.ts`, persisted in `server/store.ts`, rendered in `src/components/TicketCard.tsx` and `TicketDetailModal.tsx`, and exposed via `server/index.ts` REST API and `server/mcp.ts` MCP tools."

---

## Proposed Approach

### Strategy: Flat-and-Rich CLAUDE.md + File Headers

Based on research into best practices ([HumanLayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md), [GitHub Blog](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/), [Anthropic subagents docs](https://code.claude.com/docs/en/sub-agents)), the recommended approach combines:

1. **Enriched CLAUDE.md** — A single file an agent reads first that gives enough context to start working without chasing links
2. **Comprehensive file index** — Every source file and its purpose, in one place
3. **File-level JSDoc headers** — Standardized module descriptions in each `.ts` file
4. **Slimmed AGENTS.md** — Focused on agent-specific rules, not duplicating CLAUDE.md
5. **Progressive disclosure** — Architecture docs remain as deep-dives, but agents can find the right one via the index

### Step 1: Restructure CLAUDE.md (~100-150 lines target)

**Current**: 34 lines — project overview, Quick Start, link to AGENTS.md.

**Proposed**: Expand to ~100-150 lines following the WHAT/WHY/HOW framework:

```markdown
# Agent Kanban

[1-2 line description]

## Quick Start
[build commands — single source of truth, remove from conventions.md]

## Architecture at a Glance
[3-4 line description: "Express+React dashboard with 3 autonomous subsystems:
dispatcher (agent lifecycle), auditor (PR review), scheduler (recurring audits).
Shared types in src/types.ts. JSON file persistence in data/."]

## File Index
[Complete file-to-purpose mapping — see Step 2]

## Agent Documentation
See AGENTS.md for: workflow rules, PR guidelines, security checklist.
See docs/architecture/ for deep-dives on: [list with 1-line summaries]
```

**Rationale**: Research shows CLAUDE.md should be under 200 lines (HumanLayer recommends under 300; their own standard is under 60). By including the file index directly, agents get a complete codebase map in a single read. The ~150 line target is well within the effective range.

### Step 2: Add Comprehensive File Index to CLAUDE.md

Add a structured file index that maps every source file to its purpose. This is the "table of contents" the ticket asks about.

**Format** (compact, scannable):

```markdown
## File Index

### Server (`server/`)
| File | Purpose |
|------|---------|
| `index.ts` | Express server, REST API endpoints, WebSocket broadcast |
| `dispatcher.ts` | Agent lifecycle: spawn, monitor, PR detection, auto-merge |
| `auditor.ts` | PR review agent: watchlist, rubric, verdict posting |
| `store.ts` | JSON file persistence for projects and tickets |
| ... | ... |

### Frontend (`src/`)
| File | Purpose |
|------|---------|
| `App.tsx` | Root component, route switching |
| `types.ts` | Shared TypeScript types (used by client AND server) |
| `components/KanbanBoard.tsx` | Main kanban board layout |
| ... | ... |

### Configuration
| File | Purpose |
|------|---------|
| `vite.config.ts` | Vite config with dev proxy |
| `tsconfig.json` | Client TypeScript config |
| ... | ... |
```

**Estimated size**: ~50-60 lines for 42+ files. This replaces the sparse 10-entry list in `conventions.md`.

**Maintenance**: When a new file is added, add a line to the index. This is low-cost and can be checked by the PR auditor.

### Step 3: Add File-Level JSDoc Headers

Standardize a file-level documentation convention. Each `.ts` file gets a brief JSDoc header:

```typescript
/**
 * @file Ticket dispatcher — agent lifecycle management
 *
 * Spawns Claude Code agents in git worktrees, monitors their output via
 * stream-JSON parsing, detects PR creation, and manages the post-PR pipeline
 * (screenshots, audit, auto-merge). Runs a 3s polling loop.
 *
 * Key exports: startDispatcher(), dispatcherTick(), killAgent(), abortAgent()
 */
```

**Guidelines**:
- 3-6 lines maximum
- First line: what the module IS (noun phrase)
- Body: what it DOES (1-2 sentences of behavior)
- Key exports line (optional, for large modules)

**Why this helps agents**: When an agent reads a file to understand it, the header gives immediate context without reading 100+ lines. When grepping for functionality, headers are searchable.

**Estimated effort**: ~30 minutes to add headers to all 42+ files.

### Step 4: Slim Down AGENTS.md

**Current**: 10-line pure index page.

**Proposed**: Expand slightly to include the key workflow rules inline (so agents don't need to follow another link), while keeping architecture docs as separate deep-dives:

```markdown
# Agent Guidance

## Core Rules
- Always raise a PR — never push directly to main
- Read CLAUDE.md first for the file index and architecture overview
- Investigate before coding (see Workflow below)
- Follow the PR template at .github/pull_request_template.md

## Quick Reference
- [Conventions](./docs/AGENTS/conventions.md) — coding standards
- [Workflow](./docs/AGENTS/workflow.md) — investigation approach, ticket lifecycle
- [Security](./docs/AGENTS/security.md) — checklist for server code
- [Architecture Docs](./docs/AGENTS/architecture.md) — deep-dives by subsystem
```

The key insight: agents should be able to get the critical rules from AGENTS.md + CLAUDE.md alone, without needing to read `workflow.md` for basic guidance.

### Step 5: Deduplicate Content

Remove the duplicated Quick Start from `docs/AGENTS/conventions.md` (lines 3-13) since it will be the single source of truth in CLAUDE.md. Conventions.md should focus on coding standards and patterns only.

### Step 6: Update Dispatcher Prompt

Modify `dispatcher.ts:startAgent()` to reference the file index directly:

**Current** (line 601):
```
1. Read CLAUDE.md/AGENTS.md for conventions and architecture.
```

**Proposed**:
```
1. Read CLAUDE.md for the file index, architecture overview, and build commands.
   Then read AGENTS.md for workflow rules. Use parallel reads.
```

This tells agents exactly what they'll find and enables them to read both files in a single turn.

### Step 7: Add Cross-Cutting Feature Maps (Optional Enhancement)

For common cross-cutting operations, add a "Common Patterns" section to CLAUDE.md:

```markdown
## Common Patterns

**Adding a new ticket field**:
  1. Add to `Ticket` interface in `src/types.ts`
  2. Set/update in `server/dispatcher.ts` or relevant subsystem
  3. Expose via REST in `server/index.ts` and MCP in `server/mcp.ts`
  4. Display in `src/components/TicketCard.tsx` and `TicketDetailModal.tsx`

**Adding a new API endpoint**:
  1. Add route in `server/index.ts`
  2. Add MCP tool in `server/mcp.ts`
  3. Add architecture doc if it's a new subsystem
```

This directly addresses Problem 5 (siloed architecture docs) by showing agents the cross-file relationships for the most common task types.

---

## Files to Modify

| File | Change Description |
|------|-------------------|
| `CLAUDE.md` | **Major restructure**: Add Architecture at a Glance, comprehensive File Index, Common Patterns section. Keep Quick Start as single source of truth. ~100-150 lines total. |
| `AGENTS.md` | **Minor expansion**: Inline the 3-4 most critical workflow rules so agents don't need to follow a link for basics. Keep links to detailed docs. |
| `docs/AGENTS/conventions.md` | **Remove duplication**: Delete the Quick Start section (lines 3-13) — now lives only in CLAUDE.md. Keep Key Conventions and Project Structure (or remove Project Structure since File Index supersedes it). |
| `docs/AGENTS/architecture.md` | **No change** — still serves as the deep-dive index. |
| `docs/AGENTS/workflow.md` | **No change** — detailed workflow stays here, AGENTS.md gets a summary. |
| `docs/AGENTS/security.md` | **No change**. |
| `server/dispatcher.ts` | **Update prompt** (lines 601-602): Direct agents to read CLAUDE.md for the file index, suggest parallel reads. |
| `server/*.ts` (all 16 files) | **Add file-level JSDoc headers**: 3-6 line module description per file. |
| `src/types.ts` | **Add file-level JSDoc header**. |
| `src/App.tsx` | **Add file-level JSDoc header**. |
| `src/components/*.tsx` (15 files) | **Add file-level JSDoc headers**. |
| `src/hooks/useWebSocket.ts` | **Add file-level JSDoc header**. |
| `src/lib/ticketCompat.ts` | **Add file-level JSDoc header**. |
| `docs/architecture/*.md` (7 files) | **No change** — deep-dive docs are already well-structured. |

### Files NOT to Modify

- `docs/architecture/*.md` — These are excellent as-is. They serve as deep-dive references that agents read when they need detailed understanding of a subsystem.
- `docs/futureDevelopmentOpportunities.md` — Not agent-facing documentation.
- `server/auditor.ts` context loading (line 497-499) — Already reads AGENTS.md and CLAUDE.md; enriching those files automatically enriches auditor context.

---

## Expected Impact

### Turn Savings

| Phase | Current Turns | Proposed Turns | Savings |
|-------|--------------|----------------|---------|
| Initial context discovery | 5-7 | 1-2 | 3-5 turns |
| Finding relevant source files | 2-3 (grep/glob) | 0-1 (file index) | 1-2 turns |
| Understanding a file's purpose | 1 per file (read 50+ lines) | Instant (header) | 0.5 per file |
| **Total per agent run** | **~10 turns** | **~3 turns** | **~7 turns saved** |

With a 50-turn budget, this reclaims ~14% of the budget for actual implementation work.

### Token Savings

| Metric | Current | Proposed |
|--------|---------|----------|
| Redundant Quick Start reads | ~350 tokens wasted | 0 (deduplicated) |
| CLAUDE.md (auto-loaded) | ~350 tokens | ~600 tokens (richer but single-read) |
| AGENTS.md (agent reads) | ~120 tokens + must follow 4 links | ~250 tokens (key rules inline) |
| Net context for basic understanding | ~2,500 tokens across 5+ reads | ~850 tokens across 2 reads |

### Qualitative Improvements

- **Agents can start coding faster** — file index gives them a map without exploring
- **Cross-cutting tasks become easier** — Common Patterns section shows the multi-file chains
- **New contributors benefit** — file headers serve humans too
- **Auditor gets richer context** — enriched CLAUDE.md is automatically injected into reviews
- **Maintenance is low** — file index is a simple table, headers are one-time work

---

## Risks & Edge Cases

### 1. CLAUDE.md Size Creep

**Risk**: A 150-line CLAUDE.md is within best practices (HumanLayer recommends <300 lines) but could grow over time.

**Mitigation**: Add a comment at the top: `<!-- Target: <200 lines. Move detailed content to docs/AGENTS/ or docs/architecture/ -->`. The PR auditor can flag violations.

### 2. File Index Goes Stale

**Risk**: When files are added or renamed, the index must be updated manually.

**Mitigation**:
- The PR auditor rubric already checks "Project Conventions" — update it to include file index freshness.
- A scheduled audit template could validate the index against actual files.
- Alternatively, consider a script that generates the index from file headers (if headers are adopted), though this adds build complexity.

### 3. File Headers Add Noise for Human Readers

**Risk**: Developers may find JSDoc headers redundant for files with obvious names.

**Mitigation**: Keep headers to 3-6 lines. For small/obvious files (e.g., `nvm.ts`), 2 lines is fine. The format should be descriptive, not ceremonial.

### 4. Two Sources of File Descriptions

**Risk**: File index in CLAUDE.md and file-level headers could diverge.

**Mitigation**: The index should be a compact summary (5-10 words), while headers provide more detail (2-3 sentences). They serve different purposes: the index is for discovery, headers are for understanding. Divergence is acceptable as long as neither is wrong.

### 5. Breaking Existing Agent Expectations

**Risk**: If agents already have learned patterns like "always read AGENTS.md first", restructuring could confuse cached behaviors.

**Mitigation**: The dispatcher prompt explicitly tells agents what to read. Updating the prompt (Step 6) ensures agents follow the new structure. There's no cached state to worry about — each agent session starts fresh.

### 6. Over-Loading CLAUDE.md

**Risk**: Research warns that LLMs can reliably follow ~150-200 instructions. The Claude Code system prompt already uses ~50 of that budget. An overly prescriptive CLAUDE.md could degrade performance.

**Mitigation**: The file index is data (a reference table), not instructions. Instructions should be limited to 5-10 rules. The bulk of CLAUDE.md should be informational, not imperative.

---

## Open Questions

### 1. Should the file index be auto-generated or manually maintained?

**Options**:
- **(a) Manual** — Simple, requires discipline during PRs. The auditor can check freshness.
- **(b) Auto-generated from file headers** — Requires a build script that parses JSDoc headers and writes to CLAUDE.md. More complex but stays in sync. Could be a pre-commit hook or CI step.
- **(c) Separate file linked from CLAUDE.md** — e.g., `FILE_INDEX.md`. Keeps CLAUDE.md lean but adds one more hop.

**Recommendation**: Start with (a) manual maintenance. If it drifts, consider (b). Avoid (c) since it reintroduces the hop problem.

### 2. How detailed should file headers be?

**Options**:
- **(a) Minimal** — Just the module name and one-line purpose (`@file Ticket dispatcher`)
- **(b) Medium** — Purpose + key behavior (3-4 lines, as proposed)
- **(c) Full** — Purpose + exports + dependencies + data flow (6-10 lines)

**Recommendation**: (b) Medium. It gives agents enough to decide whether to read the full file without being noisy.

### 3. Should Common Patterns go in CLAUDE.md or a separate file?

**Options**:
- **(a) In CLAUDE.md** — Zero-hop access, but adds ~20-30 lines.
- **(b) In `docs/AGENTS/patterns.md`** — Keeps CLAUDE.md lean but adds a hop.

**Recommendation**: (a) In CLAUDE.md, limited to 3-5 most common patterns. If it grows beyond that, move to a separate file.

### 4. Should we add a CLAUDE.md validation to CI/PR checks?

A simple script could verify that every `.ts` file in `server/` and `src/` has a corresponding entry in the File Index section of CLAUDE.md. This would catch drift automatically.

**Recommendation**: Nice to have, not essential. The auditor already reviews for convention compliance. A dedicated CI check is a future enhancement.

### 5. Should architecture docs get frontmatter metadata?

Adding YAML frontmatter to architecture docs (e.g., `files: [dispatcher.ts, nvm.ts]`) would enable tooling to cross-reference docs with source files. This is a forward-looking consideration, not essential for the initial optimization.

---

## Alternative Approaches Considered

### A. Skills-Style File Headers (Pull-into-TOC)

The original ticket suggested a pattern where every file/folder has a description header that gets "pulled into" a table-of-contents summary. This is essentially the auto-generated approach in Open Question #1(b).

**Why not recommended as the primary approach**: It requires build tooling (a script to parse headers and assemble the TOC), which adds complexity. The manual file index is simpler and achieves the same goal. However, this could be a Phase 2 enhancement if maintenance proves difficult.

### B. Subagent-Based Context Loading

Claude Code's subagent system supports `skills` preloading in frontmatter. The dispatcher could define project-specific skills that get injected into the agent's context at startup.

**Why not recommended now**: The dispatcher currently spawns `claude` CLI directly, not through the subagent framework. Migrating to subagent-based dispatch would be a larger refactor. However, this is worth considering for the future (see `docs/futureDevelopmentOpportunities.md`).

### C. Hierarchical CLAUDE.md Files

Claude Code supports `.claude/` directory with per-directory CLAUDE.md files. We could add `server/CLAUDE.md` and `src/CLAUDE.md` for directory-specific context.

**Why not recommended**: Agent Kanban is a relatively small codebase (~6K lines of TypeScript). Hierarchical docs add overhead without proportional benefit. This strategy is better suited for large monorepos.

### D. Embedding Architecture Summaries in CLAUDE.md

Instead of linking to `docs/architecture/*.md`, embed 2-3 line summaries of each subsystem directly in CLAUDE.md.

**Why partially adopted**: The "Architecture at a Glance" section provides high-level summaries. Full architecture details remain in their dedicated files, accessible via the index. This balances depth with CLAUDE.md size.
