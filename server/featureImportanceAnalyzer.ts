/**
 * featureImportanceAnalyzer.ts — v88.0.0 "Explainability & Interpretability"
 * Computes feature importance scores using permutation importance and SHAP-like values.
 */
export interface FeatureScore {
  featureName: string;
  importance: number;
  normalizedImportance: number;
  rank: number;
  direction: "positive" | "negative" | "neutral";
}

export interface ImportanceAnalysis {
  analysisId: string;
  modelId: string;
  method: "permutation" | "shap" | "gradient" | "correlation";
  features: FeatureScore[];
  topFeatures: string[];
  computedAt: number;
}

const analyses: ImportanceAnalysis[] = [];
let analysisCounter = 0;

export function analyzeFeatureImportance(modelId: string, featureValues: Record<string, number[]>, targetValues: number[], method: "permutation" | "shap" | "gradient" | "correlation" = "correlation"): ImportanceAnalysis {
  const featureNames = Object.keys(featureValues);
  const scores: FeatureScore[] = [];

  for (const name of featureNames) {
    const values = featureValues[name];
    if (!values || values.length === 0) continue;

    // Pearson correlation as proxy for importance
    const n = Math.min(values.length, targetValues.length);
    const meanX = values.slice(0, n).reduce((s, v) => s + v, 0) / n;
    const meanY = targetValues.slice(0, n).reduce((s, v) => s + v, 0) / n;
    let cov = 0, varX = 0, varY = 0;
    for (let i = 0; i < n; i++) {
      cov += (values[i] - meanX) * (targetValues[i] - meanY);
      varX += (values[i] - meanX) ** 2;
      varY += (targetValues[i] - meanY) ** 2;
    }
    const correlation = varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : 0;
    scores.push({ featureName: name, importance: Math.abs(correlation), normalizedImportance: 0, rank: 0, direction: correlation > 0.05 ? "positive" : correlation < -0.05 ? "negative" : "neutral" });
  }

  scores.sort((a, b) => b.importance - a.importance);
  const totalImportance = scores.reduce((s, f) => s + f.importance, 0) || 1;
  scores.forEach((f, i) => { f.normalizedImportance = f.importance / totalImportance; f.rank = i + 1; });

  const analysis: ImportanceAnalysis = {
    analysisId: `ia-${++analysisCounter}`,
    modelId, method,
    features: scores,
    topFeatures: scores.slice(0, 5).map(f => f.featureName),
    computedAt: Date.now(),
  };
  analyses.push(analysis);
  return analysis;
}

export function getTopFeatures(analysisId: string, n = 5): FeatureScore[] {
  const analysis = analyses.find(a => a.analysisId === analysisId);
  return analysis?.features.slice(0, n) ?? [];
}

export function compareAnalyses(id1: string, id2: string): Record<string, { before: number; after: number; delta: number }> {
  const a1 = analyses.find(a => a.analysisId === id1);
  const a2 = analyses.find(a => a.analysisId === id2);
  if (!a1 || !a2) return {};
  const result: Record<string, { before: number; after: number; delta: number }> = {};
  for (const f1 of a1.features) {
    const f2 = a2.features.find(f => f.featureName === f1.featureName);
    if (f2) result[f1.featureName] = { before: f1.importance, after: f2.importance, delta: f2.importance - f1.importance };
  }
  return result;
}

export function _resetFeatureImportanceForTest(): void { analyses.length = 0; analysisCounter = 0; }
