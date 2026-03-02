import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { Layout } from './components/Layout';
import { LoadingScreen } from './components/LoadingScreen';
import { LoginScreen } from './components/LoginScreen';

type AuthState = 'checking' | 'needs_login' | 'authenticated';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('checking');

  useEffect(() => {
    // Probe a protected endpoint to see if auth is required
    const headers: HeadersInit = {};
    const key = localStorage.getItem('agent-kanban-api-key');
    if (key) headers['Authorization'] = `Bearer ${key}`;

    fetch('/api/projects', { headers })
      .then(res => {
        if (res.ok) {
          setAuthState('authenticated');
        } else if (res.status === 401 || res.status === 403) {
          // Auth required and current key (if any) is invalid
          localStorage.removeItem('agent-kanban-api-key');
          setAuthState('needs_login');
        } else {
          // Server error or not reachable — try to proceed anyway
          setAuthState('authenticated');
        }
      })
      .catch(() => {
        // Can't reach server — proceed and let WebSocket handle reconnection
        setAuthState('authenticated');
      });
  }, []);

  if (authState === 'checking') {
    return <LoadingScreen connected={false} />;
  }

  if (authState === 'needs_login') {
    return <LoginScreen onAuthenticated={() => setAuthState('authenticated')} />;
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const ws = useWebSocket();

  if (ws.initialLoading) {
    return <LoadingScreen connected={ws.connected} />;
  }

  return (
    <Layout
      teams={ws.teams}
      projects={ws.projects}
      tickets={ws.tickets}
      soloAgents={ws.soloAgents}
      connected={ws.connected}
      initialLoading={ws.initialLoading}
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
