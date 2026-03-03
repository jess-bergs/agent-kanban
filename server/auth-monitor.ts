/**
 * Auth Monitor
 *
 * Monitors Claude Code OAuth subscription credentials stored in the macOS Keychain.
 * Broadcasts warnings when the token is close to expiring so the user can re-auth
 * before agents start silently failing.
 */
import { execSync } from 'node:child_process';
import type { WSEvent } from '../src/types.ts';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // check every 30 minutes
const WARN_THRESHOLD_MS = 2 * 60 * 60 * 1000; // warn when <2 hours remaining

let checkTimer: ReturnType<typeof setInterval> | null = null;
let broadcastFn: (event: WSEvent) => void = () => {};

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

/** Read OAuth credentials from macOS Keychain. */
function readKeychainCredentials(): {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  subscriptionType?: string;
  rateLimitTier?: string;
} | null {
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
  // Check if ANTHROPIC_API_KEY is set (agents won't use it, but good to know)
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
    status.warning = 'OAuth token EXPIRED — agents will fail. Run `claude auth login` to re-authenticate.';
  } else if (expiresIn < WARN_THRESHOLD_MS) {
    status.warning = `OAuth token expires in ${expiresInHuman} — consider running \`claude auth login\` soon.`;
  }

  // Note if API key is also present
  if (hasApiKey && !status.warning) {
    status.warning = 'ANTHROPIC_API_KEY is set in env but stripped for agents (using subscription).';
  }

  return status;
}

/** Periodic check — logs warnings and broadcasts auth status. */
function authCheckTick() {
  const status = getAuthStatus();

  if (status.warning) {
    console.log(`[auth-monitor] ${status.warning}`);
    broadcastFn({
      type: 'auth_status',
      data: status,
    });
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

  checkTimer = setInterval(authCheckTick, CHECK_INTERVAL_MS);
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
