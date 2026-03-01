import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteJson, withLock, safeReadJson, listJsonFiles } from './store.ts';
import type { AuditSchedule, AuditRun, AuditCadence } from '../src/types.ts';

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const SCHEDULES_DIR = join(DATA_DIR, 'audit-schedules');
const RUNS_DIR = join(DATA_DIR, 'audit-runs');

async function ensureAuditDirs() {
  await mkdir(SCHEDULES_DIR, { recursive: true });
  await mkdir(RUNS_DIR, { recursive: true });
}

// ─── Cadence Helpers ────────────────────────────────────────────

export function computeNextRun(cadence: AuditCadence, lastRunAt: number | undefined): number | undefined {
  if (cadence === 'manual') return undefined;

  const base = lastRunAt || Date.now();
  switch (cadence) {
    case 'hourly':  return base + 60 * 60 * 1000;
    case 'daily':   return base + 24 * 60 * 60 * 1000;
    case 'weekly':  return base + 7 * 24 * 60 * 60 * 1000;
    case 'monthly': return base + 30 * 24 * 60 * 60 * 1000;
    default:        return undefined;
  }
}

// ─── Schedules ──────────────────────────────────────────────────

export async function listSchedules(): Promise<AuditSchedule[]> {
  await ensureAuditDirs();
  return listJsonFiles<AuditSchedule>(SCHEDULES_DIR);
}

export async function listSchedulesByProject(projectId: string): Promise<AuditSchedule[]> {
  const all = await listSchedules();
  return all.filter(s => s.projectId === projectId);
}

export async function getSchedule(id: string): Promise<AuditSchedule | null> {
  return safeReadJson<AuditSchedule>(join(SCHEDULES_DIR, `${id}.json`));
}

export async function createSchedule(data: Omit<AuditSchedule, 'id' | 'createdAt'>): Promise<AuditSchedule> {
  await ensureAuditDirs();
  const schedule: AuditSchedule = {
    id: randomUUID(),
    createdAt: Date.now(),
    ...data,
    nextRunAt: computeNextRun(data.cadence, undefined),
  };
  await atomicWriteJson(join(SCHEDULES_DIR, `${schedule.id}.json`), schedule);
  return schedule;
}

export async function updateSchedule(
  id: string,
  updates: Partial<AuditSchedule>,
): Promise<AuditSchedule | null> {
  return withLock(`audit-schedule:${id}`, async () => {
    const schedule = await getSchedule(id);
    if (!schedule) return null;
    const updated = { ...schedule, ...updates, id: schedule.id };
    await atomicWriteJson(join(SCHEDULES_DIR, `${updated.id}.json`), updated);
    return updated;
  });
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const { unlink } = await import('node:fs/promises');
  try {
    await unlink(join(SCHEDULES_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

// ─── Runs ───────────────────────────────────────────────────────

export async function listRuns(): Promise<AuditRun[]> {
  await ensureAuditDirs();
  return listJsonFiles<AuditRun>(RUNS_DIR);
}

export async function listRunsBySchedule(scheduleId: string): Promise<AuditRun[]> {
  const all = await listRuns();
  return all.filter(r => r.scheduleId === scheduleId);
}

export async function getRun(id: string): Promise<AuditRun | null> {
  return safeReadJson<AuditRun>(join(RUNS_DIR, `${id}.json`));
}

export async function createRun(data: Omit<AuditRun, 'id'>): Promise<AuditRun> {
  await ensureAuditDirs();
  const run: AuditRun = {
    id: randomUUID(),
    ...data,
  };
  await atomicWriteJson(join(RUNS_DIR, `${run.id}.json`), run);
  return run;
}

export async function updateRun(
  id: string,
  updates: Partial<AuditRun>,
): Promise<AuditRun | null> {
  return withLock(`audit-run:${id}`, async () => {
    const run = await getRun(id);
    if (!run) return null;
    const updated = { ...run, ...updates, id: run.id };
    await atomicWriteJson(join(RUNS_DIR, `${updated.id}.json`), updated);
    return updated;
  });
}
