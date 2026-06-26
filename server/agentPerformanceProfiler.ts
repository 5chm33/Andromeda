/**
 * agentPerformanceProfiler.ts — v48.0.0
 *
 * Collects and analyzes performance metrics for sub-agents:
 * latency histograms, throughput rates, error rates, and SLA compliance.
 */

export interface PerformanceSample {
  agentId: string;
  operation: string;
  durationMs: number;
  success: boolean;
  timestamp: number;
}

export interface PerformanceReport {
  agentId: string;
  operation: string;
  sampleCount: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  successRate: number;
  throughputPerMin: number;
}

const samples: PerformanceSample[] = [];

export function recordSample(agentId: string, operation: string, durationMs: number, success: boolean): void {
  samples.push({ agentId, operation, durationMs, success, timestamp: Date.now() });
}

export function getReport(agentId: string, operation?: string): PerformanceReport | null {
  const filtered = samples.filter(s =>
    s.agentId === agentId && (operation === undefined || s.operation === operation)
  );
  if (filtered.length === 0) return null;

  const op = operation ?? "all";
  const durations = filtered.map(s => s.durationMs).sort((a, b) => a - b);
  const successes = filtered.filter(s => s.success).length;

  const p = (pct: number): number => {
    const idx = Math.floor((pct / 100) * (durations.length - 1));
    return durations[idx];
  };

  const windowMs = 60000;
  const now = Date.now();
  const recentCount = filtered.filter(s => now - s.timestamp < windowMs).length;

  return {
    agentId,
    operation: op,
    sampleCount: filtered.length,
    avgLatencyMs: Math.round(durations.reduce((s, d) => s + d, 0) / durations.length),
    p50Ms: p(50),
    p95Ms: p(95),
    p99Ms: p(99),
    successRate: Math.round((successes / filtered.length) * 1000) / 1000,
    throughputPerMin: recentCount,
  };
}

export function getTopPerformers(metric: "latency" | "throughput" | "successRate", limit = 5): string[] {
  const agentIds = [...new Set(samples.map(s => s.agentId))];
  const reports = agentIds.map(id => getReport(id)).filter(Boolean) as PerformanceReport[];

  reports.sort((a, b) => {
    if (metric === "latency") return a.avgLatencyMs - b.avgLatencyMs;
    if (metric === "throughput") return b.throughputPerMin - a.throughputPerMin;
    return b.successRate - a.successRate;
  });

  return reports.slice(0, limit).map(r => r.agentId);
}

export function getSLACompliance(agentId: string, slaLatencyMs: number): number {
  const agentSamples = samples.filter(s => s.agentId === agentId);
  if (agentSamples.length === 0) return 1.0;
  const compliant = agentSamples.filter(s => s.durationMs <= slaLatencyMs).length;
  return Math.round((compliant / agentSamples.length) * 1000) / 1000;
}

export function _resetProfilerForTest(): void {
  samples.length = 0;
}
