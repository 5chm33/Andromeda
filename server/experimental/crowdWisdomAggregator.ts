/**
 * crowdWisdomAggregator.ts — v99.0.0 "Collective Intelligence & Swarm Cognition"
 * Aggregates diverse individual estimates to produce accurate collective predictions.
 */
export type AggregationMethod = "mean" | "median" | "trimmed_mean" | "weighted_mean" | "bayesian";
export interface IndividualEstimate { agentId: string; estimate: number; confidence: number; expertise: number; submittedAt: number; }
export interface CollectiveEstimate {
  estimateId: string;
  question: string;
  method: AggregationMethod;
  individualEstimates: IndividualEstimate[];
  collectiveValue: number;
  standardDeviation: number;
  confidenceInterval: [number, number];
  diversityScore: number;
  wisdomScore: number;
}

const estimates: CollectiveEstimate[] = [];
let estimateCounter = 0;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function aggregate(question: string, individuals: IndividualEstimate[], method: AggregationMethod = "weighted_mean"): CollectiveEstimate {
  const values = individuals.map(i => i.estimate);
  let collectiveValue: number;

  switch (method) {
    case "mean": collectiveValue = values.reduce((s, v) => s + v, 0) / values.length; break;
    case "median": collectiveValue = median(values); break;
    case "trimmed_mean": {
      const sorted = [...values].sort((a, b) => a - b);
      const trim = Math.floor(sorted.length * 0.1);
      const trimmed = sorted.slice(trim, sorted.length - trim);
      collectiveValue = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
      break;
    }
    case "weighted_mean":
    case "bayesian": {
      const totalWeight = individuals.reduce((s, i) => s + i.confidence * i.expertise, 0);
      collectiveValue = totalWeight > 0 ? individuals.reduce((s, i) => s + i.estimate * i.confidence * i.expertise, 0) / totalWeight : median(values);
      break;
    }
    default: collectiveValue = median(values);
  }

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const diversityScore = stdDev / (Math.abs(mean) + 1e-10);
  const wisdomScore = Math.min(1, individuals.length / 10) * (1 - Math.min(1, diversityScore));

  const ce: CollectiveEstimate = { estimateId: `ce-${++estimateCounter}`, question, method, individualEstimates: [...individuals], collectiveValue, standardDeviation: stdDev, confidenceInterval: [collectiveValue - 1.96 * stdDev, collectiveValue + 1.96 * stdDev], diversityScore, wisdomScore };
  estimates.push(ce);
  return ce;
}

export function getEstimates(): CollectiveEstimate[] { return [...estimates]; }
export function _resetCrowdWisdomAggregatorForTest(): void { estimates.length = 0; estimateCounter = 0; }
