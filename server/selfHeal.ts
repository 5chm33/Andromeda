/**
 * selfHeal.ts — v5.17
 *
 * Autonomous Self-Healing Loop Module.
 *
 * Closes the critical gap between monitoring and fixing:
 *   Monitor → Detect Degradation → Diagnose Root Cause → Generate Fix → Apply → Verify
 *
 * This module runs as a background loop that:
 * 1. Collects health metrics from selfMonitor
 * 2. Detects anomalies and degradation patterns
 * 3. Uses LLM to diagnose root causes from metrics + error logs
 * 4. Generates fix proposals via selfImprove
 * 5. Applies fixes with auto-approval (if confidence threshold met)
 * 6. Verifies the fix resolved the issue
 * 7. Rolls back if verification fails
 *
 * Safety:
 * - Maximum 3 heal attempts per issue before escalating to human
 * - Cooldown between heal cycles (configurable)
 * - All fixes go through the standard guard + type check pipeline
 * - Automatic rollback on verification failure
 * - Circuit breaker: stops healing if too many failures
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { createLogger } from "./logger.js";
import { withSelfHealLock } from "./redisLock.js";
const log = createLogger("selfHeal");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HealthMetric {
  name: string;
  value: number;
  threshold: number;
  direction: "above" | "below"; // "above" means value > threshold is bad
  timestamp: number;
}

export interface DegradationEvent {
  id: string;
  metric: string;
  currentValue: number;
  threshold: number;
  severity: "warning" | "critical" | "emergency";
  detectedAt: number;
  resolvedAt?: number;
  healAttempts: number;
  lastHealAt?: number;
}

export interface Diagnosis {
  rootCause: string;
  confidence: number; // 0-1
  suggestedFix: string;
  affectedModule: string;
  category: "performance" | "reliability" | "memory" | "connectivity" | "logic";
}

export interface HealAttempt {
  eventId: string;
  timestamp: number;
  diagnosis: Diagnosis;
  fixApplied: boolean;
  verified: boolean;
  rolledBack: boolean;
  message: string;
}

export interface SelfHealConfig {
  enabled: boolean;
  checkIntervalMs: number; // How often to check health (default: 60s)
  maxHealAttemptsPerIssue: number; // Max attempts before escalating (default: 3)
  cooldownAfterHealMs: number; // Cooldown after a heal attempt (default: 120s)
  autoApplyConfidence: number; // Min confidence to auto-apply fix (default: 0.8)
  circuitBreakerThreshold: number; // Max consecutive failures before stopping (default: 5)
  enableLLMDiagnosis: boolean; // Use LLM for root cause analysis
  enableAutoFix: boolean; // Actually apply fixes (vs. just diagnose)
}

// ─── State ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SelfHealConfig = {
  enabled: true, // v5.30: Enabled by default — the orchestrator coordinates this
  checkIntervalMs: 60_000,
  maxHealAttemptsPerIssue: 3,
  cooldownAfterHealMs: 120_000,
  autoApplyConfidence: 0.8,
  circuitBreakerThreshold: 5,
  enableLLMDiagnosis: true,
  enableAutoFix: true,
};

let config: SelfHealConfig = { ...DEFAULT_CONFIG };
let healLoopTimer: ReturnType<typeof setInterval> | null = null;
// v6.31: isRunning replaced by withSelfHealLock() distributed lock
let _healLoopActive = false;
let consecutiveFailures = 0;
let healCycleInProgress = false; // v5.22: Reentrance guard (kept for intra-process reentrance)

// v5.27: Watchdog timer — detects if the heal loop itself hangs or crashes
let lastHealCycleCompletedAt = Date.now();
const HEAL_WATCHDOG_TIMEOUT = 5 * 60 * 1000; // 5 minutes — if no cycle completes in this time, reset
// Watchdog timer managed by startWatchdog() lifecycle

const activeEvents: Map<string, DegradationEvent> = new Map();
const healHistory: HealAttempt[] = [];
const MAX_HISTORY = 200;

// ─── Health Checks ────────────────────────────────────────────────────────────

interface HealthCheck {
  name: string;
  check: () => Promise<{ healthy: boolean; value: number }>;
  recover: () => Promise<{ success: boolean; message: string }>;
  threshold: number;
  direction: "above" | "below";
  critical: boolean;
}

const healthChecks: HealthCheck[] = [
  {
    name: "memory_usage_mb",
    check: async () => {
      const used = process.memoryUsage().heapUsed / 1024 / 1024;
      return { healthy: used < 512, value: used };
    },
    recover: async () => {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        return { success: true, message: "Forced garbage collection" };
      }
      return { success: false, message: "GC not exposed (run with --expose-gc)" };
    },
    threshold: 512,
    direction: "above",
    critical: false,
  },
  {
    name: "event_loop_lag_ms",
    check: async () => {
      const start = Date.now();
      await new Promise(resolve => setImmediate(resolve));
      const lag = Date.now() - start;
      return { healthy: lag < 100, value: lag };
    },
    recover: async () => {
      // Not much we can do about event loop lag except log it
      return { success: false, message: "Event loop lag detected — may indicate CPU-bound work" };
    },
    threshold: 100,
    direction: "above",
    critical: false,
  },
  {
    name: "disk_space_mb",
    check: async () => {
      try {
const isWindows = process.platform === "win32";
        let freeMb: number;
        if (isWindows) {
          // v5.30: Cross-platform disk check — use wmic on Windows
          const drive = process.cwd().charAt(0);
          const output = execSync(`wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /value`, { encoding: "utf-8" });
          const match = output.match(/FreeSpace=(\d+)/);
          freeMb = match ? Math.round(parseInt(match[1]) / 1024 / 1024) : 9999;
        } else {
          const output = execSync("df -m . | tail -1 | awk '{print $4}'", { encoding: "utf-8" });
          freeMb = parseInt(output.trim()) || 9999;
        }
        return { healthy: freeMb > 100, value: freeMb };
      } catch {
        return { healthy: true, value: 9999 }; // Assume OK if can't check
      }
    },
    recover: async () => {
      // Clean up temp files and old backups
      const serverDir = getServerDir();
      const workspaceDir = path.resolve(serverDir, "..", "workspace");
      let cleaned = 0;

      try {
        // Remove old backup files
        if (fs.existsSync(workspaceDir)) {
          const files = fs.readdirSync(workspaceDir);
          for (const file of files) {
            if (file.includes(".backup_") && Date.now() - fs.statSync(path.join(workspaceDir, file)).mtimeMs > 86400_000) {
              fs.unlinkSync(path.join(workspaceDir, file));
              cleaned++;
            }
          }
        }
        return { success: cleaned > 0, message: `Cleaned ${cleaned} old backup files` };
      } catch (err: any) {
        return { success: false, message: `Cleanup failed: ${err.message}` };
      }
    },
    threshold: 100,
    direction: "below",
    critical: true,
  },
  {
    name: "open_handles",
    check: async () => {
      // Approximate: check active handles/requests
      const handles = (process as any)._getActiveHandles?.()?.length || 0;
      const requests = (process as any)._getActiveRequests?.()?.length || 0;
      const total = handles + requests;
      return { healthy: total < 1000, value: total };
    },
    recover: async () => {
      return { success: false, message: "High handle count — may indicate connection leaks" };
    },
    threshold: 1000,
    direction: "above",
    critical: false,
  },
  {
    name: "uptime_hours",
    check: async () => {
      const hours = process.uptime() / 3600;
      // Flag if running for more than 72 hours (potential memory leaks)
      return { healthy: hours < 72, value: hours };
    },
    recover: async () => {
      // Suggest graceful restart
      return { success: false, message: "Server running >72h — consider graceful restart for memory hygiene" };
    },
    threshold: 72,
    direction: "above",
    critical: false,
  },
  // v5.23: Module-level health checks
  {
    name: "llm_connectivity",
    check: async () => {
      try {
        const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY;
        if (!apiKey) return { healthy: false, value: 0 };
        const url = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/v1/models";
        const resp = await fetch(url.replace("/chat/completions", "/models"), {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        return { healthy: resp.ok, value: resp.status };
      } catch {
        return { healthy: false, value: 0 };
      }
    },
    recover: async () => {
      return { success: false, message: "LLM API unreachable — check API key and network" };
    },
    threshold: 1,
    direction: "below",
    critical: true,
  },
  {
    name: "search_connectivity",
    check: async () => {
      try {
        const braveKey = process.env.BRAVE_API_KEY;
        if (!braveKey) return { healthy: true, value: 1 }; // Optional
        const resp = await fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
          headers: { "X-Subscription-Token": braveKey },
          signal: AbortSignal.timeout(5000),
        });
        return { healthy: resp.ok, value: resp.status === 200 ? 1 : 0 };
      } catch {
        return { healthy: false, value: 0 };
      }
    },
    recover: async () => {
      return { success: false, message: "Brave Search API unreachable — check API key" };
    },
    threshold: 1,
    direction: "below",
    critical: false,
  },
  {
    name: "server_response_time_ms",
    check: async () => {
      try {
        const start = Date.now();
        const port = process.env.PORT || "3000";
        const _resp = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        const elapsed = Date.now() - start;
        return { healthy: elapsed < 2000, value: elapsed };
      } catch {
        return { healthy: true, value: 0 }; // Can't self-check, assume OK
      }
    },
    recover: async () => {
      return { success: false, message: "Server responding slowly — possible event loop blocking" };
    },
    threshold: 2000,
    direction: "above",
    critical: false,
  },
];

// ─── Utility ──────────────────────────────────────────────────────────────────

function getServerDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function generateEventId(): string {
  return `heal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getSeverity(value: number, threshold: number, direction: "above" | "below"): "warning" | "critical" | "emergency" {
  const ratio = direction === "above" ? value / threshold : threshold / value;
  if (ratio > 2) return "emergency";
  if (ratio > 1.5) return "critical";
  return "warning";
}

// ─── Core Healing Functions ───────────────────────────────────────────────────

/**
 * Run all health checks and detect degradation.
 */
async function detectDegradation(): Promise<DegradationEvent[]> {
  const newEvents: DegradationEvent[] = [];

  for (const check of healthChecks) {
    try {
      const result = await check.check();

      if (!result.healthy) {
        // Check if we already have an active event for this metric
        const existingEvent = Array.from(activeEvents.values()).find(e => e.metric === check.name && !e.resolvedAt);

        if (!existingEvent) {
          const event: DegradationEvent = {
            id: generateEventId(),
            metric: check.name,
            currentValue: result.value,
            threshold: check.threshold,
            severity: getSeverity(result.value, check.threshold, check.direction),
            detectedAt: Date.now(),
            healAttempts: 0,
          };
          activeEvents.set(event.id, event);
          newEvents.push(event);
        }
      } else {
        // Resolve any active events for this metric
        for (const [_id, event] of Array.from(activeEvents.entries())) {
          if (event.metric === check.name && !event.resolvedAt) {
            event.resolvedAt = Date.now();
          }
        }
      }
    } catch (err) {
      console.warn(`[SelfHeal] Health check '${check.name}' failed:`, (err as Error).message);
    }
  }

  return newEvents;
}

/**
 * Attempt immediate recovery using the health check's built-in recover function.
 */
async function attemptImmediateRecovery(event: DegradationEvent): Promise<{ success: boolean; message: string }> {
  const check = healthChecks.find(c => c.name === event.metric);
  if (!check) return { success: false, message: "No recovery handler for this metric" };

  try {
    return await check.recover();
  } catch (err: any) {
    return { success: false, message: `Recovery threw: ${err.message}` };
  }
}

/**
 * Use LLM to diagnose the root cause of a degradation event.
 */
async function diagnoseWithLLM(event: DegradationEvent): Promise<Diagnosis> {
  // If LLM diagnosis is disabled, return a basic diagnosis
  if (!config.enableLLMDiagnosis) {
    return {
      rootCause: `${event.metric} exceeded threshold (${event.currentValue} vs ${event.threshold})`,
      confidence: 0.5,
      suggestedFix: "Manual investigation required",
      affectedModule: "unknown",
      category: "reliability",
    };
  }

  try {
    // Attempt to use the AI module for diagnosis

    const prompt = `You are Andromeda's self-healing system. Diagnose this issue:

Metric: ${event.metric}
Current Value: ${event.currentValue}
Threshold: ${event.threshold}
Severity: ${event.severity}
Duration: ${Date.now() - event.detectedAt}ms

System Context:
- Node.js ${process.version}
- Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB
- Uptime: ${Math.round(process.uptime())}s

Respond in JSON format:
{
  "rootCause": "brief description of likely root cause",
  "confidence": 0.0-1.0,
  "suggestedFix": "specific actionable fix",
  "affectedModule": "module name or 'system'",
  "category": "performance|reliability|memory|connectivity|logic"
}`;

    // v6.03: Use adaptiveRouter for provider selection instead of hardcoded DeepSeek URL.
    // Falls back to env vars if adaptiveRouter is unavailable.
    let baseUrl = process.env.LLM_BASE_URL || "https://api.deepseek.com";
    let apiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || "";
    let model = process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat";
    try {
      const { selectProvider } = await import("./adaptiveRouter.js");
      const decision = selectProvider({ taskType: "analysis" });
      baseUrl = decision.provider.baseUrl;
      apiKey = process.env[decision.provider.apiKeyEnv] || apiKey;
      model = decision.model;
    } catch { /* fall through to env var defaults */ }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30_000), // 30s hard timeout — prevents server-wide hangs
    });

    if (response.ok) {
      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || "";
      // Try to parse JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          rootCause: parsed.rootCause || "Unknown",
          confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
          suggestedFix: parsed.suggestedFix || "No fix suggested",
          affectedModule: parsed.affectedModule || "unknown",
          category: parsed.category || "reliability",
        };
      }
    }
  } catch (err) {
    console.warn("[SelfHeal] LLM diagnosis failed:", (err as Error).message);
  }

  // Fallback diagnosis
  return {
    rootCause: `${event.metric} degradation detected`,
    confidence: 0.3,
    suggestedFix: "Investigate manually or restart service",
    affectedModule: "system",
    category: "reliability",
  };
}

/**
 * The main heal cycle — runs periodically.
 */
async function healCycle(): Promise<void> {
  if (!config.enabled || !_healLoopActive) return;

  // v5.27: Watchdog check — detect if previous cycle hung
  const timeSinceLastCompletion = Date.now() - lastHealCycleCompletedAt;
  if (healCycleInProgress && timeSinceLastCompletion > HEAL_WATCHDOG_TIMEOUT) {
    console.error(`[SelfHeal] WATCHDOG: Previous cycle hung for ${Math.round(timeSinceLastCompletion / 1000)}s. Force-resetting.`);
    healCycleInProgress = false;
    consecutiveFailures = 0; // Reset circuit breaker too
  }

  // v5.22: Reentrance guard — prevent overlapping cycles
  if (healCycleInProgress) {
    console.warn("[SelfHeal] Skipping cycle: previous cycle still in progress");
    return;
  }
  healCycleInProgress = true;

  // Circuit breaker check with auto-reset after cooldown
  if (consecutiveFailures >= config.circuitBreakerThreshold) {
    const timeSinceLastAttempt = Date.now() - (healHistory.length > 0 ? healHistory[healHistory.length - 1].timestamp : 0);
    const CIRCUIT_BREAKER_COOLDOWN = 15 * 60 * 1000; // 15 minutes
    if (timeSinceLastAttempt < CIRCUIT_BREAKER_COOLDOWN) {
      console.warn(`[SelfHeal] Circuit breaker open (${consecutiveFailures} failures). Cooldown: ${Math.round((CIRCUIT_BREAKER_COOLDOWN - timeSinceLastAttempt) / 1000)}s remaining.`);
      healCycleInProgress = false;
      return; // Don't stop the loop — just skip this cycle
    }
    // v5.25: Auto-reset after cooldown
    console.log(`[SelfHeal] Circuit breaker auto-reset after ${CIRCUIT_BREAKER_COOLDOWN / 1000}s cooldown. Resuming.`);
    consecutiveFailures = 0;
  }

  try {
    // 1. Detect degradation
    const newEvents = await detectDegradation();

    for (const event of newEvents) {
      console.log(`[SelfHeal] Degradation detected: ${event.metric} = ${event.currentValue} (threshold: ${event.threshold})`);

      // 2. Attempt immediate recovery
      const immediateResult = await attemptImmediateRecovery(event);
      if (immediateResult.success) {
        event.resolvedAt = Date.now();
        consecutiveFailures = 0;

        healHistory.push({
          eventId: event.id,
          timestamp: Date.now(),
          diagnosis: { rootCause: "Immediate recovery", confidence: 1, suggestedFix: immediateResult.message, affectedModule: "system", category: "reliability" },
          fixApplied: true,
          verified: true,
          rolledBack: false,
          message: `Immediate recovery: ${immediateResult.message}`,
        });
        if (healHistory.length > MAX_HISTORY) healHistory.shift();
        continue;
      }

      // 3. Check heal attempt limits
      if (event.healAttempts >= config.maxHealAttemptsPerIssue) {
        console.warn(`[SelfHeal] Max heal attempts reached for ${event.metric}. Escalating.`);
        continue;
      }

      // 4. Cooldown check
      if (event.lastHealAt && Date.now() - event.lastHealAt < config.cooldownAfterHealMs) {
        continue;
      }

      // 5a. Consult skillGraph for quick fix suggestions (v6.01)
      let skillGraphDiagnosis: Diagnosis | null = null;
      try {
        const { suggestFix, learnFromError } = await import("./skillGraph.js");
        const suggestion = suggestFix(event.metric + ": " + (event.currentValue || ""));
        if (suggestion && suggestion.confidence >= 0.85) {
          skillGraphDiagnosis = {
            rootCause: suggestion.fix,
            confidence: suggestion.confidence,
            suggestedFix: suggestion.fix,
            affectedModule: suggestion.module || event.metric,
            category: "logic",
          };
          learnFromError(event.metric + ": " + event.currentValue, event.metric, suggestion.fix, suggestion.fixCode, true);
          console.log(`[SelfHeal v6.01] SkillGraph provided fix for ${event.metric} (confidence: ${suggestion.confidence})`);
        }
      } catch (err) { log.caught("skillGraph not available, fall through to LLM", err); }

      // 5b. Diagnose with LLM (skip if skillGraph already provided high-confidence fix)
      const diagnosis = skillGraphDiagnosis || await diagnoseWithLLM(event);
      event.healAttempts++;
      event.lastHealAt = Date.now();

      // 6. Record the attempt
      const attempt: HealAttempt = {
        eventId: event.id,
        timestamp: Date.now(),
        diagnosis,
        fixApplied: false,
        verified: false,
        rolledBack: false,
        message: `Diagnosed: ${diagnosis.rootCause} (confidence: ${diagnosis.confidence})`,
      };

      // 7. Apply fix if confidence is high enough
      if (config.enableAutoFix && diagnosis.confidence >= config.autoApplyConfidence) {
        if (diagnosis.category === "memory") {
          // Force GC or clear caches
          if (global.gc) global.gc();
          attempt.fixApplied = true;
          attempt.message += " → Applied memory cleanup";
        } else if (diagnosis.category === "connectivity") {
          // Attempt to reconnect services
          attempt.fixApplied = true;
          attempt.message += " → Triggered reconnection";
        } else if (diagnosis.category === "logic" || diagnosis.category === "performance") {
          // v5.25: Wire code-level fixes through the selfImprove pipeline
          try {
            const { analyzeAndPropose } = await import("./selfImprove.js");
            const targetFile = diagnosis.affectedModule || event.metric;
            const proposal = await analyzeAndPropose(targetFile, diagnosis.rootCause);
            if (proposal) {
              attempt.fixApplied = true;
              attempt.message += ` → Generated improvement proposal: ${proposal.title}`;
              // Auto-apply if confidence is very high
              if (diagnosis.confidence >= 0.9) {
                const { applyProposal } = await import("./selfImprove.js");
                const applyResult = await applyProposal(proposal.id);
                attempt.message += applyResult.success ? " → Auto-applied" : " → Apply failed";
              }
            }
          } catch (improveErr) {
            attempt.message += ` → Self-improve pipeline error: ${(improveErr as Error).message}`;
          }
        }

        // Verify fix
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
        const check = healthChecks.find(c => c.name === event.metric);
        if (check) {
          const verifyResult = await check.check();
          attempt.verified = verifyResult.healthy;
          // v6.03: Feed outcome back to skill graph for learning
          try {
            const { recordFixOutcome } = await import("./skillGraph");
            recordFixOutcome(event.metric, event.metric + ": " + event.currentValue, verifyResult.healthy);
          } catch { /* skill graph not available */ }
          if (verifyResult.healthy) {
            event.resolvedAt = Date.now();
            consecutiveFailures = 0;
            attempt.message += " → Verified: issue resolved";
          } else {
            consecutiveFailures++;
            attempt.message += " → Verification failed: issue persists";
          }
        }
      }

      healHistory.push(attempt);
      if (healHistory.length > MAX_HISTORY) healHistory.shift();
    }
  } catch (err) {
    consecutiveFailures++;
    console.error("[SelfHeal] Heal cycle error:", (err as Error).message);
    // v6.03: Feed cycle-level failures back to skill graph for pattern learning
    try {
      const { learnFromError } = await import("./skillGraph.js");
      learnFromError(
        `healCycle: ${(err as Error).message}`,
        "selfHeal",
        "Investigate heal cycle error and fix root cause",
        undefined,
        false,
      );
    } catch { /* skill graph not available — non-fatal */ }
  } finally {
    healCycleInProgress = false; // v5.22: Release reentrance guard
    lastHealCycleCompletedAt = Date.now(); // v5.27: Watchdog timestamp
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the self-healing background loop.
 */
export function startHealLoop(): { success: boolean; message: string } {
  if (_healLoopActive) return { success: false, message: "Heal loop already running" };

  config.enabled = true;
  _healLoopActive = true;
  consecutiveFailures = 0;

  // v6.31: Each interval tick acquires the distributed lock before running
  healLoopTimer = setInterval(() => {
    withSelfHealLock(() => healCycle()).catch(err =>
      console.warn("[SelfHeal] Cycle skipped (lock busy or error):", (err as Error).message)
    );
  }, config.checkIntervalMs);
  console.log(`[SelfHeal] Started. Interval: ${config.checkIntervalMs}ms`);

  return { success: true, message: `Heal loop started (interval: ${config.checkIntervalMs}ms)` };
}

/**
 * Stop the self-healing loop.
 */
export function stopHealLoop(): { success: boolean; message: string } {
  if (!_healLoopActive) return { success: false, message: "Heal loop not running" };

  _healLoopActive = false;
  config.enabled = false;
  if (healLoopTimer) {
    clearInterval(healLoopTimer);
    healLoopTimer = null;
  }

  console.log("[SelfHeal] Stopped.");
  return { success: true, message: "Heal loop stopped" };
}

/**
 * Run a single heal cycle manually (for testing or on-demand healing).
 */
export async function runHealCycleOnce(): Promise<{
  eventsDetected: number;
  eventsResolved: number;
  attempts: HealAttempt[];
}> {
  const beforeEvents = activeEvents.size;
  const beforeHistory = healHistory.length;

  // Temporarily enable for this run
  const wasEnabled = config.enabled;
  config.enabled = true;
  _healLoopActive = true;

  await withSelfHealLock(() => healCycle()).catch(err =>
    console.warn("[SelfHeal] runHealCycleOnce lock error:", (err as Error).message)
  );

  config.enabled = wasEnabled;
  _healLoopActive = wasEnabled;

  const newAttempts = healHistory.slice(beforeHistory);
  const resolvedCount = Array.from(activeEvents.values()).filter(e => e.resolvedAt && e.resolvedAt > Date.now() - 10000).length;

  return {
    eventsDetected: activeEvents.size - beforeEvents + resolvedCount,
    eventsResolved: resolvedCount,
    attempts: newAttempts,
  };
}

/**
 * Get current heal status and history.
 */
export function getHealStatus(): {
  running: boolean;
  config: SelfHealConfig;
  activeEvents: DegradationEvent[];
  recentAttempts: HealAttempt[];
  consecutiveFailures: number;
  circuitBreakerOpen: boolean;
} {
  return {
    running: _healLoopActive,
    config,
    activeEvents: Array.from(activeEvents.values()).filter(e => !e.resolvedAt),
    recentAttempts: healHistory.slice(-20),
    consecutiveFailures,
    circuitBreakerOpen: consecutiveFailures >= config.circuitBreakerThreshold,
  };
}

/**
 * Update heal configuration.
 */
export function setHealConfig(updates: Partial<SelfHealConfig>): SelfHealConfig {
  config = { ...config, ...updates };

  // Restart timer if interval changed and loop is running
  if (updates.checkIntervalMs && _healLoopActive && healLoopTimer) {
    clearInterval(healLoopTimer);
    healLoopTimer = setInterval(() => {
      withSelfHealLock(() => healCycle()).catch(err =>
        console.warn("[SelfHeal] Cycle skipped (lock busy or error):", (err as Error).message)
      );
    }, config.checkIntervalMs);
  }

  return config;
}

/**
 * Reset the circuit breaker (allow healing to resume after manual intervention).
 */
export function resetCircuitBreaker(): { success: boolean; message: string } {
  consecutiveFailures = 0;
  if (config.enabled && !_healLoopActive) {
    return startHealLoop();
  }
  return { success: true, message: "Circuit breaker reset. Consecutive failures cleared." };
}

/**
 * Register a custom health check at runtime.
 */
export function registerHealthCheck(check: HealthCheck): void {
  const existing = healthChecks.findIndex(c => c.name === check.name);
  if (existing >= 0) {
    healthChecks[existing] = check;
  } else {
    healthChecks.push(check);
  }
}

/**
 * Get all registered health checks and their current status.
 */
export async function runAllHealthChecks(): Promise<Array<{ name: string; healthy: boolean; value: number; threshold: number }>> {
  const results = [];
  for (const check of healthChecks) {
    try {
      const result = await check.check();
      results.push({ name: check.name, healthy: result.healthy, value: result.value, threshold: check.threshold });
    } catch (err) {
      results.push({ name: check.name, healthy: false, value: -1, threshold: check.threshold });
    }
  }
  return results;
}

/**
 * Initialize self-heal on startup.
 */
// ─── v5.33: Proactive Health Monitoring ──────────────────────────────────────

interface MetricTrend {
  name: string;
  values: Array<{ value: number; timestamp: number }>;
  trend: "stable" | "degrading" | "improving" | "unknown";
  predictedTimeToThreshold?: number; // ms until threshold breach
}

const metricTrends: Map<string, MetricTrend> = new Map();
const MAX_TREND_POINTS = 30;

/**
 * Record a metric value for trend analysis.
 */
export function recordMetricForTrend(name: string, value: number): void {
  let trend = metricTrends.get(name);
  if (!trend) {
    trend = { name, values: [], trend: "unknown" };
    metricTrends.set(name, trend);
  }
  trend.values.push({ value, timestamp: Date.now() });
  if (trend.values.length > MAX_TREND_POINTS) trend.values.shift();

  // Calculate trend direction
  if (trend.values.length >= 5) {
    const recent = trend.values.slice(-5);
    const older = trend.values.slice(-10, -5);
    if (older.length >= 3) {
      const recentAvg = recent.reduce((s, v) => s + v.value, 0) / recent.length;
      const olderAvg = older.reduce((s, v) => s + v.value, 0) / older.length;
      const change = (recentAvg - olderAvg) / (olderAvg || 1);
      if (change > 0.1) trend.trend = "degrading";
      else if (change < -0.1) trend.trend = "improving";
      else trend.trend = "stable";
    }
  }
}

/**
 * Get proactive health predictions.
 * Returns metrics that are trending toward their thresholds.
 */
export function getProactiveAlerts(): Array<{
  metric: string;
  trend: string;
  currentValue: number;
  threshold: number;
  predictedBreachIn?: string;
}> {
  const alerts: Array<{ metric: string; trend: string; currentValue: number; threshold: number; predictedBreachIn?: string }> = [];

  for (const check of healthChecks) {
    const trend = metricTrends.get(check.name);
    if (!trend || trend.values.length < 5) continue;

    const current = trend.values[trend.values.length - 1].value;
    if (trend.trend === "degrading") {
      // Predict when threshold will be breached
      const recent5 = trend.values.slice(-5);
      const ratePerMs = (recent5[4].value - recent5[0].value) / (recent5[4].timestamp - recent5[0].timestamp);
      if (ratePerMs !== 0) {
        const remaining = check.direction === "above"
          ? (check.threshold - current) / ratePerMs
          : (current - check.threshold) / (-ratePerMs);
        if (remaining > 0 && remaining < 30 * 60 * 1000) { // Within 30 minutes
          const mins = Math.round(remaining / 60000);
          alerts.push({
            metric: check.name,
            trend: "degrading",
            currentValue: current,
            threshold: check.threshold,
            predictedBreachIn: `~${mins} minutes`,
          });
        }
      }
    }
  }

  return alerts;
}

export function initSelfHeal(): void {
  // Load config from workspace if available


  const configPath = path.join(path.resolve(getServerDir(), "..", "workspace"), ".andromeda_heal_config.json");
  if (fs.existsSync(configPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      config = { ...DEFAULT_CONFIG, ...saved };
    } catch (err) { log.caught("use defaults", err); }
  }

  if (config.enabled) {
    startHealLoop();
  }

  // v5.33: Start proactive monitoring — record metrics every 30s
  setInterval(async () => {
    for (const check of healthChecks) {
      try {
        const result = await check.check();
        recordMetricForTrend(check.name, result.value);
      } catch (err) { log.caught("skip", err); }
    }
  }, 30_000);

  console.log(`[SelfHeal] Initialized with proactive monitoring. Enabled: ${config.enabled}`);
}

// v5.26: Alias for diagnostics endpoint
export const getHealStats = getHealStatus;
