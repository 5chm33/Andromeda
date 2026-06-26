/**
 * selfHealingChaos.ts — v14.0.0
 *
 * Self-Healing Chaos Engineering: closes the feedback loop between the
 * Chaos Engineer and the RSI engine. When a chaos test identifies a module
 * with low resilience, this module automatically surfaces it as a high-priority
 * hardening target for the next RSI cycle.
 *
 * The loop:
 *   1. ChaosEngineer runs fault injection tests (every 24h or on-demand)
 *   2. Modules that score below the resilience threshold are collected
 *   3. selfHealingChaos.ts converts them into RSI "hardening targets"
 *   4. On the next RSI cycle, these targets are prioritized above normal targets
 *   5. After the RSI cycle applies a fix, chaos tests are re-run on that module
 *   6. If resilience improves, the target is cleared; otherwise it escalates
 *
 * Escalation levels:
 *   - Level 1 (score < 0.8): RSI hardening target (normal priority)
 *   - Level 2 (score < 0.6): RSI hardening target (high priority) + alert
 *   - Level 3 (score < 0.4): RSI hardening target (critical) + circuit breaker forced open
 */

import { createLogger } from "./logger.js";
import fs from "fs";
import path from "path";

const log = createLogger("selfHealingChaos");

// ─── Types ────────────────────────────────────────────────────────────────────

export type EscalationLevel = 1 | 2 | 3;

export interface HardeningTarget {
  moduleName: string;
  moduleFile: string;
  resilienceScore: number;
  escalationLevel: EscalationLevel;
  priority: "normal" | "high" | "critical";
  failedFaults: string[];
  firstDetectedAt: number;
  lastUpdatedAt: number;
  rsiCyclesAttempted: number;
  resolved: boolean;
}

export interface SelfHealingStats {
  activeTargets: number;
  resolvedTargets: number;
  criticalTargets: number;
  avgResilienceScore: number;
  totalRsiCyclesTriggered: number;
  lastChaosRunAt: number | null;
}

export interface ChaosHealingEvent {
  type: "target_added" | "target_escalated" | "target_resolved" | "rsi_triggered";
  moduleName: string;
  resilienceScore: number;
  escalationLevel: EscalationLevel;
  timestamp: number;
  detail?: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const RESILIENCE_THRESHOLDS = {
  level1: 0.8,
  level2: 0.6,
  level3: 0.4,
} as const;

const MAX_RSI_ATTEMPTS_PER_TARGET = 5;

// ─── State ────────────────────────────────────────────────────────────────────

const _targets = new Map<string, HardeningTarget>();
const _events: ChaosHealingEvent[] = [];
let _lastChaosRunAt: number | null = null;
let _totalRsiCyclesTriggered = 0;
let _initialized = false;

// ─── Persistence ──────────────────────────────────────────────────────────────

function getPersistencePath(): string {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".self_healing_chaos.json");
}

function loadState(): void {
  try {
    const p = getPersistencePath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (data.targets && Array.isArray(data.targets)) {
        for (const t of data.targets) _targets.set(t.moduleName, t);
      }
      if (data.lastChaosRunAt) _lastChaosRunAt = data.lastChaosRunAt;
      if (data.totalRsiCyclesTriggered) _totalRsiCyclesTriggered = data.totalRsiCyclesTriggered;
    }
  } catch { /* non-fatal */ }
}

function saveState(): void {
  try {
    const data = {
      targets: Array.from(_targets.values()),
      lastChaosRunAt: _lastChaosRunAt,
      totalRsiCyclesTriggered: _totalRsiCyclesTriggered,
      savedAt: Date.now(),
    };
    fs.writeFileSync(getPersistencePath(), JSON.stringify(data, null, 2), "utf-8");
  } catch { /* non-fatal */ }
}

// ─── Escalation Logic ─────────────────────────────────────────────────────────

function computeEscalation(score: number): { level: EscalationLevel; priority: HardeningTarget["priority"] } {
  if (score < RESILIENCE_THRESHOLDS.level3) return { level: 3, priority: "critical" };
  if (score < RESILIENCE_THRESHOLDS.level2) return { level: 2, priority: "high" };
  return { level: 1, priority: "normal" };
}

function resolveModuleFile(moduleName: string): string {
  const candidates = [
    `server/${moduleName}.ts`,
    `server/${moduleName}Manager.ts`,
    `server/${moduleName}Engine.ts`,
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(process.cwd(), c))) return c;
  }
  return `server/${moduleName}.ts`;
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Process chaos test results and update hardening targets.
 * Called by chaosEngineer.ts after each test run.
 */
export function processChaosResults(
  results: Array<{ moduleName: string; resilienceScore: number; failedFaults: string[] }>
): void {
  _lastChaosRunAt = Date.now();

  for (const result of results) {
    const { moduleName, resilienceScore, failedFaults } = result;
    const { level, priority } = computeEscalation(resilienceScore);

    if (resilienceScore >= RESILIENCE_THRESHOLDS.level1) {
      if (_targets.has(moduleName)) {
        const existing = _targets.get(moduleName)!;
        if (!existing.resolved) {
          existing.resolved = true;
          existing.lastUpdatedAt = Date.now();
          _events.push({ type: "target_resolved", moduleName, resilienceScore, escalationLevel: existing.escalationLevel, timestamp: Date.now(), detail: `Resilience improved to ${(resilienceScore * 100).toFixed(0)}%` });
          log.info(`[selfHealingChaos] ✓ ${moduleName} resolved (score=${resilienceScore.toFixed(2)})`);
        }
      }
      continue;
    }

    const existing = _targets.get(moduleName);
    if (existing && !existing.resolved) {
      const prevLevel = existing.escalationLevel;
      existing.resilienceScore = resilienceScore;
      existing.escalationLevel = level;
      existing.priority = priority;
      existing.failedFaults = failedFaults;
      existing.lastUpdatedAt = Date.now();
      if (level > prevLevel) {
        _events.push({ type: "target_escalated", moduleName, resilienceScore, escalationLevel: level, timestamp: Date.now(), detail: `Escalated from L${prevLevel} to L${level}` });
        log.warn(`[selfHealingChaos] ↑ ${moduleName} escalated to L${level} (score=${resilienceScore.toFixed(2)})`);
      }
    } else {
      const target: HardeningTarget = {
        moduleName,
        moduleFile: resolveModuleFile(moduleName),
        resilienceScore,
        escalationLevel: level,
        priority,
        failedFaults,
        firstDetectedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        rsiCyclesAttempted: 0,
        resolved: false,
      };
      _targets.set(moduleName, target);
      _events.push({ type: "target_added", moduleName, resilienceScore, escalationLevel: level, timestamp: Date.now(), detail: `Failed faults: ${failedFaults.join(", ")}` });
      log.warn(`[selfHealingChaos] ⚠ New hardening target: ${moduleName} (L${level}, score=${resilienceScore.toFixed(2)})`);
    }
  }

  saveState();
}

/**
 * Get all active (unresolved) hardening targets, sorted by priority.
 * Called by rsiEngine.ts to prioritize which files to improve next.
 */
export function getHardeningTargets(maxTargets = 10): HardeningTarget[] {
  return Array.from(_targets.values())
    .filter(t => !t.resolved && t.rsiCyclesAttempted < MAX_RSI_ATTEMPTS_PER_TARGET)
    .sort((a, b) => {
      if (b.escalationLevel !== a.escalationLevel) return b.escalationLevel - a.escalationLevel;
      return a.resilienceScore - b.resilienceScore;
    })
    .slice(0, maxTargets);
}

/**
 * Mark that an RSI cycle has been triggered for a hardening target.
 */
export function recordRsiAttempt(moduleName: string): void {
  const target = _targets.get(moduleName);
  if (target) {
    target.rsiCyclesAttempted++;
    target.lastUpdatedAt = Date.now();
    _totalRsiCyclesTriggered++;
    _events.push({ type: "rsi_triggered", moduleName, resilienceScore: target.resilienceScore, escalationLevel: target.escalationLevel, timestamp: Date.now(), detail: `RSI attempt #${target.rsiCyclesAttempted}` });
    log.info(`[selfHealingChaos] RSI triggered for ${moduleName} (attempt #${target.rsiCyclesAttempted})`);
    saveState();
  }
}

/**
 * Mark a hardening target as resolved after a successful RSI apply.
 */
export function clearHardeningTarget(moduleName: string): void {
  const target = _targets.get(moduleName);
  if (target && !target.resolved) {
    target.resolved = true;
    target.lastUpdatedAt = Date.now();
    _events.push({ type: "target_resolved", moduleName, resilienceScore: target.resilienceScore, escalationLevel: target.escalationLevel, timestamp: Date.now(), detail: "Resolved by RSI apply" });
    log.info(`[selfHealingChaos] ✓ ${moduleName} cleared after RSI apply`);
    saveState();
  }
}

/**
 * Check if a module is currently a hardening target.
 */
export function isHardeningTarget(moduleName: string): boolean {
  const target = _targets.get(moduleName);
  return !!target && !target.resolved;
}

/**
 * Get the escalation level for a module (0 if not a target).
 */
export function getEscalationLevel(moduleName: string): 0 | EscalationLevel {
  const target = _targets.get(moduleName);
  if (!target || target.resolved) return 0;
  return target.escalationLevel;
}

/**
 * Get the recent event log for the self-healing system.
 */
export function getHealingEvents(limit = 20): ChaosHealingEvent[] {
  return _events.slice(-limit).reverse();
}

/**
 * Get overall self-healing statistics.
 */
export function getSelfHealingStats(): SelfHealingStats {
  const all = Array.from(_targets.values());
  const active = all.filter(t => !t.resolved);
  const resolved = all.filter(t => t.resolved);
  const critical = active.filter(t => t.escalationLevel === 3);
  const avgScore = active.length > 0
    ? active.reduce((s, t) => s + t.resilienceScore, 0) / active.length
    : 1.0;

  return {
    activeTargets: active.length,
    resolvedTargets: resolved.length,
    criticalTargets: critical.length,
    avgResilienceScore: avgScore,
    totalRsiCyclesTriggered: _totalRsiCyclesTriggered,
    lastChaosRunAt: _lastChaosRunAt,
  };
}

/**
 * Initialize the self-healing chaos system. Loads persisted state.
 * Called once at boot from initDaemons.ts. Idempotent.
 */
export function initSelfHealingChaos(): void {
  if (_initialized) return;
  _initialized = true;
  loadState();

  const stats = getSelfHealingStats();
  log.info(
    `[selfHealingChaos] Initialized — ${stats.activeTargets} active targets` +
    (stats.criticalTargets > 0 ? ` (${stats.criticalTargets} CRITICAL)` : "") +
    `, ${stats.resolvedTargets} resolved`
  );

  if (stats.criticalTargets > 0) {
    const criticals = Array.from(_targets.values()).filter(t => !t.resolved && t.escalationLevel === 3);
    for (const c of criticals) {
      log.warn(`[selfHealingChaos] CRITICAL: ${c.moduleName} (score=${c.resilienceScore.toFixed(2)}, faults: ${c.failedFaults.join(", ")})`);
    }
  }
}

/**
 * Run a targeted chaos re-test on a specific module after an RSI fix.
 * Returns true if the module now passes all chaos tests.
 */
export async function retestModule(moduleName: string): Promise<boolean> {
  try {
    const { runChaosTests, getLowResilienceModules } = await import("./chaosEngineer.js");
    await runChaosTests({ scenarioIds: undefined }); // run all scenarios

    const lowResilience = getLowResilienceModules(RESILIENCE_THRESHOLDS.level1);
    const stillFailing = lowResilience.some(m => m.moduleName === moduleName);

    if (!stillFailing) {
      clearHardeningTarget(moduleName);
      log.info(`[selfHealingChaos] ✓ ${moduleName} passed retest — target cleared`);
      return true;
    } else {
      log.warn(`[selfHealingChaos] ✗ ${moduleName} still failing after RSI fix`);
      return false;
    }
  } catch (err) {
    log.warn(`[selfHealingChaos] Retest failed for ${moduleName}: ${err}`);
    return false;
  }
}


// For testing
export function _resetStateForTesting(): void {
  _targets.clear();
  _events.length = 0;
  _totalRsiCyclesTriggered = 0;
  _lastChaosRunAt = 0;
  _initialized = false;
  try {
    const fs = require("fs");
    const p = getPersistencePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}
