import { useWebSocket } from './hooks/useWebSocket';
import { Layout } from './components/Layout';
import { LoadingScreen } from './components/LoadingScreen';

export default function App() {
  const ws = useWebSocket();

  if (ws.loading) {
    return <LoadingScreen connected={ws.connected} />;
  }

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
