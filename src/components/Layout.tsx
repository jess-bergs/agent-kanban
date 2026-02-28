import { useState, useCallback } from 'react';
import { Radio, Bot } from 'lucide-react';
import type { TeamWithData, Project, Ticket, SoloAgent } from '../types';
import { formatTimestamp } from '../types';
import type { ViewMode } from '../hooks/useWebSocket';
import { Sidebar } from './Sidebar';
import { KanbanBoard } from './KanbanBoard';
import { TicketKanban } from './TicketKanban';
import { AgentKanban } from './AgentKanban';
import { ActivityFeed } from './ActivityFeed';
import { TeamHeader } from './TeamHeader';
import { ProjectHeader } from './ProjectHeader';
import { EmptyState } from './EmptyState';

interface LayoutProps {
  teams: TeamWithData[];
  projects: Project[];
  tickets: Ticket[];
  soloAgents: SoloAgent[];
  connected: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  selectedTeam: TeamWithData | null;
  onSelectTeam: (name: string) => void;
  selectedProject: Project | null;
  onSelectProject: (id: string) => void;
  selectedProjectTickets: Ticket[];
}

export function Layout({
  teams,
  projects,
  tickets,
  soloAgents,
  connected,
  viewMode,
  setViewMode,
  selectedTeam,
  onSelectTeam,
  selectedProject,
  onSelectProject,
  selectedProjectTickets,
}: LayoutProps) {
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);

  const handleNavigateToTicket = useCallback((projectId: string, ticketId: string) => {
    setViewMode('projects');
    onSelectProject(projectId);
    setOpenTicketId(ticketId);
  }, [setViewMode, onSelectProject]);

  const showAgentsView = viewMode === 'agents';
  const showTeamView = viewMode === 'teams' && selectedTeam;
  const showProjectView = viewMode === 'projects' && selectedProject;

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="h-12 flex items-center justify-between px-4 border-b border-surface-700 bg-surface-800 shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5 text-accent-blue" />
          <span className="font-semibold text-sm tracking-wide">
            Agent Kanban
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {soloAgents.length > 0 && (
            <button
              onClick={() => setViewMode('agents')}
              className="flex items-center gap-1.5 text-accent-cyan hover:text-accent-cyan/80 transition-colors"
            >
              <Bot className="w-4 h-4" />
              <span className="font-medium">{soloAgents.length} agent{soloAgents.length !== 1 ? 's' : ''}</span>
            </button>
          )}
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-accent-green' : 'bg-accent-red'
              }`}
            />
            <span className="text-slate-400">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      {/* Solo agents bar — hidden when in agents view (kanban is the full view) */}
      {soloAgents.length > 0 && viewMode !== 'agents' && (
        <button
          onClick={() => setViewMode('agents')}
          className="flex items-center gap-3 px-4 py-2 border-b border-surface-700 bg-surface-800/50 overflow-x-auto shrink-0 w-full hover:bg-surface-700/50 transition-colors cursor-pointer text-left"
        >
          <Bot className="w-4 h-4 text-accent-cyan shrink-0" />
          {soloAgents.map(agent => {
            const sourceIcon = agent.source === 'vscode' ? 'VS Code' : agent.source === 'terminal' ? 'Terminal' : agent.source;
            const isActive = agent.status === 'active';
            return (
              <div
                key={agent.sessionId}
                className="flex items-center gap-2 bg-surface-700 rounded-lg px-3 py-1.5 text-xs shrink-0"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isActive ? 'bg-accent-green animate-pulse' : 'bg-slate-500'
                  }`}
                />
                <span className="font-medium text-slate-200">{agent.projectName}</span>
                {agent.gitBranch && agent.gitBranch !== 'HEAD' && (
                  <span className="text-accent-purple font-mono">{agent.gitBranch}</span>
                )}
                <span className="text-slate-500">{sourceIcon}</span>
                <span className="text-slate-500">{formatTimestamp(agent.lastActiveAt)}</span>
              </div>
            );
          })}
          <span className="text-[10px] text-slate-500 ml-auto shrink-0">Click for full view →</span>
        </button>
      )}

      {/* Three-panel layout */}
      <div className="flex flex-1 min-h-0">
        <Sidebar
          teams={teams}
          projects={projects}
          tickets={tickets}
          soloAgents={soloAgents}
          viewMode={viewMode}
          setViewMode={setViewMode}
          selectedTeam={selectedTeam}
          onSelectTeam={onSelectTeam}
          selectedProject={selectedProject}
          onSelectProject={onSelectProject}
        />

        {/* Main content */}
        <main className="flex-1 flex flex-col min-h-0 min-w-0">
          {showAgentsView ? (
            <AgentKanban agents={soloAgents} tickets={tickets} onNavigateToTicket={handleNavigateToTicket} />
          ) : showTeamView ? (
            <>
              <TeamHeader team={selectedTeam} />
              <div className="flex-1 overflow-auto p-4">
                <KanbanBoard tasks={selectedTeam.tasks} members={selectedTeam.members} />
              </div>
            </>
          ) : showProjectView ? (
            <>
              <ProjectHeader project={selectedProject} tickets={selectedProjectTickets} />
              <div className="flex-1 overflow-auto p-4">
                <TicketKanban
                  tickets={selectedProjectTickets}
                  project={selectedProject}
                  openTicketId={openTicketId}
                  onTicketOpened={() => setOpenTicketId(null)}
                />
              </div>
            </>
          ) : (
            <EmptyState hasTeams={viewMode === 'teams' ? teams.length > 0 : viewMode === 'projects' ? projects.length > 0 : soloAgents.length > 0} />
          )}
        </main>

        {/* Activity feed — only for team view */}
        {showTeamView && (
          <ActivityFeed
            inboxes={selectedTeam.inboxes}
            members={selectedTeam.members}
          />
        )}
      </div>
    </div>
  );
}
