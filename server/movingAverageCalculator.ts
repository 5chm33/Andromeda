/**
 * movingAverageCalculator.ts — v83.0.0 "Time Series & Forecasting"
 * Computes simple, exponential, and weighted moving averages over time series data.
 */
export type MAType = "simple" | "exponential" | "weighted";

export interface MAResult {
  type: MAType;
  window: number;
  values: number[];
  timestamps: number[];
}

export function simpleMovingAverage(values: number[], window: number): number[] {
  if (window <= 0 || window > values.length) return [];
  const result: number[] = [];
  for (let i = window - 1; i < values.length; i++) {
    const slice = values.slice(i - window + 1, i + 1);
    result.push(slice.reduce((s, v) => s + v, 0) / window);
  }
  return result;
}

export function exponentialMovingAverage(values: number[], alpha: number): number[] {
  if (values.length === 0 || alpha <= 0 || alpha > 1) return [];
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

export function weightedMovingAverage(values: number[], window: number): number[] {
  if (window <= 0 || window > values.length) return [];
  const result: number[] = [];
  const totalWeight = (window * (window + 1)) / 2;
  for (let i = window - 1; i < values.length; i++) {
    let weighted = 0;
    for (let j = 0; j < window; j++) {
      weighted += values[i - window + 1 + j] * (j + 1);
    }
    result.push(weighted / totalWeight);
  }
  return result;
}

export function computeMA(points: Array<{ timestamp: number; value: number }>, type: MAType, windowOrAlpha: number): MAResult {
  const values = points.map(p => p.value);
  const timestamps = points.map(p => p.timestamp);

  let maValues: number[] = [];
  let maTimestamps: number[] = [];

  if (type === "simple") {
    maValues = simpleMovingAverage(values, windowOrAlpha);
    maTimestamps = timestamps.slice(windowOrAlpha - 1);
  } else if (type === "exponential") {
    maValues = exponentialMovingAverage(values, windowOrAlpha);
    maTimestamps = timestamps;
  } else if (type === "weighted") {
    maValues = weightedMovingAverage(values, windowOrAlpha);
    maTimestamps = timestamps.slice(windowOrAlpha - 1);
  }

  return { type, window: windowOrAlpha, values: maValues, timestamps: maTimestamps };
}
