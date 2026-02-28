import { execSync } from 'node:child_process';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface SoloAgent {
  sessionId: string;
  pid: number | null;
  cwd: string;
  projectName: string;
  gitBranch: string | null;
  slug: string | null;
  version: string | null;
  model: string | null;
  source: 'terminal' | 'vscode' | 'dispatched' | 'unknown';
  status: 'active' | 'idle';
  lastActiveAt: number;
}

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

/** Get PIDs of running claude CLI processes (not Claude.app, not helpers) */
function getRunningClaudePids(): Map<number, { args: string; source: 'terminal' | 'vscode' | 'dispatched' }> {
  const pids = new Map<number, { args: string; source: 'terminal' | 'vscode' | 'dispatched' }>();
  try {
    const raw = execSync(
      `ps -eo pid,args | grep -E '(^|/)claude( |$)' | grep -v grep`,
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();

    for (const line of raw.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      const pid = parseInt(match[1], 10);
      const args = match[2];

      if (args.includes('Claude.app') || args.includes('Claude Helper')) continue;

      let source: 'terminal' | 'vscode' | 'dispatched' = 'terminal';
      if (args.includes('.vscode/extensions')) source = 'vscode';
      if (args.includes('-p ')) source = 'dispatched';

      pids.set(pid, { args, source });
    }
  } catch {
    // ps failed
  }
  return pids;
}

/** Read session metadata from JSONL — scans from the end for cwd/sessionId */
async function readSessionMetadata(jsonlPath: string): Promise<{
  cwd: string;
  sessionId: string;
  gitBranch: string | null;
  slug: string | null;
  version: string | null;
  model: string | null;
} | null> {
  try {
    const content = await readFile(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n');

    let model: string | null = null;

    // Scan from end for metadata
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
      try {
        const entry = JSON.parse(lines[i]);

        // Capture model if we see it
        if (entry.model && !model) model = entry.model;

        if (entry.cwd && entry.sessionId) {
          return {
            cwd: entry.cwd,
            sessionId: entry.sessionId,
            gitBranch: entry.gitBranch || null,
            slug: entry.slug || null,
            version: entry.version || null,
            model,
          };
        }
      } catch { continue; }
    }
  } catch {}
  return null;
}

/** Detect active solo Claude sessions */
export async function detectSoloAgents(): Promise<SoloAgent[]> {
  const runningPids = getRunningClaudePids();
  const agents: SoloAgent[] = [];
  const seenSessions = new Set<string>();
  const now = Date.now();
  const cutoff = now - 5 * 60 * 1000;

  try {
    const projectDirs = await readdir(PROJECTS_DIR);

    for (const dir of projectDirs) {
      const projectPath = join(PROJECTS_DIR, dir);
      const dirStat = await stat(projectPath).catch(() => null);
      if (!dirStat?.isDirectory()) continue;

      const entries = await readdir(projectPath).catch(() => []);

      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        const jsonlPath = join(projectPath, entry);

        const fileStat = await stat(jsonlPath).catch(() => null);
        if (!fileStat || fileStat.mtimeMs < cutoff) continue;

        const sessionData = await readSessionMetadata(jsonlPath);
        if (!sessionData || seenSessions.has(sessionData.sessionId)) continue;
        seenSessions.add(sessionData.sessionId);

        const projectName = sessionData.cwd.split('/').pop() || sessionData.cwd;
        const ageSecs = (now - fileStat.mtimeMs) / 1000;

        agents.push({
          sessionId: sessionData.sessionId,
          pid: null,
          cwd: sessionData.cwd,
          projectName,
          gitBranch: sessionData.gitBranch,
          slug: sessionData.slug,
          version: sessionData.version,
          model: sessionData.model,
          source: 'unknown',
          status: ageSecs < 15 ? 'active' : 'idle',
          lastActiveAt: fileStat.mtimeMs,
        });
      }
    }
  } catch {
    // projects dir doesn't exist
  }

  // Match sessions to running processes
  const pidEntries = [...runningPids.entries()];

  for (const agent of agents) {
    if (agent.status === 'active' && pidEntries.length > 0) {
      for (const [pid, info] of pidEntries) {
        agent.source = info.source;
        agent.pid = pid;
        break;
      }
    }
  }

  // Only return agents active in the last 2 minutes
  const activeWindow = now - 2 * 60 * 1000;
  return agents
    .filter(a => a.lastActiveAt > activeWindow)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
