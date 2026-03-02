import { readdir, readFile, writeFile, mkdir, rename, unlink as fsUnlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, Ticket, TicketImage, TicketStatus, StateChangeEntry } from '../src/types.ts';

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const PROJECTS_DIR = join(DATA_DIR, 'projects');
const TICKETS_DIR = join(DATA_DIR, 'tickets');
const IMAGES_DIR = join(DATA_DIR, 'ticket-images');

async function ensureDirs() {
  await mkdir(PROJECTS_DIR, { recursive: true });
  await mkdir(TICKETS_DIR, { recursive: true });
  await mkdir(IMAGES_DIR, { recursive: true });
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

export interface ListTicketsFilteredOpts {
  projectId?: string;
  status?: TicketStatus;
  limit?: number;
  offset?: number;
}

export async function listTicketsFiltered(
  opts: ListTicketsFilteredOpts,
): Promise<{ tickets: Ticket[]; total: number }> {
  let tickets = await listTickets();
  if (opts.projectId) tickets = tickets.filter(t => t.projectId === opts.projectId);
  if (opts.status) tickets = tickets.filter(t => t.status === opts.status);
  // Sort newest first
  tickets.sort((a, b) => b.createdAt - a.createdAt);
  const total = tickets.length;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 50;
  return { tickets: tickets.slice(offset, offset + limit), total };
}

export async function getTicket(id: string): Promise<Ticket | null> {
  return safeReadJson<Ticket>(join(TICKETS_DIR, `${id}.json`));
}

/**
 * Find a ticket by UUID prefix (minimum 4 chars).
 * Returns the ticket if exactly one match, null otherwise.
 */
export async function getTicketByPrefix(prefix: string): Promise<Ticket | null> {
  if (prefix.length < 4) return null;
  const lowerPrefix = prefix.toLowerCase();
  await ensureDirs();
  const entries = await readdir(TICKETS_DIR).catch(() => [] as string[]);
  const matches = entries.filter(
    e => e.endsWith('.json') && e.toLowerCase().startsWith(lowerPrefix),
  );
  if (matches.length !== 1) return null;
  return safeReadJson<Ticket>(join(TICKETS_DIR, matches[0]));
}

/**
 * Resolve a ticket ID — supports both full UUIDs and short prefixes.
 */
export async function resolveTicket(idOrPrefix: string): Promise<Ticket | null> {
  // Try exact match first (full UUID = 36 chars)
  const exact = await getTicket(idOrPrefix);
  if (exact) return exact;
  // Fall back to prefix search
  return getTicketByPrefix(idOrPrefix);
}

export async function createTicket(data: {
  projectId: string;
  subject: string;
  instructions: string;
  yolo?: boolean;
  autoMerge?: boolean;
  queued?: boolean;
  useRalph?: boolean;
  useTeam?: boolean;
  planOnly?: boolean;
}): Promise<Ticket> {
  await ensureDirs();
  const now = Date.now();
  const ticket: Ticket = {
    id: randomUUID(),
    status: 'todo',
    createdAt: now,
    stateLog: [{ status: 'todo', timestamp: now, reason: 'ticket_created' }],
    ...data,
  };
  await atomicWriteJson(join(TICKETS_DIR, `${ticket.id}.json`), ticket);
  return ticket;
}

export async function updateTicket(
  id: string,
  updates: Partial<Ticket>,
  /** Optional reason for the state change (only recorded when status actually changes) */
  stateReason?: string,
): Promise<Ticket | null> {
  return withLock(`ticket:${id}`, async () => {
    const ticket = await getTicket(id);
    if (!ticket) return null;
    const updated = { ...ticket, ...updates, id: ticket.id };

    // Auto-append to stateLog when status changes
    if (updates.status && updates.status !== ticket.status) {
      const log: StateChangeEntry[] = updated.stateLog || [];
      log.push({
        status: updates.status,
        timestamp: Date.now(),
        reason: stateReason,
      });
      updated.stateLog = log;
    }

    // Auto-set needsAttention: true for terminal failures, clear on recovery
    if (updates.status === 'failed' || updates.status === 'error') {
      updated.needsAttention = true;
    } else if (updates.status === 'todo' || updates.status === 'in_progress') {
      updated.needsAttention = undefined;
    }

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

// ─── Ticket Images ──────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
]);

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export function getImagesDir(): string { return IMAGES_DIR; }

/**
 * Save an image from a base64 data URL.
 * Returns the TicketImage metadata (does not update the ticket).
 */
export async function saveTicketImage(
  dataUrl: string,
  originalName: string,
): Promise<TicketImage> {
  await ensureDirs();

  // Parse data URL: data:<mime>;base64,<data>
  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) throw new Error('Invalid data URL format');

  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported image type: ${mimeType}`);
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error(`Image too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB, max 10 MB)`);
  }

  const ext = MIME_TO_EXT[mimeType] || '.png';
  const filename = `${randomUUID()}${ext}`;
  await writeFile(join(IMAGES_DIR, filename), buffer);

  return {
    filename,
    originalName: originalName || filename,
    mimeType,
    size: buffer.length,
    uploadedAt: Date.now(),
  };
}

/** Delete an image file from disk */
export async function deleteTicketImage(filename: string): Promise<void> {
  // Prevent path traversal
  if (filename.includes('/') || filename.includes('..')) {
    throw new Error('Invalid filename');
  }
  try {
    await fsUnlink(join(IMAGES_DIR, filename));
  } catch { /* file may already be gone */ }
}
