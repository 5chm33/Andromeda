/**
 * apiRoutes.ts — Andromeda REST API Product Layer (v1.0.0)
 *
 * This is the public-facing REST API that exposes Andromeda's core capabilities
 * to external clients. Think of it as the "product wrapper" around the internal
 * agent pipeline.
 *
 * Endpoints:
 *   GET  /api/v1/health         — Liveness check (no auth required)
 *   GET  /api/v1/status         — Detailed system status (auth required)
 *   POST /api/v1/fix            — Submit a GitHub repo fix job (auth required)
 *   GET  /api/v1/fix/:jobId     — Get job status and events (auth required)
 *   GET  /api/v1/fix/:jobId/stream — SSE stream of job events (auth required)
 *   GET  /api/v1/jobs           — List all recent jobs (auth required)
 *
 * Authentication:
 *   All endpoints except /api/v1/health require an API key in the header:
 *     Authorization: Bearer <your-api-key>
 *   or as a query param:
 *     ?api_key=<your-api-key>
 *
 *   The API key is set via the ANDROMEDA_API_KEY environment variable.
 *   If not set, a random key is generated at startup and logged to the console.
 *
 * Rate Limiting:
 *   - 60 requests per minute per API key for status/list endpoints
 *   - 10 fix jobs per hour per API key
 *
 * What is a REST API?
 *   A REST API (Representational State Transfer Application Programming Interface)
 *   is a standard way for programs to communicate over HTTP. Instead of a web browser
 *   loading a page, a program sends a request (like GET or POST) to a URL and gets
 *   back structured data (JSON). This lets Andromeda be used as a service by other
 *   programs, scripts, or web apps — not just through the browser UI.
 */

import { Router, Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiRequest extends Request {
  apiKey?: string;
}

// ─── API Key Management ───────────────────────────────────────────────────────

/**
 * Returns the configured API key, or generates one if not set.
 * The key is read fresh from env on each call (no caching) so tests can override it.
 */
let _cachedApiKey: string | null = null;
function getApiKey(): string {
  // Always re-read from env (allows tests to override)
  const envKey = process.env.ANDROMEDA_API_KEY;
  if (envKey && envKey.length >= 8) {
    _cachedApiKey = envKey;
    return _cachedApiKey;
  }

  // Only generate once per process (stable for production)
  if (_cachedApiKey) return _cachedApiKey;

  // Generate a random key and log it so the user can use it
  _cachedApiKey = `ak_${randomBytes(24).toString("hex")}`;
  console.log(`\n[Andromeda API] No ANDROMEDA_API_KEY set. Generated key for this session:`);
  console.log(`[Andromeda API]   ${_cachedApiKey}`);
  console.log(`[Andromeda API] Set ANDROMEDA_API_KEY in your .env.local to make it permanent.\n`);
  return _cachedApiKey;
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const _rateLimitWindows = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const window = _rateLimitWindows.get(key);

  if (!window || now - window.windowStart > windowMs) {
    _rateLimitWindows.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (window.count >= maxRequests) return false;
  window.count++;
  return true;
}

// ─── Authentication Middleware ────────────────────────────────────────────────

function requireApiKey(req: ApiRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const queryKey = req.query.api_key as string | undefined;

  let providedKey: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    providedKey = authHeader.slice(7).trim();
  } else if (queryKey) {
    providedKey = queryKey.trim();
  }

  if (!providedKey) {
    res.status(401).json({
      error: "Unauthorized",
      message: "API key required. Pass it as: Authorization: Bearer <key> or ?api_key=<key>",
    });
    return;
  }

  if (providedKey !== getApiKey()) {
    res.status(403).json({
      error: "Forbidden",
      message: "Invalid API key.",
    });
    return;
  }

  req.apiKey = providedKey;
  next();
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function createApiRouter(): Router {
  const router = Router();

  // Ensure the API key is initialized at startup
  getApiKey();

  // ── GET /api/v1/health ─────────────────────────────────────────────────────
  // Public endpoint — no auth required. Used by uptime monitors and health checks.
  router.get("/health", (_req: Request, res: Response) => {
    let version = "unknown";
    try {
      version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")).version;
    } catch { /* non-fatal */ }

    res.json({
      ok: true,
      service: "Andromeda AI Agent API",
      version,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    });
  });

  // ── GET /api/v1/status ─────────────────────────────────────────────────────
  // Returns detailed system status. Requires API key.
  router.get("/status", requireApiKey, async (_req: ApiRequest, res: Response) => {
    try {
      let version = "unknown";
      try {
        version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")).version;
      } catch { /* non-fatal */ }

      // Get active job count
      let activeJobs = 0;
      let totalJobs = 0;
      try {
        const { listJobs } = await import("../externalRepoFixer.js");
        const jobs = listJobs();
        totalJobs = jobs.length;
        activeJobs = jobs.filter(j => !["done", "failed"].includes(j.status)).length;
      } catch { /* non-fatal */ }

      res.json({
        ok: true,
        service: "Andromeda AI Agent API",
        version,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        jobs: {
          active: activeJobs,
          total: totalJobs,
        },
        capabilities: [
          "fix-github-repo",
          "swe-bench-pipeline",
          "multi-attempt-revision",
          "model-escalation",
          "smart-context-selection",
        ],
        models: {
          base: process.env.SWEBENCH_BASE_MODEL ?? "claude-sonnet-4-5",
          mid: process.env.SWEBENCH_MID_MODEL ?? "claude-sonnet-5",
          strong: process.env.SWEBENCH_STRONG_MODEL ?? "fable-5",
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Status check failed", message: (err as Error).message });
    }
  });

  // ── POST /api/v1/fix ───────────────────────────────────────────────────────
  // Submit a new GitHub repo fix job. Requires API key.
  // Body: { repoUrl: string, maxFiles?: number, githubPat?: string }
  router.post("/fix", requireApiKey, async (req: ApiRequest, res: Response) => {
    // Rate limit: 10 fix jobs per hour per key
    const rateLimitKey = `fix:${req.apiKey}`;
    if (!checkRateLimit(rateLimitKey, 10, 60 * 60 * 1000)) {
      res.status(429).json({
        error: "Rate limit exceeded",
        message: "Maximum 10 fix jobs per hour. Try again later.",
      });
      return;
    }

    const { repoUrl, maxFiles, githubPat, branchPrefix, prTitle, prBody } = req.body ?? {};

    if (!repoUrl || typeof repoUrl !== "string") {
      res.status(400).json({
        error: "Bad Request",
        message: "repoUrl is required. Example: { \"repoUrl\": \"https://github.com/owner/repo\" }",
      });
      return;
    }

    // Validate it looks like a GitHub URL
    if (!repoUrl.includes("github.com") && !repoUrl.includes("gitlab.com")) {
      res.status(400).json({
        error: "Bad Request",
        message: "repoUrl must be a GitHub or GitLab URL.",
      });
      return;
    }

    try {
      const { startFixJob } = await import("../externalRepoFixer.js");
      const job = await startFixJob({
        repoUrl,
        maxFiles: typeof maxFiles === "number" ? Math.min(maxFiles, 15) : 5,
        githubPat: githubPat ?? process.env.GITHUB_TOKEN,
        branchPrefix: branchPrefix ?? "andromeda/fix",
        prTitle,
        prBody,
      });

      res.status(202).json({
        jobId: job.id,
        status: job.status,
        repoUrl: job.repoUrl,
        createdAt: new Date(job.createdAt).toISOString(),
        statusUrl: `/api/v1/fix/${job.id}`,
        streamUrl: `/api/v1/fix/${job.id}/stream`,
        message: "Fix job started. Poll statusUrl for updates or connect to streamUrl for real-time events.",
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to start fix job", message: (err as Error).message });
    }
  });

  // ── GET /api/v1/fix/:jobId ─────────────────────────────────────────────────
  // Get current status and event history for a fix job. Requires API key.
  router.get("/fix/:jobId", requireApiKey, async (req: ApiRequest, res: Response) => {
    try {
      const { getJob } = await import("../externalRepoFixer.js");
      const job = getJob(req.params.jobId);

      if (!job) {
        res.status(404).json({ error: "Not Found", message: `Job ${req.params.jobId} not found.` });
        return;
      }

      res.json({
        jobId: job.id,
        status: job.status,
        repoUrl: job.repoUrl,
        createdAt: new Date(job.createdAt).toISOString(),
        updatedAt: new Date(job.updatedAt).toISOString(),
        events: job.events.map(e => ({
          status: e.status,
          message: e.message,
          progress: e.progress,
          prUrl: e.prUrl,
          error: e.error,
          timestamp: new Date(e.timestamp).toISOString(),
        })),
        prUrl: job.events.find(e => e.prUrl)?.prUrl,
        error: job.events.find(e => e.error)?.error,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to get job", message: (err as Error).message });
    }
  });

  // ── GET /api/v1/fix/:jobId/stream ──────────────────────────────────────────
  // Server-Sent Events (SSE) stream of job events. Requires API key.
  // The client connects and receives real-time progress updates as the job runs.
  router.get("/fix/:jobId/stream", requireApiKey, async (req: ApiRequest, res: Response) => {
    try {
      const { getJob } = await import("../externalRepoFixer.js");
      const job = getJob(req.params.jobId);

      if (!job) {
        res.status(404).json({ error: "Not Found", message: `Job ${req.params.jobId} not found.` });
        return;
      }

      // Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
      res.flushHeaders();

      // Send all existing events first
      for (const event of job.events) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      // If job is already done, close the stream
      if (job.status === "done" || job.status === "failed") {
        res.write(`data: ${JSON.stringify({ type: "close" })}\n\n`);
        res.end();
        return;
      }

      // Subscribe to future events
      const onEvent = (event: unknown) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        const e = event as { status?: string };
        if (e.status === "done" || e.status === "failed") {
          res.write(`data: ${JSON.stringify({ type: "close" })}\n\n`);
          res.end();
        }
      };

      job.emitter.on("event", onEvent);

      // Clean up when client disconnects
      req.on("close", () => {
        job.emitter.off("event", onEvent);
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to stream job", message: (err as Error).message });
    }
  });

  // ── GET /api/v1/jobs ───────────────────────────────────────────────────────
  // List all recent fix jobs. Requires API key.
  router.get("/jobs", requireApiKey, async (_req: ApiRequest, res: Response) => {
    try {
      const { listJobs } = await import("../externalRepoFixer.js");
      const jobs = listJobs();

      res.json({
        jobs: jobs.map(j => ({
          jobId: j.id,
          status: j.status,
          repoUrl: j.repoUrl,
          createdAt: new Date(j.createdAt).toISOString(),
          updatedAt: new Date(j.updatedAt).toISOString(),
          prUrl: j.events?.find((e: { prUrl?: string }) => e.prUrl)?.prUrl,
        })),
        total: jobs.length,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to list jobs", message: (err as Error).message });
    }
  });

  return router;
}
