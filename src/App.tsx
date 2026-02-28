import { useWebSocket } from './hooks/useWebSocket';
import { Layout } from './components/Layout';

export default function App() {
  const ws = useWebSocket();

  return (
    <Layout
      teams={ws.teams}
      projects={ws.projects}
      tickets={ws.tickets}
      soloAgents={ws.soloAgents}
      connected={ws.connected}
      viewMode={ws.viewMode}
      setViewMode={ws.setViewMode}
      selectedTeam={ws.selectedTeam}
      onSelectTeam={ws.setSelectedTeamName}
      selectedProject={ws.selectedProject}
      onSelectProject={ws.setSelectedProjectId}
      selectedProjectTickets={ws.selectedProjectTickets}
    />
  );
}
