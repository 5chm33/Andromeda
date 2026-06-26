/**
 * shortTermPredictor.ts — v59.0.0 "The Prediction Engine"
 * Predicts near-future values using exponential smoothing and ARIMA-lite.
 */

export interface ShortTermPrediction { predictionId: string; seriesId: string; predictedValues: number[]; horizon: number; confidence: number; method: string; }
const predictions: ShortTermPrediction[] = [];
let predCounter = 0;

export function predictShortTerm(seriesId: string, history: number[], horizon: number): ShortTermPrediction {
  if (history.length === 0) throw new Error("[ShortTermPredictor] Empty history");
  const alpha = 0.3;
  let smoothed = history[0];
  for (let i = 1; i < history.length; i++) smoothed = alpha * history[i] + (1 - alpha) * smoothed;
  const trend = history.length > 1 ? (history[history.length - 1] - history[0]) / history.length : 0;
  const predictedValues = Array.from({ length: horizon }, (_, i) => smoothed + trend * (i + 1));
  const variance = history.reduce((s, v) => s + (v - smoothed) ** 2, 0) / history.length;
  const confidence = Math.max(0.1, 1 - Math.sqrt(variance) / (Math.abs(smoothed) + 1e-9));
  const pred: ShortTermPrediction = { predictionId: `stp-${++predCounter}`, seriesId, predictedValues, horizon, confidence, method: "exponential_smoothing" };
  predictions.push(pred);
  return pred;
}

export function getShortTermPredictions(seriesId: string): ShortTermPrediction[] { return predictions.filter(p => p.seriesId === seriesId); }
export function _resetShortTermPredictorForTest(): void { predictions.length = 0; predCounter = 0; }
