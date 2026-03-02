# Changelog

All notable changes to Agent Kanban are documented here.

## [0.2.0] - 2026-03-02

### Added
- Centralized environment config (`server/config.ts`) — DATA_DIR, PORT, CORS, API_KEY all configurable via env vars
- `/api/version` endpoint returning version, commit SHA, and build timestamp
- API key authentication middleware for cloud deployment
- EC2 setup script, systemd service, and Caddy reverse proxy config
- GitHub Actions CI/CD pipeline (deploy on push to main, release on tag)
- Data migration framework with schema versioning
- Data export/import scripts for local-to-cloud migration
- Security hardening for public-facing deployment

### Changed
- `DATA_DIR` is now configurable (was hardcoded relative to project root)
- `PORT` is now configurable via env var (was hardcoded 3003)
- `CORS` origins are now configurable (was hardcoded localhost:5174)
- `MAX_CONCURRENT` agents configurable via env var (was hardcoded 5)
- Worktree directory configurable via `WORKTREE_DIR` env var

## [0.1.0] - 2025-12-01

### Added
- Initial release — local development tool
- React 19 + Vite frontend with real-time WebSocket updates
- Express backend with JSON file persistence
- Ticket dispatcher (spawns Claude Code agents in git worktrees)
- PR auditor with watchlist and auto-merge
- Scheduled audits with templates and trend tracking
- Team monitoring (watches ~/.claude/ directories)
- Solo agent detection
- PWA support
- MCP server for programmatic access
