/**
 * anomalyDetector.ts — v83.0.0 "Time Series & Forecasting"
 * Detects anomalies in time series using Z-score, IQR, and moving-average deviation methods.
 */
export type AnomalyMethod = "zscore" | "iqr" | "mad";

export interface Anomaly {
  timestamp: number;
  value: number;
  expectedValue: number;
  deviation: number;
  severity: "low" | "medium" | "high";
  method: AnomalyMethod;
}

export interface AnomalyDetectionResult {
  method: AnomalyMethod;
  anomalies: Anomaly[];
  threshold: number;
  totalPoints: number;
}

function mean(values: number[]): number { return values.reduce((s, v) => s + v, 0) / values.length; }
function stddev(values: number[], avg: number): number { return Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length); }
function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]; }

export function detectAnomalies(points: Array<{ timestamp: number; value: number }>, method: AnomalyMethod = "zscore", threshold = 2.5): AnomalyDetectionResult {
  const values = points.map(p => p.value);
  const anomalies: Anomaly[] = [];

  if (method === "zscore") {
    const avg = mean(values);
    const std = stddev(values, avg);
    for (const p of points) {
      const z = std > 0 ? Math.abs((p.value - avg) / std) : 0;
      if (z > threshold) {
        anomalies.push({ timestamp: p.timestamp, value: p.value, expectedValue: avg, deviation: z, severity: z > threshold * 2 ? "high" : z > threshold * 1.5 ? "medium" : "low", method });
      }
    }
  } else if (method === "iqr") {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - threshold * iqr;
    const upper = q3 + threshold * iqr;
    const avg = mean(values);
    for (const p of points) {
      if (p.value < lower || p.value > upper) {
        const dev = Math.abs(p.value - avg) / (iqr > 0 ? iqr : 1);
        anomalies.push({ timestamp: p.timestamp, value: p.value, expectedValue: avg, deviation: dev, severity: dev > 5 ? "high" : dev > 3 ? "medium" : "low", method });
      }
    }
  } else if (method === "mad") {
    const med = median(values);
    const mads = values.map(v => Math.abs(v - med));
    const mad = median(mads);
    for (const p of points) {
      const score = mad > 0 ? Math.abs(p.value - med) / mad : 0;
      if (score > threshold) {
        anomalies.push({ timestamp: p.timestamp, value: p.value, expectedValue: med, deviation: score, severity: score > threshold * 2 ? "high" : score > threshold * 1.5 ? "medium" : "low", method });
      }
    }
  }

  return { method, anomalies, threshold, totalPoints: points.length };
}
