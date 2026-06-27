/**
 * trendExtractor.ts — v83.0.0 "Time Series & Forecasting"
 * Extracts trend direction, slope, and change points from time series data.
 */
export type TrendDirection = "upward" | "downward" | "flat" | "volatile";

export interface TrendResult {
  direction: TrendDirection;
  slope: number;
  intercept: number;
  rSquared: number;
  changePoints: number[];
  percentChange: number;
}

export interface ChangePoint {
  index: number;
  timestamp: number;
  value: number;
  type: "increase" | "decrease";
  magnitude: number;
}

function linearFit(x: number[], y: number[]): { slope: number; intercept: number; rSquared: number } {
  const n = x.length;
  const avgX = x.reduce((s, v) => s + v, 0) / n;
  const avgY = y.reduce((s, v) => s + v, 0) / n;
  const ssXY = x.reduce((s, v, i) => s + (v - avgX) * (y[i] - avgY), 0);
  const ssXX = x.reduce((s, v) => s + (v - avgX) ** 2, 0);
  const slope = ssXX !== 0 ? ssXY / ssXX : 0;
  const intercept = avgY - slope * avgX;
  const predicted = x.map(v => slope * v + intercept);
  const ssTot = y.reduce((s, v) => s + (v - avgY) ** 2, 0);
  const ssRes = y.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
  const rSquared = ssTot !== 0 ? 1 - ssRes / ssTot : 0;
  return { slope, intercept, rSquared };
}

export function extractTrend(points: Array<{ timestamp: number; value: number }>): TrendResult {
  const values = points.map(p => p.value);
  const x = points.map((_, i) => i);
  const { slope, intercept, rSquared } = linearFit(x, values);

  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length);

  let direction: TrendDirection;
  if (std / (avg || 1) > 0.5) direction = "volatile";
  else if (Math.abs(slope) < 0.001 * (avg || 1)) direction = "flat";
  else if (slope > 0) direction = "upward";
  else direction = "downward";

  // Detect change points using rolling mean comparison
  const windowSize = Math.max(3, Math.floor(values.length / 5));
  const changePointIndices: number[] = [];
  for (let i = windowSize; i < values.length - windowSize; i++) {
    const before = values.slice(i - windowSize, i).reduce((s, v) => s + v, 0) / windowSize;
    const after = values.slice(i, i + windowSize).reduce((s, v) => s + v, 0) / windowSize;
    if (Math.abs(after - before) > std * 1.5) changePointIndices.push(i);
  }

  const first = values[0];
  const last = values[values.length - 1];
  const percentChange = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;

  return { direction, slope, intercept, rSquared, changePoints: changePointIndices, percentChange };
}

export function detectChangePoints(points: Array<{ timestamp: number; value: number }>, sensitivity = 1.5): ChangePoint[] {
  const values = points.map(p => p.value);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length);
  const changePoints: ChangePoint[] = [];

  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (Math.abs(delta) > std * sensitivity) {
      changePoints.push({ index: i, timestamp: points[i].timestamp, value: points[i].value, type: delta > 0 ? "increase" : "decrease", magnitude: Math.abs(delta) });
    }
  }
  return changePoints;
}
