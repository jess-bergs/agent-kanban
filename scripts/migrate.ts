#!/usr/bin/env -S npx tsx
/**
 * Data Migration Runner
 *
 * Reads data/version.json, runs any pending migrations, and updates
 * the schema version. Migrations are defined in-file as numbered steps.
 *
 * Usage:
 *   npx tsx scripts/migrate.ts              # run pending migrations
 *   npx tsx scripts/migrate.ts --dry-run    # preview without applying
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Resolve DATA_DIR from env or default
const DATA_DIR = process.env.DATA_DIR || join(import.meta.dirname, '..', 'data');
const VERSION_FILE = join(DATA_DIR, 'version.json');
const dryRun = process.argv.includes('--dry-run');

interface DataVersion {
  schemaVersion: number;
  appVersion: string;
  migratedAt: number;
}

interface Migration {
  version: number;
  description: string;
  migrate: () => Promise<void>;
}

// ─── Migration Definitions ──────────────────────────────────────
// Add new migrations here. Each must have a unique, sequential version number.

const migrations: Migration[] = [
  // Example migration for future use:
  // {
  //   version: 2,
  //   description: 'Add priority field to tickets',
  //   async migrate() {
  //     const ticketsDir = join(DATA_DIR, 'tickets');
  //     const files = await readdir(ticketsDir);
  //     for (const file of files) {
  //       if (!file.endsWith('.json')) continue;
  //       const path = join(ticketsDir, file);
  //       const data = JSON.parse(await readFile(path, 'utf-8'));
  //       if (data.priority === undefined) {
  //         data.priority = 'medium';
  //         await writeFile(path, JSON.stringify(data, null, 2));
  //       }
  //     }
  //   },
  // },
];

// ─── Runner ─────────────────────────────────────────────────────

async function run() {
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Version file:  ${VERSION_FILE}`);
  if (dryRun) console.log('DRY RUN — no changes will be applied\n');

  // Read current version
  let current: DataVersion;
  if (existsSync(VERSION_FILE)) {
    current = JSON.parse(await readFile(VERSION_FILE, 'utf-8'));
  } else {
    console.log('No version.json found — initializing at schema version 1');
    current = { schemaVersion: 1, appVersion: '0.2.0', migratedAt: Date.now() };
    if (!dryRun) {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(VERSION_FILE, JSON.stringify(current, null, 2));
    }
  }

  console.log(`Current schema version: ${current.schemaVersion}`);

  // Find pending migrations
  const pending = migrations
    .filter(m => m.version > current.schemaVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    console.log('No pending migrations. Data is up to date.');
    return;
  }

  console.log(`\n${pending.length} migration(s) to apply:\n`);

  for (const migration of pending) {
    console.log(`  [${migration.version}] ${migration.description}`);
    if (!dryRun) {
      await migration.migrate();
      current.schemaVersion = migration.version;
      current.migratedAt = Date.now();
      await writeFile(VERSION_FILE, JSON.stringify(current, null, 2));
      console.log(`       ✓ Applied`);
    } else {
      console.log(`       (skipped — dry run)`);
    }
  }

  console.log(`\nMigration complete. Schema version: ${current.schemaVersion}`);
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
