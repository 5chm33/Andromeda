/**
 * metricsAggregator.ts — v70.0.0 "Observability Stack"
 * Time-series metrics aggregation with counters, gauges, histograms, and rollups.
 */
export type MetricType = "counter" | "gauge" | "histogram";
export interface MetricPoint { value: number; timestamp: number; labels: Record<string, string>; }
export interface MetricSeries { name: string; type: MetricType; points: MetricPoint[]; }
export interface AggregatedMetric { name: string; min: number; max: number; avg: number; sum: number; count: number; p50: number; p95: number; p99: number; }

const series = new Map<string, MetricSeries>();

export function recordMetric(name: string, type: MetricType, value: number, labels: Record<string, string> = {}): void {
  if (!series.has(name)) series.set(name, { name, type, points: [] });
  series.get(name)!.points.push({ value, timestamp: Date.now(), labels });
}

export function aggregateMetric(name: string, windowMs?: number): AggregatedMetric | null {
  const s = series.get(name);
  if (!s || s.points.length === 0) return null;
  const cutoff = windowMs ? Date.now() - windowMs : 0;
  const pts = s.points.filter(p => p.timestamp >= cutoff).map(p => p.value).sort((a, b) => a - b);
  if (pts.length === 0) return null;
  const sum = pts.reduce((a, b) => a + b, 0);
  const p = (pct: number) => pts[Math.floor(pts.length * pct / 100)] ?? pts[pts.length - 1];
  return { name, min: pts[0], max: pts[pts.length - 1], avg: sum / pts.length, sum, count: pts.length, p50: p(50), p95: p(95), p99: p(99) };
}

export function getMetricNames(): string[] { return [...series.keys()]; }
export function _resetMetricsAggregatorForTest(): void { series.clear(); }
