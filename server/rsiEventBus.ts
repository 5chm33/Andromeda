/**
 * rsiEventBus.ts — Real-time RSI Event Bus
 * Andromeda v9.14.0
 *
 * Provides a server-sent events (SSE) stream for RSI events.
 * Replaces the 15-second polling in ProposalNotifier.tsx with
 * instant push notifications when proposals are created, applied,
 * or rejected.
 *
 * Events emitted:
 *   proposal:new      — A new proposal was generated
 *   proposal:applied  — A proposal was applied (commit made)
 *   proposal:rejected — A proposal was rejected
 *   cycle:start       — RSI cycle started
 *   cycle:complete    — RSI cycle completed (with summary)
 *   parallel:start    — Parallel RSI workers started
 *   parallel:complete — All parallel workers finished
 */

import type { Response } from "express";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RsiEventType =
  | "proposal:new"
  | "proposal:applied"
  | "proposal:rejected"
  | "cycle:start"
  | "cycle:complete"
  | "parallel:start"
  | "parallel:complete"
  | "heartbeat";

export interface RsiEvent {
  type: RsiEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

// ─── Client Registry ─────────────────────────────────────────────────────────

interface SseClient {
  id: string;
  res: Response;
  connectedAt: number;
}

const clients = new Map<string, SseClient>();
let clientIdCounter = 0;

// ─── Event History (last 50 events for new client catch-up) ──────────────────

const eventHistory: RsiEvent[] = [];
const MAX_HISTORY = 50;

function addToHistory(event: RsiEvent): void {
  eventHistory.push(event);
  if (eventHistory.length > MAX_HISTORY) {
    eventHistory.shift();
  }
}

// ─── Emit ─────────────────────────────────────────────────────────────────────

/**
 * Emit an RSI event to all connected SSE clients.
 */
export function emitRsiEvent(type: RsiEventType, data: Record<string, unknown> = {}): void {
  const event: RsiEvent = { type, timestamp: Date.now(), data };
  addToHistory(event);

  const payload = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
  const deadClients: string[] = [];

  for (const [id, client] of clients) {
    try {
      client.res.write(payload);
    } catch {
      deadClients.push(id);
    }
  }

  // Clean up dead clients
  for (const id of deadClients) {
    clients.delete(id);
  }
}

// ─── SSE Connection Handler ───────────────────────────────────────────────────

/**
 * Register a new SSE client connection.
 * Returns a cleanup function to call when the connection closes.
 */
export function registerSseClient(res: Response, since?: number): () => void {
  const id = `sse-${++clientIdCounter}-${Date.now()}`;

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Register client
  clients.set(id, { id, res, connectedAt: Date.now() });

  // Send missed events since the client's last connection
  if (since !== undefined) {
    const missed = eventHistory.filter(e => e.timestamp > since);
    for (const event of missed) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  }

  // Send initial connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ id, timestamp: Date.now(), clientCount: clients.size })}\n\n`);

  // Cleanup on disconnect
  const cleanup = () => {
    clients.delete(id);
  };

  res.on("close", cleanup);
  res.on("error", cleanup);

  return cleanup;
}

// ─── Status ───────────────────────────────────────────────────────────────────

/** Get the number of connected SSE clients */
export function getSseClientCount(): number {
  return clients.size;
}

/** Get the last N events from history */
export function getEventHistory(limit = 20): RsiEvent[] {
  return eventHistory.slice(-limit);
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

// Send a heartbeat every 30 seconds to keep connections alive
setInterval(() => {
  if (clients.size > 0) {
    emitRsiEvent("heartbeat", { clientCount: clients.size });
  }
}, 30_000);
