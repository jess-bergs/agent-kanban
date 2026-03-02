# Plan Report: Deploying Agent Kanban to AWS

## Summary

Agent Kanban is currently a local-only development tool — an Express + React app with WebSocket real-time updates that watches `~/.claude/` directories and spawns Claude Code CLI agents in git worktrees. Moving it to AWS requires rethinking several core assumptions: the server currently relies on local filesystem access for both its own data (`data/` directory of JSON files) and for Claude Code's session directories (`~/.claude/teams/`, `~/.claude/tasks/`), it spawns child processes (`claude` CLI, `git`, `gh`) on the host machine, and it has zero authentication. This report covers AWS service selection (explicitly avoiding Lightsail), cost estimates, CI/CD pipeline design, persistent storage, a dedicated GitHub service account, versioning with breaking-change management, and zero-downtime deployment strategy.

---

## Relevant Files

| File | Role |
|------|------|
| `server/index.ts` | Express server, REST API, WebSocket, static file serving (port 3003) |
| `server/store.ts` | JSON-file-based persistence for projects/tickets in `data/` directory |
| `server/dispatcher.ts` | Spawns `claude` CLI in git worktrees, manages agent lifecycle |
| `server/auditor.ts` | Spawns `claude` for PR reviews, maintains watchlist in `data/auditor-watchlist.json` |
| `server/audit-store.ts` | JSON-file persistence for audit schedules and runs |
| `server/audit-scheduler.ts` | Cron-like scheduler for recurring audits |
| `server/watcher.ts` | Chokidar file watcher on `~/.claude/teams/` and `~/.claude/tasks/` |
| `server/claude-data.ts` | Reads Claude Code team/task/inbox data from `~/.claude/` |
| `server/solo-agents.ts` | Detects running `claude` processes via `ps` and reads JSONL sessions |
| `server/nvm.ts` | Resolves nvm-managed Node binary for child processes |
| `server/mcp.ts` | MCP server for programmatic access (stdio transport) |
| `server/screenshots.ts` | Playwright screenshot capture for PRs |
| `src/hooks/useWebSocket.ts` | Client WebSocket connection with auto-reconnect |
| `vite.config.ts` | Dev server proxy config (5174 → 3003) |
| `package.json` | Scripts, dependencies, Node >=22 requirement |
| `.github/workflows/pr-checks.yml` | Existing CI: lint + typecheck on PRs |
| `public/manifest.json` | PWA manifest |
| `docs/architecture/security.md` | Threat model (explicitly notes "local development tool") |

---

## Current Architecture

### How It Works Today

```
macOS Localhost
  React SPA (Vite build) <--- WebSocket ---> Express
  http://localhost:5174       ws://localhost:3003/ws
  (dev) or :3003 (prod)

  Express Server (port 3003)
    REST API (/api/*)
    WebSocket broadcast (real-time updates)
    Static file serving (Vite dist/)
    Dispatcher (spawns claude CLI)
    Auditor (spawns claude for PR reviews)
    Scheduler (recurring audits)
    File watcher (chokidar on ~/.claude/)

  Data:
    data/projects/*.json    (project configs)
    data/tickets/*.json     (ticket state)
    data/ticket-images/     (uploaded images)
    data/audit-*/*.json     (schedules, runs)
    data/auditor-watchlist.json
    ~/.claude/              (Claude Code sessions)

  External tools: claude CLI, git, gh, node, nvm
```

### Key Architectural Constraints

1. **Filesystem-heavy**: All persistence is flat JSON files with atomic writes (write-to-tmp + rename). No database.
2. **Child process spawning**: The dispatcher and auditor spawn `claude` CLI as child processes. This means the host machine needs Claude Code installed and authenticated.
3. **Claude session directory**: The watcher and solo-agent detector read `~/.claude/teams/`, `~/.claude/tasks/`, and `~/.claude/projects/` — these only exist on machines running Claude Code.
4. **Git worktrees**: Dispatcher creates worktrees in `/tmp/agent-kanban-worktrees/` and needs the target repos cloned locally.
5. **No auth**: No authentication on API or WebSocket. The security model assumes `localhost`.
6. **Single process**: Everything runs in one Node.js process — no workers, no message queues.

---

## Proposed Approach

### Phase 0: Pre-Deployment Prep (versioning, GitHub account, project config)

#### 0.1 Semantic Versioning

The app is currently at `0.1.0`. Adopt proper semver:

- **Major** (1.0.0, 2.0.0): Breaking API changes (WebSocket event format, REST API schema, data migration required)
- **Minor** (0.2.0, 0.3.0): New features, backward-compatible
- **Patch** (0.1.1, 0.1.2): Bug fixes

**Mechanism:**
- Use `npm version patch|minor|major` which updates `package.json` and creates a git tag
- CI creates a GitHub Release from the tag (see Phase 2)
- The server should expose a `/api/version` endpoint that returns `{ version, commitSha, builtAt }`
- The React client should show the version in the UI (footer or settings)

**Breaking change protocol:**
1. Document breaking changes in a `CHANGELOG.md`
2. Major version bumps require a migration script in `scripts/migrate-vX.ts`
3. The server startup should check data format version and refuse to start if a migration is needed (fail-fast, not silent corruption)
4. Consider a `data/version.json` file that tracks the data schema version independently of the app version

#### 0.2 Dedicated GitHub Account (Machine User vs GitHub App)

**Recommendation: GitHub App** (not a second personal account).

A GitHub App is preferred over a machine user account because:
- Fine-grained permissions (only what's needed: repo read/write, PR create/merge, checks)
- Short-lived installation tokens (auto-expire, no long-lived PATs to rotate)
- Not tied to a personal account — survives org changes
- Higher API rate limits (5000 req/hr per installation vs 5000/hr per user)
- Appears as a bot in commit/PR history (clear attribution)

**Setup steps:**
1. Create a GitHub App in the `jess-bergs` org (Settings > Developer Settings > GitHub Apps)
2. Name it something like `agent-kanban-bot`
3. Grant permissions: `contents: write`, `pull_requests: write`, `checks: read`, `metadata: read`
4. Install it on the `jess-bergs/agent-kanban` repo (and any other repos agents work on)
5. Store the App ID and private key in AWS Secrets Manager
6. On the EC2 instance, the dispatcher uses the GitHub App's installation token for `gh` CLI auth instead of your personal `gh auth login`
7. Configure `git` to use the App's token for HTTPS push/pull

**What this replaces:**
- Currently, `gh` CLI uses your personal GitHub auth (from `gh auth login`)
- Currently, `git push` uses your personal SSH key or credential helper
- The dispatcher's `gh pr create` and `gh pr merge` calls will use the App token instead

#### 0.3 Environment Configuration

Create a proper env config system. Currently, the only env var is `ANTHROPIC_API_KEY` (for the chat bot). For AWS, we need:

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3003) |
| `DATA_DIR` | Override data directory (default `./data`) |
| `NODE_ENV` | `production` / `development` |
| `ANTHROPIC_API_KEY` | For chat bot API calls |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (or path to it) |
| `GITHUB_APP_INSTALLATION_ID` | Installation ID for the target org |
| `ALLOWED_ORIGINS` | CORS origins (currently hardcoded to `http://localhost:5174`) |
| `CLAUDE_AUTH_METHOD` | How agents authenticate (subscription, API key, etc.) |

---

### Phase 1: AWS Infrastructure (EC2 + EBS + ALB)

#### Why EC2, Not Fargate/ECS/Lambda

Agent Kanban spawns long-running child processes (`claude` CLI sessions that can run for 30+ minutes), requires a real filesystem (git worktrees, JSON file store, Claude session directories), and needs `git`, `gh`, `claude`, and `nvm` installed. This rules out:

- **Lambda**: 15-minute max execution, no persistent filesystem, no long-running child processes
- **Fargate/ECS**: Possible but awkward — you'd need a fat container image with all CLI tools, and ephemeral storage complicates the JSON file store. The long-running process model doesn't map well to container orchestration.
- **Lightsail**: Explicitly excluded per requirements (limited configurability, no ALB integration, harder to automate)

**EC2 is the right fit** — it gives you a full Linux VM where you can install everything and have full control.

#### Instance Selection

| Instance | vCPU | RAM | Monthly Cost | Fit |
|----------|------|-----|-------------|-----|
| `t3.small` | 2 | 2 GB | ~$15 | Too tight — Claude agents are memory-hungry |
| **`t3.medium`** | **2** | **4 GB** | **~$30** | **Good starting point for <=3 concurrent agents** |
| `t3.large` | 2 | 8 GB | ~$61 | Better if running 5 concurrent agents |
| `t3.xlarge` | 4 | 16 GB | ~$121 | Overkill unless agent count goes up significantly |

**Recommendation: Start with `t3.medium` ($30/mo)** and monitor. The `MAX_CONCURRENT = 5` in the dispatcher might need to be lowered to 2-3 on a t3.medium. Upgrade to `t3.large` if you need all 5 concurrent agents.

#### Storage (EBS)

| Volume | Size | Cost | Purpose |
|--------|------|------|---------|
| **Root (gp3)** | 30 GB | $2.40/mo | OS, Node.js, tools, app code |
| **Data (gp3)** | 20 GB | $1.60/mo | `DATA_DIR` — mounted at `/data` |

The data volume is separate so it survives instance replacement. Total storage cost: ~$4/mo.

**Backup strategy**: Daily EBS snapshots via AWS Backup (first 5 GB free, then $0.05/GB-month). For 20 GB of data, that's ~$1/mo.

#### Load Balancer (ALB)

An ALB provides:
- HTTPS termination (free ACM certificate)
- WebSocket support (native)
- Health checks
- Future: easy to add a second instance or blue/green deployment

| Component | Monthly Cost |
|-----------|-------------|
| ALB hourly | ~$18 |
| LCU usage (low traffic) | ~$2 |
| **Total** | **~$20/mo** |

**Alternative: No ALB** — If cost is a concern, you could skip the ALB and use Caddy or nginx on the EC2 instance with Let's Encrypt for HTTPS. This saves $20/mo but loses health-check-driven routing and future scaling flexibility.

#### Networking

- VPC with public + private subnets (default VPC is fine to start)
- Security group: allow 443 (HTTPS) from anywhere, 22 (SSH) from your IP only
- Elastic IP: $3.65/mo (free while attached to a running instance)

#### Total Monthly Cost Estimate

| Component | Cost |
|-----------|------|
| EC2 t3.medium | $30 |
| EBS (root + data) | $4 |
| ALB | $20 |
| EBS snapshots | $1 |
| Data transfer (light) | $1 |
| Secrets Manager (4 secrets) | $2 |
| **Total** | **~$58/mo** |

**Budget option (no ALB, Caddy for HTTPS):** ~$38/mo

**Upgrade option (t3.large + ALB):** ~$89/mo

---

### Phase 2: CI/CD Pipeline

#### Pipeline Architecture

```
GitHub (push to main) --> GitHub Actions --> Build and Test --> Deploy to EC2
         |                                         |
         v                                         v
   Tag push (v1.2.3) --> GitHub Release --> Production deploy
```

#### GitHub Actions Workflow

**PR Checks** (existing `pr-checks.yml` — keep as-is):
- Lint + typecheck on every PR

**Deploy Workflow** (new `.github/workflows/deploy.yml`):
- Triggers on push to `main` (staging) or tag push `v*` (production)
- Steps:
  1. Checkout code
  2. `npm ci` + `npm run build` + `npm run check`
  3. Create deployment artifact (tarball of `dist/`, `server/`, `package.json`, `package-lock.json`, `scripts/`)
  4. Upload artifact to S3 (or use `rsync` over SSH directly)
  5. SSH into EC2, pull the artifact, `npm ci --production`, restart the service

**Deployment mechanism — two options:**

| Approach | Pros | Cons |
|----------|------|------|
| **GitHub Actions + SSH/rsync** | Simple, no AWS tooling, fast | Direct SSH access needed, no rollback built-in |
| **GitHub Actions + CodeDeploy** | AWS-native, blue/green support, auto-rollback | More setup (appspec.yml, IAM roles, CodeDeploy agent) |

**Recommendation: Start with SSH/rsync**, upgrade to CodeDeploy later if blue/green deploys become necessary.

#### Systemd Service

The app should run as a systemd service on EC2:

```ini
[Unit]
Description=Agent Kanban
After=network.target

[Service]
Type=simple
User=agentkanban
WorkingDirectory=/opt/agent-kanban
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/etc/agent-kanban/env

[Install]
WantedBy=multi-user.target
```

#### Release Flow

1. Developer merges PRs to `main`
2. When ready for a release: `npm version patch` (or minor/major) creates tag and pushes
3. GitHub Actions detects the tag, runs build, creates GitHub Release with changelog
4. Deploy workflow runs and deploys to EC2
5. Systemd restarts the service (brief downtime, ~5 seconds)

---

### Phase 3: Reliable Ticket Storage

The current JSON-file store is actually quite reasonable for this use case. It's simple, atomic (POSIX rename), and performs well for the expected data volumes (hundreds, not millions, of tickets).

#### Migration Path: JSON Files to SQLite

If/when JSON files become a bottleneck (unlikely at current scale), the natural upgrade is **SQLite** — not Postgres. SQLite because:

- Single file, no separate database process
- Works perfectly on EBS
- Node.js has excellent SQLite support (`better-sqlite3`)
- Easy to back up (just copy the file, or use EBS snapshots)
- Keeps the "single process, no external dependencies" architecture

**For now: Keep JSON files** but with these improvements:

1. **Make `DATA_DIR` configurable** via env var (currently hardcoded relative to `import.meta.dirname`)
2. **Mount the EBS data volume at `/data`** and set `DATA_DIR=/data/agent-kanban`
3. **Add data schema versioning** — write a `data/version.json` with `{ schemaVersion: 1 }` so future migrations can detect the format
4. **Daily EBS snapshots** for backup (AWS Backup, ~$1/mo)

#### Data that needs persistence

| Data | Current Location | Cloud Location |
|------|-----------------|----------------|
| Projects | `data/projects/*.json` | `/data/agent-kanban/projects/` |
| Tickets | `data/tickets/*.json` | `/data/agent-kanban/tickets/` |
| Ticket images | `data/ticket-images/` | `/data/agent-kanban/ticket-images/` |
| Audit schedules | `data/audit-schedules/` | `/data/agent-kanban/audit-schedules/` |
| Audit runs | `data/audit-runs/` | `/data/agent-kanban/audit-runs/` |
| Auditor watchlist | `data/auditor-watchlist.json` | `/data/agent-kanban/auditor-watchlist.json` |

#### Data that does NOT transfer to cloud

| Data | Why |
|------|-----|
| `~/.claude/teams/` | Claude Code team sessions — local to the machine running Claude |
| `~/.claude/tasks/` | Claude Code task files — local to machine |
| `~/.claude/projects/` | Claude Code session JNSLs — local to machine |

This means the **Team Monitoring** and **Solo Agent Detection** features only work on the cloud instance for agents that the cloud instance itself spawns. You won't see agents running on your laptop in the cloud dashboard.

---

### Phase 4: Authentication and Security

Moving from localhost to a public-facing server changes the threat model significantly.

#### Minimum Viable Auth

1. **Basic auth or API key** — simple, can be added in a middleware
2. **HTTPS only** — ALB handles TLS termination with free ACM cert
3. **CORS lockdown** — set `ALLOWED_ORIGINS` to the actual domain
4. **WebSocket auth** — pass token as query param on WS connection, validate in `wss.on('connection')`

#### What to Harden

| Risk (from security.md) | Cloud Impact | Mitigation |
|--------------------------|-------------|------------|
| No authentication | Critical — now internet-facing | Add auth middleware |
| Unvalidated PATCH body | Medium — attacker could overwrite ticket fields | Add field allowlist |
| Shell string interpolation | Same risk as local | Migrate to `execFile` with argument arrays |
| Open file browsing (`/api/browse`) | High — exposes server filesystem | Disable or restrict to data dir only |

---

### Phase 5: Zero-Downtime Deploys and Reboots

#### Simple Approach (Good Enough to Start)

1. `systemctl restart agent-kanban` — 3-5 second downtime
2. The React client's WebSocket has auto-reconnect with exponential backoff (already implemented in `useWebSocket.ts`)
3. The dispatcher's `recoverOrphanedTickets()` already handles server restarts — it detects `in_progress` tickets whose agent PID is dead and auto-retries them

**This is actually pretty robust already.** The main gap is the ~5s connection drop.

#### Advanced Approach (Later)

For true zero-downtime:
1. Run two instances behind the ALB
2. Deploy to one, drain connections, switch traffic, deploy to the other
3. Or: Use CodeDeploy with blue/green deployment

**Concern**: The dispatcher maintains in-memory state (`running` Map, `lastStreamActivity`, `pendingToolApproval`). Two instances would double-dispatch tickets unless you add distributed locking. **Recommendation: Stick with single instance** until this becomes a real problem.

#### Reboot Strategy

- **OS updates**: `yum update` + `reboot` — systemd auto-restarts the service
- **App updates**: `systemctl restart agent-kanban`
- **Data migration**: Stop service, run migration script, start service
- **Disaster recovery**: Launch new EC2, attach the data EBS volume, deploy app

---

### Phase 6: Breaking Changes and Migration

#### Data Schema Versioning

Add `data/version.json`:
```json
{
  "schemaVersion": 1,
  "appVersion": "0.2.0",
  "migratedAt": 1709251200000
}
```

#### Migration Framework

Create `scripts/migrate.ts` that:
1. Reads `data/version.json`
2. Runs all pending migrations in order (e.g., `migrations/002-add-field.ts`)
3. Updates `data/version.json`

The server startup (`server/index.ts`) should check the schema version and refuse to start if it's behind, with a clear error message prompting the operator to run the migration script.

#### API Versioning

For the REST API, use header-based versioning or URL prefixes:
- Start with `/api/v1/tickets` (can be aliased from current `/api/tickets`)
- When a breaking change is needed, add `/api/v2/tickets` and deprecate v1
- The WebSocket protocol version can be negotiated in the initial handshake

---

## Files to Modify

### New Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Container build (useful for local testing even if deploying to EC2) |
| `.github/workflows/deploy.yml` | CD pipeline — build, package, deploy |
| `.github/workflows/release.yml` | Create GitHub Release on tag push |
| `scripts/migrate.ts` | Data migration runner |
| `scripts/setup-ec2.sh` | EC2 instance setup script (install Node, Claude, git, gh, etc.) |
| `systemd/agent-kanban.service` | Systemd unit file |
| `CHANGELOG.md` | Release notes and breaking changes |
| `server/auth.ts` | Authentication middleware |
| `server/config.ts` | Centralized environment config with validation |

### Modified Files

| File | Changes |
|------|---------|
| `package.json` | Add `version`, `migrate`, `release` scripts; bump version |
| `server/index.ts` | Add auth middleware, configurable PORT/CORS, version endpoint, schema check on startup |
| `server/store.ts` | Make `DATA_DIR` configurable via env var, add schema version check |
| `server/audit-store.ts` | Use configurable `DATA_DIR` |
| `server/auditor.ts` | Use configurable `DATA_DIR`, use GitHub App token for `gh` |
| `server/dispatcher.ts` | Use GitHub App token for `gh`/`git`, configurable worktree path |
| `server/nvm.ts` | May need adjustment for Linux (currently macOS-centric) |
| `server/solo-agents.ts` | Will only detect agents on the cloud instance itself |
| `vite.config.ts` | Make proxy target configurable |
| `.github/workflows/pr-checks.yml` | No changes needed |
| `src/hooks/useWebSocket.ts` | Already handles reconnection — may need to pass auth token |

---

## Risks and Edge Cases

### 1. Claude Code Authentication on EC2

The dispatcher spawns `claude` CLI which needs an Anthropic account/subscription. On your laptop, this uses your personal login. On EC2, you need:
- A Claude Max subscription or API key associated with the machine
- `claude auth login` on the EC2 instance (may require interactive setup initially)
- The dispatcher strips `ANTHROPIC_API_KEY` from env to force subscription auth — that behavior would need to change for cloud

**Risk**: If the Claude auth expires on the EC2 instance, all agent dispatches will fail silently until re-authed.

**Mitigation**: Add a health check that verifies `claude --version` and auth status on startup, and alerts if unhealthy.

### 2. Git Repository Access

The dispatcher needs clone access to the repositories it creates worktrees for. On EC2:
- Repos must be cloned to the instance (or cloned on-demand)
- The `repoPath` field in projects currently points to local macOS paths like `/Users/jess/dev/my-repo`
- On EC2, these would be something like `/home/agentkanban/repos/my-repo`

**Risk**: Existing project configs will have stale `repoPath` values after migration.

**Mitigation**: Data migration script that updates `repoPath` for all projects to their new EC2 locations. Or: make project registration auto-clone from `remoteUrl`.

### 3. Team Monitoring Won't Work Remotely

The `watcher.ts` watches `~/.claude/teams/` and `~/.claude/tasks/` — these directories only exist for Claude Code sessions running on the same machine. Agents running on your laptop won't appear in the cloud dashboard.

**Mitigation**: The team monitoring feature is only useful for agents the cloud instance itself spawns. The UI should gracefully handle having no teams/solo agents. This is an acceptable trade-off.

### 4. File Watcher on EBS

Chokidar relies on `inotify` on Linux. EBS volumes support inotify, so `watcher.ts` should work. However, if the data directory is on a network filesystem (EFS), inotify doesn't work. **Stick with EBS.**

### 5. Memory Pressure

Each spawned `claude` process can use 500MB+ of RAM. With `MAX_CONCURRENT = 5`, that's potentially 2.5 GB just for agents, plus the server itself. On a t3.medium (4 GB), this is tight.

**Mitigation**: Start with `MAX_CONCURRENT = 2` on t3.medium, monitor with CloudWatch, upgrade to t3.large if needed.

### 6. Elastic IP and DNS

If you want a stable domain (e.g., `kanban.yourdomain.com`):
- Route 53 hosted zone: $0.50/mo
- Point an A record at the ALB
- ACM certificate (free) for HTTPS

### 7. WebSocket Behind ALB

ALB supports WebSocket natively, but has a default idle timeout of 60 seconds. The server should send periodic pings (already partially handled by the polling intervals), or configure the ALB idle timeout higher (up to 4000 seconds).

### 8. PWA on Cloud

The PWA manifest and service worker will work fine on a cloud deployment. The `start_url` is `/` which is relative. The only change is that `manifest.json` will be served from the cloud URL instead of `localhost`.

### 9. `nvm.ts` on Linux

The `nvm.ts` module resolves the nvm-managed Node binary on macOS. On Amazon Linux 2023 (EC2), nvm paths are the same format (`~/.nvm/versions/node/...`), but the shell is different. The existing `bash`-based resolution should still work, but needs testing.

### 10. `solo-agents.ts` Platform Dependence

The solo agent detector uses `ps -eo pid,args` and `lsof` to find running `claude` processes. These are POSIX commands available on Linux, but the output format may differ slightly from macOS. The `ps` parsing should be tested on Amazon Linux.

---

## Open Questions

### 1. Claude Code Auth Strategy
How should the EC2 instance authenticate with Claude? Options:
- **Claude Max subscription**: Log in interactively once, sessions persist. Risk: auth may expire.
- **API key**: Set `ANTHROPIC_API_KEY` in the env. The dispatcher currently strips this var — that behavior would need to change for cloud.
- **Organization/team API access**: If available through an Anthropic org account.

**This is the biggest unresolved question.** The entire value of the app depends on being able to spawn `claude` agents.

### 2. Which Repos to Pre-Clone?
The dispatcher needs repos cloned locally. Should we:
- (a) Pre-clone all repos during instance setup and update them via cron?
- (b) Clone on-demand when a project is registered (auto-clone from `remoteUrl`)?
- (c) Let the operator manually clone repos?

**Recommendation**: (b) Auto-clone from `remoteUrl` when a project is created, with periodic `git fetch` in the background.

### 3. Domain Name
Do you want a custom domain? Options:
- No domain — access via ALB DNS name (ugly but free)
- Custom domain via Route 53 (~$12/yr for `.com` + $0.50/mo hosted zone)
- Use an existing domain and add a subdomain

### 4. Who Can Access?
Authentication options:
- **Basic auth** (username/password in env) — simplest
- **GitHub OAuth** — users log in with GitHub, you allowlist specific users
- **API key** — for MCP/programmatic access
- **VPN-only** — restrict security group to VPN IP range, no app-level auth needed

### 5. Data Migration Strategy
When you first deploy:
- Start fresh (no existing tickets/projects)?
- Export from local to cloud? (copy `data/` directory, fix `repoPath` values)

### 6. Budget Ceiling
The base cost is ~$38-89/mo depending on instance size and whether you use ALB. Is there a monthly budget cap?

### 7. Multi-Instance Future
Are you planning to eventually run this for a team (multiple users, multiple instances)? If so, the JSON file store will eventually need to be replaced with a proper database, and the dispatcher needs distributed locking. This report assumes single-instance.

---

## Implementation Priority

If approved, the recommended implementation order is:

1. **Environment config** (`server/config.ts`) — make `DATA_DIR`, `PORT`, `CORS` configurable
2. **Versioning** — bump to `0.2.0`, add version endpoint, `CHANGELOG.md`
3. **GitHub App** — create the app, store credentials, update dispatcher/auditor
4. **Auth middleware** — basic auth for the API and WebSocket
5. **EC2 setup script** — provision instance, install dependencies, create systemd service
6. **CI/CD pipeline** — GitHub Actions deploy workflow
7. **Data migration** — schema versioning, migration framework
8. **Harden security** — field allowlists, disable `/api/browse`, safer shell argument handling
