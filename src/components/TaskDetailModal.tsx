import { useEffect } from 'react';
import {
  X,
  AlertCircle,
  Loader2,
  Clock,
  CheckCircle,
  Hash,
  GitBranch,
  User,
  FileText,
  Terminal,
} from 'lucide-react';
import type { Task, TeamMember, TaskStatus } from '../types';
import { STATUS_LABELS } from '../types';
import { AgentBadge } from './AgentBadge';

const STATUS_STYLE: Record<TaskStatus, { bg: string; text: string; icon: typeof Clock }> = {
  pending: { bg: 'bg-accent-amber/10', text: 'text-accent-amber', icon: Clock },
  in_progress: { bg: 'bg-accent-blue/10', text: 'text-accent-blue', icon: Loader2 },
  completed: { bg: 'bg-accent-green/10', text: 'text-accent-green', icon: CheckCircle },
};

interface TaskDetailModalProps {
  task: Task;
  members: TeamMember[];
  onClose: () => void;
}

export function TaskDetailModal({ task, members, onClose }: TaskDetailModalProps) {
  const style = STATUS_STYLE[task.status];
  const StatusIcon = style.icon;
  const ownerMember = members.find(m => m.name === task.owner);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-surface-800 border border-surface-600 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-surface-700 shrink-0">
          <div className="min-w-0 flex-1 pr-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Hash className="w-3 h-3" />
                {task.id}
              </span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
                <StatusIcon className={`w-3 h-3 ${task.status === 'in_progress' ? 'animate-spin' : ''}`} />
                {STATUS_LABELS[task.status]}
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-100">{task.subject}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-700 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Active form */}
          {task.status === 'in_progress' && task.activeForm && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-blue/5 border border-accent-blue/20">
              <Loader2 className="w-4 h-4 text-accent-blue animate-spin shrink-0" />
              <span className="text-sm text-accent-blue">{task.activeForm}</span>
            </div>
          )}

          {/* Owner */}
          {task.owner && (
            <div className="flex items-start gap-3">
              <User className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-slate-500 mb-1">Assigned to</p>
                <AgentBadge name={task.owner} color={ownerMember?.color} />
                {ownerMember && (
                  <p className="text-xs text-slate-500 mt-1">
                    {ownerMember.model} &middot; {ownerMember.agentType}
                    {ownerMember.cwd && <span> &middot; {ownerMember.cwd}</span>}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Blockers */}
          {task.blockedBy.length > 0 && (
            <div className="flex items-start gap-3">
              <GitBranch className="w-4 h-4 text-accent-red mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-slate-500 mb-1">Blocked by</p>
                <div className="flex flex-wrap gap-1.5">
                  {task.blockedBy.map(id => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent-red/10 text-accent-red font-medium"
                    >
                      <AlertCircle className="w-3 h-3" />
                      #{id}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {task.blocks.length > 0 && (
            <div className="flex items-start gap-3">
              <GitBranch className="w-4 h-4 text-accent-amber mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-slate-500 mb-1">Blocks</p>
                <div className="flex flex-wrap gap-1.5">
                  {task.blocks.map(id => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent-amber/10 text-accent-amber font-medium"
                    >
                      #{id}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Description / Full Prompt */}
          {task.description && (
            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500 mb-2">Description / Prompt</p>
                <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono bg-surface-900 rounded-lg p-4 border border-surface-700 leading-relaxed overflow-x-auto">
                  {task.description}
                </pre>
              </div>
            </div>
          )}

          {/* Agent Prompt (from team member config) */}
          {ownerMember?.prompt && (
            <div className="flex items-start gap-3">
              <Terminal className="w-4 h-4 text-accent-purple mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500 mb-2">Agent System Prompt</p>
                <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono bg-surface-900 rounded-lg p-4 border border-accent-purple/20 leading-relaxed overflow-x-auto">
                  {ownerMember.prompt}
                </pre>
              </div>
            </div>
          )}

          {/* Metadata */}
          {Object.keys(task.metadata).filter(k => k !== '_internal').length > 0 && (
            <div className="flex items-start gap-3">
              <Hash className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500 mb-2">Metadata</p>
                <pre className="text-xs text-slate-400 whitespace-pre-wrap font-mono bg-surface-900 rounded-lg p-3 border border-surface-700">
                  {JSON.stringify(
                    Object.fromEntries(
                      Object.entries(task.metadata).filter(([k]) => k !== '_internal')
                    ),
                    null,
                    2,
                  )}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
