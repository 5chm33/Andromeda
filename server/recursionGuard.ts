/**
 * Andromeda v5.27 — Recursion Guard
 *
 * Prevents runaway self-modification loops by enforcing:
 * 1. Rate limiting: max N modifications per hour
 * 2. Recursion depth: max N levels of self-modifying-self-modifier
 * 3. Cooldown: forced pause after consecutive failures
 *
 * Integrates with selfModify.ts and selfImprove.ts.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface ModificationRecord {
  id: string;
  timestamp: number;
  targetFile: string;
  source: string; // "self-improve" | "self-heal" | "continuous" | "manual"
  depth: number;
  success: boolean;
}

interface RecursionGuardConfig {
  maxModificationsPerHour: number;
  maxRecursionDepth: number;
  cooldownAfterFailures: number;    // Consecutive failures before cooldown
  cooldownDurationMs: number;        // How long to pause after hitting limit
  enabled: boolean;
}

// ── State ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: RecursionGuardConfig = {
  maxModificationsPerHour: 20,        // v5.52: increased from 10 to support active improvement cycle
  maxRecursionDepth: 5,               // v5.52: increased from 3 for deeper self-improvement chains
  cooldownAfterFailures: 5,
  cooldownDurationMs: 15 * 60 * 1000, // v5.52: reduced from 30 to 15 minutes for faster recovery
  enabled: true,
};

let config: RecursionGuardConfig = { ...DEFAULT_CONFIG };
const history: ModificationRecord[] = [];
const MAX_HISTORY = 500;
let consecutiveFailures = 0;
let cooldownUntil = 0;
let currentDepth = 0;
let totalBlocked = 0;
let totalAllowed = 0;

// ── Core Logic ───────────────────────────────────────────────────────────────

export function canModify(source: string, targetFile: string): {
  allowed: boolean;
  reason?: string;
  suggestion?: string;
} {
  if (!config.enabled) return { allowed: true };

  // Check cooldown
  if (Date.now() < cooldownUntil) {
    const remaining = Math.round((cooldownUntil - Date.now()) / 1000);
    totalBlocked++;
    return {
      allowed: false,
      reason: `Cooldown active (${remaining}s remaining) after ${config.cooldownAfterFailures} consecutive failures`,
      suggestion: "Wait for cooldown to expire or manually reset with resetGuard()",
    };
  }

  // Check rate limit
  const oneHourAgo = Date.now() - 3600000;
  const recentCount = history.filter(m => m.timestamp > oneHourAgo).length;
  if (recentCount >= config.maxModificationsPerHour) {
    totalBlocked++;
    return {
      allowed: false,
      reason: `Rate limit reached: ${recentCount}/${config.maxModificationsPerHour} modifications in the last hour`,
      suggestion: `Wait ${Math.round((history.find(m => m.timestamp > oneHourAgo)!.timestamp + 3600000 - Date.now()) / 60000)} minutes or increase maxModificationsPerHour`,
    };
  }

  // Check recursion depth
  if (currentDepth >= config.maxRecursionDepth) {
    totalBlocked++;
    return {
      allowed: false,
      reason: `Recursion depth limit reached: ${currentDepth}/${config.maxRecursionDepth}`,
      suggestion: "Complete current modification chain before starting new ones",
    };
  }

  // Check if same file was recently modified and failed
  const recentSameFile = history.filter(
    m => m.targetFile === targetFile && m.timestamp > oneHourAgo && !m.success
  );
  if (recentSameFile.length >= 3) {
    totalBlocked++;
    return {
      allowed: false,
      reason: `File "${targetFile}" has failed ${recentSameFile.length} times in the last hour`,
      suggestion: "Investigate root cause before retrying. Check selfKnowledgeBase for anti-patterns.",
    };
  }

  totalAllowed++;
  return { allowed: true };
}

export function recordModification(
  targetFile: string,
  source: string,
  success: boolean
): void {
  const record: ModificationRecord = {
    id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    targetFile,
    source,
    depth: currentDepth,
    success,
  };

  history.push(record);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

  if (success) {
    consecutiveFailures = 0;
  } else {
    consecutiveFailures++;
    if (consecutiveFailures >= config.cooldownAfterFailures) {
      cooldownUntil = Date.now() + config.cooldownDurationMs;
      console.warn(`[RecursionGuard] Cooldown activated: ${consecutiveFailures} consecutive failures. Pausing for ${config.cooldownDurationMs / 60000}min.`);
    }
  }
}

export function enterRecursion(): void {
  currentDepth++;
}

export function exitRecursion(): void {
  currentDepth = Math.max(0, currentDepth - 1);
}

export function resetGuard(): void {
  consecutiveFailures = 0;
  cooldownUntil = 0;
  currentDepth = 0;
  console.log("[RecursionGuard] Reset.");
}

export function getGuardStats() {
  const oneHourAgo = Date.now() - 3600000;
  const recentCount = history.filter(m => m.timestamp > oneHourAgo).length;
  return {
    enabled: config.enabled,
    currentDepth,
    consecutiveFailures,
    cooldownActive: Date.now() < cooldownUntil,
    cooldownRemainingMs: Math.max(0, cooldownUntil - Date.now()),
    modificationsLastHour: recentCount,
    maxPerHour: config.maxModificationsPerHour,
    maxDepth: config.maxRecursionDepth,
    totalBlocked,
    totalAllowed,
    recentHistory: history.slice(-10),
  };
}

export function updateGuardConfig(updates: Partial<RecursionGuardConfig>): void {
  config = { ...config, ...updates };
}

export function getGuardConfig(): RecursionGuardConfig {
  return { ...config };
}

// Initialize
console.log(`[RecursionGuard] Initialized. Rate: ${config.maxModificationsPerHour}/hr, Depth: ${config.maxRecursionDepth}, Cooldown: ${config.cooldownDurationMs / 60000}min`);
