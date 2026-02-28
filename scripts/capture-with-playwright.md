# Automated Screenshot Capture with Playwright

This guide explains how to use Claude Code with Playwright MCP tools to automatically capture screenshots of the Agent Kanban application.

## Prerequisites

1. Claude Code with Playwright MCP tools enabled
2. Development server running (or use the script to start it)

## Usage

### Option 1: Manual with Running Server

1. Start the dev server:
   ```bash
   npm run dev
   ```

2. In Claude Code, request:
   ```
   Take screenshots of the Agent Kanban app at http://localhost:5173.
   Capture the following views and save them to ./screenshots/:
   - Main dashboard (projects view)
   - Teams view
   - Agents view (if available)
   - Empty state
   - A ticket detail modal
   ```

### Option 2: Use the Screenshot Script

1. Run the screenshot generation script:
   ```bash
   npm run screenshot
   ```

2. The script will:
   - Start the development server
   - Wait for it to be ready
   - Provide instructions for manual or automated capture
   - Keep the server running until you press Ctrl+C

3. While the script is running, ask Claude Code to capture screenshots using Playwright.

## Example Claude Code Prompts

### Basic Screenshot Capture
```
Navigate to http://localhost:5173 and take screenshots of:
1. The main projects view - save as screenshots/main-view.png
2. The sidebar showing all projects - save as screenshots/sidebar.png
3. The empty state view - save as screenshots/empty-state.png
```

### Interactive Screenshot Session
```
Navigate to http://localhost:5173. Take a screenshot of the main view.
Then click on different views (Projects, Teams, Agents) and capture each.
Save all screenshots to the screenshots directory with descriptive names.
```

### Full Feature Documentation
```
Navigate to http://localhost:5173 and document the UI:
1. Take a screenshot of the main dashboard
2. Click on "Create Project" and screenshot the modal
3. Create a sample project and screenshot the result
4. Create a sample ticket and screenshot that
5. Open the ticket detail and screenshot it
Save all with descriptive filenames in screenshots/
```

## Tips

- **Clear screenshots directory first**: Remove old screenshots before generating new ones
- **Use descriptive filenames**: Include the feature or view name in the filename
- **Capture at consistent viewport**: Ask Claude to resize the browser to a standard size (e.g., 1920x1080)
- **Show realistic data**: If possible, create sample data before capturing screenshots
- **Dark mode**: The app uses a dark theme, so screenshots will show this

## Troubleshooting

### Server not starting
- Check if port 5173 is already in use
- Ensure all dependencies are installed (`npm install`)

### Screenshots are blank
- Wait a bit longer for the app to fully load
- Check browser console for errors
- Verify the server is running and accessible

### Playwright not available
- Ensure Claude Code has Playwright MCP tools enabled
- Check Claude Code settings and MCP server configuration

## Manual Screenshot Workflow

If automated screenshots aren't working:

1. Start dev server: `npm run dev`
2. Open http://localhost:5173 in your browser
3. Use your OS screenshot tool:
   - **macOS**: Cmd + Shift + 4, then Space, then click window
   - **Windows**: Snipping Tool or Win + Shift + S
   - **Linux**: gnome-screenshot or spectacle
4. Save to the `screenshots/` directory with descriptive names

## Screenshot Naming Convention

Use clear, descriptive names that indicate what the screenshot shows:

- `main-dashboard.png` - Main landing page
- `projects-list.png` - Projects view with multiple projects
- `project-empty-state.png` - Empty state when no projects exist
- `ticket-detail.png` - Ticket detail modal
- `agents-kanban.png` - Agents kanban view
- `teams-view.png` - Teams view with tasks
- `create-project-modal.png` - Create project modal
- `create-ticket-modal.png` - Create ticket modal

## Adding Screenshots to PRs

After generating screenshots, reference them in your PR description:

```markdown
## Screenshots

### Before
![Before changes](screenshots/before-feature.png)

### After
![After changes](screenshots/after-feature.png)

### New Feature
![New ticket creation flow](screenshots/create-ticket-modal.png)
```
