/**
 * autoRebuild.ts — v7.1.0
 *
 * Post-improvement auto-rebuild engine.
 *
 * The core gap in v7.0: Andromeda could self-improve its TypeScript source files,
 * but those changes only took effect after a manual `pnpm run build` + server restart.
 * This module closes that loop — after a batch of high-confidence proposals are applied,
 * it automatically triggers a rebuild and hot-reloads the new bundle.
 *
 * Architecture:
 *   1. RebuildQueue — collects applied proposal IDs, debounces rapid batches
 *   2. RebuildWorker — runs `node build.mjs` in a child process, captures output
 *   3. HotReload — signals the server to re-import the new dist/index.js bundle
 *   4. RebuildHistory — persists the last N rebuild results for audit/monitoring
 *
 * Safety:
 *   - Max 4 rebuilds per hour (configurable via REBUILD_MAX_PER_HOUR)
 *   - Rebuild is skipped if a rebuild is already in progress
 *   - If the build fails, the previous dist/index.js is preserved (no rollback needed)
 *   - Hot-reload only fires if the build succeeds
 *   - All rebuild events are written to the audit log
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("autoRebuild");

// ─── Config ──────────────────────────────────────────────────────────────────

export interface AutoRebuildConfig {
  enabled: boolean;
  /** Minimum number of applied proposals before triggering a rebuild */
  minAppliedToTrigger: number;
  /** Debounce delay in ms — waits this long after the last apply before rebuilding */
  debounceMs: number;
  /** Max rebuilds per hour */
  maxPerHour: number;
  /** Whether to attempt hot-reload after a successful rebuild */
  hotReload: boolean;
}

const DEFAULT_CONFIG: AutoRebuildConfig = {
  enabled: process.env.AUTO_REBUILD !== "false",
  minAppliedToTrigger: 1,
  debounceMs: 30_000, // 30 seconds — wait for any rapid batch to settle
  maxPerHour: parseInt(process.env.REBUILD_MAX_PER_HOUR ?? "12", 10), // v11.9.1: raised from 4 to 12
  hotReload: process.env.AUTO_REBUILD_HOT_RELOAD === "true",
};

let _config: AutoRebuildConfig = { ...DEFAULT_CONFIG };

export function getAutoRebuildConfig(): AutoRebuildConfig {
  return { ..._config };
}

export function setAutoRebuildConfig(patch: Partial<AutoRebuildConfig>): void {
  if (patch.minAppliedToTrigger !== undefined && (typeof patch.minAppliedToTrigger !== 'number' || patch.minAppliedToTrigger < 1 || !Number.isFinite(patch.minAppliedToTrigger))) {
    log.warn(`Invalid minAppliedToTrigger: ${patch.minAppliedToTrigger}, using existing ${_config.minAppliedToTrigger}`);
    delete patch.minAppliedToTrigger;
  }
  if (patch.debounceMs !== undefined && (typeof patch.debounceMs !== 'number' || patch.debounceMs < 1000 || !Number.isFinite(patch.debounceMs))) {
    log.warn(`Invalid debounceMs: ${patch.debounceMs}, using existing ${_config.debounceMs}`);
    delete patch.debounceMs;
  }
  if (patch.maxPerHour !== undefined && (typeof patch.maxPerHour !== 'number' || patch.maxPerHour < 1 || patch.maxPerHour > 100 || !Number.isFinite(patch.maxPerHour))) {
    log.warn(`Invalid maxPerHour: ${patch.maxPerHour}, using existing ${_config.maxPerHour}`);
    delete patch.maxPerHour;
  }
  _config = { ..._config, ...patch };
  log.info(`Config updated: ${JSON.stringify(_config)}`);
}

// ─── State ───────────────────────────────────────────────────────────────────

export interface RebuildRecord {
  id: string;
  triggeredAt: string;
  triggeredBy: string[]; // proposal IDs
  success: boolean;
  durationMs: number;
  output: string;
  error?: string;
}

const rebuildHistory: RebuildRecord[] = [];
const rebuildTimestamps: number[] = [];
let isRebuilding = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingProposalIds: Set<string> = new Set();

const HISTORY_FILE = path.join(process.cwd(), "data", "rebuild_history.json");
const MAX_HISTORY = 50;

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadHistory(): void {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")) as RebuildRecord[];
      const latest = raw.slice(-MAX_HISTORY);
      rebuildHistory.push(...latest);
      // Populate timestamps if records contain a numeric 'timestamp' field; otherwise use Date.now()
      latest.forEach((r) => {
        const ts = typeof (r as any).timestamp === "number" ? (r as any).timestamp : Date.now();
        rebuildTimestamps.push(ts);
      });
      log.info(`Loaded ${rebuildHistory.length} rebuild history entries`);
    }
  } catch (err) {
    log.caught("non-fatal", err);
  }
}

function saveHistory(): void {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const toSave = rebuildHistory.slice(-MAX_HISTORY);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(toSave, null, 2), "utf-8");
  } catch (err) {
    log.caught("non-fatal", err);
  }
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

function canRebuild(): boolean {
  const oneHourAgo = Date.now() - 3_600_000;
  // Clean old timestamps
  while (rebuildTimestamps.length > 0 && rebuildTimestamps[0] < oneHourAgo) {
    rebuildTimestamps.shift();
  }
  return rebuildTimestamps.length < _config.maxPerHour;
}

// ─── Core Rebuild ────────────────────────────────────────────────────────────

async function runRebuild(proposalIds: string[]): Promise<RebuildRecord> {
  const id = `rebuild_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startMs = Date.now();
  const cwd = process.cwd();

  log.info(`Starting rebuild ${id} — triggered by ${proposalIds.length} proposal(s): ${proposalIds.slice(0, 3).join(", ")}${proposalIds.length > 3 ? "..." : ""}`);

  let output = "";
  let error: string | undefined;
  let success = false;

  try {
    // Run `node build.mjs` — this is the server-side esbuild step
    const result = await execFileAsync("node", ["build.mjs"], {
      cwd,
      timeout: 120_000, // 2 minute timeout
      env: { ...process.env, NODE_ENV: "production" },
    });
    output = result.stdout + result.stderr;
    success = true;
    log.info(`Rebuild ${id} succeeded in ${Date.now() - startMs}ms`);
  } catch (err: unknown) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    output = (err && typeof err === 'object' && 'stdout' in err) ? (err as any).stdout : '';
    error = (err && typeof err === 'object' && 'stderr' in err) ? (err as any).stderr : errorObj.message;
    log.warn(`Rebuild ${id} failed: ${error?.slice(0, 200)}`);
  }

  const record: RebuildRecord = {
    id,
    triggeredAt: new Date().toISOString(),
    triggeredBy: proposalIds,
    success,
    durationMs: Date.now() - startMs,
    output: output.slice(0, 2000),
    error: error?.slice(0, 1000),
  };

  rebuildHistory.push(record);
  if (rebuildHistory.length > MAX_HISTORY) rebuildHistory.shift();
  rebuildTimestamps.push(Date.now());
  saveHistory();

  // Audit log
  try {
    const { auditRsiEvent } = await import("./auditLog.js");
    auditRsiEvent({
      action: success ? "proposal_applied" : "proposal_rejected",
      success,
      details: { rebuildId: id, proposalCount: proposalIds.length, durationMs: record.durationMs },
    });
  } catch { /* non-fatal */ }

  // v9.7.0: If build FAILED, trigger rollback to last healthy point.
  // The health check in selfRollback.ts only monitors server HTTP health — it cannot
  // detect a build failure because the server process is still running (on the old dist).
  // We must explicitly trigger rollback here when the build fails.
  if (!success) {
    try {
      const { rollbackToLastHealthy } = await import("./selfRollback.js");
      log.warn(`Rebuild ${id} failed — triggering rollback to last healthy point`);
      await rollbackToLastHealthy();
    } catch (rollbackErr) {
      log.warn(`Rollback after failed rebuild also failed (non-fatal): ${(rollbackErr as Error).message}`);
    }
    return record;
  }

  // Hot-reload: if enabled and build succeeded, signal the process to reload
  if (_config.hotReload) {
    try {
      await triggerHotReload();
    } catch (reloadErr) {
      log.warn(`Hot-reload failed (non-fatal): ${(reloadErr as Error).message}`);
    }
  }

  return record;
}

// ─── Hot Reload ──────────────────────────────────────────────────────────────

/**
 * Hot-reload strategy:
 * In production (dist/index.js), we can't truly hot-reload a bundled Node.js process.
 * Instead, we write a "reload signal" file that a process manager (PM2, k8s, systemd)
 * can watch and use to restart the process gracefully.
 *
 * If running under PM2, we send SIGUSR2 which triggers a graceful reload.
 * If running under systemd or k8s, the signal file approach is used.
 */
async function triggerHotReload(): Promise<void> {
  const signalFile = path.join(process.cwd(), "data", ".rebuild_signal");
  fs.writeFileSync(signalFile, new Date().toISOString(), "utf-8");
  log.info("Hot-reload signal written to data/.rebuild_signal");

  // If PM2 is managing this process, send SIGUSR2 for graceful reload
  if (process.env.PM2_HOME || process.env.pm_id !== undefined) {
    try {
      process.kill(process.pid, "SIGUSR2");
      log.info("SIGUSR2 sent to self (PM2 graceful reload triggered)");
    } catch { /* non-fatal */ }
  }
}

// ─── Debounced Trigger ───────────────────────────────────────────────────────

/**
 * Called by selfImprove.ts after each successful proposal application.
 * Debounces rapid batches so we don't rebuild after every single proposal
 * when autoApplyHighConfidence() applies multiple in quick succession.
 */
export function scheduleRebuild(proposalId: string): void {
  if (!_config.enabled) return;

  pendingProposalIds.add(proposalId);
  log.info(`Rebuild scheduled for proposal ${proposalId} (${pendingProposalIds.size} pending, debounce ${_config.debounceMs}ms)`);

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    debounceTimer = null;

    if (pendingProposalIds.size < _config.minAppliedToTrigger) {
      log.info(`Skipping rebuild — only ${pendingProposalIds.size} proposals applied (min: ${_config.minAppliedToTrigger})`);
      pendingProposalIds.clear();
      return;
    }

    if (isRebuilding) {
      log.info("Rebuild already in progress — skipping this batch");
      pendingProposalIds.clear();
      return;
    }

    if (!canRebuild()) {
      log.warn(`Rebuild rate limit reached (${_config.maxPerHour}/hour) — skipping`);
      pendingProposalIds.clear();
      return;
    }

    const ids = Array.from(pendingProposalIds);
    pendingProposalIds.clear();

    isRebuilding = true;
    try {
      await runRebuild(ids);
    } finally {
      isRebuilding = false;
    }
  }, _config.debounceMs);
}

// ─── Manual Trigger ──────────────────────────────────────────────────────────

export async function triggerRebuildNow(reason = "manual"): Promise<RebuildRecord> {
  if (isRebuilding) {
    return {
      id: "skipped",
      triggeredAt: new Date().toISOString(),
      triggeredBy: [reason],
      success: false,
      durationMs: 0,
      output: "",
      error: "Rebuild already in progress",
    };
  }

  if (!canRebuild()) {
    return {
      id: "rate-limited",
      triggeredAt: new Date().toISOString(),
      triggeredBy: [reason],
      success: false,
      durationMs: 0,
      output: "",
      error: `Rate limit: max ${_config.maxPerHour} rebuilds/hour`,
    };
  }

  isRebuilding = true;
  try {
    return await runRebuild([reason]);
  } finally {
    isRebuilding = false;
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────

export function getAutoRebuildStatus(): {
  config: AutoRebuildConfig;
  isRebuilding: boolean;
  pendingCount: number;
  recentBuilds: number;
  remainingBudget: number;
  lastBuild: RebuildRecord | null;
  history: RebuildRecord[];
} {
  const oneHourAgo = Date.now() - 3_600_000;
  const recentBuilds = rebuildTimestamps.filter(t => t >= oneHourAgo).length;
  return {
    config: _config,
    isRebuilding,
    pendingCount: pendingProposalIds.size,
    recentBuilds,
    remainingBudget: Math.max(0, _config.maxPerHour - recentBuilds),
    lastBuild: rebuildHistory.length > 0 ? rebuildHistory[rebuildHistory.length - 1] : null,
    history: rebuildHistory.slice(-10),
  };
}

// ─── Init ────────────────────────────────────────────────────────────────────

export function initAutoRebuild(): void {
  loadHistory();
  log.info(`Auto-rebuild initialized — enabled: ${_config.enabled}, debounce: ${_config.debounceMs}ms, maxPerHour: ${_config.maxPerHour}`);
}
