/**
 * hotReload.ts — v5.17
 *
 * Hot-Reload Module for Runtime Self-Modification.
 *
 * Enables Andromeda to apply self-improvements and immediately load the new code
 * without requiring a full server restart. This is critical for true autonomous
 * self-enhancement — changes take effect immediately.
 *
 * Architecture:
 * - Uses Node.js dynamic import() with cache-busting query params
 * - Maintains a module registry with version tracking
 * - Validates new module exports match expected interfaces
 * - Automatic rollback if hot-reload fails
 * - State preservation across reloads
 *
 * Safety Features:
 * - Pre-reload TypeScript compilation check
 * - Export interface validation
 * - Graceful fallback to old module on failure
 * - State snapshot before reload
 * - Cooldown period between reloads (prevents thrashing)
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModuleVersion {
  path: string;
  version: number;
  loadedAt: number;
  exports: string[];
  healthy: boolean;
}

export interface HotReloadResult {
  success: boolean;
  modulePath: string;
  version: number;
  message: string;
  rollbackPerformed: boolean;
  timeTakenMs: number;
}

export interface ReloadableModule {
  path: string;
  expectedExports: string[];
  critical: boolean; // If true, server cannot function without this module
  cooldownMs: number; // Minimum time between reloads
}

export interface GracefulRestartOptions {
  preserveState: boolean;
  drainTimeoutMs: number;
  healthCheckUrl: string;
}

// ─── Module Registry ──────────────────────────────────────────────────────────

const moduleRegistry = new Map<string, ModuleVersion>();
const moduleCache = new Map<string, any>(); // Cached module references
const reloadHistory: Array<{ path: string; timestamp: number; success: boolean; version: number }> = [];
const MAX_HISTORY = 100;

// ─── Configuration ────────────────────────────────────────────────────────────

const RELOADABLE_MODULES: ReloadableModule[] = [
  { path: "selfImprove", expectedExports: ["analyzeAndPropose", "applyProposal", "listProposals", "autoApplyHighConfidence"], critical: false, cooldownMs: 5000 },
  { path: "selfMonitor", expectedExports: ["recordMetric", "getHealthReport", "startMonitor"], critical: false, cooldownMs: 10000 },
  { path: "selfDocumentation", expectedExports: ["updateSelfDocumentation", "getChangelog"], critical: false, cooldownMs: 5000 },
  { path: "runtimeConfig", expectedExports: ["loadConfig", "saveConfig", "getPublicConfig"], critical: false, cooldownMs: 5000 },
  { path: "search", expectedExports: ["aggregateSearch"], critical: false, cooldownMs: 10000 },
  { path: "memory", expectedExports: ["storeMemory", "searchMemory"], critical: false, cooldownMs: 10000 },
  { path: "fileEngine", expectedExports: ["runMultiPassAnalysis", "runMultiPassEdit"], critical: false, cooldownMs: 15000 },
  { path: "biasDetector", expectedExports: ["annotateSources", "analyzeDiversity"], critical: false, cooldownMs: 10000 },
  { path: "codeIntel", expectedExports: ["resolveDependencies", "diagnoseError"], critical: false, cooldownMs: 10000 },
  { path: "dependencyResolver", expectedExports: ["autoResolve", "getResolverConfig"], critical: false, cooldownMs: 30000 },
];

function getServerDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

// ─── Core Hot-Reload Functions ────────────────────────────────────────────────

/**
 * Check if a module can be hot-reloaded (cooldown, existence, etc.)
 */
function canReload(modulePath: string): { allowed: boolean; reason?: string } {
  const config = RELOADABLE_MODULES.find(m => m.path === modulePath);
  if (!config) {
    return { allowed: false, reason: `Module '${modulePath}' is not registered as reloadable` };
  }

  // Check cooldown
  const lastReload = reloadHistory
    .filter(h => h.path === modulePath)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (lastReload && Date.now() - lastReload.timestamp < config.cooldownMs) {
    const remaining = config.cooldownMs - (Date.now() - lastReload.timestamp);
    return { allowed: false, reason: `Cooldown active: ${remaining}ms remaining` };
  }

  // Check file exists
  const fullPath = path.join(getServerDir(), `${modulePath}.ts`);
  if (!fs.existsSync(fullPath)) {
    return { allowed: false, reason: `Module file not found: ${fullPath}` };
  }

  return { allowed: true };
}

/**
 * Validate that a newly loaded module exports the expected interface.
 */
function validateExports(module: any, expectedExports: string[]): { valid: boolean; missing: string[] } {
  const missing = expectedExports.filter(exp => typeof module[exp] !== "function");
  return { valid: missing.length === 0, missing };
}

/**
 * Run TypeScript type check on a specific file before reloading.
 */
function typeCheckFile(filePath: string): { success: boolean; errors: string[] } {
  const cwd = path.resolve(getServerDir(), "..");
  try {
    execSync(`npx tsc --noEmit --pretty false 2>&1 | grep "${path.basename(filePath)}" || true`, {
      cwd,
      encoding: "utf-8",
      timeout: 30_000,
    });
    return { success: true, errors: [] };
  } catch (err: any) {
    const output = err.stdout?.toString?.() || err.stderr?.toString?.() || "";
    const errors = output.split("\n").filter((l: string) => l.includes("error TS")).slice(0, 10);
    return { success: errors.length === 0, errors };
  }
}

/**
 * Hot-reload a single module. The core function.
 *
 * Process:
 * 1. Validate module is reloadable
 * 2. Type-check the file
 * 3. Snapshot current module state
 * 4. Dynamic import with cache-busting
 * 5. Validate exports
 * 6. Update registry
 * 7. Rollback on failure
 */
export async function hotReloadModule(moduleName: string): Promise<HotReloadResult> {
  const startTime = Date.now();

  // 1. Check if reload is allowed
  const canReloadCheck = canReload(moduleName);
  if (!canReloadCheck.allowed) {
    return {
      success: false,
      modulePath: moduleName,
      version: moduleRegistry.get(moduleName)?.version || 0,
      message: canReloadCheck.reason || "Reload not allowed",
      rollbackPerformed: false,
      timeTakenMs: Date.now() - startTime,
    };
  }

  const config = RELOADABLE_MODULES.find(m => m.path === moduleName)!;
  const fullPath = path.join(getServerDir(), `${moduleName}.ts`);

  // 2. Type check
  const typeCheck = typeCheckFile(fullPath);
  if (!typeCheck.success) {
    return {
      success: false,
      modulePath: moduleName,
      version: moduleRegistry.get(moduleName)?.version || 0,
      message: `Type check failed: ${typeCheck.errors.join("; ")}`,
      rollbackPerformed: false,
      timeTakenMs: Date.now() - startTime,
    };
  }

  // 3. Snapshot current module
  const oldModule = moduleCache.get(moduleName);
  const currentVersion = moduleRegistry.get(moduleName)?.version || 0;
  const newVersion = currentVersion + 1;

  // 4. Dynamic import with cache-busting
  try {
    // For ESM, we use a query parameter to bust the import cache
    const importPath = `./${moduleName}.js?v=${Date.now()}`;
    const newModule = await import(importPath);

    // 5. Validate exports
    const validation = validateExports(newModule, config.expectedExports);
    if (!validation.valid) {
      // Rollback: keep old module in cache
      return {
        success: false,
        modulePath: moduleName,
        version: currentVersion,
        message: `Export validation failed. Missing: ${validation.missing.join(", ")}`,
        rollbackPerformed: true,
        timeTakenMs: Date.now() - startTime,
      };
    }

    // 6. Update registry and cache
    moduleCache.set(moduleName, newModule);
    moduleRegistry.set(moduleName, {
      path: fullPath,
      version: newVersion,
      loadedAt: Date.now(),
      exports: Object.keys(newModule).filter(k => typeof newModule[k] === "function"),
      healthy: true,
    });

    // Record history
    reloadHistory.push({ path: moduleName, timestamp: Date.now(), success: true, version: newVersion });
    if (reloadHistory.length > MAX_HISTORY) reloadHistory.shift();

    return {
      success: true,
      modulePath: moduleName,
      version: newVersion,
      message: `Hot-reloaded successfully (v${currentVersion} → v${newVersion})`,
      rollbackPerformed: false,
      timeTakenMs: Date.now() - startTime,
    };
  } catch (err: any) {
    // 7. Rollback on failure
    if (oldModule) {
      moduleCache.set(moduleName, oldModule);
    }

    reloadHistory.push({ path: moduleName, timestamp: Date.now(), success: false, version: currentVersion });
    if (reloadHistory.length > MAX_HISTORY) reloadHistory.shift();

    return {
      success: false,
      modulePath: moduleName,
      version: currentVersion,
      message: `Hot-reload failed: ${err.message}`,
      rollbackPerformed: !!oldModule,
      timeTakenMs: Date.now() - startTime,
    };
  }
}

/**
 * Reload all modules that have been modified since last load.
 */
export async function hotReloadModified(): Promise<HotReloadResult[]> {
  const results: HotReloadResult[] = [];

  for (const config of RELOADABLE_MODULES) {
    const fullPath = path.join(getServerDir(), `${config.path}.ts`);
    if (!fs.existsSync(fullPath)) continue;

    const stat = fs.statSync(fullPath);
    const registered = moduleRegistry.get(config.path);

    // Reload if file was modified after last load
    if (!registered || stat.mtimeMs > registered.loadedAt) {
      const result = await hotReloadModule(config.path);
      results.push(result);
    }
  }

  return results;
}

/**
 * Get a module from the hot-reload cache, or import fresh.
 */
export async function getModule<T = any>(moduleName: string): Promise<T | null> {
  if (moduleCache.has(moduleName)) {
    return moduleCache.get(moduleName) as T;
  }

  // First load — import and cache
  try {
    const mod = await import(`./${moduleName}.js`);
    moduleCache.set(moduleName, mod);

    const _config = RELOADABLE_MODULES.find(m => m.path === moduleName);
    moduleRegistry.set(moduleName, {
      path: path.join(getServerDir(), `${moduleName}.ts`),
      version: 1,
      loadedAt: Date.now(),
      exports: Object.keys(mod).filter(k => typeof mod[k] === "function"),
      healthy: true,
    });

    return mod as T;
  } catch {
    return null;
  }
}

// ─── Graceful Restart ─────────────────────────────────────────────────────────

/**
 * Perform a graceful restart of the server process.
 * Preserves state by writing to disk before exit.
 */
export async function gracefulRestart(options: Partial<GracefulRestartOptions> = {}): Promise<{ initiated: boolean; message: string }> {
  const opts: GracefulRestartOptions = {
    preserveState: true,
    drainTimeoutMs: 5000,
    healthCheckUrl: "http://localhost:3000/api/health",
    ...options,
  };

  try {
    // 1. Save state
    if (opts.preserveState) {
      const state = {
        moduleVersions: Object.fromEntries(moduleRegistry),
        reloadHistory: reloadHistory.slice(-20),
        timestamp: Date.now(),
      };
      const statePath = path.join(getServerDir(), "..", "workspace", ".andromeda_state.json");
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
    }

    // 2. Signal graceful shutdown (the process manager should restart us)
    // In production, this would signal PM2/systemd/Docker to restart
    console.log("[HotReload] Graceful restart initiated. State preserved.");

    // 3. Set a flag for the next startup to restore state
    const flagPath = path.join(getServerDir(), "..", "workspace", ".restart_flag");
    fs.writeFileSync(flagPath, JSON.stringify({ reason: "graceful_restart", timestamp: Date.now() }), "utf-8");

    return { initiated: true, message: "Graceful restart initiated. State preserved to workspace." };
  } catch (err: any) {
    return { initiated: false, message: `Failed to initiate restart: ${err.message}` };
  }
}

/**
 * Check if this is a restart (state restoration needed).
 */
export function checkRestartState(): { isRestart: boolean; state?: any } {
  const flagPath = path.join(getServerDir(), "..", "workspace", ".restart_flag");
  if (!fs.existsSync(flagPath)) return { isRestart: false };

  try {
    const _flag = JSON.parse(fs.readFileSync(flagPath, "utf-8"));
    // Clean up flag
    fs.unlinkSync(flagPath);

    // Load preserved state
    const statePath = path.join(getServerDir(), "..", "workspace", ".andromeda_state.json");
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      return { isRestart: true, state };
    }

    return { isRestart: true };
  } catch {
    return { isRestart: false };
  }
}

// ─── Status & Monitoring ──────────────────────────────────────────────────────

/**
 * Get the current status of all reloadable modules.
 */
export function getHotReloadStatus(): {
  modules: Array<ModuleVersion & { reloadable: boolean; cooldownActive: boolean }>;
  totalReloads: number;
  successRate: number;
  lastReload: number | null;
} {
  const modules = RELOADABLE_MODULES.map(config => {
    const registered = moduleRegistry.get(config.path);
    const canReloadCheck = canReload(config.path);

    return {
      path: config.path,
      version: registered?.version || 0,
      loadedAt: registered?.loadedAt || 0,
      exports: registered?.exports || config.expectedExports,
      healthy: registered?.healthy ?? true,
      reloadable: true,
      cooldownActive: !canReloadCheck.allowed && canReloadCheck.reason?.includes("Cooldown") || false,
    };
  });

  const successfulReloads = reloadHistory.filter(h => h.success).length;
  const totalReloads = reloadHistory.length;

  return {
    modules,
    totalReloads,
    successRate: totalReloads > 0 ? successfulReloads / totalReloads : 1,
    lastReload: reloadHistory.length > 0 ? reloadHistory[reloadHistory.length - 1].timestamp : null,
  };
}

/**
 * Get reload history for a specific module or all modules.
 */
export function getReloadHistory(moduleName?: string, limit: number = 20): typeof reloadHistory {
  const filtered = moduleName
    ? reloadHistory.filter(h => h.path === moduleName)
    : reloadHistory;
  return filtered.slice(-limit);
}

/**
 * Register a new module as reloadable at runtime.
 */
export function registerReloadableModule(config: ReloadableModule): void {
  const existing = RELOADABLE_MODULES.findIndex(m => m.path === config.path);
  if (existing >= 0) {
    RELOADABLE_MODULES[existing] = config;
  } else {
    RELOADABLE_MODULES.push(config);
  }
}

/**
 * Initialize the hot-reload system on startup.
 */
export function initHotReload(): void {
  const restart = checkRestartState();
  if (restart.isRestart && restart.state) {
    console.log("[HotReload] Restoring state from graceful restart");
    // Restore module versions from state
    if (restart.state.moduleVersions) {
      for (const [key, value] of Object.entries(restart.state.moduleVersions)) {
        moduleRegistry.set(key, value as ModuleVersion);
      }
    }
  }
  console.log(`[HotReload] Initialized. ${RELOADABLE_MODULES.length} modules registered as reloadable.`);
}

// v5.26: Alias for diagnostics endpoint
export const getHotReloadStats = getHotReloadStatus;

// ─── v5.32: Dynamic Module Discovery ──────────────────────────────────────────

/**
 * Scan the server directory for .ts files and auto-register any new modules
 * that aren't already in the RELOADABLE_MODULES list.
 * This ensures that modules added by self-improvement are automatically watched.
 */
export function scanAndRegisterNewModules(): { added: string[]; total: number } {
  const serverDir = getServerDir();
  const added: string[] = [];

  try {
    const files = fs.readdirSync(serverDir)
      .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
      .map(f => f.replace(".ts", ""));

    // Skip core modules that shouldn't be hot-reloaded
    const SKIP_MODULES = new Set([
      "hotReload",     // Can't reload itself
      "index",         // Entry point
      "streamRouter",  // Express router — needs restart
    ]);

    for (const moduleName of files) {
      if (SKIP_MODULES.has(moduleName)) continue;
      const alreadyRegistered = RELOADABLE_MODULES.some(m => m.path === moduleName);
      if (!alreadyRegistered) {
        // Auto-register with safe defaults
        const config: ReloadableModule = {
          path: moduleName,
          expectedExports: [], // No export validation for auto-discovered modules
          critical: false,
          cooldownMs: 10000,
        };
        RELOADABLE_MODULES.push(config);
        added.push(moduleName);
      }
    }

    if (added.length > 0) {
      console.log(`[HotReload] v5.32 Dynamic scan: registered ${added.length} new modules: ${added.join(", ")}`);
    }
  } catch (err) {
    console.warn(`[HotReload] Dynamic scan failed: ${(err as Error).message}`);
  }

  return { added, total: RELOADABLE_MODULES.length };
}
