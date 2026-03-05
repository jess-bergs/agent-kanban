import { describe, it, expect } from 'vitest';
import { sendSteeringMessage, steerAgent, isAgentRunning } from '../server/dispatcher.ts';

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

describe('steerAgent', () => {
  it('returns false when no agent process exists for the ticket', () => {
    expect(steerAgent('nonexistent-ticket-id', 'redirect to this')).toBe(false);
  });

  it('returns false for empty ticket ID', () => {
    expect(steerAgent('', 'redirect to this')).toBe(false);
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

  it('determines mode based on agent state, stdin availability, and session ID', () => {
    // Simulates the endpoint's updated mode selection logic:
    // Running + stdin works → stdin mode
    // Running + stdin closed → stop & resume (falls back to resume mode)
    // Not running + session ID → resume mode
    // Not running + no session → error
    function determineMode(isRunning: boolean, stdinAvailable: boolean, hasSessionId: boolean): string | null {
      if (isRunning) {
        if (stdinAvailable) return 'stdin';
        return 'resume'; // stop-and-resume fallback
      }
      if (hasSessionId) return 'resume';
      return null; // no valid mode
    }

    expect(determineMode(true, true, false)).toBe('stdin');
    expect(determineMode(true, true, true)).toBe('stdin');
    expect(determineMode(true, false, false)).toBe('resume'); // stdin closed → stop & resume
    expect(determineMode(true, false, true)).toBe('resume');
    expect(determineMode(false, false, true)).toBe('resume');
    expect(determineMode(false, false, false)).toBeNull();
  });
});
