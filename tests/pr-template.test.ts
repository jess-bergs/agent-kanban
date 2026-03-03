import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { ensurePrTemplate } from '../server/pr-template.ts';

describe('ensurePrTemplate', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pr-template-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates .github/pull_request_template.md when it does not exist', async () => {
    const created = await ensurePrTemplate(tempDir);
    expect(created).toBe(true);

    const templatePath = join(tempDir, '.github', 'pull_request_template.md');
    expect(existsSync(templatePath)).toBe(true);

    const content = await readFile(templatePath, 'utf-8');
    expect(content).toContain('# Description');
    expect(content).toContain('## Changes');
    expect(content).toContain('## Type of Change');
    expect(content).toContain('## Checklist');
    expect(content).toContain('## Ticket');
  });

  it('is a no-op when template already exists', async () => {
    const githubDir = join(tempDir, '.github');
    await mkdir(githubDir, { recursive: true });
    const templatePath = join(githubDir, 'pull_request_template.md');
    await writeFile(templatePath, '# Custom template\n');

    const created = await ensurePrTemplate(tempDir);
    expect(created).toBe(false);

    // Original content is preserved
    const content = await readFile(templatePath, 'utf-8');
    expect(content).toBe('# Custom template\n');
  });

  it('creates .github directory if it does not exist', async () => {
    const githubDir = join(tempDir, '.github');
    expect(existsSync(githubDir)).toBe(false);

    await ensurePrTemplate(tempDir);
    expect(existsSync(githubDir)).toBe(true);
  });

  it('works when .github directory already exists but template is missing', async () => {
    const githubDir = join(tempDir, '.github');
    await mkdir(githubDir, { recursive: true });
    await writeFile(join(githubDir, 'other-file.md'), 'some content');

    const created = await ensurePrTemplate(tempDir);
    expect(created).toBe(true);

    const templatePath = join(githubDir, 'pull_request_template.md');
    expect(existsSync(templatePath)).toBe(true);
  });
});
