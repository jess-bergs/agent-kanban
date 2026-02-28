import { readdir, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, Ticket } from '../src/types.ts';

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const PROJECTS_DIR = join(DATA_DIR, 'projects');
const TICKETS_DIR = join(DATA_DIR, 'tickets');

async function ensureDirs() {
  await mkdir(PROJECTS_DIR, { recursive: true });
  await mkdir(TICKETS_DIR, { recursive: true });
}

/** Atomic write: write to temp file then rename (rename is atomic on POSIX) */
export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const tmp = path + '.tmp.' + process.pid;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, path);
}

/** Per-file write locks to prevent concurrent read-merge-write races */
const writeLocks = new Map<string, Promise<void>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>(r => { resolve = r; });
  writeLocks.set(key, next);
  await prev;
  try { return await fn(); }
  finally { resolve!(); }
}

export async function safeReadJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Attempt recovery: find first valid JSON object
      for (let i = raw.length; i > 0; i--) {
        if (raw[i - 1] !== '}') continue;
        try {
          const obj = JSON.parse(raw.slice(0, i)) as T;
          // Auto-repair the file
          await atomicWriteJson(path, obj);
          console.log(`[store] Auto-repaired corrupt file: ${path}`);
          return obj;
        } catch { /* keep scanning */ }
      }
      console.error(`[store] Unrecoverable corrupt file: ${path}`);
      return null;
    }
  } catch {
    return null;
  }
}

export async function listJsonFiles<T>(dir: string): Promise<T[]> {
  await ensureDirs();
  const entries = await readdir(dir).catch(() => [] as string[]);
  const items: T[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const item = await safeReadJson<T>(join(dir, entry));
    if (item) items.push(item);
  }
  return items;
}

// ─── Projects ──────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  return listJsonFiles<Project>(PROJECTS_DIR);
}

export async function getProject(id: string): Promise<Project | null> {
  return safeReadJson<Project>(join(PROJECTS_DIR, `${id}.json`));
}

export async function createProject(data: {
  name: string;
  repoPath: string;
  defaultBranch: string;
  remoteUrl?: string;
}): Promise<Project> {
  await ensureDirs();
  const project: Project = {
    id: randomUUID(),
    createdAt: Date.now(),
    ...data,
  };
  await atomicWriteJson(join(PROJECTS_DIR, `${project.id}.json`), project);
  return project;
}

export async function deleteProject(id: string): Promise<boolean> {
  const { unlink } = await import('node:fs/promises');
  try {
    await unlink(join(PROJECTS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

// ─── Tickets ───────────────────────────────────────────────────────

export async function listTickets(): Promise<Ticket[]> {
  return listJsonFiles<Ticket>(TICKETS_DIR);
}

export async function listTicketsByProject(projectId: string): Promise<Ticket[]> {
  const all = await listTickets();
  return all.filter(t => t.projectId === projectId);
}

export async function getTicket(id: string): Promise<Ticket | null> {
  return safeReadJson<Ticket>(join(TICKETS_DIR, `${id}.json`));
}

export async function createTicket(data: {
  projectId: string;
  subject: string;
  instructions: string;
  yolo?: boolean;
  autoMerge?: boolean;
  queued?: boolean;
  useRalph?: boolean;
}): Promise<Ticket> {
  await ensureDirs();
  const ticket: Ticket = {
    id: randomUUID(),
    status: 'todo',
    createdAt: Date.now(),
    ...data,
  };
  await atomicWriteJson(join(TICKETS_DIR, `${ticket.id}.json`), ticket);
  return ticket;
}

export async function updateTicket(
  id: string,
  updates: Partial<Ticket>,
): Promise<Ticket | null> {
  return withLock(`ticket:${id}`, async () => {
    const ticket = await getTicket(id);
    if (!ticket) return null;
    const updated = { ...ticket, ...updates, id: ticket.id };
    await atomicWriteJson(join(TICKETS_DIR, `${updated.id}.json`), updated);
    return updated;
  });
}

export async function deleteTicket(id: string): Promise<boolean> {
  const { unlink } = await import('node:fs/promises');
  try {
    await unlink(join(TICKETS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

export async function getProjectsPayload() {
  const [projects, tickets] = await Promise.all([
    listProjects(),
    listTickets(),
  ]);
  return { projects, tickets };
}
