/**
 * API key authentication middleware.
 *
 * When API_KEY is set in the environment, all API requests and WebSocket
 * connections must include a valid key. When unset, auth is disabled
 * (local development mode).
 *
 * API requests: pass the key as `Authorization: Bearer <key>` header
 * WebSocket:    pass the key as `?token=<key>` query parameter
 */

import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import { config } from './config.ts';

/**
 * Express middleware — rejects requests without a valid API key.
 * Skips auth if API_KEY is not configured (development mode).
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!config.authEnabled) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (token !== config.apiKey) {
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  next();
}

/**
 * Validate a WebSocket upgrade request.
 * Returns true if the connection is authorized.
 */
export function validateWsAuth(req: IncomingMessage): boolean {
  if (!config.authEnabled) return true;

  // Check query param: ws://host/ws?token=<key>
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (token === config.apiKey) return true;

  // Also accept Authorization header (some WS clients support it)
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const headerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;
    if (headerToken === config.apiKey) return true;
  }

  return false;
}
