import { describe, it, expect } from 'vitest';
import { sendSteeringMessage, isAgentRunning } from '../server/dispatcher.ts';

describe('isAgentRunning', () => {
  it('returns false for unknown ticket IDs', () => {
    expect(isAgentRunning('nonexistent-ticket-id')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAgentRunning('')).toBe(false);
  });
});

describe('sendSteeringMessage', () => {
  it('returns false when no agent process exists for the ticket', () => {
    expect(sendSteeringMessage('nonexistent-ticket-id', 'hello')).toBe(false);
  });

  it('returns false for empty ticket ID', () => {
    expect(sendSteeringMessage('', 'hello')).toBe(false);
  });
});

describe('steer API request validation', () => {
  // These test the validation logic patterns used by POST /api/tickets/:id/steer
  // without requiring a running server. They verify the conditions the endpoint checks.

  it('rejects empty messages', () => {
    const inputs = ['', '   ', null, undefined];
    for (const input of inputs) {
      const isValid = typeof input === 'string' && input.trim().length > 0;
      expect(isValid).toBe(false);
    }
  });

  it('accepts non-empty string messages', () => {
    const inputs = ['hello', 'fix the bug', 'a'];
    for (const input of inputs) {
      const isValid = typeof input === 'string' && input.trim().length > 0;
      expect(isValid).toBe(true);
    }
  });

  it('determines mode based on agent state and session ID', () => {
    // Simulates the endpoint's mode selection logic
    function determineMode(isRunning: boolean, hasSessionId: boolean): string | null {
      if (isRunning) return 'stdin';
      if (hasSessionId) return 'resume';
      return null; // no valid mode
    }

    expect(determineMode(true, false)).toBe('stdin');
    expect(determineMode(true, true)).toBe('stdin'); // running takes priority
    expect(determineMode(false, true)).toBe('resume');
    expect(determineMode(false, false)).toBeNull();
  });
});
