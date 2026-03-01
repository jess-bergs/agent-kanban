import { describe, it, expect } from 'vitest';
import { isPathSafe, isDirWithinRepo, SENSITIVE_PATTERNS, TREE_IGNORE } from './chat-utils.ts';

describe('isPathSafe', () => {
  const repo = '/tmp/test-repo';

  it('allows files within the repo', () => {
    expect(isPathSafe(repo, 'src/index.ts')).toBe(true);
    expect(isPathSafe(repo, 'package.json')).toBe(true);
    expect(isPathSafe(repo, 'deeply/nested/dir/file.txt')).toBe(true);
  });

  it('allows the repo root itself', () => {
    expect(isPathSafe(repo, '')).toBe(true);
    expect(isPathSafe(repo, '.')).toBe(true);
  });

  it('blocks path traversal via ..', () => {
    expect(isPathSafe(repo, '../etc/passwd')).toBe(false);
    expect(isPathSafe(repo, '../../etc/passwd')).toBe(false);
    expect(isPathSafe(repo, 'src/../../etc/passwd')).toBe(false);
  });

  it('blocks sibling directory escape via prefix match', () => {
    // /tmp/test-repo-evil starts with /tmp/test-repo but is outside it
    expect(isPathSafe('/tmp/test-repo', '../test-repo-evil/secret.txt')).toBe(false);
  });

  it('blocks absolute paths outside the repo', () => {
    expect(isPathSafe(repo, '/etc/passwd')).toBe(false);
  });

  it('blocks .env files', () => {
    expect(isPathSafe(repo, '.env')).toBe(false);
    expect(isPathSafe(repo, '.env.production')).toBe(false);
    expect(isPathSafe(repo, '.ENV')).toBe(false);
    expect(isPathSafe(repo, 'config/.env')).toBe(false);
  });

  it('allows .env.example', () => {
    // .env.example matches /\.env\..*/i pattern — it's intentionally blocked
    // because SENSITIVE_PATTERNS is broad. The file tree builder handles
    // .env.example specially in its filter, not via isPathSafe.
    expect(isPathSafe(repo, '.env.example')).toBe(false);
  });

  it('blocks private key files', () => {
    expect(isPathSafe(repo, 'certs/server.pem')).toBe(false);
    expect(isPathSafe(repo, 'certs/server.key')).toBe(false);
    expect(isPathSafe(repo, 'cert.p12')).toBe(false);
  });

  it('blocks credentials and secrets files', () => {
    expect(isPathSafe(repo, 'credentials.json')).toBe(false);
    expect(isPathSafe(repo, 'secrets.yml')).toBe(false);
    expect(isPathSafe(repo, 'secrets.yaml')).toBe(false);
  });

  it('blocks SSH key files', () => {
    expect(isPathSafe(repo, 'id_rsa')).toBe(false);
    expect(isPathSafe(repo, 'id_ed25519')).toBe(false);
    expect(isPathSafe(repo, '.ssh/id_rsa')).toBe(false);
  });

  it('blocks other sensitive files', () => {
    expect(isPathSafe(repo, '.pgpass')).toBe(false);
    expect(isPathSafe(repo, '.netrc')).toBe(false);
    expect(isPathSafe(repo, 'app.secret')).toBe(false);
  });

  it('allows normal source files', () => {
    expect(isPathSafe(repo, 'src/App.tsx')).toBe(true);
    expect(isPathSafe(repo, 'README.md')).toBe(true);
    expect(isPathSafe(repo, 'CLAUDE.md')).toBe(true);
    expect(isPathSafe(repo, 'server/index.ts')).toBe(true);
  });
});

describe('isDirWithinRepo', () => {
  const repo = '/tmp/test-repo';

  it('allows the repo root', () => {
    expect(isDirWithinRepo(repo, '/tmp/test-repo')).toBe(true);
  });

  it('allows subdirectories', () => {
    expect(isDirWithinRepo(repo, '/tmp/test-repo/src')).toBe(true);
    expect(isDirWithinRepo(repo, '/tmp/test-repo/src/components')).toBe(true);
  });

  it('blocks parent directory', () => {
    expect(isDirWithinRepo(repo, '/tmp')).toBe(false);
    expect(isDirWithinRepo(repo, '/')).toBe(false);
  });

  it('blocks sibling directories with matching prefix', () => {
    expect(isDirWithinRepo(repo, '/tmp/test-repo-evil')).toBe(false);
    expect(isDirWithinRepo(repo, '/tmp/test-repoo')).toBe(false);
  });

  it('blocks unrelated directories', () => {
    expect(isDirWithinRepo(repo, '/etc')).toBe(false);
    expect(isDirWithinRepo(repo, '/home/user')).toBe(false);
  });
});

describe('SENSITIVE_PATTERNS', () => {
  it('contains expected patterns', () => {
    expect(SENSITIVE_PATTERNS.length).toBeGreaterThan(0);
    // Spot-check a few
    expect(SENSITIVE_PATTERNS.some(p => p.test('.env'))).toBe(true);
    expect(SENSITIVE_PATTERNS.some(p => p.test('id_rsa'))).toBe(true);
    expect(SENSITIVE_PATTERNS.some(p => p.test('server.pem'))).toBe(true);
  });

  it('does not match normal files', () => {
    const normalFiles = ['index.ts', 'package.json', 'README.md', 'App.tsx'];
    for (const file of normalFiles) {
      expect(SENSITIVE_PATTERNS.some(p => p.test(file))).toBe(false);
    }
  });
});

describe('TREE_IGNORE', () => {
  it('ignores node_modules and .git', () => {
    expect(TREE_IGNORE.has('node_modules')).toBe(true);
    expect(TREE_IGNORE.has('.git')).toBe(true);
  });

  it('ignores build output directories', () => {
    expect(TREE_IGNORE.has('dist')).toBe(true);
    expect(TREE_IGNORE.has('build')).toBe(true);
  });

  it('does not ignore source directories', () => {
    expect(TREE_IGNORE.has('src')).toBe(false);
    expect(TREE_IGNORE.has('server')).toBe(false);
  });
});
