/**
 * apiPerformanceBenchmarker.ts — v53.0.0
 *
 * Benchmarks API endpoint performance: latency distributions,
 * throughput measurement, and regression detection.
 */

export interface BenchmarkRun {
  runId: string;
  apiId: string;
  endpoint: string;
  samples: number[];    // latency in ms per request
  concurrency: number;
  runAt: number;
}

export interface BenchmarkReport {
  apiId: string;
  endpoint: string;
  sampleCount: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  throughputRps: number;
  regressionDetected: boolean;
  baselineAvgMs?: number;
}

const runs = new Map<string, BenchmarkRun[]>();
const baselines = new Map<string, number>();
let runCounter = 0;

export function recordBenchmarkRun(apiId: string, endpoint: string, samples: number[], concurrency = 1): BenchmarkRun {
  const run: BenchmarkRun = {
    runId: `bench-${++runCounter}`,
    apiId,
    endpoint,
    samples,
    concurrency,
    runAt: Date.now(),
  };
  const key = `${apiId}:${endpoint}`;
  if (!runs.has(key)) runs.set(key, []);
  runs.get(key)!.push(run);
  return run;
}

export function setBaseline(apiId: string, endpoint: string, avgMs: number): void {
  baselines.set(`${apiId}:${endpoint}`, avgMs);
}

export function getBenchmarkReport(apiId: string, endpoint: string): BenchmarkReport | null {
  const key = `${apiId}:${endpoint}`;
  const allRuns = runs.get(key);
  if (!allRuns || allRuns.length === 0) return null;

  const latest = allRuns[allRuns.length - 1];
  const sorted = [...latest.samples].sort((a, b) => a - b);
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const totalMs = sorted.reduce((s, v) => s + v, 0);
  const throughputRps = totalMs > 0 ? (sorted.length * 1000) / totalMs : 0;

  const baseline = baselines.get(key);
  const regressionDetected = baseline !== undefined && avg > baseline * 1.2; // 20% regression threshold

  return {
    apiId,
    endpoint,
    sampleCount: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    avgMs: avg,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    p99Ms: sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1],
    throughputRps,
    regressionDetected,
    baselineAvgMs: baseline,
  };
}

export function _resetBenchmarkerForTest(): void {
  runs.clear();
  baselines.clear();
  runCounter = 0;
}
