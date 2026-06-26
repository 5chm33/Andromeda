/**
 * Experiment Designer — designs controlled experiments to test improvement hypotheses.
 * Implements factorial design, A/B testing, and statistical power analysis.
 */

export interface ExperimentDesign {
  id: string;
  hypothesisId: string;
  type: "ab_test" | "factorial" | "bandit" | "ablation";
  controlCondition: Record<string, unknown>;
  treatmentConditions: Array<Record<string, unknown>>;
  sampleSize: number;
  powerLevel: number;
  alpha: number;
  expectedDuration: number;  // cycles
  createdAt: number;
}

export interface ExperimentResult {
  experimentId: string;
  controlMean: number;
  treatmentMean: number;
  effectSize: number;
  pValue: number;
  significant: boolean;
  confidenceInterval: [number, number];
  conclusion: string;
}

export interface ExperimentReport {
  totalDesigned: number;
  totalCompleted: number;
  significantResults: number;
  avgEffectSize: number;
  avgPower: number;
}

class ExperimentDesignerEngine {
  private designs: ExperimentDesign[] = [];
  private results: ExperimentResult[] = [];
  private counter = 0;

  designExperiment(
    hypothesisId: string,
    type: ExperimentDesign["type"],
    controlCondition: Record<string, unknown>,
    treatmentConditions: Array<Record<string, unknown>>
  ): ExperimentDesign {
    // Power analysis: sample size for 80% power at alpha=0.05
    const sampleSize = this._computeSampleSize(0.8, 0.05, 0.5);
    const design: ExperimentDesign = {
      id: `exp-${++this.counter}`,
      hypothesisId,
      type,
      controlCondition,
      treatmentConditions,
      sampleSize,
      powerLevel: 0.8,
      alpha: 0.05,
      expectedDuration: Math.ceil(sampleSize / 10),
      createdAt: Date.now(),
    };
    this.designs.push(design);
    return design;
  }

  private _computeSampleSize(power: number, alpha: number, effectSize: number): number {
    // Cohen's formula approximation
    const zAlpha = 1.96; // alpha=0.05 two-tailed
    const zBeta = 0.842; // power=0.8
    return Math.ceil(2 * ((zAlpha + zBeta) / effectSize) ** 2);
  }

  analyzeResults(
    experimentId: string,
    controlSamples: number[],
    treatmentSamples: number[]
  ): ExperimentResult {
    const controlMean = controlSamples.reduce((a, b) => a + b, 0) / Math.max(controlSamples.length, 1);
    const treatmentMean = treatmentSamples.reduce((a, b) => a + b, 0) / Math.max(treatmentSamples.length, 1);
    const effectSize = treatmentMean - controlMean;

    // Welch's t-test approximation
    const controlVar = controlSamples.reduce((s, v) => s + (v - controlMean) ** 2, 0) / Math.max(controlSamples.length - 1, 1);
    const treatVar = treatmentSamples.reduce((s, v) => s + (v - treatmentMean) ** 2, 0) / Math.max(treatmentSamples.length - 1, 1);
    const se = Math.sqrt(controlVar / Math.max(controlSamples.length, 1) + treatVar / Math.max(treatmentSamples.length, 1));
    const tStat = se > 0 ? effectSize / se : 0;
    // Approximate p-value from t-statistic
    const pValue = Math.max(0.001, Math.min(0.999, 2 * (1 - this._normalCDF(Math.abs(tStat)))));
    const significant = pValue < 0.05;
    const ci: [number, number] = [effectSize - 1.96 * se, effectSize + 1.96 * se];

    const result: ExperimentResult = {
      experimentId,
      controlMean,
      treatmentMean,
      effectSize,
      pValue,
      significant,
      confidenceInterval: ci,
      conclusion: significant
        ? `Treatment significantly better (p=${pValue.toFixed(4)}, effect=${effectSize.toFixed(6)})`
        : `No significant difference (p=${pValue.toFixed(4)})`,
    };
    this.results.push(result);
    return result;
  }

  private _normalCDF(x: number): number {
    // Abramowitz & Stegun approximation
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
    return x > 0 ? 1 - p : p;
  }

  computeStatisticalPower(effectSize: number, sampleSize: number, alpha = 0.05): number {
    const zAlpha = 1.96;
    const ncp = effectSize * Math.sqrt(sampleSize / 2);
    return this._normalCDF(ncp - zAlpha);
  }

  getExperimentReport(): ExperimentReport {
    return {
      totalDesigned: this.designs.length,
      totalCompleted: this.results.length,
      significantResults: this.results.filter(r => r.significant).length,
      avgEffectSize: this.results.length > 0
        ? this.results.reduce((s, r) => s + Math.abs(r.effectSize), 0) / this.results.length
        : 0,
      avgPower: this.designs.length > 0
        ? this.designs.reduce((s, d) => s + d.powerLevel, 0) / this.designs.length
        : 0,
    };
  }

  getDesigns(): ExperimentDesign[] { return [...this.designs]; }
  getResults(): ExperimentResult[] { return [...this.results]; }
}

export const globalExperimentDesigner = new ExperimentDesignerEngine();

export function designExperiment(
  hypothesisId: string, type: ExperimentDesign["type"],
  controlCondition: Record<string, unknown>, treatmentConditions: Array<Record<string, unknown>>
): ExperimentDesign {
  return globalExperimentDesigner.designExperiment(hypothesisId, type, controlCondition, treatmentConditions);
}
export function analyzeExperimentResults(experimentId: string, controlSamples: number[], treatmentSamples: number[]): ExperimentResult {
  return globalExperimentDesigner.analyzeResults(experimentId, controlSamples, treatmentSamples);
}
export function computeStatisticalPower(effectSize: number, sampleSize: number, alpha?: number): number {
  return globalExperimentDesigner.computeStatisticalPower(effectSize, sampleSize, alpha);
}
export function getExperimentReport(): ExperimentReport {
  return globalExperimentDesigner.getExperimentReport();
}
export function initExperimentDesigner(): void {
  console.log("[Experiment] Experiment Designer initialized.");
}
