/**
 * timeSeriesStore.ts — v83.0.0 "Time Series & Forecasting"
 * Stores and retrieves time series data points with efficient range queries.
 */
export interface DataPoint {
  timestamp: number;
  value: number;
  tags: Record<string, string>;
}

export interface TimeSeries {
  seriesId: string;
  name: string;
  unit: string;
  dataPoints: DataPoint[];
  createdAt: number;
  lastUpdated: number;
}

export interface RangeQueryResult {
  seriesId: string;
  points: DataPoint[];
  count: number;
  min: number;
  max: number;
  mean: number;
  sum: number;
}

const store = new Map<string, TimeSeries>();
let seriesCounter = 0;

export function createSeries(name: string, unit: string): TimeSeries {
  const series: TimeSeries = {
    seriesId: `ts-${++seriesCounter}`,
    name, unit,
    dataPoints: [],
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  };
  store.set(series.seriesId, series);
  return series;
}

export function appendDataPoint(seriesId: string, value: number, timestamp = Date.now(), tags: Record<string, string> = {}): boolean {
  const series = store.get(seriesId);
  if (!series) return false;
  series.dataPoints.push({ timestamp, value, tags });
  series.dataPoints.sort((a, b) => a.timestamp - b.timestamp);
  series.lastUpdated = Date.now();
  return true;
}

export function queryRange(seriesId: string, fromTimestamp: number, toTimestamp: number): RangeQueryResult | null {
  const series = store.get(seriesId);
  if (!series) return null;
  const points = series.dataPoints.filter(p => p.timestamp >= fromTimestamp && p.timestamp <= toTimestamp);
  if (points.length === 0) return { seriesId, points: [], count: 0, min: 0, max: 0, mean: 0, sum: 0 };
  const values = points.map(p => p.value);
  const sum = values.reduce((s, v) => s + v, 0);
  return { seriesId, points, count: points.length, min: Math.min(...values), max: Math.max(...values), mean: sum / points.length, sum };
}

export function getSeries(seriesId: string): TimeSeries | undefined { return store.get(seriesId); }
export function getLatestValue(seriesId: string): DataPoint | null {
  const series = store.get(seriesId);
  if (!series || series.dataPoints.length === 0) return null;
  return series.dataPoints[series.dataPoints.length - 1];
}
export function _resetTimeSeriesStoreForTest(): void { store.clear(); seriesCounter = 0; }
