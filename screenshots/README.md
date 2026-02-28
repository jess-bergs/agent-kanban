# Screenshots Directory

This directory contains screenshots of the Agent Kanban application for documentation and PR purposes.

## Purpose

Screenshots help reviewers quickly understand UI changes and new features without needing to run the application locally.

## Generating Screenshots

### Automated (Recommended)

Run the screenshot generation script:

```bash
npm run screenshot
```

This will:
1. Start the development server
2. Provide instructions for capturing screenshots
3. Keep the server running until you're done

For fully automated screenshot capture using Playwright, see [scripts/capture-with-playwright.md](../scripts/capture-with-playwright.md).

### Manual

1. Start the dev server: `npm run dev`
2. Open http://localhost:5173 in your browser
3. Use your OS screenshot tool to capture views
4. Save screenshots here with descriptive filenames

## Naming Convention

Use descriptive names that clearly indicate what the screenshot shows:

- `main-dashboard.png` - Main landing page
- `projects-list.png` - Projects view with data
- `project-empty-state.png` - Empty state
- `ticket-detail.png` - Ticket detail modal
- `agents-kanban.png` - Agents kanban view
- `teams-view.png` - Teams view
- `create-project-modal.png` - Project creation modal
- `create-ticket-modal.png` - Ticket creation modal

For feature-specific screenshots, include the feature name:
- `feature-name-before.png`
- `feature-name-after.png`

## Best Practices

1. **Clear, high-quality images**: Use full resolution, not compressed
2. **Consistent viewport**: Try to use the same browser window size
3. **Realistic data**: Show the app with sample data, not empty
4. **Clean up old screenshots**: Remove outdated screenshots before generating new ones
5. **Document in PRs**: Reference screenshots in your PR description

## Using Screenshots in Pull Requests

Add screenshots to your PR description like this:

```markdown
## Screenshots

### New Feature
![Feature screenshot](screenshots/new-feature.png)

### Before/After Comparison
| Before | After |
|--------|-------|
| ![Before](screenshots/before.png) | ![After](screenshots/after.png) |
```

## Git Ignore

Note: This directory is tracked by git. If you want to keep screenshots out of the repository:
1. Add `screenshots/*.png` to `.gitignore`
2. Only commit the README.md file
3. Generate screenshots as needed for PRs

Currently, we track screenshots to make PR reviews easier.
