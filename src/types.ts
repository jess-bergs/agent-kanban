// ─── Claude Code Data Models ───────────────────────────────────────

export interface TeamMember {
  agentId: string;
  name: string;
  agentType: string;
  model: string;
  prompt?: string;
  color?: string;
  planModeRequired?: boolean;
  joinedAt: number;
  tmuxPaneId: string;
  cwd: string;
  subscriptions: string[];
  backendType?: string;
}

export interface TeamConfig {
  name: string;
  description: string;
  createdAt: number;
  leadAgentId: string;
  leadSessionId: string;
  members: TeamMember[];
}

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  blocks: string[];
  blockedBy: string[];
  metadata: Record<string, unknown>;
  owner?: string;
  activeForm?: string;
}

export interface InboxMessage {
  from: string;
  text: string;
  summary: string;
  timestamp: string;
  color?: string;
  read: boolean;
}

// ─── Aggregated Team Data ──────────────────────────────────────────

export interface TeamWithData extends TeamConfig {
  tasks: Task[];
  inboxes: Record<string, InboxMessage[]>;
}

// ─── WebSocket Events ──────────────────────────────────────────────

// ─── Solo Agent Detection ─────────────────────────────────────────

export interface SoloAgent {
  sessionId: string;
  pid: number | null;
  cwd: string;
  projectName: string;
  gitBranch: string | null;
  slug: string | null;
  version: string | null;
  model: string | null;
  source: 'terminal' | 'vscode' | 'dispatched' | 'unknown';
  status: 'active' | 'idle';
  lastActiveAt: number;
  prompt: string | null;
  lastOutput: string | null;
}

export type WSEventType =
  | 'initial'
  | 'team_updated'
  | 'task_updated'
  | 'inbox_updated'
  | 'team_added'
  | 'team_removed'
  | 'projects_updated'
  | 'ticket_updated'
  | 'ticket_deleted'
  | 'agents_updated';

export interface WSEvent {
  type: WSEventType;
  data: unknown;
}

export interface WSInitialEvent extends WSEvent {
  type: 'initial';
  data: TeamWithData[];
}

export interface WSTeamUpdatedEvent extends WSEvent {
  type: 'team_updated';
  data: TeamWithData;
}

export interface WSTaskUpdatedEvent extends WSEvent {
  type: 'task_updated';
  data: { teamName: string; task: Task };
}

export interface WSInboxUpdatedEvent extends WSEvent {
  type: 'inbox_updated';
  data: { teamName: string; agentName: string; messages: InboxMessage[] };
}

// ─── Dispatch Models (User Projects + Tickets) ────────────────────

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  defaultBranch: string;
  remoteUrl?: string;
  createdAt: number;
}

export type TicketStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'merged' | 'failed' | 'error';

export interface Ticket {
  id: string;
  projectId: string;
  subject: string;
  instructions: string;
  status: TicketStatus;
  yolo?: boolean;
  autoMerge?: boolean;
  queued?: boolean;
  branchName?: string;
  worktreePath?: string;
  prUrl?: string;
  prNumber?: number;
  agentPid?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  lastOutput?: string;
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  merged: 'Merged',
  failed: 'Failed',
  error: 'Error',
};

export const TICKET_STATUS_COLORS: Record<TicketStatus, string> = {
  todo: 'amber',
  in_progress: 'blue',
  in_review: 'cyan',
  done: 'green',
  merged: 'purple',
  failed: 'red',
  error: 'red',
};

// ─── Dispatch WebSocket Events ─────────────────────────────────────

export interface ProjectsPayload {
  projects: Project[];
  tickets: Ticket[];
}

// ─── UI State ──────────────────────────────────────────────────────

export type TaskStatus = Task['status'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'amber',
  in_progress: 'blue',
  completed: 'green',
};

export const AGENT_COLORS = [
  'blue', 'green', 'purple', 'cyan', 'amber', 'red',
] as const;

export type AgentColor = typeof AGENT_COLORS[number];

export function getAgentColor(name: string): AgentColor {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

export function formatTimestamp(ts: string | number): string {
  const date = new Date(typeof ts === 'number' ? ts : ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString();
}

export function isIdleNotification(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return parsed?.type === 'idle_notification';
  } catch {
    return false;
  }
}
