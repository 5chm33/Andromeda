/**
 * seasonalityAnalyzer.ts — v83.0.0 "Time Series & Forecasting"
 * Detects and characterizes seasonal patterns in time series data.
 */
export type SeasonalPeriod = "hourly" | "daily" | "weekly" | "monthly" | "custom";

export interface SeasonalPattern {
  period: SeasonalPeriod;
  periodLength: number;
  strength: number;
  peakIndex: number;
  troughIndex: number;
  seasonalIndices: number[];
}

export interface SeasonalityReport {
  hasSeasonality: boolean;
  dominantPeriod: SeasonalPeriod | null;
  patterns: SeasonalPattern[];
  deseasonalizedValues: number[];
}

function computeSeasonalIndices(values: number[], period: number): number[] {
  const indices: number[] = new Array(period).fill(0);
  const counts: number[] = new Array(period).fill(0);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;

  for (let i = 0; i < values.length; i++) {
    indices[i % period] += values[i];
    counts[i % period]++;
  }

  return indices.map((sum, i) => counts[i] > 0 ? (sum / counts[i]) / (avg || 1) : 1);
}

function seasonalStrength(values: number[], period: number): number {
  const indices = computeSeasonalIndices(values, period);
  const variance = indices.reduce((s, v) => s + (v - 1) ** 2, 0) / indices.length;
  return Math.min(1, Math.sqrt(variance));
}

export function analyzeSeasonality(values: number[], periods: Array<{ period: SeasonalPeriod; length: number }> = [
  { period: "daily", length: 24 },
  { period: "weekly", length: 7 },
]): SeasonalityReport {
  const patterns: SeasonalPattern[] = [];

  for (const { period, length } of periods) {
    if (values.length < length * 2) continue;
    const indices = computeSeasonalIndices(values, length);
    const strength = seasonalStrength(values, length);
    const peakIndex = indices.indexOf(Math.max(...indices));
    const troughIndex = indices.indexOf(Math.min(...indices));
    if (strength > 0.05) {
      patterns.push({ period, periodLength: length, strength, peakIndex, troughIndex, seasonalIndices: indices });
    }
  }

  patterns.sort((a, b) => b.strength - a.strength);
  const dominant = patterns[0] ?? null;

  // Deseasonalize
  const deseasonalized = dominant
    ? values.map((v, i) => v / (dominant.seasonalIndices[i % dominant.periodLength] || 1))
    : [...values];

  return {
    hasSeasonality: patterns.length > 0,
    dominantPeriod: dominant?.period ?? null,
    patterns,
    deseasonalizedValues: deseasonalized,
  };
}
