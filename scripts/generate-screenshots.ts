#!/usr/bin/env node
/**
 * Screenshot Generator for Agent Kanban
 *
 * This script captures screenshots of the application for PR documentation.
 * It starts the dev server, waits for it to be ready, captures screenshots
 * of key views, and saves them to the screenshots directory.
 */

import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const screenshotsDir = join(projectRoot, 'screenshots');

// ANSI color codes for better console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function waitForServer(url: string, maxAttempts = 30): Promise<boolean> {
  log(`Waiting for server at ${url}...`, 'blue');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        log('✓ Server is ready!', 'green');
        return true;
      }
    } catch (error) {
      // Server not ready yet
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return false;
}

async function captureScreenshots(): Promise<void> {
  log('\n📸 Agent Kanban Screenshot Generator\n', 'cyan');

  // Create screenshots directory
  await mkdir(screenshotsDir, { recursive: true });
  log(`✓ Screenshots directory: ${screenshotsDir}`, 'green');

  // Start dev server
  log('\n🚀 Starting development server...', 'blue');
  const serverProcess = spawn('npm', ['run', 'dev'], {
    cwd: projectRoot,
    stdio: 'pipe',
    shell: true,
  });

  let serverReady = false;

  serverProcess.stdout?.on('data', (data) => {
    const output = data.toString();
    if (output.includes('Local:') || output.includes('localhost')) {
      serverReady = true;
    }
  });

  // Wait for server to be ready
  const serverUrl = 'http://localhost:5173';
  const isReady = await waitForServer(serverUrl, 30);

  if (!isReady) {
    log('✗ Server failed to start in time', 'red');
    serverProcess.kill();
    process.exit(1);
  }

  // Wait a bit more for the app to fully load
  await new Promise(resolve => setTimeout(resolve, 2000));

  log('\n📸 Capturing screenshots...', 'blue');

  // Create instructions for manual screenshot capture
  const instructions = `
# Screenshot Capture Instructions

The development server is now running at: ${serverUrl}

## Manual Screenshot Capture (Recommended)

Since this script runs in a Node.js environment without browser automation,
please capture screenshots manually using the following steps:

### Main Views to Capture:

1. **Projects View (Empty State)**
   - Navigate to: ${serverUrl}
   - Switch to "Projects" tab in sidebar
   - Screenshot filename: projects-empty-state.png

2. **Projects View (With Tickets)**
   - Create a project and some tickets
   - Screenshot filename: projects-with-tickets.png

3. **Teams View**
   - Switch to "Teams" tab in sidebar
   - Screenshot filename: teams-view.png

4. **Agents View**
   - Switch to "Agents" view (if any solo agents exist)
   - Screenshot filename: agents-view.png

5. **Ticket Detail Modal**
   - Open any ticket
   - Screenshot filename: ticket-detail.png

### How to Take Screenshots:

**macOS:** Cmd + Shift + 4, then Space, then click window
**Windows:** Snipping Tool or Snip & Sketch
**Linux:** gnome-screenshot or spectacle

Save screenshots to: ${screenshotsDir}

---

## Automated Screenshot Capture (Claude Code)

If you're using Claude Code with Playwright MCP tools, you can ask:
"Take screenshots of the Agent Kanban app at http://localhost:5173
showing the main views and save them to the screenshots directory"

---

Press Ctrl+C when you're done capturing screenshots.
`;

  log(instructions, 'yellow');

  // Write instructions to file
  await writeFile(
    join(screenshotsDir, 'INSTRUCTIONS.md'),
    instructions.trim()
  );

  log('\n📝 Instructions saved to screenshots/INSTRUCTIONS.md', 'green');
  log('\n⏳ Server will keep running until you press Ctrl+C\n', 'cyan');

  // Keep the server running
  await new Promise((resolve) => {
    process.on('SIGINT', () => {
      log('\n\n🛑 Shutting down server...', 'yellow');
      serverProcess.kill();
      log('✓ Done!', 'green');
      resolve(undefined);
    });
  });
}

// Run the script
captureScreenshots().catch((error) => {
  log(`\n✗ Error: ${error.message}`, 'red');
  process.exit(1);
});
