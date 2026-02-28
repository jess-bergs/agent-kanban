# Changes in This PR

## Summary

Added comprehensive screenshot generation tools and PR documentation template to make it easier to include visual documentation in pull requests.

## Files Added

### Documentation
- `SCREENSHOT_GUIDE.md` - Comprehensive guide for generating screenshots
- `EXAMPLE_PR.md` - Example PR showing how to use the tooling
- `.github/pull_request_template.md` - PR template with screenshot section
- `screenshots/README.md` - Documentation for screenshots directory
- `screenshots/.gitkeep` - Ensures directory is tracked in git

### Scripts
- `scripts/generate-screenshots.ts` - Automated screenshot generation script
- `scripts/capture-with-playwright.md` - Guide for Playwright automation

### Configuration
- Updated `package.json` - Added `screenshot` npm script

## Key Features

### 1. PR Template
A standardized pull request template that includes:
- Description and changes sections
- Type of change checklist
- Screenshots section (Before/After)
- Testing checklist
- Related issues linking

### 2. Screenshot Script
Run with `npm run screenshot` to:
- Start the development server automatically
- Provide instructions for capturing screenshots
- Support both manual and automated capture
- Keep server running until you're done

### 3. Playwright Integration
For users with Claude Code and Playwright MCP:
- Automated browser navigation
- Programmatic screenshot capture
- Batch screenshot generation
- High-quality image output

### 4. Comprehensive Documentation
Multiple documentation files covering:
- Quick start guide
- Troubleshooting section
- Best practices
- Naming conventions
- Example workflows

## Why This Matters

### Better Pull Requests
- Visual context speeds up reviews
- Screenshots show intent clearly
- Easier to spot UI issues
- Historical record of changes

### Easier Contribution
- Clear process for adding screenshots
- Multiple options (manual/automated)
- Well-documented workflow
- Standardized PR format

### Improved Review Process
- Reviewers see changes immediately
- No need to run code for visual review
- Better understanding of features
- Faster feedback cycles

## Usage

### Basic Workflow
```bash
# Make your changes
git checkout -b feature/my-feature

# Generate screenshots
npm run screenshot
# Follow on-screen instructions

# Create PR
gh pr create --base main --fill
# Add screenshots to PR description
```

### With Playwright (Claude Code)
```bash
# Start the server
npm run screenshot

# In Claude Code, ask:
"Capture screenshots of the app at http://localhost:5173
showing [specific views]. Save to screenshots/ directory."
```

## Technical Details

### Why Not Fully Automated?
1. **Git Worktrees**: Don't share node_modules by default
2. **Context Required**: Different PRs need different screenshots
3. **Dependency Weight**: Playwright is heavy (~100MB)
4. **Flexibility**: Manual option ensures universal access

### Design Decisions
- **MCP Integration**: Leverage Claude Code's Playwright tools
- **Minimal Dependencies**: No new npm packages required
- **Clear Fallbacks**: Manual process always available
- **Documentation First**: Comprehensive guides over automation

### File Organization
```
.github/
  └── pull_request_template.md    # GitHub PR template
scripts/
  ├── generate-screenshots.ts     # Server starter + instructions
  └── capture-with-playwright.md  # Playwright automation docs
screenshots/
  ├── README.md                   # Directory documentation
  └── .gitkeep                    # Git tracking
SCREENSHOT_GUIDE.md               # Main user guide
EXAMPLE_PR.md                     # Complete example
```

## Future Enhancements

Potential additions in future PRs:
- Screenshot diffing for before/after comparison
- CI/CD integration for automated capture
- Visual regression testing
- Screenshot annotation tools
- Gallery view of historical screenshots

## Testing

Tested scenarios:
- ✅ Script execution (`npm run screenshot`)
- ✅ Server startup and readiness check
- ✅ Instructions display correctly
- ✅ Directory structure is git-tracked
- ✅ Documentation is clear and complete
- ✅ PR template renders on GitHub

## Breaking Changes

None. This is purely additive functionality.

## Related Tickets

Closes #14 - Add screenshot generation capability
