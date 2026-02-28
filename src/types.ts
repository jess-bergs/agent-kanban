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
  | 'agents_updated'
  | 'auditor_updated'
  | 'audit_schedules_updated'
  | 'audit_run_updated';

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

export type TicketStatus = 'todo' | 'in_progress' | 'needs_approval' | 'in_review' | 'done' | 'merged' | 'failed' | 'error';

/** A single entry in the agent's live activity stream */
export interface AgentActivity {
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result';
  /** For tool_use: tool name; for text/thinking: omitted */
  tool?: string;
  /** Content summary (truncated for display) */
  content: string;
  /** Timestamp of when this activity occurred */
  timestamp: number;
}

export interface Ticket {
  id: string;
  projectId: string;
  subject: string;
  instructions: string;
  status: TicketStatus;
  yolo?: boolean;
  autoMerge?: boolean;
  queued?: boolean;
  useRalph?: boolean;
  branchName?: string;
  worktreePath?: string;
  prUrl?: string;
  prNumber?: number;
  /** Whether the PR currently has merge conflicts */
  hasConflict?: boolean;
  /** Timestamp when conflict was first detected */
  conflictDetectedAt?: number;
  agentPid?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  lastOutput?: string;
  /** Recent agent activity stream for live oversight */
  agentActivity?: AgentActivity[];
  /** Current reasoning/thinking text (most recent) */
  lastThinking?: string;
  /** Effort metrics collected from agent stream output */
  effort?: TicketEffort;
  /** Status of the local auditor review */
  auditStatus?: 'pending' | 'running' | 'done' | 'error';
  /** Auditor review result text */
  auditResult?: string;
}

// ─── Scheduled Audits ─────────────────────────────────────────────

export type AuditCadence = 'daily' | 'weekly' | 'monthly' | 'manual';
export type AuditMode = 'report' | 'fix';
export type AuditScheduleStatus = 'active' | 'paused';
export type AuditRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type AuditTemplateId =
  | 'readme-freshness'
  | 'architecture-review'
  | 'improvement-opportunities'
  | 'dependency-review'
  | 'security-scan'
  | 'ai-security';

export interface AuditSchedule {
  id: string;
  projectId: string;
  name: string;
  templateId?: AuditTemplateId;
  prompt: string;
  cadence: AuditCadence;
  mode: AuditMode;
  status: AuditScheduleStatus;
  yolo?: boolean;
  autoMerge?: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface AuditRun {
  id: string;
  scheduleId: string;
  projectId: string;
  mode: AuditMode;
  status: AuditRunStatus;
  ticketId?: string;
  report?: string;
  reportPath?: string;
  structuredReport?: AuditReport;
  severityCounts?: SeverityCounts;
  trend?: AuditTrend;
  agentPid?: number;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

// ─── Structured Audit Reports ─────────────────────────────────────

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface AuditFinding {
  id: string;
  severity: FindingSeverity;
  aspect: string;
  location?: string;
  title: string;
  description: string;
  recommendation?: string;
}

export interface AuditRubricScore {
  aspect: string;
  score: number;
  rating: 'pass' | 'concern' | 'fail';
  summary: string;
  findingCount: number;
}

export interface AuditReport {
  overallScore: number;
  overallVerdict: string;
  summary: string;
  rubric: AuditRubricScore[];
  findings: AuditFinding[];
  severityCounts: SeverityCounts;
  generatedAt: number;
}

export interface AuditTrend {
  previousRunId: string;
  previousScore: number;
  currentScore: number;
  delta: number;
  direction: 'improving' | 'stable' | 'declining';
  newFindings: string[];
  resolvedFindings: string[];
  recurringFindings: string[];
  aspectDeltas: Array<{
    aspect: string;
    previousScore: number;
    currentScore: number;
    delta: number;
  }>;
}

export interface RubricAspectDefinition {
  aspect: string;
  description: string;
  weight: number;
}

/** Effort metrics describing how much work an agent put into a ticket */
export interface TicketEffort {
  /** Number of API round-trips (assistant events) */
  turns: number;
  /** Number of tool calls made */
  toolCalls: number;
  /** Total input tokens consumed (may be approximate due to stream-json duplication) */
  inputTokens?: number;
  /** Total output tokens produced */
  outputTokens?: number;
  /** Cost in USD if reported */
  costUsd?: number;
  /** Duration in milliseconds (computed from startedAt/completedAt) */
  durationMs?: number;
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  needs_approval: 'Needs Approval',
  in_review: 'In Review',
  done: 'Done',
  merged: 'Merged',
  failed: 'Failed',
  error: 'Error',
};

export const TICKET_STATUS_COLORS: Record<TicketStatus, string> = {
  todo: 'amber',
  in_progress: 'blue',
  needs_approval: 'orange',
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

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

export function isIdleNotification(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return parsed?.type === 'idle_notification';
  } catch {
    return false;
  }
}
