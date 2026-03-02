/**
 * Centralized environment configuration with validation.
 *
 * All configurable values flow through this module.
 * On import, it reads from process.env and applies defaults.
 */

import { join } from 'node:path';
import { execSync } from 'node:child_process';

// ─── Helpers ────────────────────────────────────────────────────

function env(key: string, fallback?: string): string {
  return process.env[key] ?? fallback ?? '';
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (!val) return fallback;
  return val === '1' || val.toLowerCase() === 'true';
}

// ─── Commit SHA (resolved once at startup) ──────────────────────

let commitSha = 'unknown';
try {
  commitSha = execSync('git rev-parse --short HEAD', {
    encoding: 'utf-8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch { /* not in a git repo or git not available */ }

// ─── Config ─────────────────────────────────────────────────────

export const config = {
  /** Server */
  port: envInt('PORT', 3003),
  nodeEnv: env('NODE_ENV', 'development'),
  get isProduction() { return this.nodeEnv === 'production'; },

  /** Data directory — all JSON file persistence */
  dataDir: env('DATA_DIR', '') || join(import.meta.dirname, '..', 'data'),

  /** CORS — comma-separated origins, or '*' */
  allowedOrigins: env('ALLOWED_ORIGINS', 'http://localhost:5174'),

  /** Authentication — API key for cloud access */
  apiKey: env('API_KEY', ''),
  get authEnabled() { return this.apiKey.length > 0; },

  /** Anthropic — for the chat bot */
  anthropicApiKey: env('ANTHROPIC_API_KEY', ''),

  /** GitHub App — for cloud dispatcher/auditor git/gh operations */
  githubAppId: env('GITHUB_APP_ID', ''),
  githubAppPrivateKey: env('GITHUB_APP_PRIVATE_KEY', ''),
  githubAppInstallationId: env('GITHUB_APP_INSTALLATION_ID', ''),
  get githubAppEnabled() {
    return !!(this.githubAppId && this.githubAppPrivateKey && this.githubAppInstallationId);
  },

  /** Dispatcher */
  maxConcurrent: envInt('MAX_CONCURRENT', 5),
  worktreeDir: env('WORKTREE_DIR', '') || '/tmp/agent-kanban-worktrees',

  /** Version info */
  version: process.env.npm_package_version ?? '0.0.0',
  commitSha,
  builtAt: new Date().toISOString(),
} as const;

// ─── Validation ─────────────────────────────────────────────────

const warnings: string[] = [];

if (config.isProduction && !config.authEnabled) {
  warnings.push('API_KEY is not set — API and WebSocket are unprotected!');
}

if (config.isProduction && !config.allowedOrigins) {
  warnings.push('ALLOWED_ORIGINS is not set — CORS is wide open');
}

if (warnings.length > 0) {
  for (const w of warnings) {
    console.warn(`[config] WARNING: ${w}`);
  }
}

/** Log the active config (redacting secrets) */
export function logConfig(): void {
  console.log('[config] Active configuration:');
  console.log(`  NODE_ENV:          ${config.nodeEnv}`);
  console.log(`  PORT:              ${config.port}`);
  console.log(`  DATA_DIR:          ${config.dataDir}`);
  console.log(`  ALLOWED_ORIGINS:   ${config.allowedOrigins}`);
  console.log(`  AUTH_ENABLED:      ${config.authEnabled}`);
  console.log(`  GITHUB_APP:        ${config.githubAppEnabled ? 'configured' : 'not configured'}`);
  console.log(`  MAX_CONCURRENT:    ${config.maxConcurrent}`);
  console.log(`  WORKTREE_DIR:      ${config.worktreeDir}`);
  console.log(`  VERSION:           ${config.version} (${config.commitSha})`);
}
