import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskCard } from './TaskCard';
import type { Task } from '../types';

/** Minimal valid task with all required fields present. */
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    subject: 'Test task',
    description: '',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    metadata: {},
    ...overrides,
  };
}

describe('TaskCard null-safety', () => {
  it('renders without crashing when blockedBy is undefined', () => {
    const task = makeTask({ blockedBy: undefined as unknown as string[] });
    const { container } = render(<TaskCard task={task} />);
    expect(container.textContent).toContain('Test task');
    expect(screen.queryByText(/Blocked by/)).toBeNull();
  });

  it('renders without crashing when blockedBy is null', () => {
    const task = makeTask({ blockedBy: null as unknown as string[] });
    const { container } = render(<TaskCard task={task} />);
    expect(container.textContent).toContain('Test task');
    expect(screen.queryByText(/Blocked by/)).toBeNull();
  });

  it('renders blocker count when blockedBy has entries', () => {
    const task = makeTask({ blockedBy: ['task-2', 'task-3'] });
    render(<TaskCard task={task} />);
    expect(screen.getByText(/Blocked by 2/)).toBeTruthy();
  });

  it('renders without crashing when blocks is undefined', () => {
    const task = makeTask({ blocks: undefined as unknown as string[] });
    const { container } = render(<TaskCard task={task} />);
    expect(container.textContent).toContain('Test task');
  });
});
