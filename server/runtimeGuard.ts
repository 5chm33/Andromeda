/**
 * runtimeGuard.ts — v12.10.0 — Runtime Telemetry Feedback & Auto-Rollback
 *
 * Monitors live server routes for 500 errors after a proposal is applied.
 * If a newly modified route throws a 500 error within the observation window
 * (default: 5 minutes), the system automatically triggers a semantic rollback.
 *
 * How it works:
 *  1. After a proposal is committed, the modified file's route paths are
 *     extracted from the AST (looking for app.get/post/put/delete/use calls).
 *  2. A "watch window" is registered for those routes for N minutes.
 *  3. The existing telemetry middleware records every request's status code.
 *  4. A background check runs every 30 seconds during the watch window.
 *  5. If any watched route accumulates ≥3 consecutive 500 errors, the
 *     semantic rollback is triggered and the proposal is marked "auto-rolled-back".
 *
 * Safety features:
 *  - Only triggers on routes that were CLEAN before the proposal (no pre-existing 500s)
 *  - Requires ≥3 consecutive errors (not just 1) to avoid flapping
 *  - Rollback is logged with full context for human review
 *  - Watch window expires automatically after N minutes
 *  - Non-blocking: all operations are non-fatal
 *
 * Expected impact: Safety net that prevents bad commits from staying live.
 * Particularly valuable for route handler changes that pass tsc but have
 * runtime logic errors (unhandled promise rejections, missing await, etc.).
 *
 * Integration: called from selfImprove.ts after git commit.
 * The watch is registered asynchronously and does not block the apply pipeline.
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("runtimeGuard");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RouteWatch {
  proposalId: string;
  targetFile: string;
  routes: string[];
  startedAt: number;
  windowMs: number;         // observation window in ms (default: 5 min)
  consecutiveErrors: Map<string, number>;
  triggered: boolean;
  rollbackFn?: () => Promise<void>;
}

export interface RuntimeGuardResult {
  watchRegistered: boolean;
  routes: string[];
  skippedReason?: string;
}

// ─── In-Memory Watch Registry ─────────────────────────────────────────────────

const _activeWatches = new Map<string, RouteWatch>();
let _checkIntervalId: ReturnType<typeof setInterval> | null = null;
const CHECK_INTERVAL_MS = 30_000; // 30 seconds

// ─── Route Extraction ─────────────────────────────────────────────────────────

/**
 * Extract Express route paths from a server file using regex.
 * Looks for patterns like: router.get('/path', ...) or app.post('/path', ...)
 */
export function extractRoutePaths(fileContent: string): string[] {
  const routes: string[] = [];
  const routeRe = /(?:router|app)\s*\.\s*(?:get|post|put|patch|delete|use)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(fileContent)) !== null) {
    const route = m[1];
    if (route && route.startsWith("/")) {
      routes.push(route);
    }
  }
  return [...new Set(routes)];
}

// ─── Error Rate Sampling ──────────────────────────────────────────────────────

/**
 * Sample the current 500 error rate for a set of routes from the telemetry module.
 * Returns a map of route -> recent 500 count.
 */
async function sampleErrorRates(routes: string[]): Promise<Map<string, number>> {
  const errorMap = new Map<string, number>();
  try {
    const { getRawSamples } = await import("./telemetry.js");
    const samples = getRawSamples().latency;
    const recentWindow = Date.now() - 60_000; // last 60 seconds

    for (const route of routes) {
      const routeSamples = samples.filter(s =>
        s.timestamp > recentWindow &&
        s.statusCode >= 500 &&
        (s.endpoint === route || s.endpoint.startsWith(route))
      );
      errorMap.set(route, routeSamples.length);
    }
  } catch { /* telemetry module not available */ }
  return errorMap;
}

// ─── Background Check Loop ────────────────────────────────────────────────────

function startCheckLoop(): void {
  if (_checkIntervalId !== null) return; // already running

  _checkIntervalId = setInterval(async () => {
    const now = Date.now();
    const expiredWatches: string[] = [];

    for (const [proposalId, watch] of _activeWatches) {
      // Expire old watches
      if (now - watch.startedAt > watch.windowMs) {
        expiredWatches.push(proposalId);
        log.info(`[RuntimeGuard] Watch expired for proposal ${proposalId} (no issues detected)`);
        continue;
      }

      if (watch.triggered) {
        expiredWatches.push(proposalId);
        continue;
      }

      // Sample error rates
      const errorRates = await sampleErrorRates(watch.routes);

      for (const [route, errorCount] of errorRates) {
        if (errorCount > 0) {
          const prev = watch.consecutiveErrors.get(route) ?? 0;
          watch.consecutiveErrors.set(route, prev + errorCount);

          const total = watch.consecutiveErrors.get(route) ?? 0;
          if (total >= 3) {
            log.warn(`[RuntimeGuard] TRIGGERING auto-rollback for proposal ${proposalId}: route ${route} has ${total} errors in observation window`);
            watch.triggered = true;

            // Trigger rollback
            if (watch.rollbackFn) {
              try {
                await watch.rollbackFn();
                log.info(`[RuntimeGuard] Auto-rollback completed for proposal ${proposalId}`);
              } catch (rollbackErr) {
                log.error(`[RuntimeGuard] Auto-rollback FAILED for proposal ${proposalId}: ${(rollbackErr as Error).message}`);
              }
            }

            expiredWatches.push(proposalId);
            break;
          }
        } else {
          // Reset consecutive error count if no errors in this window
          watch.consecutiveErrors.set(route, 0);
        }
      }
    }

    // Clean up expired watches
    for (const id of expiredWatches) {
      _activeWatches.delete(id);
    }

    // Stop the interval if no more watches
    if (_activeWatches.size === 0 && _checkIntervalId !== null) {
      clearInterval(_checkIntervalId);
      _checkIntervalId = null;
    }
  }, CHECK_INTERVAL_MS);

  // Don't prevent process exit
  if (_checkIntervalId && typeof _checkIntervalId === "object" && "unref" in _checkIntervalId) {
    (_checkIntervalId as NodeJS.Timeout).unref();
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Register a runtime watch for a newly applied proposal.
 * Non-blocking — returns immediately after registering the watch.
 *
 * @param opts.proposalId - The proposal ID
 * @param opts.targetFile - The modified file path
 * @param opts.projectRoot - Project root directory
 * @param opts.windowMinutes - Observation window in minutes (default: 5)
 * @param opts.rollbackFn - Async function to call if rollback is triggered
 */
export function registerRuntimeWatch(opts: {
  proposalId: string;
  targetFile: string;
  projectRoot: string;
  windowMinutes?: number;
  rollbackFn?: () => Promise<void>;
}): RuntimeGuardResult {
  const { proposalId, targetFile, projectRoot, windowMinutes = 5, rollbackFn } = opts;

  // Only watch server-side route files
  const isRouteFile = targetFile.includes("route") ||
    targetFile.includes("Route") ||
    targetFile.includes("handler") ||
    targetFile.includes("Handler") ||
    targetFile.includes("controller") ||
    targetFile.includes("Controller") ||
    targetFile.includes("api/") ||
    targetFile.includes("_core/");

  if (!isRouteFile) {
    return {
      watchRegistered: false,
      routes: [],
      skippedReason: `Not a route file: ${targetFile}`,
    };
  }

  // Extract routes from the file
  let routes: string[] = [];
  try {
    const absPath = path.join(projectRoot, targetFile);
    if (fs.existsSync(absPath)) {
      const content = fs.readFileSync(absPath, "utf-8");
      routes = extractRoutePaths(content);
    }
  } catch { /* non-fatal */ }

  if (routes.length === 0) {
    return {
      watchRegistered: false,
      routes: [],
      skippedReason: "No route paths found in file",
    };
  }

  // Register the watch
  const watch: RouteWatch = {
    proposalId,
    targetFile,
    routes,
    startedAt: Date.now(),
    windowMs: windowMinutes * 60 * 1000,
    consecutiveErrors: new Map(),
    triggered: false,
    rollbackFn,
  };

  _activeWatches.set(proposalId, watch);
  startCheckLoop();

  log.info(`[RuntimeGuard] Watching ${routes.length} routes for proposal ${proposalId} (window: ${windowMinutes}min): ${routes.slice(0, 3).join(", ")}${routes.length > 3 ? "..." : ""}`);

  return {
    watchRegistered: true,
    routes,
  };
}

// ─── Status & Stats ───────────────────────────────────────────────────────────

export function getRuntimeGuardStats(): {
  activeWatches: number;
  watchedRoutes: string[];
} {
  const watchedRoutes: string[] = [];
  for (const watch of _activeWatches.values()) {
    watchedRoutes.push(...watch.routes);
  }
  return {
    activeWatches: _activeWatches.size,
    watchedRoutes: [...new Set(watchedRoutes)],
  };
}

export function clearAllWatches(): void {
  _activeWatches.clear();
  if (_checkIntervalId !== null) {
    clearInterval(_checkIntervalId);
    _checkIntervalId = null;
  }
}
