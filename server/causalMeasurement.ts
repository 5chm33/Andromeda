/**
 * causalMeasurement.ts — Andromeda v5.0
 * P3: Causal Measurement Framework (Ablation Tracking)
 * 
 * Compares a minimal baseline against new context, probe, critic, and rollback
 * additions one at a time on a held-out set. Features are promoted only if they
 * improve resolved rate, apply reliability, cost, latency, or security-test
 * performance.
 */

import * as fs from "fs";
import * as path from "path";

export interface FeatureMetrics {
  featureName: string;
  resolvedDelta: number;
  applyReliabilityDelta: number;
  costDeltaUSD: number;
  latencyDeltaSec: number;
  securityTestDelta: number;
}

export interface AblationRun {
  runId: string;
  timestamp: number;
  datasetSplit: "dev" | "held-out";
  baselineCommit: string;
  metrics: FeatureMetrics[];
  promotionDecision: "promote" | "reject" | "needs_data";
}

const ABLATION_LOG_PATH = path.join(process.cwd(), "data", "ablation_history.jsonl");

export function recordAblationRun(run: AblationRun): void {
  const line = JSON.stringify(run) + "\n";
  fs.appendFileSync(ABLATION_LOG_PATH, line, "utf-8");
}

export function evaluateFeaturePromotion(metrics: FeatureMetrics): boolean {
  // A feature must improve at least one core metric without severely regressing others
  const isLift = 
    metrics.resolvedDelta > 0 ||
    metrics.applyReliabilityDelta > 0 ||
    metrics.securityTestDelta > 0;
  
  const isSevereRegression = 
    metrics.resolvedDelta < -0.02 ||
    metrics.applyReliabilityDelta < -0.05 ||
    metrics.costDeltaUSD > 0.50 ||
    metrics.latencyDeltaSec > 60;

  return isLift && !isSevereRegression;
}
