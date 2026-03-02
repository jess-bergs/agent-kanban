#!/usr/bin/env -S npx tsx
/**
 * Import data from a local export to the cloud data directory.
 *
 * Extracts the tarball, optionally remaps repoPath values in project files
 * from local macOS paths to EC2 paths.
 *
 * Usage:
 *   npx tsx scripts/import-data.ts /path/to/agent-kanban-data-export.tar.gz
 *   npx tsx scripts/import-data.ts /path/to/export.tar.gz --remap /Users/jess/development=/home/agentkanban/repos
 */

import { execSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dirname, '..', 'data');

// Parse args
const args = process.argv.slice(2);
const tarball = args.find(a => !a.startsWith('--'));
const remapIdx = args.indexOf('--remap');
const remapRule = remapIdx >= 0 ? args[remapIdx + 1] : null;

if (!tarball) {
  console.error('Usage: npx tsx scripts/import-data.ts <tarball> [--remap <from>=<to>]');
  console.error('Example: npx tsx scripts/import-data.ts export.tar.gz --remap /Users/jess/development=/home/agentkanban/repos');
  process.exit(1);
}

if (!existsSync(tarball)) {
  console.error(`File not found: ${tarball}`);
  process.exit(1);
}

console.log(`Importing data to: ${DATA_DIR}`);
console.log(`Source: ${tarball}`);
if (remapRule) console.log(`Remap: ${remapRule}`);

// Extract tarball into DATA_DIR's parent
// The tarball contains data/ as top-level directory
execSync(`tar xzf "${tarball}" -C "${join(DATA_DIR, '..')}"`, {
  stdio: 'inherit',
});

console.log('Extraction complete.');

// Remap repoPath values in project files
if (remapRule) {
  const [fromPath, toPath] = remapRule.split('=');
  if (!fromPath || !toPath) {
    console.error('Invalid remap format. Use: --remap /old/path=/new/path');
    process.exit(1);
  }

  console.log(`\nRemapping repoPath: "${fromPath}" → "${toPath}"`);

  const projectsDir = join(DATA_DIR, 'projects');
  if (existsSync(projectsDir)) {
    const files = await readdir(projectsDir);
    let remapped = 0;

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(projectsDir, file);
      const data = JSON.parse(await readFile(filePath, 'utf-8'));

      if (data.repoPath && data.repoPath.startsWith(fromPath)) {
        const oldPath = data.repoPath;
        data.repoPath = data.repoPath.replace(fromPath, toPath);
        await writeFile(filePath, JSON.stringify(data, null, 2));
        console.log(`  ${data.name}: ${oldPath} → ${data.repoPath}`);
        remapped++;
      }
    }

    console.log(`\nRemapped ${remapped} project(s).`);
  }
}

console.log('\nImport complete!');
console.log('Run the migration script to ensure schema is current:');
console.log('  npx tsx scripts/migrate.ts');
