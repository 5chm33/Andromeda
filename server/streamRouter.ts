/**
 * streamRouter.ts — Main route orchestrator (v9.12.0)
 *
 * This file is intentionally thin. All route logic has been extracted into
 * focused modules under server/routes/. This file:
 *   1. Creates shared infrastructure (rate limiters, SSE helpers, session map)
 *   2. Delegates to each route module
 *
 * Route modules:
 *   searchRoutes.ts    — /api/search/*
 *   chatRoutes.ts      — /api/chat/*, /api/continue/*, /api/image/*, /api/browse, /api/agent/plan
 *   editRoutes.ts      — /api/edit/*, /api/analyze/*, /api/code/execute
 *   codeRoutes.ts      — /api/code/*, /api/deps/*, /api/workspace/*, /api/agent/team*
 *   toolMcpRoutes.ts   — /api/tools/*, /api/mcp/*, /api/llm/*
 *   agentRoutes.ts     — /api/agent/react/*
 *   memoryRoutes.ts    — /api/memory/*
 *   selfRoutes.ts      — /api/self/*, /api/rsi/*
 *   llmRoutes.ts       — /api/llm/* (extended)
 *   autonomyRoutes.ts  — /api/autonomy/*
 *   systemRoutes.ts    — /api/system/*
 */
import type { Express, Request, Response } from "express";
import { ReactEngine } from "./reactEngine.js";
import rateLimit from "express-rate-limit";

// ── Route module imports ───────────────────────────────────────────────────────
import { registerSearchRoutes } from "./routes/searchRoutes.js";
import { registerChatRoutes } from "./routes/chatRoutes.js";
import { registerEditRoutes } from "./routes/editRoutes.js";
import { registerCodeRoutes } from "./routes/codeRoutes.js";
import { registerToolMcpRoutes } from "./routes/toolMcpRoutes.js";
import { registerMemoryRoutes } from "./routes/memoryRoutes.js";
import { registerSelfRoutes } from "./routes/selfRoutes.js";
import { registerAgentRoutes } from "./routes/agentRoutes.js";
import { registerLLMRoutes } from "./routes/llmRoutes.js";
import { registerAutonomyRoutes } from "./routes/autonomyRoutes.js";
import { registerSystemRoutes } from "./routes/systemRoutes.js";

// ── Shared session map ─────────────────────────────────────────────────────────
// Maps sessionId → active ReactEngine for human-in-the-loop control.
const activeAgentSessions = new Map<string, ReactEngine>();

// Cleanup completed/interrupted sessions every 5 minutes
const sessionCleanupInterval = setInterval(() => {
  for (const [id, engine] of Array.from(activeAgentSessions.entries())) {
    const st = engine.getState();
    if (st === "completed" || st === "interrupted") activeAgentSessions.delete(id);
  }
}, 5 * 60_000);
sessionCleanupInterval.unref();

export function stopSessionCleanup(): void {
  clearInterval(sessionCleanupInterval);
}

// ── Rate limiters ──────────────────────────────────────────────────────────────

/** Standard rate limiter: 120 requests per minute per IP */
function extractIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : forwarded?.[0] ?? req.socket.remoteAddress ?? "unknown";
}

const streamLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractIp,
});

/** Heavy rate limiter: 20 requests per minute per IP (for expensive operations) */
const heavyLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractIp,
});

// ── SSE helpers ────────────────────────────────────────────────────────────────

/** Sets Server-Sent Events headers on the response. */
function setSseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

/** Writes a single SSE event to the response. */
function sseWrite(res: Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  // flush() is available when compression middleware is active (not in standard Express types)
  const r = res as Response & { flush?: () => void };
  if (typeof r.flush === "function") r.flush?.();
}

// ── Main registration function ─────────────────────────────────────────────────

/**
 * Registers all API routes onto the Express application.
 * Called once at server startup from _core/index.ts.
 * @param app Express application instance
 */
export function registerStreamRoutes(app: Express): void {
  if (!app || typeof app.use !== "function") {
    throw new Error("registerStreamRoutes: invalid Express app instance");
  }
  const deps: Record<string, unknown> = { activeAgentSessions };

  // Delegate to focused route modules
  registerSearchRoutes(app, streamLimiter, heavyLimiter, setSseHeaders, sseWrite);
  registerChatRoutes(app, streamLimiter, heavyLimiter, setSseHeaders, sseWrite, deps);
  registerEditRoutes(app, streamLimiter, heavyLimiter, setSseHeaders, sseWrite);
  registerCodeRoutes(app, streamLimiter, heavyLimiter);
  registerToolMcpRoutes(app);
  registerMemoryRoutes(app, streamLimiter, heavyLimiter, setSseHeaders, sseWrite, deps);
  registerSelfRoutes(app, streamLimiter, heavyLimiter, setSseHeaders, sseWrite, deps);
  registerAgentRoutes(app, streamLimiter, heavyLimiter, setSseHeaders, sseWrite, deps);
  registerLLMRoutes(app);
  registerAutonomyRoutes(app);
  registerSystemRoutes(app);
}
