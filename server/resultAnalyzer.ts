/**
 * Result Analyzer — deep statistical analysis of improvement results.
 * Computes effect sizes, trend detection, regression analysis, and meta-analysis.
 */

export interface AnalysisResult {
  id: string;
  sampleId: string;
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  skewness: number;
  kurtosis: number;
  trend: "improving" | "degrading" | "stable" | "oscillating";
  trendSlope: number;
  analyzedAt: number;
}

export interface MetaAnalysis {
  studies: number;
  pooledEffectSize: number;
  heterogeneityI2: number;  // 0-100%
  confidenceInterval: [number, number];
  conclusion: string;
}

export interface AnalyzerReport {
  totalAnalyses: number;
  avgEffectSize: number;
  improvingTrends: number;
  degradingTrends: number;
  stableCount: number;
}

class ResultAnalyzerEngine {
  private analyses: AnalysisResult[] = [];
  private counter = 0;

  analyzeTimeSeries(sampleId: string, values: number[]): AnalysisResult {
    if (values.length === 0) {
      return {
        id: `analysis-${++this.counter}`, sampleId, mean: 0, median: 0, std: 0, min: 0, max: 0,
        skewness: 0, kurtosis: 0, trend: "stable", trendSlope: 0, analyzedAt: Date.now(),
      };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(values.length - 1, 1);
    const std = Math.sqrt(variance);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;

    // Skewness (Fisher's moment)
    const skewness = std > 0 ? values.reduce((s, v) => s + ((v - mean) / std) ** 3, 0) / values.length : 0;
    // Excess kurtosis
    const kurtosis = std > 0 ? values.reduce((s, v) => s + ((v - mean) / std) ** 4, 0) / values.length - 3 : 0;

    // Linear trend (OLS slope)
    const n = values.length;
    const xMean = (n - 1) / 2;
    const trendSlope = n > 1
      ? values.reduce((s, v, i) => s + (i - xMean) * (v - mean), 0) /
        values.reduce((s, _, i) => s + (i - xMean) ** 2, 0)
      : 0;

    let trend: AnalysisResult["trend"];
    if (Math.abs(trendSlope) < 1e-8) trend = "stable";
    else if (trendSlope > 0) trend = "improving";
    else if (trendSlope < 0) trend = "degrading";
    else trend = "oscillating";

    // Check for oscillation
    if (values.length >= 4) {
      const diffs = values.slice(1).map((v, i) => v - (values[i] ?? 0));
      const signChanges = diffs.slice(1).filter((d, i) => d * (diffs[i] ?? 0) < 0).length;
      if (signChanges > diffs.length * 0.4) trend = "oscillating";
    }

    const result: AnalysisResult = {
      id: `analysis-${++this.counter}`, sampleId, mean, median, std, min, max,
      skewness, kurtosis, trend, trendSlope, analyzedAt: Date.now(),
    };
    this.analyses.push(result);
    if (this.analyses.length > 5000) this.analyses.shift();
    return result;
  }

  computeMetaAnalysis(effectSizes: number[], sampleSizes: number[]): MetaAnalysis {
    if (effectSizes.length === 0) {
      return { studies: 0, pooledEffectSize: 0, heterogeneityI2: 0, confidenceInterval: [0, 0], conclusion: "No studies" };
    }
    // Inverse-variance weighted meta-analysis
    const weights = sampleSizes.map(n => n);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const pooledEffect = effectSizes.reduce((s, e, i) => s + e * (weights[i] ?? 0), 0) / Math.max(totalWeight, 1);

    // Cochran's Q for heterogeneity
    const Q = effectSizes.reduce((s, e, i) => s + (weights[i] ?? 0) * (e - pooledEffect) ** 2, 0);
    const df = effectSizes.length - 1;
    const I2 = Math.max(0, Math.min(100, ((Q - df) / Math.max(Q, 0.001)) * 100));

    const se = 1 / Math.sqrt(Math.max(totalWeight, 1));
    const ci: [number, number] = [pooledEffect - 1.96 * se, pooledEffect + 1.96 * se];

    return {
      studies: effectSizes.length,
      pooledEffectSize: pooledEffect,
      heterogeneityI2: I2,
      confidenceInterval: ci,
      conclusion: I2 > 75
        ? `High heterogeneity (I²=${I2.toFixed(1)}%) — results may not generalize`
        : `Pooled effect: ${pooledEffect.toFixed(6)} (I²=${I2.toFixed(1)}%)`,
    };
  }

  detectRegression(baseline: number[], current: number[]): boolean {
    const baselineMean = baseline.reduce((a, b) => a + b, 0) / Math.max(baseline.length, 1);
    const currentMean = current.reduce((a, b) => a + b, 0) / Math.max(current.length, 1);
    return currentMean < baselineMean * 0.99; // >1% regression
  }

  getAnalyzerReport(): AnalyzerReport {
    return {
      totalAnalyses: this.analyses.length,
      avgEffectSize: this.analyses.length > 0
        ? this.analyses.reduce((s, a) => s + Math.abs(a.trendSlope), 0) / this.analyses.length
        : 0,
      improvingTrends: this.analyses.filter(a => a.trend === "improving").length,
      degradingTrends: this.analyses.filter(a => a.trend === "degrading").length,
      stableCount: this.analyses.filter(a => a.trend === "stable").length,
    };
  }

  getAnalyses(): AnalysisResult[] { return [...this.analyses]; }
}

export const globalResultAnalyzer = new ResultAnalyzerEngine();

export function analyzeTimeSeries(sampleId: string, values: number[]): AnalysisResult {
  return globalResultAnalyzer.analyzeTimeSeries(sampleId, values);
}
export function computeMetaAnalysis(effectSizes: number[], sampleSizes: number[]): MetaAnalysis {
  return globalResultAnalyzer.computeMetaAnalysis(effectSizes, sampleSizes);
}
export function detectRegression(baseline: number[], current: number[]): boolean {
  return globalResultAnalyzer.detectRegression(baseline, current);
}
export function getAnalyzerReport(): AnalyzerReport {
  return globalResultAnalyzer.getAnalyzerReport();
}
export function initResultAnalyzer(): void {
  console.log("[ResultAnalyzer] Result Analyzer initialized.");
}
