import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, Ticket } from '../src/types.ts';

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const PROJECTS_DIR = join(DATA_DIR, 'projects');
const TICKETS_DIR = join(DATA_DIR, 'tickets');

async function ensureDirs() {
  await mkdir(PROJECTS_DIR, { recursive: true });
  await mkdir(TICKETS_DIR, { recursive: true });
}

async function safeReadJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

async function listJsonFiles<T>(dir: string): Promise<T[]> {
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
    id: randomUUID().slice(0, 8),
    createdAt: Date.now(),
    ...data,
  };
  await writeFile(
    join(PROJECTS_DIR, `${project.id}.json`),
    JSON.stringify(project, null, 2),
  );
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
  // Auto-increment ticket ID
  const existing = await listTickets();
  const maxId = existing.reduce((max, t) => {
    const num = parseInt(t.id, 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  const ticket: Ticket = {
    id: String(maxId + 1),
    status: 'todo',
    createdAt: Date.now(),
    ...data,
  };
  await writeFile(
    join(TICKETS_DIR, `${ticket.id}.json`),
    JSON.stringify(ticket, null, 2),
  );
  return ticket;
}

export async function updateTicket(
  id: string,
  updates: Partial<Ticket>,
): Promise<Ticket | null> {
  const ticket = await getTicket(id);
  if (!ticket) return null;
  const updated = { ...ticket, ...updates, id: ticket.id };
  await writeFile(
    join(TICKETS_DIR, `${updated.id}.json`),
    JSON.stringify(updated, null, 2),
  );
  return updated;
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
