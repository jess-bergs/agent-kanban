import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReplayEvent, SessionHistory } from '../src/types.ts';

const DATA_DIR = join(import.meta.dirname, '..', 'data', 'sessions');

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function sessionPath(ticketId: string): string {
  return join(DATA_DIR, `${ticketId}.json`);
}

export async function getSessionHistory(ticketId: string): Promise<SessionHistory | null> {
  try {
    const data = await readFile(sessionPath(ticketId), 'utf-8');
    return JSON.parse(data) as SessionHistory;
  } catch {
    return null;
  }
}

export async function saveSessionHistory(history: SessionHistory): Promise<void> {
  await ensureDir();
  await writeFile(sessionPath(history.ticketId), JSON.stringify(history, null, 2));
}

export async function appendReplayEvent(ticketId: string, event: ReplayEvent): Promise<void> {
  await ensureDir();
  let history = await getSessionHistory(ticketId);
  if (!history) {
    history = {
      ticketId,
      events: [],
      totalDurationMs: 0,
      startedAt: event.timestamp,
    };
  }

  // Compute step duration from previous event
  if (history.events.length > 0) {
    const prev = history.events[history.events.length - 1];
    prev.stepDurationMs = event.timestamp - prev.timestamp;
  }

  event.index = history.events.length;
  history.events.push(event);
  history.totalDurationMs = event.timestamp - history.startedAt;

  await saveSessionHistory(history);
}

export async function finalizeSession(ticketId: string): Promise<void> {
  const history = await getSessionHistory(ticketId);
  if (!history) return;

  history.completedAt = Date.now();
  history.totalDurationMs = history.completedAt - history.startedAt;

  await saveSessionHistory(history);
}
