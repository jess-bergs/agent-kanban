import path from 'node:path';

/** Patterns that should never be served to the chat context */
export const SENSITIVE_PATTERNS = [
  /\.env$/i, /\.env\..*/i, /\.pem$/i, /\.key$/i, /\.p12$/i,
  /credentials/i, /secrets?\.ya?ml$/i, /\.secret$/i,
  /id_rsa/i, /id_ed25519/i, /\.pgpass$/i, /\.netrc$/i,
];

/** Directories to skip when building file trees */
export const TREE_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'target', '.turbo', '.cache', 'coverage',
]);

/** Check whether a file path is safe to read (not sensitive, within repo) */
export function isPathSafe(repoPath: string, filePath: string): boolean {
  const resolved = path.resolve(repoPath, filePath);
  const repoRoot = path.resolve(repoPath);
  // Must stay within the repo directory
  if (resolved !== repoRoot && !resolved.startsWith(repoRoot + path.sep)) {
    return false;
  }
  // Block sensitive patterns
  const basename = path.basename(resolved);
  return !SENSITIVE_PATTERNS.some(p => p.test(basename));
}

/** Check whether a directory path stays within the repo root */
export function isDirWithinRepo(repoPath: string, dirPath: string): boolean {
  const repoRoot = path.resolve(repoPath);
  const resolved = path.resolve(dirPath);
  return resolved === repoRoot || resolved.startsWith(repoRoot + path.sep);
}
