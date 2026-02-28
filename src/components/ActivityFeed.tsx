import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { InboxMessage, TeamMember } from '../types';
import { formatTimestamp, isIdleNotification } from '../types';
import { AgentBadge } from './AgentBadge';

interface ActivityFeedProps {
  inboxes: Record<string, InboxMessage[]>;
  members: TeamMember[];
}

interface FeedItem extends InboxMessage {
  agent: string;
}

export function ActivityFeed({ inboxes, members }: ActivityFeedProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Flatten all inboxes, filter idle notifications, sort newest first
  const items: FeedItem[] = [];
  for (const [agent, messages] of Object.entries(inboxes)) {
    for (const msg of messages) {
      if (!isIdleNotification(msg.text)) {
        items.push({ ...msg, agent });
      }
    }
  }
  items.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Resolve member color
  const memberColorMap = new Map(
    members.map(m => [m.name, m.color])
  );

  return (
    <aside className="w-80 bg-surface-800 border-l border-surface-700 flex flex-col shrink-0">
      <div className="px-4 py-3 border-b border-surface-700 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-slate-400" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Activity
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">
            No activity yet
          </p>
        ) : (
          <div className="divide-y divide-surface-700">
            {items.map((item, idx) => {
              const isExpanded = expandedIdx === idx;
              return (
                <button
                  key={`${item.agent}-${item.timestamp}-${idx}`}
                  onClick={() =>
                    setExpandedIdx(isExpanded ? null : idx)
                  }
                  className="w-full text-left px-4 py-3 hover:bg-surface-700/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <AgentBadge
                      name={item.from}
                      color={memberColorMap.get(item.from)}
                      size="sm"
                    />
                    <span className="text-[10px] text-slate-500">
                      {formatTimestamp(item.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">
                    {item.summary || item.text.slice(0, 100)}
                  </p>

                  {isExpanded && (
                    <pre className="mt-2 text-xs text-slate-400 whitespace-pre-wrap font-mono bg-surface-900/50 rounded p-2 max-h-60 overflow-y-auto">
                      {item.text}
                    </pre>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
