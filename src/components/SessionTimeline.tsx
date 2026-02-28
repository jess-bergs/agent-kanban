import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Brain,
  Terminal,
  CheckCircle,
  MessageSquare,
  Clock,
  Rewind,
  FastForward,
} from 'lucide-react';
import type { SessionHistory, ReplayEvent } from '../types';
import { formatDuration } from '../types';

interface SessionTimelineProps {
  ticketId: string;
  onClose: () => void;
}

function EventIcon({ type }: { type: ReplayEvent['type'] }) {
  switch (type) {
    case 'thinking':
      return <Brain className="w-3.5 h-3.5 text-accent-purple" />;
    case 'tool_use':
      return <Terminal className="w-3.5 h-3.5 text-accent-cyan" />;
    case 'tool_result':
      return <CheckCircle className="w-3.5 h-3.5 text-accent-green" />;
    case 'text':
      return <MessageSquare className="w-3.5 h-3.5 text-slate-400" />;
  }
}

const EVENT_COLORS: Record<string, string> = {
  thinking: 'bg-accent-purple',
  tool_use: 'bg-accent-cyan',
  tool_result: 'bg-accent-green',
  text: 'bg-slate-500',
};

const EVENT_LABELS: Record<string, string> = {
  thinking: 'Reasoning',
  tool_use: 'Tool Call',
  tool_result: 'Result',
  text: 'Output',
};

export function SessionTimeline({ ticketId, onClose }: SessionTimelineProps) {
  const [history, setHistory] = useState<SessionHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch(`/api/tickets/${ticketId}/session`);
        if (!res.ok) {
          setError('No session history available');
          return;
        }
        const data = await res.json();
        setHistory(data);
      } catch {
        setError('Failed to load session history');
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, [ticketId]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (playIntervalRef.current) {
      clearTimeout(playIntervalRef.current);
      playIntervalRef.current = null;
    }
  }, []);

  const advancePlayback = useCallback(() => {
    if (!history) return;
    setCurrentIndex(prev => {
      const next = prev + 1;
      if (next >= history.events.length) {
        stopPlayback();
        return prev;
      }
      // Schedule next advance based on step duration
      const event = history.events[next];
      const delay = event.stepDurationMs
        ? Math.min(event.stepDurationMs / playbackSpeed, 2000) // cap at 2s real time
        : 500 / playbackSpeed;
      playIntervalRef.current = setTimeout(advancePlayback, delay);
      return next;
    });
  }, [history, playbackSpeed, stopPlayback]);

  function togglePlay() {
    if (!history || history.events.length === 0) return;
    if (isPlaying) {
      stopPlayback();
    } else {
      setIsPlaying(true);
      // If at end, restart
      if (currentIndex >= history.events.length - 1) {
        setCurrentIndex(0);
      }
      const event = history.events[currentIndex];
      const delay = event?.stepDurationMs
        ? Math.min(event.stepDurationMs / playbackSpeed, 2000)
        : 500 / playbackSpeed;
      playIntervalRef.current = setTimeout(advancePlayback, delay);
    }
  }

  useEffect(() => {
    return () => {
      if (playIntervalRef.current) clearTimeout(playIntervalRef.current);
    };
  }, []);

  // Auto-scroll to current event
  useEffect(() => {
    if (eventListRef.current) {
      const activeEl = eventListRef.current.querySelector(`[data-index="${currentIndex}"]`);
      activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentIndex]);

  if (loading) {
    return (
      <div className="bg-surface-800 rounded-xl border border-surface-700 p-6">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Clock className="w-4 h-4 animate-spin" />
          Loading session history...
        </div>
      </div>
    );
  }

  if (error || !history) {
    return (
      <div className="bg-surface-800 rounded-xl border border-surface-700 p-6">
        <p className="text-sm text-slate-500">{error || 'No session data'}</p>
      </div>
    );
  }

  const events = history.events;
  const currentEvent = events[currentIndex];
  const progress = events.length > 1 ? (currentIndex / (events.length - 1)) * 100 : 0;

  // Count event types for the minimap
  const typeCounts: Record<string, number> = {};
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }

  return (
    <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <Rewind className="w-4 h-4 text-accent-cyan" />
          <span className="text-sm font-semibold text-slate-200">Session Replay</span>
          <span className="text-xs text-slate-500">
            ({events.length} events, {formatDuration(history.totalDurationMs)})
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1"
        >
          Close
        </button>
      </div>

      {/* Minimap — event type distribution bar */}
      <div className="px-4 py-2 border-b border-surface-700/50">
        <div className="flex h-3 rounded-full overflow-hidden bg-surface-700">
          {events.map((event, idx) => (
            <button
              key={idx}
              onClick={() => { stopPlayback(); setCurrentIndex(idx); }}
              className={`flex-1 min-w-[2px] transition-opacity ${EVENT_COLORS[event.type]} ${
                idx === currentIndex ? 'opacity-100 ring-1 ring-white' : idx <= currentIndex ? 'opacity-70' : 'opacity-30'
              }`}
              title={`${EVENT_LABELS[event.type]}: ${event.tool || event.content?.slice(0, 50)}`}
            />
          ))}
        </div>
        {/* Legend */}
        <div className="flex gap-3 mt-1.5">
          {Object.entries(typeCounts).map(([type, count]) => (
            <div key={type} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-sm ${EVENT_COLORS[type]}`} />
              <span className="text-[10px] text-slate-500">{EVENT_LABELS[type]} ({count})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-700/50 bg-surface-900/30">
        <button
          onClick={() => { stopPlayback(); setCurrentIndex(0); }}
          className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
          title="Rewind to start"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          onClick={togglePlay}
          className="p-1.5 bg-accent-cyan/20 text-accent-cyan rounded-full hover:bg-accent-cyan/30 transition-colors"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={() => { stopPlayback(); setCurrentIndex(Math.min(events.length - 1, currentIndex + 1)); }}
          className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
          title="Next event"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        {/* Speed control */}
        <div className="flex items-center gap-1 ml-2">
          <FastForward className="w-3 h-3 text-slate-500" />
          {[0.5, 1, 2, 4].map(speed => (
            <button
              key={speed}
              onClick={() => setPlaybackSpeed(speed)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                playbackSpeed === speed
                  ? 'bg-accent-cyan/20 text-accent-cyan font-bold'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>

        {/* Progress */}
        <div className="flex-1 mx-2">
          <input
            type="range"
            min={0}
            max={events.length - 1}
            value={currentIndex}
            onChange={e => { stopPlayback(); setCurrentIndex(parseInt(e.target.value)); }}
            className="w-full h-1 bg-surface-700 rounded-lg appearance-none cursor-pointer accent-accent-cyan"
          />
        </div>

        <span className="text-[10px] text-slate-500 font-mono shrink-0">
          {currentIndex + 1}/{events.length}
        </span>
      </div>

      {/* Two-panel: event list + current event detail */}
      <div className="flex min-h-0" style={{ height: '350px' }}>
        {/* Event list (scrollable) */}
        <div ref={eventListRef} className="w-64 shrink-0 overflow-y-auto border-r border-surface-700 p-2 space-y-0.5">
          {events.map((event, idx) => (
            <button
              key={idx}
              data-index={idx}
              onClick={() => { stopPlayback(); setCurrentIndex(idx); }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                idx === currentIndex
                  ? 'bg-accent-cyan/10 border border-accent-cyan/30'
                  : idx < currentIndex
                    ? 'opacity-60 hover:opacity-80 hover:bg-surface-700 border border-transparent'
                    : 'hover:bg-surface-700 border border-transparent'
              }`}
            >
              <span className="text-[9px] text-slate-600 font-mono w-5 shrink-0 text-right">
                {idx + 1}
              </span>
              <EventIcon type={event.type} />
              <span className="text-[11px] text-slate-300 truncate flex-1">
                {event.tool || EVENT_LABELS[event.type]}
              </span>
              {event.stepDurationMs != null && event.stepDurationMs > 0 && (
                <span className="text-[9px] text-slate-600 font-mono shrink-0">
                  {event.stepDurationMs < 1000
                    ? `${event.stepDurationMs}ms`
                    : `${(event.stepDurationMs / 1000).toFixed(1)}s`
                  }
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Current event detail */}
        <div className="flex-1 overflow-y-auto p-4">
          {currentEvent ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <EventIcon type={currentEvent.type} />
                <span className="text-sm font-medium text-slate-200">
                  {currentEvent.tool || EVENT_LABELS[currentEvent.type]}
                </span>
                <span className="text-[10px] text-slate-500 font-mono ml-auto">
                  Step {currentEvent.index + 1} of {events.length}
                </span>
              </div>

              {/* Elapsed time from start */}
              <div className="flex items-center gap-1 text-[10px] text-slate-500">
                <Clock className="w-3 h-3" />
                {formatDuration(currentEvent.timestamp - history.startedAt)} elapsed
                {currentEvent.stepDurationMs != null && (
                  <span className="ml-2">
                    (step took {currentEvent.stepDurationMs < 1000
                      ? `${currentEvent.stepDurationMs}ms`
                      : formatDuration(currentEvent.stepDurationMs)
                    })
                  </span>
                )}
              </div>

              {/* Content */}
              <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono bg-surface-900 rounded-lg p-3 border border-surface-700 max-h-60 overflow-y-auto leading-relaxed">
                {currentEvent.fullContent || currentEvent.content || '(no content)'}
              </pre>

              {/* Progress bar within session */}
              <div className="pt-2">
                <div className="flex justify-between text-[10px] text-slate-600 mb-1">
                  <span>Start</span>
                  <span>{formatDuration(history.totalDurationMs)}</span>
                </div>
                <div className="w-full h-1.5 bg-surface-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-cyan rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select an event to view details</p>
          )}
        </div>
      </div>
    </div>
  );
}
