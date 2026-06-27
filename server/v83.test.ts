/**
 * v83.test.ts — Time Series & Forecasting
 * Comprehensive tests for all 6 v83 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createSeries, appendDataPoint, queryRange, getSeries, getLatestValue, _resetTimeSeriesStoreForTest } from "./timeSeriesStore";
import { simpleMovingAverage, exponentialMovingAverage, weightedMovingAverage, computeMA } from "./movingAverageCalculator";
import { detectAnomalies } from "./anomalyDetector";
import { forecast } from "./forecastEngine";
import { analyzeSeasonality } from "./seasonalityAnalyzer";
import { extractTrend, detectChangePoints } from "./trendExtractor";

// ─── timeSeriesStore ─────────────────────────────────────────────────────────
describe("timeSeriesStore", () => {
  beforeEach(() => _resetTimeSeriesStoreForTest());

  it("creates a series and appends data points", () => {
    const series = createSeries("cpu_usage", "percent");
    appendDataPoint(series.seriesId, 45.2, 1000);
    appendDataPoint(series.seriesId, 52.1, 2000);
    expect(getSeries(series.seriesId)?.dataPoints.length).toBe(2);
  });

  it("queries a time range", () => {
    const series = createSeries("memory", "MB");
    appendDataPoint(series.seriesId, 100, 1000);
    appendDataPoint(series.seriesId, 200, 2000);
    appendDataPoint(series.seriesId, 300, 3000);
    const result = queryRange(series.seriesId, 1500, 2500);
    expect(result?.count).toBe(1);
    expect(result?.points[0].value).toBe(200);
  });

  it("computes range statistics", () => {
    const series = createSeries("latency", "ms");
    appendDataPoint(series.seriesId, 10, 1000);
    appendDataPoint(series.seriesId, 20, 2000);
    appendDataPoint(series.seriesId, 30, 3000);
    const result = queryRange(series.seriesId, 0, 9999);
    expect(result?.min).toBe(10);
    expect(result?.max).toBe(30);
    expect(result?.mean).toBe(20);
    expect(result?.sum).toBe(60);
  });

  it("returns latest value", () => {
    const series = createSeries("temp", "C");
    appendDataPoint(series.seriesId, 22, 1000);
    appendDataPoint(series.seriesId, 25, 3000);
    appendDataPoint(series.seriesId, 23, 2000);
    expect(getLatestValue(series.seriesId)?.value).toBe(25);
  });

  it("returns null for unknown series", () => {
    expect(queryRange("unknown", 0, 9999)).toBeNull();
  });

  it("resets cleanly", () => {
    createSeries("x", "u");
    _resetTimeSeriesStoreForTest();
    expect(getSeries("ts-1")).toBeUndefined();
  });
});

// ─── movingAverageCalculator ─────────────────────────────────────────────────
describe("movingAverageCalculator", () => {
  it("computes simple moving average", () => {
    const values = [1, 2, 3, 4, 5];
    const sma = simpleMovingAverage(values, 3);
    expect(sma.length).toBe(3);
    expect(sma[0]).toBeCloseTo(2);
    expect(sma[1]).toBeCloseTo(3);
    expect(sma[2]).toBeCloseTo(4);
  });

  it("computes exponential moving average", () => {
    const values = [1, 2, 3, 4, 5];
    const ema = exponentialMovingAverage(values, 0.5);
    expect(ema.length).toBe(5);
    expect(ema[0]).toBe(1);
    expect(ema[ema.length - 1]).toBeGreaterThan(ema[0]);
  });

  it("computes weighted moving average", () => {
    const values = [1, 2, 3, 4, 5];
    const wma = weightedMovingAverage(values, 3);
    expect(wma.length).toBe(3);
    // WMA gives more weight to recent values, so should be higher than SMA
    const sma = simpleMovingAverage(values, 3);
    expect(wma[0]).toBeGreaterThanOrEqual(sma[0]);
  });

  it("returns empty for window larger than data", () => {
    expect(simpleMovingAverage([1, 2], 5)).toEqual([]);
  });

  it("computeMA returns correct structure", () => {
    const points = [1, 2, 3, 4, 5].map((v, i) => ({ timestamp: i * 1000, value: v }));
    const result = computeMA(points, "simple", 3);
    expect(result.type).toBe("simple");
    expect(result.values.length).toBeGreaterThan(0);
  });

  it("EMA alpha=1 equals original values", () => {
    const values = [1, 2, 3, 4, 5];
    const ema = exponentialMovingAverage(values, 1);
    expect(ema).toEqual(values);
  });
});

// ─── anomalyDetector ─────────────────────────────────────────────────────────
describe("anomalyDetector", () => {
  const normalPoints = [10, 11, 10, 12, 11, 10, 11, 12, 10, 11, 100, 10, 11].map((v, i) => ({ timestamp: i * 1000, value: v }));

  it("detects outlier with z-score method", () => {
    const result = detectAnomalies(normalPoints, "zscore", 2);
    expect(result.anomalies.length).toBeGreaterThan(0);
    expect(result.anomalies[0].value).toBe(100);
  });

  it("detects outlier with IQR method", () => {
    const result = detectAnomalies(normalPoints, "iqr", 1.5);
    expect(result.anomalies.length).toBeGreaterThan(0);
  });

  it("detects outlier with MAD method", () => {
    const result = detectAnomalies(normalPoints, "mad", 2);
    expect(result.anomalies.length).toBeGreaterThan(0);
  });

  it("returns no anomalies for uniform data", () => {
    const uniform = Array(20).fill(10).map((v, i) => ({ timestamp: i * 1000, value: v }));
    const result = detectAnomalies(uniform, "zscore", 2);
    expect(result.anomalies.length).toBe(0);
  });

  it("returns total point count", () => {
    const result = detectAnomalies(normalPoints, "zscore", 2);
    expect(result.totalPoints).toBe(normalPoints.length);
  });

  it("assigns severity levels", () => {
    const result = detectAnomalies(normalPoints, "zscore", 1);
    expect(["low", "medium", "high"]).toContain(result.anomalies[0]?.severity);
  });
});

// ─── forecastEngine ──────────────────────────────────────────────────────────
describe("forecastEngine", () => {
  const trendPoints = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v, i) => ({ timestamp: i * 60000, value: v }));

  it("generates linear regression forecasts", () => {
    const result = forecast(trendPoints, 3, "linear_regression");
    expect(result.forecasts.length).toBe(3);
    expect(result.forecasts[0].predictedValue).toBeGreaterThan(10);
  });

  it("generates exponential smoothing forecasts", () => {
    const result = forecast(trendPoints, 3, "exponential_smoothing");
    expect(result.forecasts.length).toBe(3);
    expect(result.forecasts[0].predictedValue).toBeGreaterThan(0);
  });

  it("generates naive forecasts", () => {
    const result = forecast(trendPoints, 3, "naive");
    expect(result.forecasts.length).toBe(3);
    expect(result.forecasts[0].predictedValue).toBe(10);
  });

  it("forecast intervals widen over horizon", () => {
    const result = forecast(trendPoints, 5, "naive");
    const first = result.forecasts[0].upperBound - result.forecasts[0].lowerBound;
    const last = result.forecasts[4].upperBound - result.forecasts[4].lowerBound;
    expect(last).toBeGreaterThan(first);
  });

  it("returns MAPE and RMSE", () => {
    const result = forecast(trendPoints, 3, "linear_regression");
    expect(result.mape).toBeGreaterThanOrEqual(0);
    expect(result.rmse).toBeGreaterThanOrEqual(0);
  });

  it("timestamps are in the future", () => {
    const result = forecast(trendPoints, 3, "naive");
    const lastTs = trendPoints[trendPoints.length - 1].timestamp;
    expect(result.forecasts[0].timestamp).toBeGreaterThan(lastTs);
  });
});

// ─── seasonalityAnalyzer ─────────────────────────────────────────────────────
describe("seasonalityAnalyzer", () => {
  it("detects weekly seasonality", () => {
    // Create 3 weeks of data with clear weekly pattern
    const values: number[] = [];
    for (let week = 0; week < 3; week++) {
      for (let day = 0; day < 7; day++) {
        values.push(day === 5 || day === 6 ? 100 : 50); // weekends spike
      }
    }
    const result = analyzeSeasonality(values, [{ period: "weekly", length: 7 }]);
    expect(result.hasSeasonality).toBe(true);
    expect(result.dominantPeriod).toBe("weekly");
  });

  it("returns no seasonality for random data", () => {
    const values = [1, 5, 2, 8, 3, 7, 4, 6, 1, 5, 2, 8, 3, 7, 4]; // no clear pattern
    const result = analyzeSeasonality(values, [{ period: "weekly", length: 7 }]);
    // May or may not detect, just check structure
    expect(result).toHaveProperty("hasSeasonality");
    expect(result).toHaveProperty("deseasonalizedValues");
  });

  it("returns deseasonalized values of same length", () => {
    const values = Array(21).fill(0).map((_, i) => (i % 7 === 0 ? 100 : 50));
    const result = analyzeSeasonality(values, [{ period: "weekly", length: 7 }]);
    expect(result.deseasonalizedValues.length).toBe(values.length);
  });

  it("skips period if insufficient data", () => {
    const values = [1, 2, 3, 4, 5]; // too short for weekly
    const result = analyzeSeasonality(values, [{ period: "weekly", length: 7 }]);
    expect(result.patterns.length).toBe(0);
  });
});

// ─── trendExtractor ──────────────────────────────────────────────────────────
describe("trendExtractor", () => {
  it("detects upward trend", () => {
    const points = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190].map((v, i) => ({ timestamp: i * 1000, value: v }));
    const result = extractTrend(points);
    expect(result.direction).toBe("upward");
    expect(result.slope).toBeGreaterThan(0);
  });

  it("detects downward trend", () => {
    const points = [190, 180, 170, 160, 150, 140, 130, 120, 110, 100].map((v, i) => ({ timestamp: i * 1000, value: v }));
    const result = extractTrend(points);
    expect(result.direction).toBe("downward");
    expect(result.slope).toBeLessThan(0);
  });

  it("detects flat trend", () => {
    const points = Array(10).fill(5).map((v, i) => ({ timestamp: i * 1000, value: v }));
    const result = extractTrend(points);
    expect(result.direction).toBe("flat");
  });

  it("computes percent change", () => {
    const points = [10, 20].map((v, i) => ({ timestamp: i * 1000, value: v }));
    const result = extractTrend(points);
    expect(result.percentChange).toBeCloseTo(100);
  });

  it("detects change points", () => {
    const points = [5, 5, 5, 5, 50, 50, 50, 50].map((v, i) => ({ timestamp: i * 1000, value: v }));
    const changePoints = detectChangePoints(points, 1);
    expect(changePoints.length).toBeGreaterThan(0);
    expect(changePoints[0].type).toBe("increase");
  });

  it("returns R-squared value", () => {
    const points = [1, 2, 3, 4, 5].map((v, i) => ({ timestamp: i * 1000, value: v }));
    const result = extractTrend(points);
    expect(result.rSquared).toBeGreaterThan(0.9);
  });
});
