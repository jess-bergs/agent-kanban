/**
 * Authenticated fetch wrapper.
 *
 * Reads the API key from localStorage and attaches it as a Bearer token.
 * Falls back to unauthenticated requests when no key is stored (local dev).
 */

const API_KEY_STORAGE_KEY = 'agent-kanban-api-key';

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
}

export function setApiKey(key: string): void {
  if (key) {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

/**
 * Fetch wrapper that adds the Authorization header when an API key is stored.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const key = getApiKey();
  if (!key) return fetch(input, init);

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${key}`);
  return fetch(input, { ...init, headers });
}
