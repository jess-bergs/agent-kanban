import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TeamConfig, Task, InboxMessage, TeamWithData } from '../src/types.ts';

export function getClaudeDir(): string {
  return join(homedir(), '.claude');
}

export function getTeamsDir(): string {
  return join(getClaudeDir(), 'teams');
}

export function getTasksDir(): string {
  return join(getClaudeDir(), 'tasks');
}

async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function safeDirEntries(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch {
    return [];
  }
}

export async function listTeams(): Promise<string[]> {
  const entries = await safeDirEntries(getTeamsDir());
  // Filter out dotfiles
  return entries.filter((e) => !e.startsWith('.'));
}

export async function readTeamConfig(teamName: string): Promise<TeamConfig | null> {
  const configPath = join(getTeamsDir(), teamName, 'config.json');
  return safeReadJson<TeamConfig>(configPath);
}

export async function readTeamTasks(teamName: string): Promise<Task[]> {
  const taskDir = join(getTasksDir(), teamName);
  const entries = await safeDirEntries(taskDir);
  const tasks: Task[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    if (entry === '.lock' || entry === '.highwatermark') continue;
    // Also skip any dotfiles
    if (entry.startsWith('.')) continue;

    const task = await safeReadJson<Task>(join(taskDir, entry));
    if (task && task.id) {
      tasks.push(task);
    }
  }

  return tasks;
}

export async function readTeamInboxes(
  teamName: string,
): Promise<Record<string, InboxMessage[]>> {
  const inboxDir = join(getTeamsDir(), teamName, 'inboxes');
  const entries = await safeDirEntries(inboxDir);
  const inboxes: Record<string, InboxMessage[]> = {};

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    if (entry.startsWith('.')) continue;

    const agentName = entry.replace(/\.json$/, '');
    const messages = await safeReadJson<InboxMessage[]>(join(inboxDir, entry));
    if (Array.isArray(messages)) {
      inboxes[agentName] = messages;
    }
  }

  return inboxes;
}

export async function getAllTeamsWithData(): Promise<TeamWithData[]> {
  const teamNames = await listTeams();
  const teams: TeamWithData[] = [];

  for (const name of teamNames) {
    const config = await readTeamConfig(name);
    if (!config) continue;

    const [tasks, inboxes] = await Promise.all([
      readTeamTasks(name),
      readTeamInboxes(name),
    ]);

    teams.push({ ...config, tasks, inboxes });
  }

  return teams;
}
