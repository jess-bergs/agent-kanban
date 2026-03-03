import { Radio } from 'lucide-react';

interface LoadingScreenProps {
  connected: boolean;
}

export function LoadingScreen({ connected }: LoadingScreenProps) {
  return (
    <div className="h-screen bg-surface-900 flex flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6 animate-in">
        <div className="relative">
          <Radio className="w-12 h-12 text-accent-blue" />
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-accent-blue animate-ping" />
        </div>
        <div className="text-center">
          <h1 className="text-lg font-semibold text-secondary tracking-wide">
            Agent Kanban
          </h1>
          <p className="text-sm text-muted mt-2">
            {connected ? 'Loading data\u2026' : 'Connecting to server\u2026'}
          </p>
        </div>
        <div className="flex gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}
