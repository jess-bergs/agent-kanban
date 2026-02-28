# Screenshot Generation Guide for Agent Kanban

This guide explains how to generate screenshots for pull request documentation.

## Overview

Screenshots help reviewers understand UI changes and new features without needing to run the application locally. This project includes tools and templates to make screenshot generation easy.

## Quick Start

### Method 1: Automated Screenshot Script

```bash
npm run screenshot
```

This command:
1. Starts the development server automatically
2. Waits for the app to be ready
3. Provides clear instructions for capturing screenshots
4. Keeps the server running until you press Ctrl+C

### Method 2: Using Claude Code with Playwright

If you're using Claude Code with Playwright MCP tools enabled:

1. Start the screenshot script (which starts the server):
   ```bash
   npm run screenshot
   ```

2. In Claude Code, request automated screenshot capture:
   ```
   The dev server is running at http://localhost:5173.
   Use Playwright to navigate to the app and capture screenshots of:
   - Main dashboard view
   - Projects view with sample data
   - Teams view
   - Agents view (if available)
   - Empty states
   - Any modal dialogs

   Save all screenshots to the screenshots/ directory with descriptive names.
   ```

3. Claude Code will use Playwright MCP tools to:
   - Navigate to the application
   - Interact with the UI
   - Capture high-quality screenshots
   - Save them with proper filenames

### Method 3: Manual Screenshot Capture

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Open http://localhost:5173 in your browser

3. Navigate to different views and capture screenshots using:
   - **macOS**: `Cmd + Shift + 4`, then `Space`, then click window
   - **Windows**: Snipping Tool or `Win + Shift + S`
   - **Linux**: `gnome-screenshot` or `spectacle`

4. Save screenshots to the `screenshots/` directory

## Why Can't Screenshots Be Fully Automated?

There are a few reasons why full automation isn't included by default:

1. **Git Worktrees**: This project uses git worktrees for branch isolation. Each worktree needs its own dependencies, or we need symlinks to share node_modules.

2. **Browser Automation**: Playwright requires a browser runtime, which adds significant dependencies to the project. It's better as an optional tool via MCP.

3. **Dynamic Content**: Screenshots are most valuable when they show realistic, meaningful data. This often requires manual setup or database seeding.

4. **Context Matters**: Different PRs need different screenshots. Automated scripts can't predict what views are most relevant to show.

## Screenshot Best Practices

### What to Capture

For **new features**:
- Initial state (before any interaction)
- Key interaction points (modals, forms, dropdowns)
- Final state (after completing an action)
- Error states or validation messages

For **bug fixes**:
- Before: Screenshot showing the bug
- After: Screenshot showing the fix

For **UI improvements**:
- Before and after comparison
- Multiple views if the change affects different screens

### Naming Convention

Use clear, descriptive filenames:

```
main-dashboard.png              # Main landing page
projects-list-with-data.png     # Projects view with sample data
project-empty-state.png         # Empty state view
ticket-detail-modal.png         # Ticket detail modal open
agents-kanban-view.png          # Agents kanban board
create-project-modal.png        # Project creation modal
teams-activity-feed.png         # Teams view with activity feed
```

For feature-specific screenshots:
```
feature-name-before.png
feature-name-after.png
feature-name-step1.png
feature-name-step2.png
```

### Image Quality

- **Resolution**: Capture at standard sizes (1920x1080 or 1440x900)
- **Format**: PNG for UI screenshots (better quality than JPEG)
- **Compression**: Use original quality, don't compress
- **Cropping**: Show enough context, but focus on relevant areas

### Realistic Data

- Use sample data that looks realistic
- Avoid Lorem ipsum or "Test 1, Test 2, Test 3"
- Show meaningful names, dates, and content
- Demonstrate actual use cases

## Using Screenshots in Pull Requests

The PR template (`.github/pull_request_template.md`) includes a Screenshots section. Use it like this:

### Example 1: New Feature

```markdown
## Screenshots

### New Ticket Creation Flow

![Create ticket button](screenshots/create-ticket-button.png)

Click the "Create Ticket" button in the project view.

![Create ticket modal](screenshots/create-ticket-modal.png)

Fill in ticket details in the modal.

![Ticket created](screenshots/ticket-created.png)

New ticket appears in the kanban board.
```

### Example 2: Bug Fix

```markdown
## Screenshots

### Before (Bug)
![Bug: Ticket title overflow](screenshots/bug-ticket-overflow-before.png)

Long ticket titles were overflowing the card container.

### After (Fixed)
![Fixed: Ticket title truncated](screenshots/bug-ticket-overflow-after.png)

Ticket titles now truncate with ellipsis.
```

### Example 3: UI Improvement

```markdown
## Screenshots

| Before | After |
|--------|-------|
| ![Before: Plain sidebar](screenshots/sidebar-before.png) | ![After: Icon sidebar](screenshots/sidebar-after.png) |
| Plain text sidebar | Added icons for better visual hierarchy |
```

## Troubleshooting

### Server Won't Start

**Problem**: `npm run screenshot` fails to start the server

**Solutions**:
- Check if port 5173 is already in use: `lsof -i :5173`
- Install dependencies: `npm install`
- Try running `npm run dev` directly to see error messages

### Screenshots Are Blank

**Problem**: Screenshots show a white or blank page

**Solutions**:
- Wait longer for the app to load (especially on first run)
- Check browser console for JavaScript errors
- Verify the server is actually running: `curl http://localhost:5173`

### Can't Use Playwright

**Problem**: Playwright MCP tools aren't available in Claude Code

**Solutions**:
- Use manual screenshot capture
- Install Playwright locally: `npm install -D playwright`
- Check Claude Code MCP server configuration

### Git Worktree Issues

**Problem**: Dependencies not found in worktree

**Solutions**:
- Symlink node_modules: `ln -s /path/to/main/repo/node_modules .`
- Install dependencies in worktree: `npm install`
- Run commands from the main repository directory

## Advanced: Custom Screenshot Automation

If you want to create custom screenshot automation:

```typescript
// scripts/custom-screenshots.ts
import { chromium } from 'playwright';

async function captureScreenshots() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');

  // Capture main view
  await page.screenshot({ path: 'screenshots/main-view.png' });

  // Click on Projects
  await page.click('text=Projects');
  await page.screenshot({ path: 'screenshots/projects-view.png' });

  // Add more captures as needed

  await browser.close();
}

captureScreenshots();
```

Then run with: `npx tsx scripts/custom-screenshots.ts`

## Contributing

When adding screenshots to a PR:

1. ✅ **DO** capture relevant views that show your changes
2. ✅ **DO** use descriptive filenames
3. ✅ **DO** include before/after comparisons for changes
4. ✅ **DO** show realistic, meaningful data
5. ✅ **DO** reference screenshots in your PR description

6. ❌ **DON'T** commit unrelated or outdated screenshots
7. ❌ **DON'T** use compressed or low-quality images
8. ❌ **DON'T** include screenshots with sensitive information
9. ❌ **DON'T** forget to add alt text in markdown for accessibility

## Resources

- [PR Template](.github/pull_request_template.md) - Use this when creating PRs
- [Playwright Documentation](scripts/capture-with-playwright.md) - Detailed Playwright guide
- [Screenshot Directory](screenshots/README.md) - Screenshot storage info
- [Screenshot Script](scripts/generate-screenshots.ts) - The automation script

## Questions?

If you have questions about screenshot generation or run into issues not covered here, please:

1. Check the troubleshooting section above
2. Look at recent PRs to see examples
3. Ask in the project discussions or issues

Happy screenshotting! 📸
