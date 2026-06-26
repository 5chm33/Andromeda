/**
 * predictionCalibrator.ts — v59.0.0 "The Prediction Engine"
 * Calibrates prediction intervals using historical coverage analysis.
 */

export interface CalibrationCheck { predicted: number; actual: number; lowerBound: number; upperBound: number; }
export interface PredictionCalibrationResult { calId: string; coverageRate: number; targetCoverage: number; calibrationError: number; isWellCalibrated: boolean; }
const history: CalibrationCheck[] = [];
const calResults: PredictionCalibrationResult[] = [];
let calCounter = 0;

export function addPredictionOutcome(check: CalibrationCheck): void { history.push(check); }

export function evaluateCalibration(targetCoverage = 0.95): PredictionCalibrationResult {
  if (history.length === 0) throw new Error("[PredictionCalibrator] No outcomes to evaluate");
  const covered = history.filter(h => h.actual >= h.lowerBound && h.actual <= h.upperBound).length;
  const coverageRate = covered / history.length;
  const calibrationError = Math.abs(coverageRate - targetCoverage);
  const result: PredictionCalibrationResult = { calId: `pc-${++calCounter}`, coverageRate, targetCoverage, calibrationError, isWellCalibrated: calibrationError < 0.05 };
  calResults.push(result);
  return result;
}

export function _resetPredictionCalibratorForTest(): void { history.length = 0; calResults.length = 0; calCounter = 0; }
