/**
 * selfRollback.ts — v5.22
 *
 * Automated Rollback System for Self-Enhancement Safety.
 *
 * Provides file-level versioning and instant rollback capability:
 * - Creates rollback points before any self-modification
 * - Stores full file content snapshots (not diffs)
 * - Supports instant rollback to any previous point
 * - Auto-rollback triggered by health check failures
 * - Maintains a rolling history with configurable retention
 *
 * This works independently of git — it's a lightweight, in-process
 * versioning system designed for speed and reliability.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createLogger } from "./logger.js";
const log = createLogger("rollback");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RollbackPoint {
  id: string;
  description: string;
  timestamp: number;
  author: string;
  files: FileVersion[];
  metadata: Record<string, any>;
}

export interface FileVersion {
  path: string;           // Absolute path
  relativePath: string;   // Relative to project root
  content: string;        // Full file content at this point
  size: number;
  hash: string;           // Simple content hash for comparison
}

export interface RollbackConfig {
  enabled: boolean;
  maxRollbackPoints: number;      // Max history to keep (default: 50)
  selfRollbackOnHealthFail: boolean;  // Auto-rollback if health degrades
  healthCheckUrl: string;
  healthCheckInterval: number;    // ms between health checks after changes
  retentionDays: number;          // Delete rollback points older than this
  storageDir: string;             // Where to persist rollback data
}

export interface RollbackResult {
  success: boolean;
  pointId: string;
  filesRestored: number;
  message: string;
  duration: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = process.cwd();

const DEFAULT_CONFIG: RollbackConfig = {
  enabled: true,

  maxRollbackPoints: 50,
  // v12.2.3: Disable automatic rollback on health-check failure.
  // The health check was triggering false-positive rollbacks when the server
  // was busy under RSI load (CI pipeline takes 20-30s, health check timed out).
  // Rollbacks are still available manually via the API but will NOT fire automatically.
  selfRollbackOnHealthFail: false,
  healthCheckUrl: `http://localhost:${process.env.PORT ?? 3000}/api/health`,
  healthCheckInterval: 90_000,
  retentionDays: 7,
  storageDir: path.resolve(PROJECT_DIR, "workspace", ".rollback_history"),
};

let config: RollbackConfig = { ...DEFAULT_CONFIG };
let rollbackPoints: RollbackPoint[] = [];
let healthWatchTimer: ReturnType<typeof setInterval> | null = null;
let lastHealthyPointId: string | null = null;

// v5.48: Deduplication guard — tracks which proposal IDs already have a rollback point
// to prevent infinite rollback point creation when a proposal keeps failing.
const rollbackPointsByProposal = new Map<string, string>(); // proposalId → rollbackPointId

// ─── Utility ──────────────────────────────────────────────────────────────────

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

function generatePointId(): string {
  return `rp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Create a rollback point capturing the current state of specified files.
 */
export function createRollbackPoint(
  filePaths: string[],
  description: string,
  author: string = "system",
  metadata: Record<string, any> = {}
): RollbackPoint {
  // v5.48: Deduplication — if this description references a proposal that already has a rollback point, skip creating another
  const proposalMatch = description.match(/Before proposal (\S+)/);
  if (proposalMatch) {
    const proposalId = proposalMatch[1];
    if (rollbackPointsByProposal.has(proposalId)) {
      const existingId = rollbackPointsByProposal.get(proposalId)!;
      const existing = rollbackPoints.find(p => p.id === existingId);
      if (existing) {
        log.info(`Reusing existing point ${existingId} for proposal ${proposalId} (dedup)`);
        return existing;
      }
    }
  }

  const files: FileVersion[] = [];

  for (const filePath of filePaths) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_DIR, filePath);
    
    if (!fs.existsSync(absolutePath)) continue;

    const content = fs.readFileSync(absolutePath, "utf-8");
    files.push({
      path: absolutePath,
      relativePath: path.relative(PROJECT_DIR, absolutePath),
      content,
      size: content.length,
      hash: simpleHash(content),
    });
  }

  const point: RollbackPoint = {
    id: generatePointId(),
    description,
    timestamp: Date.now(),
    author,
    files,
    metadata,
  };

  rollbackPoints.push(point);

  // v5.48: Register this point for the proposal (dedup)
  if (proposalMatch) {
    rollbackPointsByProposal.set(proposalMatch[1], point.id);
  }

  // Enforce max history
  while (rollbackPoints.length > config.maxRollbackPoints) {
    const removed = rollbackPoints.shift();
    if (removed) {
      // Clean up dedup map for removed points
      for (const [pid, rpid] of Array.from(rollbackPointsByProposal.entries())) {
        if (rpid === removed.id) rollbackPointsByProposal.delete(pid);
      }
    }
  }

  // Persist to disk
  persistPoint(point);

  log.info(`Created point ${point.id}: "${description}" (${files.length} files)`);
  return point;
}

/**
 * Rollback to a specific point, restoring all files to their captured state.
 */
export async function rollbackTo(pointId: string): Promise<RollbackResult> {
  const startTime = Date.now();
  const point = rollbackPoints.find(p => p.id === pointId);

  if (!point) {
    return {
      success: false,
      pointId,
      filesRestored: 0,
      message: `Rollback point ${pointId} not found`,
      duration: Date.now() - startTime,
    };
  }

  let restored = 0;
  const errors: string[] = [];

  for (const file of point.files) {
    try {
      // Ensure directory exists
      fs.mkdirSync(path.dirname(file.path), { recursive: true });
      fs.writeFileSync(file.path, file.content);
      restored++;
    } catch (err: any) {
      errors.push(`Failed to restore ${file.relativePath}: ${err.message}`);
    }
  }

  const success = errors.length === 0;
  const message = success
    ? `Rolled back to "${point.description}" — ${restored} files restored`
    : `Partial rollback: ${restored}/${point.files.length} files restored. Errors: ${errors.join("; ")}`;

  log.info(`${message}`);

  // v5.27: Document rollback in changelog
  try {
    const { documentSystemEvent } = await import("./selfDocumentation");
    documentSystemEvent(
      `ROLLBACK: ${point.description} (${restored} files restored, point: ${pointId})`,
      "5.27.0"
    );
  } catch { /* selfDocumentation not available */ }

  // v5.27: Record in recursion guard
  try {
    const { recordModification } = await import("./recursionGuard");
    for (const file of point.files) {
      recordModification(file.relativePath, "rollback", success);
    }
  } catch { /* non-fatal */ }

  return {
    success,
    pointId,
    filesRestored: restored,
    message,
    duration: Date.now() - startTime,
  };
}

/**
 * Rollback to the most recent point.
 */
export async function rollbackToLatest(): Promise<RollbackResult> {
  if (rollbackPoints.length === 0) {
    return {
      success: false,
      pointId: "",
      filesRestored: 0,
      message: "No rollback points available",
      duration: 0,
    };
  }

  const latest = rollbackPoints[rollbackPoints.length - 1];
  return rollbackTo(latest.id);
}

/**
 * Rollback to the last known healthy state.
 */
export async function rollbackToLastHealthy(): Promise<RollbackResult> {
  if (!lastHealthyPointId) {
    return rollbackToLatest();
  }
  return rollbackTo(lastHealthyPointId);
}

// ─── Health Monitoring ────────────────────────────────────────────────────────

/**
 * Start monitoring health after a change is applied.
 * If health degrades, auto-rollback to the last healthy point.
 */
export function startHealthWatch(pointId: string): void {
  if (!config.selfRollbackOnHealthFail) return;
  if (healthWatchTimer) clearInterval(healthWatchTimer);

  let checksCompleted = 0;
  const maxChecks = 6; // Monitor for 60s (6 checks × 10s interval)

  healthWatchTimer = setInterval(async () => {
    checksCompleted++;

    try {
      const controller = new AbortController();
      // v11.291.1: 15s timeout (was 5s) — server may be busy during CI pipeline
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const resp = await fetch(config.healthCheckUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (resp.ok) {
        // Health is good — update last healthy point
        lastHealthyPointId = pointId;

        if (checksCompleted >= maxChecks) {
          // All checks passed — stop monitoring
          stopHealthWatch();
          log.info(`Health stable after change. Monitoring complete.`);
        }
      } else {
        // Health degraded — auto-rollback!
        log.error(`Health check FAILED (status ${resp.status}). Auto-rolling back!`);
        stopHealthWatch();
        rollbackToLastHealthy();
      }
    } catch (err: any) {
      // Health check failed — auto-rollback!
      log.error(`Health check ERROR: ${err.message}. Auto-rolling back!`);
      stopHealthWatch();
      rollbackToLastHealthy();
    }
  }, config.healthCheckInterval);
}

/**
 * Stop health monitoring.
 */
export function stopHealthWatch(): void {
  if (healthWatchTimer) {
    clearInterval(healthWatchTimer);
    healthWatchTimer = null;
  }
}

// ─── v5.33: Runtime Degradation Rollback ───────────────────────────────────

interface DegradationSnapshot {
  timestamp: number;
  memoryMb: number;
  eventLoopLagMs: number;
  errorCount: number;
}

const degradationHistory: DegradationSnapshot[] = [];
const MAX_DEGRADATION_HISTORY = 20;
let degradationWatchTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start continuous degradation monitoring.
 * If metrics degrade significantly after a self-modification,
 * automatically roll back to the last healthy state.
 */
export function startDegradationWatch(): void {
  if (degradationWatchTimer) return;

  // Take baseline snapshot
  degradationHistory.length = 0;
  takeSnapshot();

  degradationWatchTimer = setInterval(async () => {
    takeSnapshot();

    if (degradationHistory.length < 3) return;

    const baseline = degradationHistory[0];
    const recent = degradationHistory[degradationHistory.length - 1];

    // Check for significant degradation
    const memoryIncrease = recent.memoryMb / (baseline.memoryMb || 1);
    const lagIncrease = recent.eventLoopLagMs / (baseline.eventLoopLagMs || 1);

    // v9.8.5: Raised thresholds — LLM calls and proposal analysis naturally use 2-3x baseline
    // memory during a cycle. Only trigger on extreme degradation (5x memory or 10x event loop lag).
    // Also require at least 5 samples before triggering to avoid false positives on startup.
    if (degradationHistory.length >= 5 && (memoryIncrease > 5.0 || lagIncrease > 10.0)) {
      log.error(`Runtime degradation detected! Memory: ${memoryIncrease.toFixed(1)}x, Lag: ${lagIncrease.toFixed(1)}x`);
      stopDegradationWatch();

      // Auto-rollback if we have a healthy point
      if (lastHealthyPointId) {
        log.error(`Auto-rolling back to last healthy point: ${lastHealthyPointId}`);
        await rollbackToLastHealthy();
      }
    } else if (memoryIncrease > 2.0 || lagIncrease > 5.0) {
      // Log warning but don't kill the server
      log.warn(`Memory elevated (${memoryIncrease.toFixed(1)}x) — monitoring, not rolling back`);
    }
  }, 15_000); // Check every 15 seconds
}

function takeSnapshot(): void {
  const mem = process.memoryUsage();
  degradationHistory.push({
    timestamp: Date.now(),
    memoryMb: Math.round(mem.heapUsed / 1024 / 1024),
    eventLoopLagMs: 0, // Updated asynchronously
    errorCount: 0,
  });
  if (degradationHistory.length > MAX_DEGRADATION_HISTORY) degradationHistory.shift();
}

export function stopDegradationWatch(): void {
  if (degradationWatchTimer) {
    clearInterval(degradationWatchTimer);
    degradationWatchTimer = null;
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function persistPoint(point: RollbackPoint): void {
  try {
    fs.mkdirSync(config.storageDir, { recursive: true });
    const filePath = path.join(config.storageDir, `${point.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(point, null, 2));
  } catch (err: any) {
    log.warn(`Failed to persist point: ${err.message}`);
  }
}

function loadPersistedPoints(): void {
  try {
    if (!fs.existsSync(config.storageDir)) return;

    const files = fs.readdirSync(config.storageDir)
      .filter(f => f.endsWith(".json"))
      .sort();

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(config.storageDir, file), "utf-8");
        const point = JSON.parse(content) as RollbackPoint;

        // Check retention
        const ageDays = (Date.now() - point.timestamp) / (24 * 60 * 60 * 1000);
        if (ageDays > config.retentionDays) {
          fs.unlinkSync(path.join(config.storageDir, file));
          continue;
        }

        rollbackPoints.push(point);
      } catch { /* skip corrupt files */ }
    }

    // Enforce max
    while (rollbackPoints.length > config.maxRollbackPoints) {
      const removed = rollbackPoints.shift();
      if (removed) {
        try { fs.unlinkSync(path.join(config.storageDir, `${removed.id}.json`)); } catch { /* OK */ }
      }
    }

    log.info(`Loaded ${rollbackPoints.length} persisted rollback points`);
  } catch (err: any) {
    log.warn(`Failed to load persisted points: ${err.message}`);
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Clean up old rollback points beyond retention period.
 */
export function cleanupOldPoints(): { removed: number } {
  const cutoff = Date.now() - (config.retentionDays * 24 * 60 * 60 * 1000);
  const before = rollbackPoints.length;

  rollbackPoints = rollbackPoints.filter(p => {
    if (p.timestamp < cutoff) {
      try { fs.unlinkSync(path.join(config.storageDir, `${p.id}.json`)); } catch { /* OK */ }
      return false;
    }
    return true;
  });

  return { removed: before - rollbackPoints.length };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get rollback system status.
 */
export function getRollbackStatus(): {
  enabled: boolean;
  pointCount: number;
  lastHealthyPointId: string | null;
  monitoring: boolean;
  recentPoints: Array<{ id: string; description: string; timestamp: number; fileCount: number }>;
} {
  return {
    enabled: config.enabled,
    pointCount: rollbackPoints.length,
    lastHealthyPointId,
    monitoring: healthWatchTimer !== null,
    recentPoints: rollbackPoints.slice(-10).map(p => ({
      id: p.id,
      description: p.description,
      timestamp: p.timestamp,
      fileCount: p.files.length,
    })),
  };
}

/**
 * Compare current file state with a rollback point.
 */
export function diffWithPoint(pointId: string): Array<{ path: string; changed: boolean; currentHash: string; pointHash: string }> {
  const point = rollbackPoints.find(p => p.id === pointId);
  if (!point) return [];

  return point.files.map(file => {
    const currentContent = fs.existsSync(file.path) ? fs.readFileSync(file.path, "utf-8") : "";
    const currentHash = simpleHash(currentContent);
    return {
      path: file.relativePath,
      changed: currentHash !== file.hash,
      currentHash,
      pointHash: file.hash,
    };
  });
}

/**
 * Update rollback configuration.
 */
export function setRollbackConfig(updates: Partial<RollbackConfig>): RollbackConfig {
  config = { ...config, ...updates };
  return config;
}

/**
 * Initialize the rollback system on startup.
 */
export function initRollback(): void {
  loadPersistedPoints();
  log.info(`Initialized. ${rollbackPoints.length} points loaded. Enabled: ${config.enabled}`);
}


// ─── Legacy selfRollback.ts Aliases (v15.0.0 cleanup) ────────────────────────
export function createSnapshot(files: string[], reason: string): string {
  const pt = createRollbackPoint(files, reason, "system");
  return pt.id;
}

export function restoreSnapshot(snapshotId: string): boolean {
  // Fire-and-forget async wrapper to match sync signature
  rollbackTo(snapshotId).catch(() => {});
  return true;
}
