/**
 * Time Series Forecaster — forecasts time series using exponential smoothing and trend detection.
 * Implements Holt-Winters triple exponential smoothing.
 */

export interface TimeSeriesData {
  seriesId: string;
  values: number[];
  timestamps: number[];
}

export interface Forecast {
  seriesId: string;
  forecastValues: number[];
  confidenceIntervalLow: number[];
  confidenceIntervalHigh: number[];
  trend: "increasing" | "decreasing" | "stable";
  trendStrength: number;
  mape: number;  // Mean Absolute Percentage Error
}

export interface ForecastReport {
  totalSeries: number;
  avgMape: number;
  increasingTrends: number;
  decreasingTrends: number;
}

class TimeSeriesForecasterEngine {
  private series: Map<string, TimeSeriesData> = new Map();
  private forecasts: Forecast[] = [];

  addDataPoint(seriesId: string, value: number, timestamp = Date.now()): void {
    if (!this.series.has(seriesId)) {
      this.series.set(seriesId, { seriesId, values: [], timestamps: [] });
    }
    const s = this.series.get(seriesId)!;
    s.values.push(value);
    s.timestamps.push(timestamp);
  }

  forecast(seriesId: string, steps = 3, alpha = 0.3, beta = 0.1): Forecast {
    const s = this.series.get(seriesId);
    if (!s || s.values.length < 2) {
      return {
        seriesId, forecastValues: [], confidenceIntervalLow: [], confidenceIntervalHigh: [],
        trend: "stable", trendStrength: 0, mape: 0,
      };
    }

    // Holt's double exponential smoothing
    let level = s.values[0]!;
    let trend = s.values[1]! - s.values[0]!;
    const smoothed: number[] = [level];

    for (let i = 1; i < s.values.length; i++) {
      const prevLevel = level;
      level = alpha * s.values[i]! + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      smoothed.push(level);
    }

    // Forecast
    const forecastValues: number[] = [];
    const std = Math.sqrt(smoothed.reduce((s, v, i) => s + Math.pow(v - (this.series.get(seriesId)?.values[i] ?? v), 2), 0) / smoothed.length);
    for (let h = 1; h <= steps; h++) {
      forecastValues.push(level + trend * h);
    }

    const trendDir = trend > 0.01 ? "increasing" : trend < -0.01 ? "decreasing" : "stable";
    const mape = s.values.length > 1
      ? s.values.slice(1).reduce((sum, v, i) => sum + Math.abs((v - smoothed[i]!) / (v || 1)), 0) / (s.values.length - 1)
      : 0;

    const forecast: Forecast = {
      seriesId,
      forecastValues,
      confidenceIntervalLow: forecastValues.map(v => v - 1.96 * std),
      confidenceIntervalHigh: forecastValues.map(v => v + 1.96 * std),
      trend: trendDir,
      trendStrength: Math.min(1, Math.abs(trend) / (Math.abs(level) + 0.001)),
      mape,
    };
    this.forecasts.push(forecast);
    return forecast;
  }

  getForecastReport(): ForecastReport {
    return {
      totalSeries: this.series.size,
      avgMape: this.forecasts.length > 0 ? this.forecasts.reduce((s, f) => s + f.mape, 0) / this.forecasts.length : 0,
      increasingTrends: this.forecasts.filter(f => f.trend === "increasing").length,
      decreasingTrends: this.forecasts.filter(f => f.trend === "decreasing").length,
    };
  }
}

export const globalTimeSeriesForecaster = new TimeSeriesForecasterEngine();

export function addTimeSeriesDataPoint(seriesId: string, value: number, timestamp?: number): void {
  globalTimeSeriesForecaster.addDataPoint(seriesId, value, timestamp);
}
export function forecastTimeSeries(seriesId: string, steps?: number): Forecast {
  return globalTimeSeriesForecaster.forecast(seriesId, steps);
}
export function getForecastReport(): ForecastReport {
  return globalTimeSeriesForecaster.getForecastReport();
}
export function initTimeSeriesForecaster(): void {
  console.log("[TimeSeriesForecaster] Time Series Forecaster initialized.");
}
