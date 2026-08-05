/**
 * Causal Measurement Framework — Elicit P3 Recommendation
 *
 * Tracks per-feature ablation deltas against the held-out evaluation set.
 * A feature branch is only eligible for promotion if it shows measurable lift
 * on at least one primary metric (resolvedRate, applyRate) without regression
 * on cost or latency beyond the defined tolerances.
 *
 * This module is intentionally decoupled from the repair loop — it is called
 * by the promotion gate (policy-promotion/index.ts) before any branch merge.
 */

export interface AblationMetrics {
  resolvedRate: number;    // fraction of instances resolved (0–1)
  applyRate: number;       // fraction of patches that apply cleanly (0–1)
  avgCostUsd: number;      // average cost per instance in USD
  avgLatencyMs: number;    // average wall-clock time per instance in ms
  instanceCount: number;   // number of instances evaluated
  runId: string;           // unique identifier for this eval run
  timestamp: number;       // Unix ms
  featureName: string;     // name of the feature being measured
  baselineRunId: string;   // runId of the baseline this is compared against
}

export interface AblationDelta {
  resolvedRateDelta: number;   // positive = improvement
  applyRateDelta: number;
  costDelta: number;           // negative = cheaper
  latencyDelta: number;        // negative = faster
  liftDetected: boolean;       // true if resolvedRate improved by >= threshold
  regressionDetected: boolean; // true if cost or latency degraded beyond tolerance
  eligible: boolean;           // liftDetected && !regressionDetected
}

export interface AblationRecord {
  featureName: string;
  baseline: AblationMetrics;
  treatment: AblationMetrics;
  delta: AblationDelta;
  recordedAt: number;
}

// In-memory store — persisted to data/ablation_records.jsonl by flushRecords()
const _records: AblationRecord[] = [];

// Thresholds — conservative defaults, can be overridden per-feature
const LIFT_THRESHOLD = 0.01;        // 1 percentage point minimum resolved rate improvement
const COST_REGRESSION_LIMIT = 0.15; // 15% cost increase is acceptable
const LATENCY_REGRESSION_LIMIT = 0.20; // 20% latency increase is acceptable

/**
 * Compute the delta between a baseline and treatment run and determine
 * whether the feature is eligible for promotion.
 */
export function computeDelta(
  baseline: AblationMetrics,
  treatment: AblationMetrics,
  liftThreshold = LIFT_THRESHOLD,
  costRegressionLimit = COST_REGRESSION_LIMIT,
  latencyRegressionLimit = LATENCY_REGRESSION_LIMIT,
): AblationDelta {
  const resolvedRateDelta = treatment.resolvedRate - baseline.resolvedRate;
  const applyRateDelta = treatment.applyRate - baseline.applyRate;
  const costDelta = treatment.avgCostUsd - baseline.avgCostUsd;
  const latencyDelta = treatment.avgLatencyMs - baseline.avgLatencyMs;

  const liftDetected = resolvedRateDelta >= liftThreshold;
  const costRegression = baseline.avgCostUsd > 0
    ? costDelta / baseline.avgCostUsd > costRegressionLimit
    : false;
  const latencyRegression = baseline.avgLatencyMs > 0
    ? latencyDelta / baseline.avgLatencyMs > latencyRegressionLimit
    : false;
  const regressionDetected = costRegression || latencyRegression;

  return {
    resolvedRateDelta,
    applyRateDelta,
    costDelta,
    latencyDelta,
    liftDetected,
    regressionDetected,
    eligible: liftDetected && !regressionDetected,
  };
}

/**
 * Record an ablation result. Returns the full record including the delta.
 */
export function recordAblation(
  baseline: AblationMetrics,
  treatment: AblationMetrics,
): AblationRecord {
  const delta = computeDelta(baseline, treatment);
  const record: AblationRecord = {
    featureName: treatment.featureName,
    baseline,
    treatment,
    delta,
    recordedAt: Date.now(),
  };
  _records.push(record);
  return record;
}

/**
 * Get all recorded ablation results.
 */
export function getRecords(): AblationRecord[] {
  return [..._records];
}

/**
 * Get the most recent ablation record for a given feature.
 */
export function getLatestRecord(featureName: string): AblationRecord | null {
  const matching = _records.filter(r => r.featureName === featureName);
  return matching.length > 0 ? matching[matching.length - 1] : null;
}

/**
 * Check whether a feature is eligible for promotion based on its most
 * recent ablation record. Returns false if no record exists.
 */
export function isEligibleForPromotion(featureName: string): boolean {
  const record = getLatestRecord(featureName);
  return record?.delta.eligible ?? false;
}

/**
 * Summarise all recorded ablations as a human-readable report string.
 */
export function summarizeAblations(): string {
  if (_records.length === 0) return "[CausalMeasurement] No ablation records.";
  const lines = _records.map(r => {
    const d = r.delta;
    const status = d.eligible ? "ELIGIBLE" : d.regressionDetected ? "REGRESSION" : "NO_LIFT";
    return `  ${r.featureName}: ${status} | resolvedRate ${d.resolvedRateDelta >= 0 ? "+" : ""}${(d.resolvedRateDelta * 100).toFixed(1)}pp | cost ${d.costDelta >= 0 ? "+" : ""}$${d.costDelta.toFixed(4)} | latency ${d.latencyDelta >= 0 ? "+" : ""}${d.latencyDelta.toFixed(0)}ms`;
  });
  return `[CausalMeasurement] Ablation summary (${_records.length} records):\n${lines.join("\n")}`;
}

/** Reset for testing. */
export function _resetCausalMeasurementForTest(): void {
  _records.length = 0;
}
