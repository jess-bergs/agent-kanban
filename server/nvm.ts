/**
 * Helpers for spawning processes with the correct Node version via nvm.
 *
 * When the dispatcher or auditor spawns a `claude` agent, that agent may in
 * turn run `node`, `npm`, or `npx` commands inside the worktree. We need
 * those child processes to use the Node version pinned in .nvmrc rather than
 * whatever version happens to be on the system PATH.
 *
 * Strategy: detect the nvm-managed Node binary directory for the version
 * specified in .nvmrc, then prepend it to PATH in the spawn environment.
 * This avoids shell wrappers and works with spawn()'s default no-shell mode.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

let cachedNodeBinDir: string | null | undefined; // undefined = not yet computed

/**
 * Resolve the nvm-managed Node binary directory for the version in .nvmrc.
 * Returns null if nvm is not available or the version isn't installed.
 */
function resolveNvmNodeBin(): string | null {
  const nvmDir = process.env.NVM_DIR || join(homedir(), '.nvm');
  const nvmSh = join(nvmDir, 'nvm.sh');

  if (!existsSync(nvmSh)) {
    console.log('[nvm] nvm not found, agents will use system Node');
    return null;
  }

  // Read the .nvmrc from the project root (where package.json lives)
  const projectRoot = join(import.meta.dirname, '..');
  const nvmrcPath = join(projectRoot, '.nvmrc');

  if (!existsSync(nvmrcPath)) {
    console.log('[nvm] No .nvmrc found, agents will use system Node');
    return null;
  }

  const requestedVersion = readFileSync(nvmrcPath, 'utf-8').trim();

  try {
    // Ask nvm to resolve the version and give us the path.
    // NOTE: We must use shell: true here because nvm.sh is a shell function,
    // not an executable. The inputs are hardcoded paths, not user-supplied.
    const nodePath = execSync(
      `source "${nvmSh}" --no-use && nvm which ${requestedVersion}`,
      { encoding: 'utf-8', shell: '/bin/bash', timeout: 10000 },
    ).trim();

    if (!nodePath || !existsSync(nodePath)) {
      console.warn(`[nvm] nvm resolved Node ${requestedVersion} to ${nodePath} but it does not exist`);
      return null;
    }

    // nodePath is e.g. /Users/x/.nvm/versions/node/v22.22.0/bin/node
    // We want the bin directory
    const binDir = join(nodePath, '..');
    console.log(`[nvm] Resolved Node ${requestedVersion} → ${binDir}`);
    return binDir;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[nvm] Failed to resolve Node ${requestedVersion}: ${msg}`);
    return null;
  }
}

/**
 * Get the nvm Node binary directory (cached after first call).
 */
function getNvmNodeBin(): string | null {
  if (cachedNodeBinDir === undefined) {
    cachedNodeBinDir = resolveNvmNodeBin();
  }
  return cachedNodeBinDir;
}

/**
 * Build an environment object with PATH adjusted to use the nvm-managed Node.
 * Takes a base env (typically the cleaned process.env) and returns a new env
 * with the nvm Node bin directory prepended to PATH.
 */
export function envWithNvmNode(baseEnv: Record<string, string | undefined>): Record<string, string | undefined> {
  const nvmBin = getNvmNodeBin();
  if (!nvmBin) return baseEnv;

  const currentPath = baseEnv.PATH || process.env.PATH || '';
  return {
    ...baseEnv,
    PATH: `${nvmBin}:${currentPath}`,
  };
}
