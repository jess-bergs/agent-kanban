/**
 * A circular badge that displays a count number.
 * Used as a replacement for plain indicator dots when a numeric count is meaningful.
 */

interface CountBadgeProps {
  count: number;
  /** Tailwind color class for background, e.g. 'bg-accent-green' */
  bg: string;
  /** Tailwind color class for text, e.g. 'text-white'. Defaults to 'text-white' */
  text?: string;
  /** Whether to pulse (for active status). Defaults to false */
  pulse?: boolean;
  /** Size variant. 'sm' = 16px, 'md' = 20px. Defaults to 'sm' */
  size?: 'sm' | 'md';
}

export function CountBadge({ count, bg, text = 'text-white', pulse = false, size = 'sm' }: CountBadgeProps) {
  const sizeClasses = size === 'sm'
    ? 'w-4 h-4 text-[9px]'
    : 'w-5 h-5 text-[10px]';

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold leading-none shrink-0 ${sizeClasses} ${bg} ${text} ${pulse ? 'animate-pulse' : ''}`}
    >
      {count}
    </span>
  );
}
