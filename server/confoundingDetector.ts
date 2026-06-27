/**
 * confoundingDetector.ts — v98.0.0 "Causal Inference & Counterfactual Reasoning"
 * Detects confounding variables that bias causal estimates.
 */
export interface ObservationalData { variableName: string; values: number[]; }
export interface ConfoundingAnalysis {
  analysisId: string;
  treatmentVariable: string;
  outcomeVariable: string;
  potentialConfounders: Array<{ variable: string; correlationWithTreatment: number; correlationWithOutcome: number; confoundingScore: number; isConfounder: boolean }>;
  adjustmentNeeded: boolean;
  biasEstimate: number;
}

const analyses: ConfoundingAnalysis[] = [];
let analysisCounter = 0;

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return 0;
  const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const my = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); dx2 += (x[i] - mx) ** 2; dy2 += (y[i] - my) ** 2; }
  return dx2 * dy2 > 0 ? num / Math.sqrt(dx2 * dy2) : 0;
}

export function analyzeConfounding(treatment: ObservationalData, outcome: ObservationalData, candidates: ObservationalData[]): ConfoundingAnalysis {
  const potentialConfounders = candidates.map(c => {
    const corrTreatment = Math.abs(pearsonCorrelation(c.values, treatment.values));
    const corrOutcome = Math.abs(pearsonCorrelation(c.values, outcome.values));
    const confoundingScore = corrTreatment * corrOutcome;
    return { variable: c.variableName, correlationWithTreatment: corrTreatment, correlationWithOutcome: corrOutcome, confoundingScore, isConfounder: confoundingScore > 0.1 };
  });

  const maxBias = potentialConfounders.filter(c => c.isConfounder).reduce((max, c) => Math.max(max, c.confoundingScore), 0);
  const analysis: ConfoundingAnalysis = { analysisId: `ca-${++analysisCounter}`, treatmentVariable: treatment.variableName, outcomeVariable: outcome.variableName, potentialConfounders, adjustmentNeeded: potentialConfounders.some(c => c.isConfounder), biasEstimate: maxBias };
  analyses.push(analysis);
  return analysis;
}

export function getAnalyses(): ConfoundingAnalysis[] { return [...analyses]; }
export function _resetConfoundingDetectorForTest(): void { analyses.length = 0; analysisCounter = 0; }
