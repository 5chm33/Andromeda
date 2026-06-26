/**
 * anomalyIsolator.ts — v62.0.0 "The Security Vault"
 * Isolates anomalous processes/requests using statistical deviation scoring.
 */

export interface IsolationResult { isolationId: string; entityId: string; anomalyScore: number; isolated: boolean; reason: string; }
const baseline = new Map<string, number[]>();
const isolations: IsolationResult[] = [];
let iCounter = 0;

export function recordBaseline(entityId: string, value: number): void {
  if (!baseline.has(entityId)) baseline.set(entityId, []);
  baseline.get(entityId)!.push(value);
}

export function evaluateAnomaly(entityId: string, currentValue: number, threshold = 2.5): IsolationResult {
  const history = baseline.get(entityId) ?? [];
  let anomalyScore = 0;
  let reason = "no_baseline";
  if (history.length > 0) {
    const mean = history.reduce((s, v) => s + v, 0) / history.length;
    const std = Math.sqrt(history.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / history.length);
    anomalyScore = std > 0 ? Math.abs(currentValue - mean) / std : 0;
    reason = anomalyScore >= threshold ? `z_score_${anomalyScore.toFixed(2)}_exceeds_${threshold}` : "within_normal_range";
  }
  const result: IsolationResult = { isolationId: `iso-${++iCounter}`, entityId, anomalyScore, isolated: anomalyScore >= threshold, reason };
  isolations.push(result);
  return result;
}

export function getIsolations(): IsolationResult[] { return [...isolations]; }
export function _resetAnomalyIsolatorForTest(): void { baseline.clear(); isolations.length = 0; iCounter = 0; }
