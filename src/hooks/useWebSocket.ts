import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  TeamWithData,
  Project,
  Ticket,
  SoloAgent,
  ProjectsPayload,
  WSEvent,
  WSInitialEvent,
  WSTeamUpdatedEvent,
  WSTaskUpdatedEvent,
  WSInboxUpdatedEvent,
} from '../types';

export type ViewMode = 'projects' | 'teams' | 'agents' | 'analytics';

interface UseWebSocketReturn {
  teams: TeamWithData[];
  projects: Project[];
  tickets: Ticket[];
  soloAgents: SoloAgent[];
  connected: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  selectedTeam: TeamWithData | null;
  setSelectedTeamName: (name: string) => void;
  selectedProject: Project | null;
  setSelectedProjectId: (id: string) => void;
  selectedProjectTickets: Ticket[];
}

export function useWebSocket(): UseWebSocketReturn {
  const [teams, setTeams] = useState<TeamWithData[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [soloAgents, setSoloAgents] = useState<SoloAgent[]>([]);
  const [connected, setConnected] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('projects');
  const [selectedTeamName, setSelectedTeamName] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);

  const handleMessage = useCallback((event: MessageEvent) => {
    let parsed: WSEvent;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (parsed.type) {
      case 'initial': {
        const { data } = parsed as WSInitialEvent;
        setTeams(data);
        break;
      }
      case 'projects_updated': {
        const { projects: p, tickets: t } = parsed.data as ProjectsPayload;
        setProjects(p);
        setTickets(prev => {
          const map = new Map(prev.map(ticket => [ticket.id, ticket]));
          for (const ticket of t) map.set(ticket.id, ticket);
          return Array.from(map.values());
        });
        break;
      }
      case 'ticket_updated': {
        const ticket = parsed.data as Ticket;
        setTickets(prev => {
          const idx = prev.findIndex(t => t.id === ticket.id);
          if (idx >= 0) {
            return prev.map((t, i) => (i === idx ? ticket : t));
          }
          return [...prev, ticket];
        });
        break;
      }
      case 'ticket_deleted': {
        const { id } = parsed.data as { id: string };
        setTickets(prev => prev.filter(t => t.id !== id));
        break;
      }
      case 'agents_updated': {
        setSoloAgents(parsed.data as SoloAgent[]);
        break;
      }
      case 'team_updated': {
        const { data } = parsed as WSTeamUpdatedEvent;
        setTeams(prev => {
          if (prev.some(t => t.name === data.name)) {
            return prev.map(t => (t.name === data.name ? data : t));
          }
          return [...prev, data];
        });
        break;
      }
      case 'team_added': {
        const team = parsed.data as TeamWithData;
        setTeams(prev => {
          if (prev.some(t => t.name === team.name)) {
            return prev.map(t => (t.name === team.name ? team : t));
          }
          return [...prev, team];
        });
        break;
      }
      case 'team_removed': {
        const { name } = parsed.data as { name: string };
        setTeams(prev => prev.filter(t => t.name !== name));
        break;
      }
      case 'task_updated': {
        const { data } = parsed as WSTaskUpdatedEvent;
        setTeams(prev =>
          prev.map(t => {
            if (t.name !== data.teamName) return t;
            const taskIndex = t.tasks.findIndex(task => task.id === data.task.id);
            const newTasks =
              taskIndex >= 0
                ? t.tasks.map((task, i) => (i === taskIndex ? data.task : task))
                : [...t.tasks, data.task];
            return { ...t, tasks: newTasks };
          }),
        );
        break;
      }
      case 'inbox_updated': {
        const { data } = parsed as WSInboxUpdatedEvent;
        setTeams(prev =>
          prev.map(t => {
            if (t.name !== data.teamName) return t;
            return {
              ...t,
              inboxes: { ...t.inboxes, [data.agentName]: data.messages },
            };
          }),
        );
        break;
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      backoffRef.current = 1000;
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, 30000);
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [handleMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const selectedTeam = teams.find(t => t.name === selectedTeamName) ?? null;
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;
  const selectedProjectTickets = selectedProject
    ? tickets.filter(t => t.projectId === selectedProject.id)
    : [];

  return {
    teams,
    projects,
    tickets,
    soloAgents,
    connected,
    viewMode,
    setViewMode,
    selectedTeam,
    setSelectedTeamName,
    selectedProject,
    setSelectedProjectId,
    selectedProjectTickets,
  };
}
