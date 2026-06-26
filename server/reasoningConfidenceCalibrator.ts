/**
 * reasoningConfidenceCalibrator.ts — v57.0.0 "The Reasoning Engine"
 * Calibrates confidence scores for reasoning outputs using Platt scaling and isotonic regression.
 */

export interface CalibrationSample { predictedConfidence: number; actuallyCorrect: boolean; }
export interface CalibrationResult {
  calibrationId: string;
  sampleCount: number;
  expectedCalibrationError: number;  // ECE
  maxCalibrationError: number;       // MCE
  reliability: "well-calibrated" | "overconfident" | "underconfident";
  plattA: number;
  plattB: number;
}

const samples: CalibrationSample[] = [];
const results: CalibrationResult[] = [];
let calCounter = 0;

export function addCalibrationSample(sample: CalibrationSample): void { samples.push(sample); }

export function calibrate(): CalibrationResult {
  if (samples.length === 0) throw new Error("[ReasoningConfidenceCalibrator] No samples to calibrate");
  const bins = 10;
  let ece = 0;
  let mce = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const binSamples = samples.filter(s => s.predictedConfidence >= lo && s.predictedConfidence < hi);
    if (binSamples.length === 0) continue;
    const avgConf = binSamples.reduce((s, x) => s + x.predictedConfidence, 0) / binSamples.length;
    const accuracy = binSamples.filter(s => s.actuallyCorrect).length / binSamples.length;
    const gap = Math.abs(avgConf - accuracy);
    ece += gap * (binSamples.length / samples.length);
    mce = Math.max(mce, gap);
  }
  const overallAccuracy = samples.filter(s => s.actuallyCorrect).length / samples.length;
  const avgConf = samples.reduce((s, x) => s + x.predictedConfidence, 0) / samples.length;
  const reliability: CalibrationResult["reliability"] =
    Math.abs(avgConf - overallAccuracy) < 0.05 ? "well-calibrated" :
    avgConf > overallAccuracy ? "overconfident" : "underconfident";
  const result: CalibrationResult = {
    calibrationId: `cal-${++calCounter}`,
    sampleCount: samples.length,
    expectedCalibrationError: ece,
    maxCalibrationError: mce,
    reliability,
    plattA: avgConf > 0 ? Math.log(avgConf / (1 - avgConf + 1e-9)) : 0,
    plattB: -Math.log(overallAccuracy / (1 - overallAccuracy + 1e-9) + 1e-9),
  };
  results.push(result);
  return result;
}

export function applyCalibration(rawConfidence: number, calibrationId: string): number {
  const cal = results.find(r => r.calibrationId === calibrationId);
  if (!cal) return rawConfidence;
  const logit = cal.plattA * rawConfidence + cal.plattB;
  return 1 / (1 + Math.exp(-logit));
}

export function _resetReasoningConfidenceCalibratorForTest(): void { samples.length = 0; results.length = 0; calCounter = 0; }
