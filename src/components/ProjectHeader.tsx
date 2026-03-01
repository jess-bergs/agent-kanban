import { FolderOpen, GitBranch, Globe } from 'lucide-react';
import type { Project, Ticket } from '../types';
import { formatTimestamp } from '../types';

interface ProjectHeaderProps {
  project: Project;
  tickets: Ticket[];
}

export function ProjectHeader({ project, tickets }: ProjectHeaderProps) {
  const inProgress = tickets.filter(t => t.status === 'in_progress').length;
  const completed = tickets.filter(t => t.status === 'done' || t.status === 'merged').length;
  const total = tickets.length;

  return (
    <div className="px-6 py-4 border-b border-surface-700 bg-surface-800/50 shrink-0">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-100">{project.name}</h1>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 bg-surface-700 px-2.5 py-1 rounded-md border border-surface-600 font-mono">
              <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
              {project.repoPath}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-accent-purple bg-accent-purple/10 px-2.5 py-1 rounded-md">
              <GitBranch className="w-3.5 h-3.5" />
              {project.defaultBranch}
            </span>
            {project.remoteUrl && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 bg-surface-700 px-2.5 py-1 rounded-md border border-surface-600">
                <Globe className="w-3.5 h-3.5 text-slate-500" />
                {project.remoteUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '')}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className="text-xs text-slate-500">
            Added {formatTimestamp(project.createdAt)}
          </span>
          {total > 0 && (
            <div className="flex items-center gap-3 mt-1 text-xs">
              {inProgress > 0 && (
                <span className="text-accent-blue">{inProgress} running</span>
              )}
              {completed > 0 && (
                <span className="text-accent-green">{completed}/{total} completed</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
