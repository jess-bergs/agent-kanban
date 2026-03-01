import { useState } from 'react';
import {
  Users,
  ChevronRight,
  FolderOpen,
  Plus,
  GitBranch,
  Bot,
  Monitor,
  Code2,
  Trash2,
  BarChart3,
  Loader2,
} from 'lucide-react';
import type { TeamWithData, Project, Ticket, SoloAgent } from '../types';
import { formatTimestamp } from '../types';
import { AgentBadge } from './AgentBadge';
import { AddProjectModal } from './AddProjectModal';
import type { ViewMode } from '../hooks/useWebSocket';

interface SidebarProps {
  teams: TeamWithData[];
  projects: Project[];
  tickets: Ticket[];
  soloAgents: SoloAgent[];
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  selectedTeam: TeamWithData | null;
  onSelectTeam: (name: string) => void;
  selectedProject: Project | null;
  onSelectProject: (id: string) => void;
}

export function Sidebar({
  teams,
  projects,
  tickets,
  soloAgents,
  viewMode,
  setViewMode,
  selectedTeam,
  onSelectTeam,
  selectedProject,
  onSelectProject,
}: SidebarProps) {
  const [showAddProject, setShowAddProject] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  async function handleDeleteProject(projectId: string, projectName: string) {
    if (!confirm(`Are you sure you want to remove "${projectName}" from the project list? This will not delete the actual repository.`)) {
      return;
    }

    setDeletingProjectId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to delete project');
      }
    } catch (err) {
      alert('Failed to connect to server');
    } finally {
      setDeletingProjectId(null);
    }
  }

  return (
    <aside className="w-72 bg-surface-800 border-r border-surface-700 flex flex-col shrink-0">
      {/* View mode tabs */}
      <div className="flex border-b border-surface-700">
        <button
          onClick={() => setViewMode('projects')}
          className={`flex-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            viewMode === 'projects'
              ? 'text-accent-blue border-b-2 border-accent-blue'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Projects
        </button>
        <button
          onClick={() => setViewMode('teams')}
          className={`flex-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            viewMode === 'teams'
              ? 'text-accent-blue border-b-2 border-accent-blue'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Teams
        </button>
        <button
          onClick={() => setViewMode('agents')}
          className={`flex-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors relative ${
            viewMode === 'agents'
              ? 'text-accent-cyan border-b-2 border-accent-cyan'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Agents
          {soloAgents.length > 0 && viewMode !== 'agents' && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent-green animate-pulse" />
          )}
        </button>
        <button
          onClick={() => setViewMode('analytics')}
          className={`flex-1 px-2 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            viewMode === 'analytics'
              ? 'text-accent-purple border-b-2 border-accent-purple'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5 mx-auto" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {viewMode === 'analytics' ? (
          <div className="px-3 py-4 text-center">
            <BarChart3 className="w-8 h-8 text-accent-purple mx-auto mb-2 opacity-50" />
            <p className="text-sm text-slate-400">Analytics Dashboard</p>
            <p className="text-xs text-slate-500 mt-1">
              Dispatcher runs, PR reviews, audit reports, and issues
            </p>
          </div>
        ) : viewMode === 'projects' ? (
          <>
            {/* Add project button */}
            <button
              onClick={() => setShowAddProject(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-surface-700 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Project
            </button>

            {projects.length === 0 && (
              <p className="text-sm text-slate-500 px-2 py-4 text-center">
                No projects yet
              </p>
            )}

            {projects.map(project => {
              const isSelected = selectedProject?.id === project.id;
              const projectTickets = tickets.filter(t => t.projectId === project.id);
              const inProgress = projectTickets.filter(t => t.status === 'in_progress').length;
              const completed = projectTickets.filter(t => t.status === 'done' || t.status === 'merged').length;
              const isDeleting = deletingProjectId === project.id;

              return (
                <div key={project.id} className="relative group">
                  <button
                    onClick={() => onSelectProject(project.id)}
                    className={`w-full text-left rounded-lg p-3 transition-colors ${
                      isSelected
                        ? 'bg-surface-700 border border-accent-blue'
                        : 'hover:bg-surface-700 border border-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-slate-100 truncate">
                          {project.name}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5 font-mono truncate">
                          {project.repoPath.split('/').slice(-2).join('/')}
                        </p>
                      </div>
                      <ChevronRight
                        className={`w-4 h-4 text-slate-500 mt-0.5 shrink-0 transition-transform ${
                          isSelected ? 'rotate-90' : ''
                        }`}
                      />
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-3 h-3" />
                        {project.defaultBranch}
                      </span>
                      {projectTickets.length > 0 && (
                        <span>
                          {projectTickets.length} ticket{projectTickets.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {inProgress > 0 && (
                        <span className="text-accent-blue">{inProgress} active</span>
                      )}
                      {completed > 0 && (
                        <span className="text-accent-green">{completed} completed</span>
                      )}
                    </div>
                  </button>
                  {/* Delete button - only show on hover */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(project.id, project.name);
                    }}
                    disabled={isDeleting}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-surface-800 border border-surface-600 text-slate-400 hover:text-accent-red hover:border-accent-red transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Remove project from list"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </>
        ) : viewMode === 'agents' ? (
          <>
            {soloAgents.length === 0 && (
              <p className="text-sm text-slate-500 px-2 py-4 text-center">
                No active agents
              </p>
            )}

            {/* Group agents by project */}
            {(() => {
              const byProject = new Map<string, { cwd: string; agents: typeof soloAgents }>();
              for (const agent of soloAgents) {
                if (!byProject.has(agent.cwd)) {
                  byProject.set(agent.cwd, { cwd: agent.cwd, agents: [] });
                }
                byProject.get(agent.cwd)!.agents.push(agent);
              }
              const groups = [...byProject.values()].sort((a, b) => {
                const aActive = a.agents.some(ag => ag.status === 'active') ? 1 : 0;
                const bActive = b.agents.some(ag => ag.status === 'active') ? 1 : 0;
                if (aActive !== bActive) return bActive - aActive;
                return Math.max(...b.agents.map(ag => ag.lastActiveAt)) - Math.max(...a.agents.map(ag => ag.lastActiveAt));
              });

              return groups.map(({ cwd, agents: projectAgents }) => {
                const projectName = cwd.split('/').pop() || cwd;
                const activeCount = projectAgents.filter(a => a.status === 'active').length;
                const idleCount = projectAgents.filter(a => a.status === 'idle').length;

                return (
                  <div key={cwd} className="rounded-lg p-3 hover:bg-surface-700 border border-transparent transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {activeCount > 0 && (
                            <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse shrink-0" />
                          )}
                          <p className="font-medium text-sm text-slate-100 truncate">
                            {projectName}
                          </p>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5 font-mono truncate">
                          {cwd.split('/').slice(-2).join('/')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                      {activeCount > 0 && (
                        <span className="text-accent-green">{activeCount} working</span>
                      )}
                      {idleCount > 0 && (
                        <span>{idleCount} idle</span>
                      )}
                    </div>
                    {/* Individual agents */}
                    <div className="mt-2 space-y-1 border-l border-surface-600 pl-3 ml-1">
                      {projectAgents.map(agent => (
                        <div key={agent.sessionId} className="flex items-center gap-2 py-0.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              agent.status === 'active' ? 'bg-accent-green' : 'bg-slate-500'
                            }`}
                          />
                          <span className="text-xs text-slate-300 truncate">
                            {agent.slug || agent.sessionId.slice(0, 8)}
                          </span>
                          {agent.model && (
                            <span className="text-[10px] text-slate-500 truncate">
                              {agent.model}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              });
            })()}
          </>
        ) : (
          <>
            {(() => {
              const pendingTeamTickets = tickets.filter(
                t => t.useTeam && t.teamName && t.status === 'in_progress' && !teams.some(team => team.name === t.teamName)
              );
              return (
                <>
                  {teams.length === 0 && pendingTeamTickets.length === 0 && (
                    <p className="text-sm text-slate-500 px-2 py-4 text-center">
                      No active teams
                    </p>
                  )}
                  {pendingTeamTickets.map(ticket => (
                    <div key={`pending-${ticket.teamName}`} className="rounded-lg p-3 border border-dashed border-accent-blue/30 bg-accent-blue/5">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 text-accent-blue animate-spin" />
                        <p className="font-medium text-sm text-accent-blue/70 truncate">
                          {ticket.teamName}
                        </p>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 truncate">
                        Waiting for agent to create team…
                      </p>
                      <p className="text-[10px] text-slate-600 mt-0.5 truncate">
                        {ticket.subject}
                      </p>
                    </div>
                  ))}
                </>
              );
            })()}
            {teams.map(team => {
              const isSelected = selectedTeam?.name === team.name;
              return (
                <div key={team.name}>
                  <button
                    onClick={() => onSelectTeam(team.name)}
                    className={`w-full text-left rounded-lg p-3 transition-colors ${
                      isSelected
                        ? 'bg-surface-700 border border-accent-blue'
                        : 'hover:bg-surface-700 border border-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-slate-100 truncate">
                          {team.name}
                        </p>
                        {team.description && (
                          <p className="text-xs text-slate-400 mt-0.5 truncate">
                            {team.description}
                          </p>
                        )}
                      </div>
                      <ChevronRight
                        className={`w-4 h-4 text-slate-500 mt-0.5 shrink-0 transition-transform ${
                          isSelected ? 'rotate-90' : ''
                        }`}
                      />
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {team.members.length}
                      </span>
                      <span>{formatTimestamp(team.createdAt)}</span>
                    </div>
                  </button>

                  {isSelected && team.members.length > 0 && (
                    <div className="ml-3 mt-1 mb-2 space-y-1 border-l border-surface-600 pl-3">
                      {team.members.map(member => {
                        const isActive = member.tmuxPaneId === 'in-process';
                        return (
                          <div key={member.agentId} className="flex items-center gap-2 py-1">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                isActive ? 'bg-accent-green' : 'bg-slate-500'
                              }`}
                            />
                            <AgentBadge name={member.name} color={member.color} size="sm" />
                            <span className="text-[10px] text-slate-500 truncate">
                              {member.model}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {showAddProject && (
        <AddProjectModal
          onClose={() => setShowAddProject(false)}
          onCreated={() => setShowAddProject(false)}
        />
      )}
    </aside>
  );
}
