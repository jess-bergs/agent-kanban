import { describe, it, expect } from 'vitest';
import { detectUsageLimit } from '../server/dispatcher.ts';

describe('detectUsageLimit', () => {
  it('returns null for empty text', () => {
    expect(detectUsageLimit('')).toBeNull();
  });

  it('returns null for normal error messages', () => {
    expect(detectUsageLimit('Error: file not found')).toBeNull();
    expect(detectUsageLimit('SyntaxError: unexpected token')).toBeNull();
    expect(detectUsageLimit('Connection refused')).toBeNull();
  });

  it('detects "rate limit" keyword', () => {
    const result = detectUsageLimit('Error: rate limit exceeded');
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(Date.now());
  });

  it('detects "usage limit" keyword', () => {
    const result = detectUsageLimit("You've exceeded your usage limit");
    expect(result).not.toBeNull();
  });

  it('detects "quota exceeded" keyword', () => {
    const result = detectUsageLimit('API quota exceeded, please wait');
    expect(result).not.toBeNull();
  });

  it('detects "too many requests" keyword', () => {
    const result = detectUsageLimit('429 Too Many Requests');
    expect(result).not.toBeNull();
  });

  it('detects "you\'ve hit your limit" keyword', () => {
    const result = detectUsageLimit("You've hit your limit · resets 3am");
    expect(result).not.toBeNull();
  });

  it('detects "resource_exhausted" keyword', () => {
    const result = detectUsageLimit('error: resource_exhausted');
    expect(result).not.toBeNull();
  });

  it('parses "resets in N minutes"', () => {
    const before = Date.now();
    const result = detectUsageLimit('Rate limit exceeded, resets in 30 minutes');
    expect(result).not.toBeNull();
    // Should be ~30 minutes from now
    const delta = result! - before;
    expect(delta).toBeGreaterThan(29 * 60_000);
    expect(delta).toBeLessThan(31 * 60_000);
  });

  it('parses "resets in N hours"', () => {
    const before = Date.now();
    const result = detectUsageLimit('Usage limit reached. Resets in 2 hours');
    expect(result).not.toBeNull();
    const delta = result! - before;
    expect(delta).toBeGreaterThan(1.9 * 3600_000);
    expect(delta).toBeLessThan(2.1 * 3600_000);
  });

  it('defaults to 1 hour for generic limit messages', () => {
    const before = Date.now();
    const result = detectUsageLimit('rate limit');
    expect(result).not.toBeNull();
    const delta = result! - before;
    expect(delta).toBeGreaterThan(59 * 60_000);
    expect(delta).toBeLessThan(61 * 60_000);
  });
});

describe('PR URL regex', () => {
  // Test the same regex used in dispatcher.ts for PR detection
  const prUrlRegex = /https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/;

  it('matches standard GitHub PR URLs', () => {
    const match = 'Created PR: https://github.com/user/repo/pull/42'.match(prUrlRegex);
    expect(match).not.toBeNull();
    expect(match![0]).toBe('https://github.com/user/repo/pull/42');
    expect(match![1]).toBe('42');
  });

  it('matches PR URLs with org/repo names containing hyphens', () => {
    const match = 'https://github.com/jess-bergs/agent-kanban/pull/105'.match(prUrlRegex);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('105');
  });

  it('does not match non-PR GitHub URLs', () => {
    expect('https://github.com/user/repo/issues/1'.match(prUrlRegex)).toBeNull();
    expect('https://github.com/user/repo'.match(prUrlRegex)).toBeNull();
  });

  it('extracts first PR URL from multi-line output', () => {
    const output = `
Working on the task...
Created https://github.com/org/repo/pull/99
Done!
    `;
    const match = output.match(prUrlRegex);
    expect(match![1]).toBe('99');
  });
});
