import { useState, useCallback } from 'react';
import { Radio, Bot, Loader2, Sun, Moon, Monitor } from 'lucide-react';
import type { TeamWithData, Project, Ticket, SoloAgent } from '../types';
import { shortenPillLabel } from '../types';
import type { ViewMode } from '../hooks/useWebSocket';
import { useTheme } from '../hooks/useTheme';
import type { Theme } from '../hooks/useTheme';
import { Sidebar } from './Sidebar';
import { KanbanBoard } from './KanbanBoard';
import { TicketKanban } from './TicketKanban';
import { AgentKanban } from './AgentKanban';
import { ActivityFeed } from './ActivityFeed';
import { TeamHeader } from './TeamHeader';
import { ProjectHeader } from './ProjectHeader';
import { EmptyState } from './EmptyState';
import { ChatPopover } from './ChatPopover';
import { AnalyticsDashboard } from './AnalyticsDashboard';

interface LayoutProps {
  teams: TeamWithData[];
  projects: Project[];
  tickets: Ticket[];
  soloAgents: SoloAgent[];
  connected: boolean;
  initialLoading: boolean;
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
  initialLoading,
  viewMode,
  setViewMode,
  selectedTeam,
  onSelectTeam,
  selectedProject,
  onSelectProject,
  selectedProjectTickets,
}: LayoutProps) {
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const { theme, setTheme, resolvedTheme } = useTheme();

  const cycleTheme = useCallback(() => {
    const order: Theme[] = ['light', 'dark', 'system'];
    setTheme(order[(order.indexOf(theme) + 1) % order.length]);
  }, [theme, setTheme]);

  const handleNavigateToTicket = useCallback((projectId: string, ticketId: string) => {
    setViewMode('projects');
    onSelectProject(projectId);
    setOpenTicketId(ticketId);
  }, [setViewMode, onSelectProject]);

  const showAnalyticsView = viewMode === 'analytics';
  const showAgentsView = viewMode === 'agents';
  const showTeamView = viewMode === 'teams' && selectedTeam;
  const showProjectView = viewMode === 'projects' && selectedProject;

  if (initialLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-surface-900">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <Radio className="w-10 h-10 text-accent-blue" />
            <Loader2 className="w-5 h-5 text-accent-blue/60 animate-spin absolute -bottom-1 -right-1" />
          </div>
          <div className="text-center">
            <h1 className="text-base font-semibold text-secondary">Agent Kanban</h1>
            <p className="text-xs text-muted mt-1">
              {connected ? 'Loading projects and teams…' : 'Connecting to server…'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="h-10 flex items-center justify-between px-4 border-b border-surface-700 bg-surface-800 shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-accent-blue" />
          <span className="font-semibold text-xs tracking-wide">
            Agent Kanban
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {soloAgents.length > 0 && (
            <button
              onClick={() => setViewMode('agents')}
              className="flex items-center gap-1.5 text-accent-cyan hover:text-accent-cyan/80 transition-colors"
            >
              <Bot className="w-3.5 h-3.5" />
              <span className="font-medium">{soloAgents.length} agent{soloAgents.length !== 1 ? 's' : ''}</span>
            </button>
          )}
          <button
            onClick={cycleTheme}
            className="p-1 rounded text-muted hover:text-primary transition-colors"
            title={`Theme: ${theme} (click to cycle)`}
            aria-label={`Current theme: ${theme}. Click to change.`}
          >
            {theme === 'system' ? (
              <Monitor className="w-3.5 h-3.5" />
            ) : resolvedTheme === 'dark' ? (
              <Moon className="w-3.5 h-3.5" />
            ) : (
              <Sun className="w-3.5 h-3.5" />
            )}
          </button>
          <span
            className={`w-2 h-2 rounded-full ${
              connected ? 'bg-accent-green' : 'bg-accent-red'
            }`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
        </div>
      </header>

      {/* Solo agents bar — hidden when in agents view (kanban is the full view) */}
      {soloAgents.length > 0 && viewMode !== 'agents' && (
        <button
          onClick={() => setViewMode('agents')}
          className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-700 bg-surface-800/50 overflow-x-auto shrink-0 w-full hover:bg-surface-700/50 transition-colors cursor-pointer text-left"
        >
          <Bot className="w-3.5 h-3.5 text-accent-cyan shrink-0" />
          {soloAgents.map(agent => {
            const isActive = agent.status === 'active';
            return (
              <div
                key={agent.sessionId}
                className="flex items-center gap-1.5 bg-surface-700 rounded px-2 py-0.5 text-[11px] shrink-0"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isActive ? 'bg-accent-green animate-pulse' : 'bg-surface-500'
                  }`}
                />
                <span className="font-medium text-secondary">{shortenPillLabel(agent.projectName)}</span>
                {agent.gitBranch && agent.gitBranch !== 'HEAD' && (
                  <span className="text-accent-purple font-mono">{shortenPillLabel(agent.gitBranch)}</span>
                )}
              </div>
            );
          })}
          <span className="text-[10px] text-muted ml-auto shrink-0">Full view →</span>
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
          {showAnalyticsView ? (
            <AnalyticsDashboard />
          ) : showAgentsView ? (
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

      <ChatPopover projects={projects} />
    </div>
  );
}
