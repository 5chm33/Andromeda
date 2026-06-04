/**
 * watchdog.ts — v7.0.1
 *
 * Self-Healing Watchdog for Andromeda.
 *
 * v7.0.1 FIX: The original watchdog used `await import("../rsiEngine.js")`
 * style paths for health checks. When running from the dist bundle
 * (dist/index.js), all modules are compiled into a single file — there are
 * no separate ../rsiEngine.js files on disk. This caused every module to
 * report "Cannot find module" and the system to permanently show
 * "System health: critical", which also caused the orchestrator to fire
 * emergency healing on every cycle (the "0 actions, 1 errors" pattern).
 *
 * The fix: health checks now use lazy in-process imports (which resolve
 * correctly from the bundle via esbuild's module system) rather than
 * filesystem-relative paths. The `importPath` field is removed entirely.
 *
 * Additional fixes in v7.0.1:
 *   - rbac downgraded from critical → non-critical (it's middleware, not runtime)
 *   - audit action corrected from "server_started" → "module_recovered" / "module_failed"
 *   - telemetry module added to registry
 */

import { createLogger } from "./logger.js";
import { audit } from "./auditLog.js";

const log = createLogger("watchdog");

// ── Types ──────────────────────────────────────────────────────────────────────

export type ModuleHealth = "healthy" | "degraded" | "failed" | "recovering" | "unknown";

export interface WatchedModule {
  name: string;
  description: string;
  critical: boolean;
  health: ModuleHealth;
  failCount: number;
  restartCount: number;
  lastHealthyAt: number | null;
  lastFailedAt: number | null;
  lastRecoveredAt: number | null;
  mttrMs: number | null;
  lastError?: string;
}

export interface WatchdogStatus {
  enabled: boolean;
  interval: number;
  lastCheckAt: number | null;
  nextCheckAt: number | null;
  overallHealth: "healthy" | "degraded" | "critical";
  healthyModules: number;
  degradedModules: number;
  failedModules: number;
  totalModules: number;
  totalRestarts: number;
  uptime: number;
  modules: WatchedModule[];
}

// ── Module Spec ────────────────────────────────────────────────────────────────

interface ModuleSpec {
  name: string;
  description: string;
  critical: boolean;
  /** Returns true if the module is healthy. Throws on failure. */
  healthCheck: () => boolean | Promise<boolean>;
  /** Optional recovery function called on first failure. */
  reinit?: () => void | Promise<void>;
}

// All health checks use standard ESM imports which resolve correctly from
// both the source tree (dev mode) and the bundled dist/index.js (production).
const WATCHED_MODULES: ModuleSpec[] = [
  // ── Core RSI pipeline ──────────────────────────────────────────────────────
  {
    name: "rsiEngine",
    description: "Recursive Self-Improvement engine",
    critical: true,
    healthCheck: async () => {
      const { getRsiStatus } = await import("./rsiEngine.js");
      const s = getRsiStatus();
      return s !== null && s !== undefined;
    },
  },
  {
    name: "selfImprove",
    description: "Self-improvement proposal engine",
    critical: true,
    healthCheck: async () => {
      const { listProposals } = await import("./selfImprove.js");
      listProposals("pending");
      return true;
    },
  },
  {
    name: "safetySupervisor",
    description: "Safety supervisor / constitution guard",
    critical: true,
    healthCheck: async () => {
      await import("./safetySupervisor.js");
      return true;
    },
  },
  {
    name: "evalFramework",
    description: "Evaluation framework",
    critical: true,
    healthCheck: async () => {
      const { EVAL_TASKS } = await import("./evalFramework.js");
      return Array.isArray(EVAL_TASKS) && EVAL_TASKS.length > 0;
    },
  },
  // ── v6.36 modules ──────────────────────────────────────────────────────────
  {
    name: "evalGoalDiscovery",
    description: "Unsupervised goal discovery from eval results",
    critical: false,
    healthCheck: async () => {
      const { getDiscoveries } = await import("./evalGoalDiscovery.js");
      getDiscoveries();
      return true;
    },
  },
  {
    name: "learnedConstraints",
    description: "Constitutional AI learned constraints",
    critical: false,
    healthCheck: async () => {
      const { getConstraints } = await import("./learnedConstraints.js");
      getConstraints();
      return true;
    },
  },
  // ── v6.37 modules ──────────────────────────────────────────────────────────
  {
    name: "goalDecomposer",
    description: "Goal decomposition into sub-goals",
    critical: false,
    healthCheck: async () => {
      await import("./goalDecomposer.js");
      return true;
    },
  },
  {
    name: "dbPostgres",
    description: "Postgres database adapter (optional)",
    critical: false,
    healthCheck: async () => {
      const { getPgStatus } = await import("./dbPostgres.js");
      const s = getPgStatus();
      // Postgres is optional — if not configured, that's healthy (not an error)
      return !s.configured || s.connected === true;
    },
  },
  // ── v6.38 modules ──────────────────────────────────────────────────────────
  {
    name: "auditLog",
    description: "Structured audit log",
    critical: false,
    healthCheck: async () => {
      const { getAuditStats } = await import("./auditLog.js");
      getAuditStats();
      return true;
    },
    reinit: async () => {
      const { loadAuditFromDisk } = await import("./auditLog.js");
      loadAuditFromDisk();
    },
  },
  {
    name: "rbac",
    description: "Role-based access control middleware",
    critical: false, // v7.0.1: not critical — RBAC is middleware, not a runtime service
    healthCheck: async () => {
      await import("./rbac.js");
      return true;
    },
  },
  {
    name: "tenantManager",
    description: "Multi-tenant isolation manager",
    critical: false,
    healthCheck: async () => {
      const { getTenantStats } = await import("./tenantManager.js");
      getTenantStats();
      return true;
    },
    reinit: async () => {
      const { initTenantManager } = await import("./tenantManager.js");
      initTenantManager();
    },
  },
  // ── v6.39 modules ──────────────────────────────────────────────────────────
  {
    name: "federatedLearning",
    description: "Federated multi-node RSI learning",
    critical: false,
    healthCheck: async () => {
      const { getFederatedStats } = await import("./federatedLearning.js");
      getFederatedStats();
      return true;
    },
    reinit: async () => {
      const { initFederatedLearning } = await import("./federatedLearning.js");
      initFederatedLearning();
    },
  },
  // ── v6.40 modules ──────────────────────────────────────────────────────────
  {
    name: "adaptiveEval",
    description: "Adaptive eval with LLM-generated benchmarks",
    critical: false,
    healthCheck: async () => {
      const { getBenchmarkEvolutionStats } = await import("./adaptiveEval.js");
      getBenchmarkEvolutionStats();
      return true;
    },
    reinit: async () => {
      const { initAdaptiveEval } = await import("./adaptiveEval.js");
      initAdaptiveEval();
    },
  },
  // ── Core infrastructure ────────────────────────────────────────────────────
  {
    name: "contextBus",
    description: "Cross-session context bus",
    critical: true,
    healthCheck: async () => {
      const { getContextBusStats } = await import("./contextBus.js");
      getContextBusStats();
      return true;
    },
  },
  {
    name: "selfModel",
    description: "Self-model and capability manifest",
    critical: false,
    healthCheck: async () => {
      const { getSelfModel } = await import("./selfModel.js");
      getSelfModel();
      return true;
    },
  },
  {
    name: "circuitBreaker",
    description: "Circuit breaker for external calls",
    critical: false,
    healthCheck: async () => {
      const { getAllCircuitBreakerStats } = await import("./circuitBreaker.js");
      getAllCircuitBreakerStats();
      return true;
    },
  },
  {
    name: "continuousImprover",
    description: "Continuous improvement daemon",
    critical: false,
    healthCheck: async () => {
      const { getImproverStats } = await import("./continuousImprover.js");
      getImproverStats();
      return true;
    },
  },
  // ── v7.0 modules ───────────────────────────────────────────────────────────
  {
    name: "telemetry",
    description: "Performance telemetry collector",
    critical: false,
    healthCheck: async () => {
      const { getTelemetrySnapshot } = await import("./telemetry.js");
      getTelemetrySnapshot();
      return true;
    },
  },
];

// ── State ──────────────────────────────────────────────────────────────────────

const moduleStates = new Map<string, WatchedModule>();
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckAt: number | null = null;
let nextCheckAt: number | null = null;
let totalRestarts = 0;
const startedAt = Date.now();

const INTERVAL_MS = parseInt(process.env.WATCHDOG_INTERVAL_MS ?? "60000", 10);
const ENABLED = process.env.NODE_ENV !== "test" && process.env.WATCHDOG_ENABLED !== "false";

// ── Init ───────────────────────────────────────────────────────────────────────

function initModuleStates(): void {
  for (const m of WATCHED_MODULES) {
    moduleStates.set(m.name, {
      name: m.name,
      description: m.description,
      critical: m.critical,
      health: "unknown",
      failCount: 0,
      restartCount: 0,
      lastHealthyAt: null,
      lastFailedAt: null,
      lastRecoveredAt: null,
      mttrMs: null,
    });
  }
}

// ── Health Check ───────────────────────────────────────────────────────────────

async function checkModule(spec: ModuleSpec, state: WatchedModule): Promise<ModuleHealth> {
  try {
    const ok = await spec.healthCheck();
    return ok ? "healthy" : "failed";
  } catch (err) {
    state.lastError = (err as Error).message;
    return "failed";
  }
}

async function attemptRecovery(spec: ModuleSpec, state: WatchedModule): Promise<boolean> {
  if (!spec.reinit) return false;
  try {
    log.info(`[watchdog] Attempting recovery of ${spec.name} via reinit()`);
    await spec.reinit();
    return true;
  } catch (err) {
    log.warn(`[watchdog] Recovery of ${spec.name} failed: ${(err as Error).message}`);
    state.lastError = (err as Error).message;
    return false;
  }
}

async function runHealthCheck(): Promise<void> {
  lastCheckAt = Date.now();
  let anyFailed = false;
  let anyCriticalFailed = false;

  for (const spec of WATCHED_MODULES) {
    const state = moduleStates.get(spec.name);
    if (!state) continue;

    const prevHealth = state.health;
    const health = await checkModule(spec, state);

    if (health === "healthy") {
      if (prevHealth !== "healthy" && prevHealth !== "unknown") {
        // Recovery detected — log and audit
        const failDuration = state.lastFailedAt ? Date.now() - state.lastFailedAt : null;
        state.lastRecoveredAt = Date.now();
        if (failDuration !== null) {
          state.mttrMs = state.mttrMs
            ? Math.round((state.mttrMs + failDuration) / 2)
            : failDuration;
        }
        state.failCount = 0;
        log.info(`[watchdog] ${spec.name} recovered (was ${prevHealth})`);
        audit({
          category: "system",
          action: "module_recovered",
          actor: "watchdog",
          resource: spec.name,
          success: true,
          severity: "info",
          details: { event: "module_recovered", prevHealth, mttrMs: state.mttrMs },
        });
      }
      state.health = "healthy";
      state.lastHealthyAt = Date.now();
    } else {
      state.failCount++;
      state.lastFailedAt = Date.now();
      anyFailed = true;
      if (spec.critical) anyCriticalFailed = true;

      if (state.failCount === 1) {
        state.health = "recovering";
        log.warn(`[watchdog] ${spec.name} failed (attempt ${state.failCount}) — attempting recovery`);
        const recovered = await attemptRecovery(spec, state);
        if (recovered) {
          state.health = "healthy";
          state.restartCount++;
          totalRestarts++;
          state.failCount = 0;
          anyFailed = false;
          if (spec.critical) anyCriticalFailed = false;
          log.info(`[watchdog] ${spec.name} auto-recovered`);
        } else {
          state.health = "failed";
          audit({
            category: "system",
            action: "module_failed",
            actor: "watchdog",
            resource: spec.name,
            success: false,
            severity: spec.critical ? "error" : "warn",
            details: {
              event: "module_failed",
              failCount: state.failCount,
              critical: spec.critical,
              error: state.lastError,
            },
          });
        }
      } else if (state.failCount <= 3) {
        state.health = "degraded";
      } else {
        state.health = "failed";
      }
    }

    moduleStates.set(spec.name, state);
  }

  const overallHealth = anyCriticalFailed ? "critical" : anyFailed ? "degraded" : "healthy";
  if (overallHealth !== "healthy") {
    log.warn(`[watchdog] System health: ${overallHealth}`);
  }

  scheduleNextCheck();
}

function scheduleNextCheck(): void {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  if (!ENABLED) { nextCheckAt = null; return; }
  nextCheckAt = Date.now() + INTERVAL_MS;
  watchdogTimer = setTimeout(() => runHealthCheck(), INTERVAL_MS);
}

// ── Status ─────────────────────────────────────────────────────────────────────

export function getWatchdogStatus(): WatchdogStatus {
  const modules = Array.from(moduleStates.values());
  const healthy = modules.filter(m => m.health === "healthy").length;
  const degraded = modules.filter(m => m.health === "degraded" || m.health === "recovering").length;
  const failed = modules.filter(m => m.health === "failed" || m.health === "unknown").length;
  const criticalFailed = modules.filter(m => m.critical && m.health === "failed").length;
  const overallHealth: WatchdogStatus["overallHealth"] =
    criticalFailed > 0 ? "critical" : degraded > 0 || failed > 0 ? "degraded" : "healthy";

  return {
    enabled: ENABLED,
    interval: INTERVAL_MS,
    lastCheckAt,
    nextCheckAt,
    overallHealth,
    healthyModules: healthy,
    degradedModules: degraded,
    failedModules: failed,
    totalModules: modules.length,
    totalRestarts,
    uptime: Date.now() - startedAt,
    modules,
  };
}

// ── Manual trigger ─────────────────────────────────────────────────────────────

export async function triggerHealthCheck(): Promise<WatchdogStatus> {
  await runHealthCheck();
  return getWatchdogStatus();
}

// ── Init ───────────────────────────────────────────────────────────────────────

export function initWatchdog(): void {
  initModuleStates();

  if (!ENABLED) {
    log.info("[watchdog] Watchdog disabled (test environment or WATCHDOG_ENABLED=false)");
    return;
  }

  log.info(`[watchdog] Initialized: monitoring ${moduleStates.size} modules every ${INTERVAL_MS / 1000}s`);

  // First check after 90 seconds (let all modules finish initializing)
  setTimeout(() => runHealthCheck(), 90_000);
}
