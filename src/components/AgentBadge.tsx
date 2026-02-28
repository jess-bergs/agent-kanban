import { getAgentColor } from '../types';
import type { AgentColor } from '../types';

const COLOR_MAP: Record<AgentColor, { bg: string; text: string; dot: string }> = {
  blue:   { bg: 'bg-accent-blue/10',   text: 'text-accent-blue',   dot: 'bg-accent-blue' },
  green:  { bg: 'bg-accent-green/10',  text: 'text-accent-green',  dot: 'bg-accent-green' },
  purple: { bg: 'bg-accent-purple/10', text: 'text-accent-purple', dot: 'bg-accent-purple' },
  cyan:   { bg: 'bg-accent-cyan/10',   text: 'text-accent-cyan',   dot: 'bg-accent-cyan' },
  amber:  { bg: 'bg-accent-amber/10',  text: 'text-accent-amber',  dot: 'bg-accent-amber' },
  red:    { bg: 'bg-accent-red/10',    text: 'text-accent-red',    dot: 'bg-accent-red' },
};

function resolveColor(name: string, color?: string): AgentColor {
  if (color && color in COLOR_MAP) return color as AgentColor;
  return getAgentColor(name);
}

interface AgentBadgeProps {
  name: string;
  color?: string;
  size?: 'sm' | 'md';
}

export function AgentBadge({ name, color, size = 'md' }: AgentBadgeProps) {
  const c = resolveColor(name, color);
  const styles = COLOR_MAP[c];

  const sizeClasses =
    size === 'sm'
      ? 'text-[10px] px-1.5 py-0.5 gap-1'
      : 'text-xs px-2 py-0.5 gap-1.5';

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${styles.bg} ${styles.text} ${sizeClasses}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
      {name}
    </span>
  );
}
