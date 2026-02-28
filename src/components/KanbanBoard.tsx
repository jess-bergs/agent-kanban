import { useState } from 'react';
import type { Task, TaskStatus, TeamMember } from '../types';
import { STATUS_LABELS } from '../types';
import { TaskCard } from './TaskCard';
import { TaskDetailModal } from './TaskDetailModal';

const COLUMNS: TaskStatus[] = ['pending', 'in_progress', 'completed'];

const COLUMN_STYLES: Record<TaskStatus, { header: string; badge: string }> = {
  pending: {
    header: 'bg-accent-amber/10 text-accent-amber',
    badge: 'bg-accent-amber/20 text-accent-amber',
  },
  in_progress: {
    header: 'bg-accent-blue/10 text-accent-blue',
    badge: 'bg-accent-blue/20 text-accent-blue',
  },
  completed: {
    header: 'bg-accent-green/10 text-accent-green',
    badge: 'bg-accent-green/20 text-accent-green',
  },
};

interface KanbanBoardProps {
  tasks: Task[];
  members: TeamMember[];
}

export function KanbanBoard({ tasks, members }: KanbanBoardProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const grouped: Record<TaskStatus, Task[]> = {
    pending: [],
    in_progress: [],
    completed: [],
  };

  for (const task of tasks) {
    if (task.status in grouped) {
      grouped[task.status].push(task);
    }
  }

  // Sort by id within each column, newest first
  for (const status of COLUMNS) {
    grouped[status].sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-4 h-full">
        {COLUMNS.map(status => {
          const style = COLUMN_STYLES[status];
          const columnTasks = grouped[status];

          return (
            <div
              key={status}
              className="bg-surface-800 rounded-xl flex flex-col min-h-0"
            >
              {/* Column header */}
              <div
                className={`flex items-center justify-between px-4 py-2.5 rounded-t-xl ${style.header}`}
              >
                <span className="text-sm font-semibold">
                  {STATUS_LABELS[status]}
                </span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.badge}`}
                >
                  {columnTasks.length}
                </span>
              </div>

              {/* Task list */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {columnTasks.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">
                    No tasks
                  </p>
                ) : (
                  columnTasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onClick={setSelectedTask}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          members={members}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </>
  );
}
