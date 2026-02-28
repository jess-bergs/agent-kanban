import { watch, type FSWatcher } from 'chokidar';
import { basename, relative } from 'node:path';
import { getTeamsDir, getTasksDir } from './claude-data.ts';

export interface ChangeEvent {
  kind: 'team_config' | 'task' | 'inbox';
  teamName: string;
  /** For tasks, the task filename; for inboxes, the agent name */
  detail?: string;
}

export type ChangeCallback = (event: ChangeEvent) => void;

function shouldIgnore(filePath: string): boolean {
  const name = basename(filePath);
  return (
    name === '.lock' ||
    name === '.highwatermark' ||
    name.startsWith('.') ||
    !name.endsWith('.json')
  );
}

function classifyTeamsChange(relPath: string): ChangeEvent | null {
  // relPath examples:
  //   "my-team/config.json"
  //   "my-team/inboxes/agent-a.json"
  const parts = relPath.split('/');
  if (parts.length < 2) return null;

  const teamName = parts[0];

  if (parts[1] === 'config.json') {
    return { kind: 'team_config', teamName };
  }

  if (parts[1] === 'inboxes' && parts.length >= 3) {
    const agentFile = parts[2];
    const agentName = agentFile.replace(/\.json$/, '');
    return { kind: 'inbox', teamName, detail: agentName };
  }

  return null;
}

function classifyTasksChange(relPath: string): ChangeEvent | null {
  // relPath examples:
  //   "my-team/1.json"
  const parts = relPath.split('/');
  if (parts.length < 2) return null;

  const teamName = parts[0];
  return { kind: 'task', teamName, detail: parts[1] };
}

export function startWatcher(callback: ChangeCallback): FSWatcher {
  const teamsDir = getTeamsDir();
  const tasksDir = getTasksDir();

  let debounceTimers = new Map<string, NodeJS.Timeout>();

  function debouncedEmit(key: string, event: ChangeEvent) {
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        callback(event);
      }, 100),
    );
  }

  function handleChange(filePath: string) {
    if (shouldIgnore(filePath)) return;

    // Try classifying as a teams/ change
    const relToTeams = relative(teamsDir, filePath);
    if (!relToTeams.startsWith('..')) {
      const event = classifyTeamsChange(relToTeams);
      if (event) {
        debouncedEmit(`${event.kind}:${event.teamName}:${event.detail ?? ''}`, event);
        return;
      }
    }

    // Try classifying as a tasks/ change
    const relToTasks = relative(tasksDir, filePath);
    if (!relToTasks.startsWith('..')) {
      const event = classifyTasksChange(relToTasks);
      if (event) {
        debouncedEmit(`${event.kind}:${event.teamName}:${event.detail ?? ''}`, event);
        return;
      }
    }
  }

  const watcher = watch([teamsDir, tasksDir], {
    ignoreInitial: true,
    persistent: true,
    depth: 3,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
  });

  watcher.on('add', handleChange);
  watcher.on('change', handleChange);
  watcher.on('unlink', handleChange);

  return watcher;
}
