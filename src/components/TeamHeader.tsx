import { FolderOpen, GitBranch } from 'lucide-react';
import type { TeamWithData } from '../types';
import { formatTimestamp } from '../types';
import { AgentBadge } from './AgentBadge';

interface TeamHeaderProps {
  team: TeamWithData;
}

function extractRepoInfo(cwd: string): { folder: string; short: string } {
  const parts = cwd.split('/');
  const short = parts.slice(-2).join('/');
  return { folder: cwd, short };
}

export function TeamHeader({ team }: TeamHeaderProps) {
  // Collect unique working directories from team members
  const cwds = new Map<string, string[]>();
  for (const m of team.members) {
    if (!m.cwd) continue;
    const existing = cwds.get(m.cwd);
    if (existing) {
      existing.push(m.name);
    } else {
      cwds.set(m.cwd, [m.name]);
    }
  }

  return (
    <div className="px-6 py-4 border-b border-surface-700 bg-surface-800/50 shrink-0">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-100">{team.name}</h1>
          {team.description && (
            <p className="text-sm text-slate-400 mt-0.5">
              {team.description}
            </p>
          )}
        </div>
        <span className="text-xs text-slate-500 shrink-0">
          Created {formatTimestamp(team.createdAt)}
        </span>
      </div>

      {/* Working directories */}
      {cwds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 mt-2">
          {[...cwds.entries()].map(([cwd]) => {
            const { short, folder } = extractRepoInfo(cwd);
            return (
              <span
                key={cwd}
                title={folder}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 bg-surface-700 px-2.5 py-1 rounded-md border border-surface-600"
              >
                <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
                <span className="font-mono">{short}</span>
              </span>
            );
          })}
        </div>
      )}

      {team.members.length > 0 && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {team.members.map(m => (
            <AgentBadge key={m.agentId} name={m.name} color={m.color} />
          ))}
        </div>
      )}
    </div>
  );
}
