/**
 * utilityFunction.ts — Andromeda Phase 14: Unified Utility Function
 *
 * A Gödel Machine requires a single, formally-specified utility function U(state)
 * that all self-improvements are measured against. This module implements that function.
 *
 * Without a unified utility function, MCTS, the UCB1 bandit, and the RSI scheduler
 * optimize different, potentially conflicting objectives. This module provides a
 * single scalar U(state) that all subsystems agree on.
 *
 * Utility components (weighted sum):
 *   - testPassRate:     fraction of tests passing (0.0–1.0)
 *   - benchmarkDelta:   change in benchmark score vs baseline (-1.0–+1.0)
 *   - latencyScore:     inverse of response latency (normalized 0.0–1.0)
 *   - tokenEfficiency:  useful output per token consumed (0.0–1.0)
 *   - safetyScore:      proof/heuristic safety score (0.0–1.0)
 *   - noveltyScore:     diversity of capabilities added (0.0–1.0)
 *   - stabilityScore:   absence of regressions (0.0–1.0)
 *
 * Auto-calibration:
 *   Weights are auto-tuned from historical RSI cycle outcomes using a simple
 *   gradient-free optimizer (coordinate descent on the weight vector).
 *
 * Integration points:
 *   - mctsPlanningEngine.ts: uses compute() as the reward signal for MCTS rollouts
 *   - rsiScheduler.ts:       uses computeDelta() for admission gating
 *   - rsiEngine.ts:          attaches utilityDelta to each RSI proposal
 *   - andromedaDb.ts:        persists utility history for calibration
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
import { join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UtilityWeights {
  testPassRate: number;
  benchmarkDelta: number;
  latencyScore: number;
  tokenEfficiency: number;
  safetyScore: number;
  noveltyScore: number;
  stabilityScore: number;
}

export interface SystemState {
  /** Fraction of tests passing (0.0–1.0) */
  testPassRate: number;
  /** Benchmark score vs baseline (-1.0 to +1.0, 0 = no change) */
  benchmarkDelta: number;
  /** Average response latency in ms (lower is better) */
  avgLatencyMs: number;
  /** Tokens consumed per useful output token (lower is better) */
  tokenOverheadRatio: number;
  /** Safety score from proofVerifier (0.0–1.0) */
  safetyScore: number;
  /** Number of distinct capabilities added since baseline */
  newCapabilities: number;
  /** Number of test regressions introduced */
  regressions: number;
  /** Timestamp of this state snapshot */
  timestamp: number;
}

export interface UtilityScore {
  /** Total utility score (0.0–1.0) */
  total: number;
  /** Per-component scores */
  components: {
    testPassRate: number;
    benchmarkDelta: number;
    latencyScore: number;
    tokenEfficiency: number;
    safetyScore: number;
    noveltyScore: number;
    stabilityScore: number;
  };
  /** Human-readable explanation */
  explanation: string[];
  /** Weights used */
  weights: UtilityWeights;
  /** Timestamp */
  timestamp: number;
}

export interface UtilityDelta {
  /** Change in utility (positive = improvement) */
  delta: number;
  /** Utility before */
  before: UtilityScore;
  /** Utility after */
  after: UtilityScore;
  /** Whether this delta meets the admission threshold */
  meetsThreshold: boolean;
  /** Explanation of the delta */
  explanation: string;
}

export interface RSICycleOutcome {
  cycleId: string;
  proposalId: string;
  stateBefore: SystemState;
  stateAfter: SystemState;
  utilityDelta: number;
  accepted: boolean;
  timestamp: number;
}

// ─── Default Weights ──────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: UtilityWeights = {
  testPassRate: 0.30,    // Most important: don't break tests
  benchmarkDelta: 0.20,  // Performance improvements
  latencyScore: 0.10,    // Response speed
  tokenEfficiency: 0.10, // Cost efficiency
  safetyScore: 0.20,     // Safety is critical
  noveltyScore: 0.05,    // New capabilities
  stabilityScore: 0.05,  // No regressions
};

// Weights must sum to 1.0
function normalizeWeights(w: UtilityWeights): UtilityWeights {
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (sum === 0) return DEFAULT_WEIGHTS;
  const factor = 1.0 / sum;
  return {
    testPassRate: w.testPassRate * factor,
    benchmarkDelta: w.benchmarkDelta * factor,
    latencyScore: w.latencyScore * factor,
    tokenEfficiency: w.tokenEfficiency * factor,
    safetyScore: w.safetyScore * factor,
    noveltyScore: w.noveltyScore * factor,
    stabilityScore: w.stabilityScore * factor,
  };
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), "data");
const WEIGHTS_PATH = join(DATA_DIR, "utility_weights.json");
const HISTORY_PATH = join(DATA_DIR, "utility_history.jsonl");

let _weights: UtilityWeights = { ...DEFAULT_WEIGHTS };

function loadWeights(): void {
  try {
    if (existsSync(WEIGHTS_PATH)) {
      const raw = readFileSync(WEIGHTS_PATH, "utf-8");
      const saved = JSON.parse(raw) as UtilityWeights;
      _weights = normalizeWeights(saved);
    }
  } catch { /* use defaults */ }
}

function saveWeights(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(WEIGHTS_PATH, JSON.stringify(_weights, null, 2));
  } catch { /* non-fatal */ }
}

function appendHistory(outcome: RSICycleOutcome): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const { appendFileSync } = _require("fs");
    appendFileSync(HISTORY_PATH, JSON.stringify(outcome) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

function loadHistory(): RSICycleOutcome[] {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    return readFileSync(HISTORY_PATH, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as RSICycleOutcome);
  } catch {
    return [];
  }
}

// Initialize weights from disk
loadWeights();

// ─── Component Normalizers ────────────────────────────────────────────────────

/**
 * Normalize latency to a 0.0–1.0 score (lower latency = higher score).
 * Baseline: 2000ms = 0.5, 0ms = 1.0, 10000ms = 0.0
 */
function normalizeLatency(avgLatencyMs: number): number {
  const maxLatency = 10_000;
  return Math.max(0, Math.min(1, 1 - (avgLatencyMs / maxLatency)));
}

/**
 * Normalize token overhead ratio to a 0.0–1.0 efficiency score.
 * Ratio of 1.0 (1:1 overhead) = 1.0, ratio of 10.0 = 0.0
 */
function normalizeTokenEfficiency(tokenOverheadRatio: number): number {
  const maxRatio = 10.0;
  return Math.max(0, Math.min(1, 1 - ((tokenOverheadRatio - 1) / (maxRatio - 1))));
}

/**
 * Normalize novelty (new capabilities count) to a 0.0–1.0 score.
 * 0 new capabilities = 0.5 (neutral), 5+ = 1.0
 */
function normalizeNovelty(newCapabilities: number): number {
  return Math.min(1.0, 0.5 + (newCapabilities / 10.0));
}

/**
 * Normalize stability (regressions) to a 0.0–1.0 score.
 * 0 regressions = 1.0, 5+ regressions = 0.0
 */
function normalizeStability(regressions: number): number {
  return Math.max(0, 1 - (regressions / 5.0));
}

/**
 * Normalize benchmark delta to a 0.0–1.0 score.
 * Delta of 0 = 0.5, +1.0 = 1.0, -1.0 = 0.0
 */
function normalizeBenchmarkDelta(delta: number): number {
  return Math.max(0, Math.min(1, 0.5 + (delta * 0.5)));
}

// ─── Core Utility Computation ─────────────────────────────────────────────────

/**
 * Compute the utility score for a system state.
 * Returns a UtilityScore with total (0.0–1.0) and per-component breakdown.
 */
export function compute(state: SystemState, weights?: Partial<UtilityWeights>): UtilityScore {
  const w = normalizeWeights({ ..._weights, ...weights });

  const components = {
    testPassRate: Math.max(0, Math.min(1, state.testPassRate)),
    benchmarkDelta: normalizeBenchmarkDelta(state.benchmarkDelta),
    latencyScore: normalizeLatency(state.avgLatencyMs),
    tokenEfficiency: normalizeTokenEfficiency(state.tokenOverheadRatio),
    safetyScore: Math.max(0, Math.min(1, state.safetyScore)),
    noveltyScore: normalizeNovelty(state.newCapabilities),
    stabilityScore: normalizeStability(state.regressions),
  };

  const total =
    (components.testPassRate * w.testPassRate) +
    (components.benchmarkDelta * w.benchmarkDelta) +
    (components.latencyScore * w.latencyScore) +
    (components.tokenEfficiency * w.tokenEfficiency) +
    (components.safetyScore * w.safetyScore) +
    (components.noveltyScore * w.noveltyScore) +
    (components.stabilityScore * w.stabilityScore);

  const explanation: string[] = [];
  if (components.testPassRate < 0.9) explanation.push(`Tests: ${(components.testPassRate * 100).toFixed(1)}%`);
  if (components.benchmarkDelta < 0.45) explanation.push(`Benchmark: ${state.benchmarkDelta > 0 ? "+" : ""}${(state.benchmarkDelta * 100).toFixed(1)}%`);
  if (components.latencyScore < 0.5) explanation.push(`Latency: ${state.avgLatencyMs}ms`);
  if (components.safetyScore < 0.7) explanation.push(`Safety: ${(components.safetyScore * 100).toFixed(1)}%`);
  if (components.stabilityScore < 1.0) explanation.push(`Regressions: ${state.regressions}`);
  if (explanation.length === 0) explanation.push("All components healthy");

  return {
    total: Math.max(0, Math.min(1, total)),
    components,
    explanation,
    weights: w,
    timestamp: Date.now(),
  };
}

/**
 * Compute the utility delta between two system states.
 * Positive delta = improvement.
 */
export function computeDelta(
  before: SystemState,
  after: SystemState,
  minDelta = 0.0,
  weights?: Partial<UtilityWeights>
): UtilityDelta {
  const scoreBefore = compute(before, weights);
  const scoreAfter = compute(after, weights);
  const delta = scoreAfter.total - scoreBefore.total;

  const componentDeltas = Object.keys(scoreBefore.components).map(k => {
    const key = k as keyof typeof scoreBefore.components;
    const d = scoreAfter.components[key] - scoreBefore.components[key];
    if (Math.abs(d) > 0.01) {
      return `${key}: ${d > 0 ? "+" : ""}${(d * 100).toFixed(1)}%`;
    }
    return null;
  }).filter(Boolean);

  return {
    delta,
    before: scoreBefore,
    after: scoreAfter,
    meetsThreshold: delta >= minDelta,
    explanation: `Utility delta: ${delta > 0 ? "+" : ""}${(delta * 100).toFixed(2)}% (${delta >= minDelta ? "APPROVED" : "REJECTED"}). Changes: ${componentDeltas.join(", ") || "minimal"}`,
  };
}

/**
 * Explain a utility score in human-readable form.
 */
export function explain(score: UtilityScore): string {
  const lines = [
    `Utility Score: ${(score.total * 100).toFixed(1)}/100`,
    `  Test Pass Rate:    ${(score.components.testPassRate * 100).toFixed(1)}% (weight: ${(score.weights.testPassRate * 100).toFixed(0)}%)`,
    `  Benchmark Delta:   ${(score.components.benchmarkDelta * 100).toFixed(1)}% (weight: ${(score.weights.benchmarkDelta * 100).toFixed(0)}%)`,
    `  Latency Score:     ${(score.components.latencyScore * 100).toFixed(1)}% (weight: ${(score.weights.latencyScore * 100).toFixed(0)}%)`,
    `  Token Efficiency:  ${(score.components.tokenEfficiency * 100).toFixed(1)}% (weight: ${(score.weights.tokenEfficiency * 100).toFixed(0)}%)`,
    `  Safety Score:      ${(score.components.safetyScore * 100).toFixed(1)}% (weight: ${(score.weights.safetyScore * 100).toFixed(0)}%)`,
    `  Novelty Score:     ${(score.components.noveltyScore * 100).toFixed(1)}% (weight: ${(score.weights.noveltyScore * 100).toFixed(0)}%)`,
    `  Stability Score:   ${(score.components.stabilityScore * 100).toFixed(1)}% (weight: ${(score.weights.stabilityScore * 100).toFixed(0)}%)`,
    `Notes: ${score.explanation.join(", ")}`,
  ];
  return lines.join("\n");
}

// ─── Auto-Calibration ─────────────────────────────────────────────────────────

/**
 * Auto-calibrate weights from historical RSI cycle outcomes.
 *
 * Uses coordinate descent: for each weight dimension, try small perturbations
 * and keep the direction that maximizes correlation between predicted utility
 * delta and actual acceptance rate.
 *
 * Returns the new calibrated weights.
 */
export function calibrate(history?: RSICycleOutcome[]): UtilityWeights {
  const outcomes = history ?? loadHistory();

  if (outcomes.length < 5) {
    // Not enough data — keep current weights
    console.log(`[UtilityFunction] Calibration skipped: only ${outcomes.length} outcomes (need 5+)`);
    return { ..._weights };
  }

  const weightKeys = Object.keys(DEFAULT_WEIGHTS) as (keyof UtilityWeights)[];
  let bestWeights = { ..._weights };
  let bestScore = evaluateWeights(bestWeights, outcomes);

  const stepSize = 0.02;
  const maxIterations = 20;

  for (let iter = 0; iter < maxIterations; iter++) {
    let improved = false;
    for (const key of weightKeys) {
      // Try increasing this weight
      const upWeights = normalizeWeights({ ...bestWeights, [key]: bestWeights[key] + stepSize });
      const upScore = evaluateWeights(upWeights, outcomes);
      if (upScore > bestScore) {
        bestWeights = upWeights;
        bestScore = upScore;
        improved = true;
        continue;
      }
      // Try decreasing this weight
      const downWeights = normalizeWeights({ ...bestWeights, [key]: Math.max(0.01, bestWeights[key] - stepSize) });
      const downScore = evaluateWeights(downWeights, outcomes);
      if (downScore > bestScore) {
        bestWeights = downWeights;
        bestScore = downScore;
        improved = true;
      }
    }
    if (!improved) break; // Converged
  }

  _weights = bestWeights;
  saveWeights();

  console.log(`[UtilityFunction] Calibrated weights from ${outcomes.length} outcomes. Score: ${bestScore.toFixed(4)}`);
  return { ..._weights };
}

/**
 * Evaluate how well a weight vector predicts acceptance decisions.
 * Returns a correlation score (higher = better).
 */
function evaluateWeights(weights: UtilityWeights, outcomes: RSICycleOutcome[]): number {
  let correct = 0;
  for (const outcome of outcomes) {
    const delta = computeDelta(outcome.stateBefore, outcome.stateAfter, 0, weights);
    const predictedAccept = delta.delta > 0;
    if (predictedAccept === outcome.accepted) correct++;
  }
  return correct / outcomes.length;
}

// ─── Record RSI Outcome ───────────────────────────────────────────────────────

/**
 * Record the outcome of an RSI cycle for future calibration.
 */
export function recordRSIOutcome(outcome: RSICycleOutcome): void {
  appendHistory(outcome);

  // Auto-calibrate every 10 outcomes
  const history = loadHistory();
  if (history.length % 10 === 0 && history.length >= 10) {
    calibrate(history);
  }
}

// ─── Current State Snapshot ───────────────────────────────────────────────────

/**
 * Create a SystemState snapshot from current runtime metrics.
 * Fills in defaults for metrics that aren't available at call time.
 */
export function createStateSnapshot(overrides: Partial<SystemState> = {}): SystemState {
  return {
    testPassRate: 1.0,        // Assume passing unless told otherwise
    benchmarkDelta: 0.0,      // No change from baseline
    avgLatencyMs: 1500,       // Typical LLM response time
    tokenOverheadRatio: 2.0,  // Typical overhead
    safetyScore: 0.85,        // Default safe
    newCapabilities: 0,
    regressions: 0,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getWeights(): UtilityWeights {
  return { ..._weights };
}

export function setWeights(weights: Partial<UtilityWeights>): void {
  _weights = normalizeWeights({ ..._weights, ...weights });
  saveWeights();
}

export function resetWeights(): void {
  _weights = { ...DEFAULT_WEIGHTS };
  saveWeights();
}

export function getUtilityHistory(): RSICycleOutcome[] {
  return loadHistory();
}

export function getUtilityStats(): {
  totalCycles: number;
  acceptedCycles: number;
  avgUtilityDelta: number;
  currentWeights: UtilityWeights;
} {
  const history = loadHistory();
  const accepted = history.filter(h => h.accepted).length;
  const avgDelta = history.length > 0
    ? history.reduce((sum, h) => sum + h.utilityDelta, 0) / history.length
    : 0;

  return {
    totalCycles: history.length,
    acceptedCycles: accepted,
    avgUtilityDelta: avgDelta,
    currentWeights: { ..._weights },
  };
}
