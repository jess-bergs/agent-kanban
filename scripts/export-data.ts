#!/usr/bin/env -S npx tsx
/**
 * Export local data for migration to cloud.
 *
 * Creates a tarball of the data/ directory that can be imported on EC2.
 *
 * Usage:
 *   npx tsx scripts/export-data.ts                    # exports to ./agent-kanban-data-export.tar.gz
 *   npx tsx scripts/export-data.ts /path/to/output    # custom output path
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dirname, '..', 'data');
const outputPath = resolve(process.argv[2] || './agent-kanban-data-export.tar.gz');

if (!existsSync(DATA_DIR)) {
  console.error(`Data directory not found: ${DATA_DIR}`);
  process.exit(1);
}

console.log(`Exporting data from: ${DATA_DIR}`);
console.log(`Output: ${outputPath}`);

// Create tarball
execSync(`tar czf "${outputPath}" -C "${join(DATA_DIR, '..')}" data/`, {
  stdio: 'inherit',
});

console.log(`\nExport complete: ${outputPath}`);
console.log('\nTo import on EC2:');
console.log(`  scp ${outputPath} agentkanban@<ec2-host>:/tmp/`);
console.log('  npx tsx scripts/import-data.ts /tmp/agent-kanban-data-export.tar.gz');
