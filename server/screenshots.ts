/**
 * Post-PR screenshot capture and upload.
 *
 * After a dispatched agent creates a PR, this module:
 * 1. Starts the dev server in the worktree
 * 2. Captures screenshots of key views using Playwright (via npx)
 * 3. Uploads images to the PR body via `gh`
 * 4. Tears down the dev server
 *
 * Designed to run as a best-effort step — failures don't block the ticket.
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Ticket } from '../src/types.ts';
import { getProject } from './store.ts';

const SCREENSHOT_TIMEOUT_MS = 60_000;

interface ScreenshotResult {
  success: boolean;
  screenshots: string[];
  error?: string;
}

/**
 * Wait for a URL to respond with HTTP 200.
 */
async function waitForServer(url: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Start the dev server (both backend + vite) in a worktree directory.
 * Returns the child process and a cleanup function.
 */
function startDevServer(cwd: string): { proc: ChildProcess; kill: () => void } {
  // Check if node_modules exists, if not symlink from main repo
  try {
    execFileSync('test', ['-d', 'node_modules'], { cwd, stdio: 'ignore' });
  } catch {
    try {
      const mainRepo = execFileSync(
        'git', ['rev-parse', '--git-common-dir'],
        { cwd, encoding: 'utf-8' },
      ).trim();
      const mainRoot = join(mainRepo, '..');
      execFileSync('ln', ['-sf', join(mainRoot, 'node_modules'), 'node_modules'], {
        cwd, stdio: 'ignore',
      });
    } catch {
      // Can't symlink — npm run dev will likely fail
    }
  }

  const proc = spawn('npm', ['run', 'dev'], {
    cwd,
    stdio: 'ignore',
    shell: true,
    detached: true,
  });

  return {
    proc,
    kill: () => {
      try {
        if (proc.pid) process.kill(-proc.pid, 'SIGTERM');
      } catch {
        proc.kill('SIGTERM');
      }
    },
  };
}

/**
 * Capture screenshots of the running app using Playwright.
 * Writes a temporary capture script, runs it with node, and parses the output.
 */
async function captureWithPlaywright(
  baseUrl: string,
  outDir: string,
): Promise<string[]> {
  await mkdir(outDir, { recursive: true });

  const scriptPath = join(outDir, '_capture.mjs');
  const script = `
import { chromium } from 'playwright';
import { join } from 'path';

const baseUrl = ${JSON.stringify(baseUrl)};
const outDir = ${JSON.stringify(outDir)};

const views = [
  { name: 'dashboard', path: '/', waitFor: 2000 },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const captured = [];
  for (const view of views) {
    try {
      await page.goto(baseUrl + view.path, { waitUntil: 'networkidle', timeout: 15000 });
      if (view.waitFor) await page.waitForTimeout(view.waitFor);
      const filePath = join(outDir, view.name + '.png');
      await page.screenshot({ path: filePath, fullPage: false });
      captured.push(filePath);
    } catch (err) {
      console.error('Failed to capture ' + view.name + ':', err.message);
    }
  }

  await browser.close();
  console.log(JSON.stringify(captured));
})();
`;

  await writeFile(scriptPath, script);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const nodeProc = spawn('node', [scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: SCREENSHOT_TIMEOUT_MS,
    });

    nodeProc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    nodeProc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    nodeProc.on('close', async (code) => {
      try { await rm(scriptPath); } catch { /* cleanup best-effort */ }

      if (code !== 0) {
        reject(new Error(`Playwright capture failed (code ${code}): ${stderr.slice(-500)}`));
        return;
      }

      const lines = stdout.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      try {
        const paths = JSON.parse(lastLine);
        resolve(Array.isArray(paths) ? paths : []);
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Upload screenshot images to a GitHub PR.
 * Commits screenshots to the branch, pushes, and updates the PR body.
 */
async function uploadScreenshotsToPr(
  prUrl: string,
  screenshotPaths: string[],
  cwd: string,
): Promise<void> {
  if (screenshotPaths.length === 0) return;

  // Read current PR body
  let currentBody = '';
  try {
    currentBody = execFileSync(
      'gh', ['pr', 'view', prUrl, '--json', 'body', '--jq', '.body'],
      { cwd, encoding: 'utf-8', timeout: 10000 },
    ).trim();
  } catch {
    // couldn't read, will create fresh
  }

  // Get branch and repo info
  let branch: string;
  let repoFullName: string;
  try {
    const prInfoJson = execFileSync(
      'gh', ['pr', 'view', prUrl, '--json', 'headRefName,headRepository'],
      { cwd, encoding: 'utf-8', timeout: 10000 },
    ).trim();
    const prInfo = JSON.parse(prInfoJson);
    branch = prInfo.headRefName;
    repoFullName = prInfo.headRepository?.nameWithOwner;
    if (!repoFullName) {
      repoFullName = execFileSync(
        'gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
        { cwd, encoding: 'utf-8', timeout: 10000 },
      ).trim();
    }
  } catch {
    return; // can't determine repo info
  }

  // Copy screenshots into a screenshots/ dir in the worktree
  execFileSync('mkdir', ['-p', 'screenshots'], { cwd, stdio: 'ignore' });

  const commitPaths: string[] = [];
  const imageMarkdownLines: string[] = [];

  for (const srcPath of screenshotPaths) {
    const filename = srcPath.split('/').pop()!;
    const destPath = join('screenshots', filename);
    try {
      execFileSync('cp', [srcPath, join(cwd, destPath)], { stdio: 'ignore' });
      commitPaths.push(destPath);
      const rawUrl = `https://raw.githubusercontent.com/${repoFullName}/${branch}/${destPath}`;
      imageMarkdownLines.push(`![${filename}](${rawUrl})`);
    } catch {
      // skip this screenshot
    }
  }

  if (commitPaths.length === 0) return;

  // Stage, commit, and push
  try {
    for (const p of commitPaths) {
      execFileSync('git', ['add', p], { cwd, stdio: 'ignore' });
    }
    execFileSync('git', ['commit', '-m', 'Add UI screenshots for PR'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['push'], { cwd, stdio: 'ignore', timeout: 30000 });
  } catch {
    return; // commit/push failed
  }

  // Build the screenshot markdown section
  const screenshotSection = [
    '## Screenshots',
    '',
    ...imageMarkdownLines,
  ].join('\n');

  // Update PR body
  let newBody: string;
  if (currentBody.includes('## Screenshots')) {
    newBody = currentBody.replace(
      /## Screenshots[\s\S]*?(?=\n## |\s*$)/,
      screenshotSection,
    );
  } else {
    newBody = currentBody + '\n\n' + screenshotSection;
  }

  try {
    execFileSync('gh', ['pr', 'edit', prUrl, '--body', newBody], {
      cwd, encoding: 'utf-8', timeout: 15000,
    });
    console.log(`[screenshots] Added ${commitPaths.length} screenshot(s) to PR: ${prUrl}`);
  } catch {
    // Body update failed — try as a comment
    const comment = `## UI Screenshots\n\n${imageMarkdownLines.join('\n\n')}`;
    try {
      execFileSync('gh', ['pr', 'comment', prUrl, '--body', comment], {
        cwd, encoding: 'utf-8', timeout: 15000,
      });
      console.log(`[screenshots] Added ${commitPaths.length} screenshot(s) as comment on PR: ${prUrl}`);
    } catch {
      console.error('[screenshots] Failed to add screenshots to PR');
    }
  }
}

/**
 * Main entry point: capture screenshots of the app and attach them to a PR.
 * Called by the dispatcher after an agent finishes and a PR is detected.
 *
 * Best-effort — failures are logged but don't affect ticket status.
 */
export async function captureAndUploadScreenshots(
  ticket: Ticket,
): Promise<ScreenshotResult> {
  const tag = `[screenshots] Ticket #${ticket.id}`;

  if (!ticket.prUrl || !ticket.worktreePath) {
    return { success: false, screenshots: [], error: 'Missing PR URL or worktree path' };
  }

  const project = await getProject(ticket.projectId);
  if (!project) {
    return { success: false, screenshots: [], error: 'Project not found' };
  }

  const cwd = ticket.worktreePath;
  const outDir = join(cwd, 'screenshots');
  const appUrl = 'http://localhost:5174';

  console.log(`${tag}: Starting screenshot capture...`);

  const server = startDevServer(cwd);

  try {
    const ready = await waitForServer(appUrl, 30_000);
    if (!ready) {
      server.kill();
      return { success: false, screenshots: [], error: 'Dev server did not start in time' };
    }

    // Extra wait for JS hydration
    await new Promise(r => setTimeout(r, 2000));

    const screenshots = await captureWithPlaywright(appUrl, outDir);
    console.log(`${tag}: Captured ${screenshots.length} screenshot(s)`);

    await uploadScreenshotsToPr(ticket.prUrl, screenshots, cwd);

    server.kill();
    return { success: true, screenshots };
  } catch (err) {
    server.kill();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag}: Screenshot capture failed: ${msg}`);
    return { success: false, screenshots: [], error: msg };
  }
}
