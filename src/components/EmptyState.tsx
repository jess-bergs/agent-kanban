import { Radio } from 'lucide-react';

interface EmptyStateProps {
  hasTeams: boolean;
}

export function EmptyState({ hasTeams }: EmptyStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <Radio className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-slate-300 mb-2">
          {hasTeams ? 'No team selected' : 'No active teams'}
        </h2>
        <p className="text-sm text-slate-500 leading-relaxed">
          Agent Kanban monitors Claude Code agent teams in real-time.
          {hasTeams
            ? ' Select a team from the sidebar to view its tasks and activity.'
            : ' Teams will appear here when active.'}
        </p>
      </div>
    </div>
  );
}
