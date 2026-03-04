import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskDetailModal } from './TaskDetailModal';
import type { Task } from '../types';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    subject: 'Detail task',
    description: '',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    metadata: {},
    ...overrides,
  };
}

describe('TaskDetailModal null-safety', () => {
  const defaultProps = { members: [], onClose: () => {} };

  it('renders without crashing when metadata is undefined', () => {
    const task = makeTask({ metadata: undefined as unknown as Record<string, unknown> });
    const { container } = render(<TaskDetailModal task={task} {...defaultProps} />);
    expect(container.textContent).toContain('Detail task');
    expect(screen.queryByText('Metadata')).toBeNull();
  });

  it('renders without crashing when metadata is null', () => {
    const task = makeTask({ metadata: null as unknown as Record<string, unknown> });
    const { container } = render(<TaskDetailModal task={task} {...defaultProps} />);
    expect(container.textContent).toContain('Detail task');
    expect(screen.queryByText('Metadata')).toBeNull();
  });

  it('renders metadata section when metadata has non-internal keys', () => {
    const task = makeTask({ metadata: { priority: 'high' } });
    render(<TaskDetailModal task={task} {...defaultProps} />);
    expect(screen.getByText('Metadata')).toBeTruthy();
  });

  it('hides metadata section when only _internal key exists', () => {
    const task = makeTask({ metadata: { _internal: true } });
    render(<TaskDetailModal task={task} {...defaultProps} />);
    expect(screen.queryByText('Metadata')).toBeNull();
  });

  it('renders without crashing when blockedBy is undefined', () => {
    const task = makeTask({ blockedBy: undefined as unknown as string[] });
    const { container } = render(<TaskDetailModal task={task} {...defaultProps} />);
    expect(container.textContent).toContain('Detail task');
    expect(screen.queryByText('Blocked by')).toBeNull();
  });

  it('renders without crashing when blocks is undefined', () => {
    const task = makeTask({ blocks: undefined as unknown as string[] });
    const { container } = render(<TaskDetailModal task={task} {...defaultProps} />);
    expect(container.textContent).toContain('Detail task');
    expect(screen.queryByText('Blocks')).toBeNull();
  });

  it('renders blockers when blockedBy has entries', () => {
    const task = makeTask({ blockedBy: ['task-2'] });
    render(<TaskDetailModal task={task} {...defaultProps} />);
    expect(screen.getByText('Blocked by')).toBeTruthy();
  });

  it('renders blocks when blocks has entries', () => {
    const task = makeTask({ blocks: ['task-3'] });
    render(<TaskDetailModal task={task} {...defaultProps} />);
    expect(screen.getByText('Blocks')).toBeTruthy();
  });
});
