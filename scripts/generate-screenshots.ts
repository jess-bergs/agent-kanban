#!/usr/bin/env node
/**
 * Captures screenshots of Agent Kanban using Playwright (headless Chromium).
 *
 * Usage:
 *   npm run screenshot                  # Starts dev server, captures, then exits
 *   npm run screenshot -- --url http://localhost:5174  # Use already-running server
 *   npm run screenshot -- --out ./my-screenshots       # Custom output directory
 *
 * Requires Playwright to be installed (globally or via npx).
 */

import { spawn, type ChildProcess } from 'child_process';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const appUrl = getArg('url') || 'http://localhost:5174';
const outDir = resolve(getArg('out') || join(projectRoot, 'screenshots'));
const shouldStartServer = !getArg('url');

async function waitForServer(url: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not ready
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  console.log(`Screenshots will be saved to: ${outDir}`);
  await mkdir(outDir, { recursive: true });

  let serverProc: ChildProcess | undefined;
  if (shouldStartServer) {
    console.log('Starting dev server...');
    serverProc = spawn('npm', ['run', 'dev'], {
      cwd: projectRoot,
      stdio: 'ignore',
      shell: true,
      detached: true,
    });
  }

  try {
    console.log(`Waiting for app at ${appUrl}...`);
    const ready = await waitForServer(appUrl);
    if (!ready) {
      console.error('App did not become ready in time.');
      process.exit(1);
    }
    console.log('App is ready.');
    await new Promise(r => setTimeout(r, 2000));

    // Write a Playwright capture script and run it
    const scriptPath = join(outDir, '_capture.mjs');
    const script = `
import { chromium } from 'playwright';
import { join } from 'path';

const baseUrl = ${JSON.stringify(appUrl)};
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
      console.error('Captured: ' + view.name + '.png');
    } catch (err) {
      console.error('Failed to capture ' + view.name + ':', err.message);
    }
  }

  await browser.close();
  console.log(JSON.stringify(captured));
})();
`;

    await writeFile(scriptPath, script);

    try {
      const result = execFileSync('node', [scriptPath], {
        encoding: 'utf-8',
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      const lines = result.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      const paths: string[] = JSON.parse(lastLine);
      console.log(`\nCaptured ${paths.length} screenshot(s):`);
      for (const p of paths) {
        console.log(`  ${p}`);
      }
    } finally {
      try { await rm(scriptPath); } catch {}
    }
  } finally {
    if (serverProc?.pid) {
      try { process.kill(-serverProc.pid, 'SIGTERM'); } catch {}
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
