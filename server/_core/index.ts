/**
 * _core/index.ts — v6.04
 *
 * Server entry point. Kept intentionally slim — all initialization logic
 * has been extracted into focused modules:
 *
 *   initRoutes.ts   — Core API routes (/health, /api/self/introspect, /api/diagnostics, /api/rsi/*)
 *   initModules.ts  — All async module initialization (order-dependent)
 *   initDaemons.ts  — Background daemon startup (called after server.listen())
 *   initSafety.ts   — Boot integrity check and crash guard
 */

import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

// ── Load env vars ─────────────────────────────────────────────────────────────
// Search order: .env.local takes priority over .env.
// Checks both the launcher root (next to START HERE.bat) and andromeda/ subfolder.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envCandidates: string[] = [
  resolve(process.cwd(), ".env.local"),        // CWD/.env.local  ← bat sets CWD to app root
  resolve(__dirname, "../.env.local"),         // dist/../.env.local = app root (bundle)
  resolve(__dirname, "../../.env.local"),      // server/_core/../../.env.local = app root (dev)
  resolve(__dirname, "../../../.env.local"),   // one more level up (legacy)
  resolve(process.cwd(), ".env"),              // CWD/.env
  resolve(__dirname, "../.env"),               // dist/../.env (bundle)
  resolve(__dirname, "../../.env"),            // server/_core/../../.env (dev)
];
let envLoaded = false;
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    dotenvConfig({ path: envPath });
    envLoaded = true;
    break;
  }
}
if (!envLoaded) dotenvConfig();

import express from "express";
import { createServer } from "http";
import net from "net";
import { randomUUID } from "crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerStreamRoutes } from "../streamRouter";
import { registerCoreRoutes } from "./initRoutes";
import { initModules } from "./initModules";
import { startDaemons } from "./initDaemons";
import { runBootIntegrityCheck, clearCrashFlag } from "./initSafety";

// ── Port utilities ────────────────────────────────────────────────────────────
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => server.close(() => resolve(true)));
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// ── Main server startup ───────────────────────────────────────────────────────
async function startServer(): Promise<void> {
  const app = express();
  const server = createServer(app);

  // v5.11: CORS middleware — configurable via CORS_ORIGIN env var
  const corsOrigin = process.env.CORS_ORIGIN || "";
  if (corsOrigin) {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (corsOrigin === "*" || origin === corsOrigin) {
        res.setHeader("Access-Control-Allow-Origin", corsOrigin === "*" ? "*" : origin!);
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID");
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
      if (req.method === "OPTIONS") { res.sendStatus(204); return; }
      next();
    });
  }

  // v5.11: Request ID tracing — every request gets a unique 8-char ID
  app.use((req, res, next) => {
    const requestId = randomUUID().slice(0, 8);
    (req as any).requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      if (res.statusCode >= 400) {
        // v6.15: Suppress autocomplete 400s — these are harmless tRPC batch-link
        // mount-time fires before skipToken activates. Not a real error.
        const isAutocompletNoise = req.path.includes("search.autocomplete") && res.statusCode === 400;
        if (!isAutocompletNoise) {
          console.warn(`[${requestId}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
        }
      }
    });
    next();
  });

  // v5.8: Security headers
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  // v5.8: Request size limit and timeout
  // v6.18: Reduced from 2gb to 50mb (DoS fix) — 50mb is sufficient for most routes
  // v10.2: Large-payload routes (zip analysis/edit) get 200MB limit to support 69MB+ zips
  //        (base64 encoding inflates ~33%, so 69MB zip → ~92MB JSON body)
  const LARGE_PAYLOAD_ROUTES = ["/api/analyze/stream", "/api/edit/zip"];
  app.use((req, res, next) => {
    const isLargeRoute = LARGE_PAYLOAD_ROUTES.some(r => req.path.startsWith(r));
    const limit = isLargeRoute ? "200mb" : "50mb";
    express.json({ limit })(req, res, next);
  });
  app.use((req, res, next) => {
    const isLargeRoute = LARGE_PAYLOAD_ROUTES.some(r => req.path.startsWith(r));
    const limit = isLargeRoute ? "200mb" : "50mb";
    express.urlencoded({ limit, extended: true })(req, res, next);
  });
  app.use((req, res, next) => {
    // Long-running endpoints: streams, RSI trigger/pipeline, self-improve, guard apply
    const isLongRunning = req.path.includes("/stream") ||
      req.path.includes("/rsi/trigger") ||
      req.path.includes("/rsi/parallel") ||
      req.path.includes("/rsi/scheduler") ||
      req.path.includes("/pipeline") ||
      req.path.includes("/guard/apply") ||
      req.path.includes("/self/improve");
    const timeout = isLongRunning ? 300_000 : 60_000;
    res.setTimeout(timeout, () => {
      if (!res.headersSent) res.status(408).json({ error: "Request timeout" });
    });
    next();
  });

  // Register routes
  await registerCoreRoutes(app);  // /health, /api/self/introspect, /api/diagnostics, /api/rsi/*, /api/rag/*, /api/eval/*, /api/episodic/*, /api/plan/*
  registerOAuthRoutes(app);      // OAuth callback
  registerStreamRoutes(app);     // SSE streaming endpoints
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  // Static/Vite serving
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  // Boot integrity check (crash guard, auto-rollback)
  await runBootIntegrityCheck();

  // Initialize all async modules
  await initModules();

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    startDaemons();
  });

  // v5.8: Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    clearCrashFlag();
    server.close(() => {
      console.log("All connections drained. Goodbye.");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Forced shutdown after 10s timeout");
      process.exit(1);
    }, 10_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  // v7.1.7: On Windows, Ctrl+C in a PowerShell/cmd window sometimes kills the
  // process before SIGINT fires, leaving the crash flag behind and causing a
  // spurious git rollback on the next boot. beforeExit + exit act as safety nets.
  process.on("beforeExit", () => { try { clearCrashFlag(); } catch {} });
  process.on("exit", () => { try { clearCrashFlag(); } catch {} });

  // v5.23: Global unhandled error handlers
  process.on("unhandledRejection", (reason) => {
    console.error("[UNHANDLED REJECTION]", reason);
    import("../selfMonitor.js").then(m => {
      m.recordMetric("error_rate", 1, `Unhandled rejection: ${String(reason).slice(0, 200)}`);
    }).catch(() => {});
  });
  process.on("uncaughtException", (err) => {
    // v10.1: canvas.node is an optional native dependency. On Windows without
    // build tools, canvas.node is missing and throws MODULE_NOT_FOUND when
    // required. Swallow this error and continue — visual annotation is disabled
    // gracefully. This prevents the server from crash-looping on Windows.
    const nodeErr = err as NodeJS.ErrnoException & { requireStack?: string[] };
    if (nodeErr.code === "MODULE_NOT_FOUND" &&
        (nodeErr.message?.includes("canvas") || nodeErr.requireStack?.some?.(s => s.includes("canvas")))) {
      console.warn("[WARN] canvas native binary not available (Windows without build tools)");
      console.warn("[WARN] Visual annotation features disabled. Server continues normally.");
      return; // Do NOT exit — canvas is optional
    }
    console.error("[UNCAUGHT EXCEPTION]", err);
    // v8.9: Clear crash flag so a non-RSI crash does not trigger a spurious
    // git rollback on the next boot. The crash flag is only meaningful for
    // detecting RSI-induced instability, not general runtime errors.
    try { clearCrashFlag(); } catch {}
    import("../selfMonitor.js").then(m => {
      m.recordMetric("error_rate", 1, `Uncaught exception: ${err.message}`);
    }).catch(() => {});
    setTimeout(() => process.exit(1), 5000);
  });
}

startServer().catch(console.error);
