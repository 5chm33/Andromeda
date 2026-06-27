/**
 * forecastEngine.ts — v83.0.0 "Time Series & Forecasting"
 * Generates short-term forecasts using linear regression and exponential smoothing.
 */
export type ForecastMethod = "linear_regression" | "exponential_smoothing" | "naive";

export interface ForecastPoint {
  timestamp: number;
  predictedValue: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
}

export interface ForecastResult {
  method: ForecastMethod;
  horizon: number;
  forecasts: ForecastPoint[];
  mape: number;
  rmse: number;
}

function linearRegression(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = x.length;
  const sumX = x.reduce((s, v) => s + v, 0);
  const sumY = y.reduce((s, v) => s + v, 0);
  const sumXY = x.reduce((s, v, i) => s + v * y[i], 0);
  const sumX2 = x.reduce((s, v) => s + v * v, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function forecast(points: Array<{ timestamp: number; value: number }>, horizon: number, method: ForecastMethod = "linear_regression", intervalMs = 60000): ForecastResult {
  const values = points.map(p => p.value);
  const timestamps = points.map(p => p.timestamp);
  const lastTs = timestamps[timestamps.length - 1];

  const forecasts: ForecastPoint[] = [];
  const std = Math.sqrt(values.reduce((s, v) => s + (v - values.reduce((a, b) => a + b, 0) / values.length) ** 2, 0) / values.length);

  if (method === "linear_regression") {
    const x = timestamps.map((t, i) => i);
    const { slope, intercept } = linearRegression(x, values);
    for (let h = 1; h <= horizon; h++) {
      const predicted = slope * (points.length + h - 1) + intercept;
      const margin = std * 1.96;
      forecasts.push({ timestamp: lastTs + h * intervalMs, predictedValue: predicted, lowerBound: predicted - margin, upperBound: predicted + margin, confidence: 0.95 });
    }
  } else if (method === "exponential_smoothing") {
    const alpha = 0.3;
    let smoothed = values[0];
    for (const v of values) smoothed = alpha * v + (1 - alpha) * smoothed;
    for (let h = 1; h <= horizon; h++) {
      const margin = std * (1 + h * 0.1);
      forecasts.push({ timestamp: lastTs + h * intervalMs, predictedValue: smoothed, lowerBound: smoothed - margin, upperBound: smoothed + margin, confidence: Math.max(0.5, 0.95 - h * 0.02) });
    }
  } else if (method === "naive") {
    const lastValue = values[values.length - 1];
    for (let h = 1; h <= horizon; h++) {
      const margin = std * h * 0.5;
      forecasts.push({ timestamp: lastTs + h * intervalMs, predictedValue: lastValue, lowerBound: lastValue - margin, upperBound: lastValue + margin, confidence: Math.max(0.3, 0.9 - h * 0.05) });
    }
  }

  // Compute MAPE and RMSE on training data (simplified)
  const predicted = values.map((_, i) => {
    if (method === "linear_regression") {
      const { slope, intercept } = linearRegression(timestamps.map((_, j) => j), values);
      return slope * i + intercept;
    }
    return values[Math.max(0, i - 1)];
  });
  const mape = values.reduce((s, v, i) => s + (v !== 0 ? Math.abs((v - predicted[i]) / v) : 0), 0) / values.length * 100;
  const rmse = Math.sqrt(values.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0) / values.length);

  return { method, horizon, forecasts, mape, rmse };
}
