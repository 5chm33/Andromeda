/**
 * fineTunerActivation.ts — v18.0.0
 *
 * Verifies that the OpenAI API key has fine-tuning scope and that the
 * continuousFineTuner is ready to activate. Adds a health check endpoint
 * to the RSI dashboard and emits a startup warning if fine-tuning is
 * unavailable.
 *
 * Exported API:
 *   checkFineTunerReadiness()  → FineTunerReadiness
 *   initFineTunerActivation()  → void (called from initDaemons)
 *   getFineTunerReadiness()    → FineTunerReadiness (cached)
 */

import { createLogger } from "./logger.js";
import { getFineTunerStatus } from "./continuousFineTuner.js";

const log = createLogger("fineTunerActivation");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FineTunerReadiness {
  ready: boolean;
  hasApiKey: boolean;
  apiKeyHasScope: boolean;
  pendingExamples: number;
  completedJobs: number;
  activeModelId: string | null;
  thresholdRemaining: number;
  estimatedActivationDays: number | null;
  blockers: string[];
  checkedAt: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

let _readiness: FineTunerReadiness | null = null;
let _initialized = false;

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Verify the OpenAI API key has fine-tuning scope by making a lightweight
 * probe request to the fine-tuning jobs list endpoint.
 */
async function _probeApiKeyScope(): Promise<{ hasKey: boolean; hasScope: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { hasKey: false, hasScope: false };

  try {
    const resp = await fetch("https://api.openai.com/v1/fine_tuning/jobs?limit=1", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (resp.status === 200) return { hasKey: true, hasScope: true };
    if (resp.status === 401 || resp.status === 403) return { hasKey: true, hasScope: false };
    // 429 rate limit still means key is valid and has scope
    if (resp.status === 429) return { hasKey: true, hasScope: true };
    return { hasKey: true, hasScope: false };
  } catch {
    // Network error — assume key is present but can't verify scope
    return { hasKey: !!apiKey, hasScope: false };
  }
}

/**
 * Run a full readiness check for the continuous fine-tuner.
 * This probes the OpenAI API to verify key scope.
 */
export async function checkFineTunerReadiness(): Promise<FineTunerReadiness> {
  const blockers: string[] = [];
  const { hasKey, hasScope } = await _probeApiKeyScope();

  if (!hasKey) blockers.push("OPENAI_API_KEY is not set in environment");
  if (hasKey && !hasScope) blockers.push("OPENAI_API_KEY does not have fine-tuning scope (needs model:write or fine_tuning:write)");

  const status = getFineTunerStatus();
  const THRESHOLD = 100;
  const thresholdRemaining = Math.max(0, THRESHOLD - status.pendingExamples);

  // Estimate days to activation based on typical RSI cycle rate (~8 proposals/day)
  const RSI_PROPOSALS_PER_DAY = 8;
  const estimatedActivationDays = thresholdRemaining > 0
    ? Math.ceil(thresholdRemaining / RSI_PROPOSALS_PER_DAY)
    : 0;

  const ready = hasKey && hasScope && thresholdRemaining === 0;

  const readiness: FineTunerReadiness = {
    ready,
    hasApiKey: hasKey,
    apiKeyHasScope: hasScope,
    pendingExamples: status.pendingExamples,
    completedJobs: status.completedJobs,
    activeModelId: status.activeModelId,
    thresholdRemaining,
    estimatedActivationDays: thresholdRemaining > 0 ? estimatedActivationDays : null,
    blockers,
    checkedAt: new Date().toISOString(),
  };

  _readiness = readiness;
  return readiness;
}

/**
 * Return the cached readiness result (populated at boot by initFineTunerActivation).
 * Falls back to a stub if init hasn't run yet.
 */
export function getFineTunerReadiness(): FineTunerReadiness {
  if (_readiness) return _readiness;
  const status = getFineTunerStatus();
  return {
    ready: false,
    hasApiKey: !!process.env.OPENAI_API_KEY,
    apiKeyHasScope: false,
    pendingExamples: status.pendingExamples,
    completedJobs: status.completedJobs,
    activeModelId: status.activeModelId,
    thresholdRemaining: 100,
    estimatedActivationDays: null,
    blockers: ["Readiness check not yet run"],
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Initialize the fine-tuner activation checker at boot.
 * Runs the readiness probe and logs the result.
 * Called from initDaemons.ts.
 */
export function initFineTunerActivation(): void {
  if (_initialized) return;
  _initialized = true;

  // Run the probe asynchronously — don't block boot
  checkFineTunerReadiness().then(readiness => {
    if (readiness.ready) {
      log.info("[fineTunerActivation] Fine-tuner is READY — will activate on next threshold crossing");
    } else if (readiness.blockers.length > 0) {
      for (const b of readiness.blockers) {
        log.warn(`[fineTunerActivation] BLOCKER: ${b}`);
      }
    } else {
      const days = readiness.estimatedActivationDays;
      log.info(`[fineTunerActivation] Fine-tuner collecting examples — ${readiness.thresholdRemaining} remaining (est. ${days} days)`);
    }
  }).catch(err => {
    log.warn(`[fineTunerActivation] Readiness probe failed: ${(err as Error).message}`);
  });
}

/**
 * Reset state for testing.
 */
export function _resetFineTunerActivationForTesting(): void {
  _readiness = null;
  _initialized = false;
}
