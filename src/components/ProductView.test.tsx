import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductView, getTicketStatusCounts } from './ProductView';
import type { Project, Ticket } from '../types';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    repoPath: '/home/user/repos/test',
    defaultBranch: 'main',
    createdAt: 1000,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    projectId: 'proj-1',
    subject: 'Test ticket',
    instructions: 'Do the thing',
    status: 'todo',
    createdAt: 1000,
    ...overrides,
  };
}

// ─── getTicketStatusCounts ─────────────────────────────────────

describe('getTicketStatusCounts', () => {
  it('returns empty array for no tickets', () => {
    expect(getTicketStatusCounts([])).toEqual([]);
  });

  it('counts tickets grouped by status', () => {
    const tickets = [
      makeTicket({ id: '1', status: 'todo' }),
      makeTicket({ id: '2', status: 'todo' }),
      makeTicket({ id: '3', status: 'in_progress' }),
    ];
    const counts = getTicketStatusCounts(tickets);
    expect(counts).toEqual([
      { status: 'todo', label: 'To Do', count: 2, color: 'amber' },
      { status: 'in_progress', label: 'In Progress', count: 1, color: 'blue' },
    ]);
  });

  it('sorts by count descending', () => {
    const tickets = [
      makeTicket({ id: '1', status: 'done' }),
      makeTicket({ id: '2', status: 'failed' }),
      makeTicket({ id: '3', status: 'failed' }),
      makeTicket({ id: '4', status: 'failed' }),
    ];
    const counts = getTicketStatusCounts(tickets);
    expect(counts[0].status).toBe('failed');
    expect(counts[0].count).toBe(3);
    expect(counts[1].status).toBe('done');
    expect(counts[1].count).toBe(1);
  });

  it('maps known statuses to labels and colors', () => {
    const tickets = [makeTicket({ id: '1', status: 'merged' })];
    const counts = getTicketStatusCounts(tickets);
    expect(counts[0]).toEqual({
      status: 'merged',
      label: 'Merged',
      count: 1,
      color: 'purple',
    });
  });
});

// ─── ProductView component ─────────────────────────────────────

describe('ProductView', () => {
  const noop = () => {};

  it('renders empty state when no projects exist', () => {
    render(<ProductView projects={[]} tickets={[]} onSelectProject={noop} />);
    expect(screen.getByText('No projects yet')).toBeTruthy();
  });

  it('renders summary stats correctly', () => {
    const projects = [makeProject()];
    const tickets = [
      makeTicket({ id: '1', status: 'todo' }),
      makeTicket({ id: '2', status: 'in_progress' }),
      makeTicket({ id: '3', status: 'done' }),
      makeTicket({ id: '4', status: 'merged' }),
    ];
    const { container } = render(
      <ProductView projects={projects} tickets={tickets} onSelectProject={noop} />,
    );
    // 4 total tickets, 1 active (in_progress), 2 completed (done + merged)
    expect(container.textContent).toContain('4');
    expect(container.textContent).toContain('1');
    expect(container.textContent).toContain('2');
  });

  it('renders project name, repo path, and branch', () => {
    const projects = [
      makeProject({ name: 'My App', repoPath: '/repos/my-app', defaultBranch: 'develop' }),
    ];
    render(<ProductView projects={projects} tickets={[]} onSelectProject={noop} />);
    expect(screen.getByText('My App')).toBeTruthy();
    expect(screen.getByText('/repos/my-app')).toBeTruthy();
    expect(screen.getByText('develop')).toBeTruthy();
  });

  it('shows ticket count per project', () => {
    const projects = [makeProject({ id: 'p1' })];
    const tickets = [
      makeTicket({ id: '1', projectId: 'p1' }),
      makeTicket({ id: '2', projectId: 'p1' }),
      makeTicket({ id: '3', projectId: 'other' }),
    ];
    render(<ProductView projects={projects} tickets={tickets} onSelectProject={noop} />);
    expect(screen.getByText('2 tickets')).toBeTruthy();
  });

  it('shows singular "ticket" for one ticket', () => {
    const projects = [makeProject({ id: 'p1' })];
    const tickets = [makeTicket({ id: '1', projectId: 'p1' })];
    render(<ProductView projects={projects} tickets={tickets} onSelectProject={noop} />);
    expect(screen.getByText('1 ticket')).toBeTruthy();
  });

  it('calls onSelectProject when a project card is clicked', () => {
    const onSelect = vi.fn();
    const projects = [makeProject({ id: 'proj-42' })];
    render(<ProductView projects={projects} tickets={[]} onSelectProject={onSelect} />);
    fireEvent.click(screen.getByText('Test Project'));
    expect(onSelect).toHaveBeenCalledWith('proj-42');
  });

  it('shows status breakdown badges on project cards', () => {
    const projects = [makeProject({ id: 'p1' })];
    const tickets = [
      makeTicket({ id: '1', projectId: 'p1', status: 'todo' }),
      makeTicket({ id: '2', projectId: 'p1', status: 'todo' }),
      makeTicket({ id: '3', projectId: 'p1', status: 'done' }),
    ];
    render(<ProductView projects={projects} tickets={tickets} onSelectProject={noop} />);
    expect(screen.getByText('To Do: 2')).toBeTruthy();
    expect(screen.getByText('Done: 1')).toBeTruthy();
  });

  it('shows remote indicator when project has remoteUrl', () => {
    const projects = [makeProject({ remoteUrl: 'git@github.com:org/repo.git' })];
    render(<ProductView projects={projects} tickets={[]} onSelectProject={noop} />);
    expect(screen.getByText('remote')).toBeTruthy();
  });

  it('hides remote indicator when project has no remoteUrl', () => {
    const projects = [makeProject({ remoteUrl: undefined })];
    render(<ProductView projects={projects} tickets={[]} onSelectProject={noop} />);
    expect(screen.queryByText('remote')).toBeNull();
  });
});
