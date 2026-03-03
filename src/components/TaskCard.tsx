import { AlertCircle, Loader2 } from 'lucide-react';
import type { Task, TaskStatus } from '../types';
import { AgentBadge } from './AgentBadge';

const BORDER_COLORS: Record<TaskStatus, string> = {
  pending: 'border-l-accent-amber',
  in_progress: 'border-l-accent-blue',
  completed: 'border-l-accent-green',
};

interface TaskCardProps {
  task: Task;
  onClick?: (task: Task) => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const borderColor = BORDER_COLORS[task.status];

  return (
    <div
      onClick={() => onClick?.(task)}
      className={`bg-surface-700 rounded-lg p-3 border border-surface-600 border-l-2 ${borderColor} hover:border-surface-500 transition-colors cursor-pointer`}
    >
      {/* Subject */}
      <p className="text-sm font-medium text-primary">{task.subject}</p>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-tertiary mt-1 line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Active form (spinner) */}
      {task.status === 'in_progress' && task.activeForm && (
        <div className="flex items-center gap-1.5 mt-2">
          <Loader2 className="w-3 h-3 text-accent-blue animate-spin" />
          <span className="text-xs text-accent-blue italic">
            {task.activeForm}
          </span>
        </div>
      )}

      {/* Footer: owner + blockers */}
      <div className="flex items-center justify-between mt-2">
        <div>
          {task.owner && <AgentBadge name={task.owner} size="sm" />}
        </div>
        {task.blockedBy.length > 0 && (
          <div className="flex items-center gap-1 text-accent-red">
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium">
              Blocked by {task.blockedBy.length}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
