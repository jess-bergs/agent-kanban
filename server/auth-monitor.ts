/**
 * Auth Monitor
 *
 * Monitors Claude Code OAuth subscription credentials stored in the macOS Keychain.
 * Proactively refreshes the access token before it expires so agents always have
 * valid credentials — even overnight when no agents are running.
 */
import { execSync, spawn } from 'node:child_process';
import { envWithNvmNode } from './nvm.ts';
import type { WSEvent } from '../src/types.ts';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // check every 30 minutes
const REFRESH_THRESHOLD_MS = 60 * 60 * 1000; // refresh when <1 hour remaining
const WARN_THRESHOLD_MS = 10 * 60 * 1000; // warn when <10 min remaining (refresh failed)

let checkTimer: ReturnType<typeof setInterval> | null = null;
let broadcastFn: (event: WSEvent) => void = () => {};
let refreshInProgress = false;

export interface AuthStatus {
  ok: boolean;
  source: 'subscription' | 'api_key' | 'none';
  subscriptionType?: string;
  rateLimitTier?: string;
  expiresAt?: number;
  expiresIn?: number; // ms remaining
  expiresInHuman?: string;
  email?: string;
  warning?: string;
}

interface OAuthCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  subscriptionType?: string;
  rateLimitTier?: string;
}

/** Read OAuth credentials from macOS Keychain. */
function readKeychainCredentials(): OAuthCredentials | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    const parsed = JSON.parse(raw);
    return parsed?.claudeAiOauth || null;
  } catch {
    return null;
  }
}

/** Get current auth status with expiration info. */
export function getAuthStatus(): AuthStatus {
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const creds = readKeychainCredentials();

  if (!creds) {
    return {
      ok: false,
      source: hasApiKey ? 'api_key' : 'none',
      warning: hasApiKey
        ? 'Using API key (agents strip this — subscription auth not found in Keychain)'
        : 'No auth found — agents will fail',
    };
  }

  const now = Date.now();
  const expiresAt = creds.expiresAt || 0;
  const expiresIn = expiresAt - now;

  const hours = Math.floor(expiresIn / 1000 / 60 / 60);
  const mins = Math.floor((expiresIn / 1000 / 60) % 60);
  const expiresInHuman = expiresIn > 0
    ? `${hours}h ${mins}m`
    : 'EXPIRED';

  const status: AuthStatus = {
    ok: expiresIn > 0,
    source: 'subscription',
    subscriptionType: creds.subscriptionType,
    rateLimitTier: creds.rateLimitTier,
    expiresAt,
    expiresIn: Math.max(0, expiresIn),
    expiresInHuman,
  };

  if (expiresIn <= 0) {
    status.warning = 'OAuth token EXPIRED — run `claude auth login` to re-authenticate.';
  } else if (expiresIn < WARN_THRESHOLD_MS) {
    status.warning = `OAuth token expires in ${expiresInHuman} — auto-refresh may have failed.`;
  }

  if (hasApiKey && !status.warning) {
    status.warning = 'ANTHROPIC_API_KEY is set in env but stripped for agents (using subscription).';
  }

  return status;
}

/**
 * Proactively refresh the OAuth token by spawning a short-lived `claude` process.
 *
 * Claude Code checks token expiry on startup (within 5 min buffer) and refreshes
 * if needed. We spawn `claude -p "echo ok" --max-turns 1` which triggers the
 * built-in refresh, writes the new token to Keychain, and exits.
 */
async function proactiveRefresh(): Promise<boolean> {
  if (refreshInProgress) return false;
  refreshInProgress = true;

  console.log('[auth-monitor] Token expiring soon — triggering proactive refresh...');

  return new Promise<boolean>((resolve) => {
    // Strip env vars that block nested sessions (same as dispatcher)
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE;
    for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith('CLAUDE_CODE_')) delete cleanEnv[key];
    }
    delete cleanEnv.ANTHROPIC_API_KEY;
    cleanEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';

    const proc = spawn('claude', ['-p', 'Reply with just the word OK', '--max-turns', '1'], {
      cwd: '/tmp',
      env: envWithNvmNode(cleanEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });

    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
    }, 30_000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      refreshInProgress = false;

      if (code === 0) {
        const after = readKeychainCredentials();
        const newExpiry = after?.expiresAt ? after.expiresAt - Date.now() : 0;
        const hours = Math.floor(newExpiry / 1000 / 60 / 60);
        const mins = Math.floor((newExpiry / 1000 / 60) % 60);
        console.log(`[auth-monitor] Token refreshed — new expiry in ${hours}h ${mins}m`);
        resolve(true);
      } else {
        console.error(`[auth-monitor] Refresh failed (code=${code}): ${stderr.slice(-200)}`);
        resolve(false);
      }
    });
  });
}

/** Periodic check — refreshes proactively, warns on failure. */
async function authCheckTick() {
  const status = getAuthStatus();

  // Proactively refresh if token is close to expiry
  if (status.source === 'subscription' && status.expiresIn !== undefined) {
    if (status.expiresIn > 0 && status.expiresIn < REFRESH_THRESHOLD_MS) {
      const refreshed = await proactiveRefresh();
      if (refreshed) {
        // Re-check after refresh
        const newStatus = getAuthStatus();
        broadcastFn({ type: 'auth_status', data: newStatus });
        return;
      }
    }
  }

  if (status.warning) {
    console.log(`[auth-monitor] ${status.warning}`);
    broadcastFn({ type: 'auth_status', data: status });
  }
}

/** Start periodic auth monitoring. */
export function startAuthMonitor() {
  if (checkTimer) return;

  const status = getAuthStatus();
  const tier = status.rateLimitTier ? ` (${status.rateLimitTier})` : '';
  const expiry = status.expiresInHuman ? `, expires in ${status.expiresInHuman}` : '';
  console.log(
    `[auth-monitor] Started — ${status.source} auth${tier}${expiry}`,
  );

  if (status.warning) {
    console.log(`[auth-monitor] WARNING: ${status.warning}`);
  }

  // If already close to expiry on startup, refresh immediately
  if (status.source === 'subscription' && status.expiresIn !== undefined &&
      status.expiresIn > 0 && status.expiresIn < REFRESH_THRESHOLD_MS) {
    proactiveRefresh().catch(err => {
      console.error('[auth-monitor] Startup refresh failed:', err);
    });
  }

  checkTimer = setInterval(() => {
    authCheckTick().catch(err => {
      console.error('[auth-monitor] Check tick failed:', err);
    });
  }, CHECK_INTERVAL_MS);
}

/** Stop periodic auth monitoring. */
export function stopAuthMonitor() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

/** Set the broadcast function for WebSocket events. */
export function setAuthMonitorBroadcast(fn: (event: WSEvent) => void) {
  broadcastFn = fn;
}
