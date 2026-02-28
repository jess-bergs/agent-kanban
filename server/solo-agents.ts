import { execSync } from 'node:child_process';
import { readdir, stat, open } from 'node:fs/promises';
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
  prompt: string | null;
  lastOutput: string | null;
}

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const HEAD_BYTES = 64 * 1024;  // 64KB from start for prompt
const TAIL_BYTES = 64 * 1024;  // 64KB from end for metadata + output

/** Get PIDs of running claude CLI processes with their cwds */
function getRunningClaudeProcesses(): Map<number, { cwd: string | null; source: 'terminal' | 'vscode' | 'dispatched' }> {
  const procs = new Map<number, { cwd: string | null; source: 'terminal' | 'vscode' | 'dispatched' }>();
  try {
    const raw = execSync(
      `ps -eo pid,args | grep -E '(^|/)claude( |$)' | grep -v grep`,
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();

    const pids: number[] = [];
    const pidArgs = new Map<number, string>();

    for (const line of raw.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      const pid = parseInt(match[1], 10);
      const args = match[2];
      if (args.includes('Claude.app') || args.includes('Claude Helper')) continue;
      pids.push(pid);
      pidArgs.set(pid, args);
    }

    // Get cwds for all PIDs using lsof (single call)
    if (pids.length > 0) {
      try {
        const lsofRaw = execSync(
          `lsof -a -d cwd -p ${pids.join(',')} -Fpn 2>/dev/null`,
          { encoding: 'utf-8', timeout: 5000 },
        ).trim();

        let currentPid: number | null = null;
        for (const line of lsofRaw.split('\n')) {
          if (line.startsWith('p')) {
            currentPid = parseInt(line.slice(1), 10);
          } else if (line.startsWith('n') && currentPid !== null) {
            const cwd = line.slice(1);
            const args = pidArgs.get(currentPid) ?? '';
            let source: 'terminal' | 'vscode' | 'dispatched' = 'terminal';
            if (args.includes('.vscode/extensions')) source = 'vscode';
            if (args.includes('-p ')) source = 'dispatched';
            procs.set(currentPid, { cwd, source });
          }
        }
      } catch {
        // lsof failed, fall back to no-cwd info
      }
    }

    // Add PIDs without cwd info
    for (const pid of pids) {
      if (!procs.has(pid)) {
        const args = pidArgs.get(pid) ?? '';
        let source: 'terminal' | 'vscode' | 'dispatched' = 'terminal';
        if (args.includes('.vscode/extensions')) source = 'vscode';
        if (args.includes('-p ')) source = 'dispatched';
        procs.set(pid, { cwd: null, source });
      }
    }
  } catch {
    // ps failed
  }
  return procs;
}

/** Extract first user message text from JSONL content */
function extractPrompt(text: string): string | null {
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'user') continue;
      const content = entry.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return content.slice(0, 500);
      }
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === 'text' && c.text?.trim()) {
            return c.text.slice(0, 500);
          }
        }
      }
    } catch { continue; }
  }
  return null;
}

/** Extract metadata + last assistant text from JSONL tail content */
function extractTailData(text: string): {
  cwd: string | null;
  sessionId: string | null;
  gitBranch: string | null;
  slug: string | null;
  version: string | null;
  model: string | null;
  lastOutput: string | null;
} {
  const result = {
    cwd: null as string | null,
    sessionId: null as string | null,
    gitBranch: null as string | null,
    slug: null as string | null,
    version: null as string | null,
    model: null as string | null,
    lastOutput: null as string | null,
  };

  const lines = text.split('\n').filter(l => l.trim());

  // Scan from end
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 100); i--) {
    try {
      const entry = JSON.parse(lines[i]);

      if (!result.model) {
        result.model = entry.model || entry.message?.model || null;
      }

      if (!result.cwd && entry.cwd && entry.sessionId) {
        result.cwd = entry.cwd;
        result.sessionId = entry.sessionId;
        result.gitBranch = entry.gitBranch || null;
        result.slug = entry.slug || null;
        result.version = entry.version || null;
      }

      if (!result.lastOutput && entry.message?.role === 'assistant') {
        const content = entry.message.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type === 'text' && c.text?.trim()) {
              result.lastOutput = c.text.slice(0, 500);
            }
          }
        }
      }

      if (result.cwd && result.lastOutput && result.model) break;
    } catch { continue; }
  }

  return result;
}

/** Read session data from JSONL using partial file reads */
async function readSessionData(jsonlPath: string): Promise<{
  cwd: string;
  sessionId: string;
  gitBranch: string | null;
  slug: string | null;
  version: string | null;
  model: string | null;
  prompt: string | null;
  lastOutput: string | null;
} | null> {
  try {
    const fileStat = await stat(jsonlPath);
    const fileSize = fileStat.size;
    const fh = await open(jsonlPath, 'r');

    try {
      // Read head for prompt
      const headSize = Math.min(HEAD_BYTES, fileSize);
      const headBuf = Buffer.alloc(headSize);
      await fh.read(headBuf, 0, headSize, 0);
      const prompt = extractPrompt(headBuf.toString('utf-8'));

      // Read tail for metadata + last output
      const tailOffset = Math.max(0, fileSize - TAIL_BYTES);
      const tailSize = Math.min(TAIL_BYTES, fileSize);
      const tailBuf = Buffer.alloc(tailSize);
      await fh.read(tailBuf, 0, tailSize, tailOffset);
      const tailData = extractTailData(tailBuf.toString('utf-8'));

      if (!tailData.cwd || !tailData.sessionId) return null;

      return {
        cwd: tailData.cwd,
        sessionId: tailData.sessionId,
        gitBranch: tailData.gitBranch,
        slug: tailData.slug,
        version: tailData.version,
        model: tailData.model,
        prompt,
        lastOutput: tailData.lastOutput,
      };
    } finally {
      await fh.close();
    }
  } catch { /* failed to read session file */ }
  return null;
}

/** Detect active solo Claude sessions */
export async function detectSoloAgents(): Promise<SoloAgent[]> {
  const runningProcs = getRunningClaudeProcesses();
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

        const sessionData = await readSessionData(jsonlPath);
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
          prompt: sessionData.prompt,
          lastOutput: sessionData.lastOutput,
        });
      }
    }
  } catch {
    // projects dir doesn't exist
  }

  // Match sessions to running processes by cwd
  for (const agent of agents) {
    for (const [pid, info] of runningProcs) {
      if (info.cwd && (info.cwd === agent.cwd || info.cwd.startsWith(agent.cwd + '/'))) {
        agent.pid = pid;
        agent.source = info.source;
        break;
      }
    }
  }

  // Filter: only show agents that have a running process OR very recent JSONL activity
  const recentThreshold = now - 20 * 1000; // 20 seconds grace period
  return agents
    .filter(a => a.pid !== null || a.lastActiveAt > recentThreshold)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

/** Find the session ID for an agent running in a given working directory */
export async function findSessionIdByCwd(targetCwd: string): Promise<string | null> {
  try {
    const projectDirs = await readdir(PROJECTS_DIR);

    for (const dir of projectDirs) {
      const projectPath = join(PROJECTS_DIR, dir);
      const dirStat = await stat(projectPath).catch(() => null);
      if (!dirStat?.isDirectory()) continue;

      const entries = await readdir(projectPath).catch(() => []);
      // Sort by modification time descending to find most recent first
      const jsonlFiles = entries.filter(e => e.endsWith('.jsonl'));
      const withStats = await Promise.all(
        jsonlFiles.map(async (f) => {
          const p = join(projectPath, f);
          const s = await stat(p).catch(() => null);
          return s ? { path: p, mtimeMs: s.mtimeMs, size: s.size } : null;
        })
      );
      const sorted = withStats.filter(Boolean).sort((a, b) => b!.mtimeMs - a!.mtimeMs) as { path: string; mtimeMs: number; size: number }[];

      for (const file of sorted) {
        const sessionData = await readSessionData(file.path);
        if (sessionData && sessionData.cwd === targetCwd) {
          return sessionData.sessionId;
        }
      }
    }
  } catch { /* projects dir doesn't exist */ }
  return null;
}
