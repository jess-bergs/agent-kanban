# Future Development Opportunities

## Data Storage
- **S3-backed storage**: Migrate ticket/project JSON from local `data/` directory to S3 for durability, multi-device access, and backup. Could use versioned buckets for automatic history.
- Currently using git-tracked `data/` as interim backup strategy.

## Known Improvements
- **Conflict-aware auto-merge**: Detect and auto-resolve simple merge conflicts in agent PRs.
- **Agent retry with context**: When retrying failed tickets, pass previous attempt's output as context so the agent doesn't start from scratch.
