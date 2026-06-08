/**
 * telemetry.ts — v7.0
 *
 * Performance Telemetry for Andromeda.
 *
 * Tracks and exposes real-time performance metrics across all subsystems:
 *   - Request latency (p50, p95, p99) per endpoint
 *   - RSI cycle throughput and duration trends
 *   - LLM call latency and token usage
 *   - Eval run scores over time
 *   - Memory and CPU snapshots
 *   - Error rates per module
 *
 * Storage: in-memory ring buffer (no disk I/O overhead)
 * Exposes: /api/telemetry/metrics, /api/telemetry/summary
 */

import { createLogger } from "./logger.js";

const log = createLogger("telemetry");

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LatencySample {
  endpoint: string;
  method: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
}

export interface RsiCycleSample {
  cycleId: string;
  durationMs: number;
  proposalsGenerated: number;
  proposalsApplied: number;
  evalScore: number | null;
  timestamp: number;
}

export interface LlmCallSample {
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  success: boolean;
  timestamp: number;
}

export interface EvalScoreSample {
  runId: string;
  percentage: number;
  passed: number;
  failed: number;
  durationMs: number;
  adaptive: boolean;
  timestamp: number;
}

export interface ErrorSample {
  module: string;
  error: string;
  timestamp: number;
}

export interface PercentileStats {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  count: number;
}

export interface TelemetrySummary {
  uptime: number;
  requestLatency: Record<string, PercentileStats>;
  rsiCycles: {
    total: number;
    avgDurationMs: number;
    avgProposalsGenerated: number;
    avgProposalsApplied: number;
    avgEvalScore: number | null;
  };
  llmCalls: {
    total: number;
    successRate: number;
    avgDurationMs: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    byModel: Record<string, { count: number; avgDurationMs: number; successRate: number }>;
  };
  evalScores: {
    total: number;
    latestScore: number | null;
    avgScore: number;
    trend: "improving" | "stable" | "declining" | "insufficient_data";
  };
  errors: {
    total: number;
    recentErrors: ErrorSample[];
    byModule: Record<string, number>;
  };
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
  };
}

// ── Ring Buffers ───────────────────────────────────────────────────────────────

const MAX_LATENCY_SAMPLES = 1000;
const MAX_RSI_SAMPLES = 200;
const MAX_LLM_SAMPLES = 500;
const MAX_EVAL_SAMPLES = 100;
const MAX_ERROR_SAMPLES = 200;

const latencySamples: LatencySample[] = [];
const rsiCycleSamples: RsiCycleSample[] = [];
const llmCallSamples: LlmCallSample[] = [];
const evalScoreSamples: EvalScoreSample[] = [];
const errorSamples: ErrorSample[] = [];

const startedAt = Date.now();

// ── Record Functions ───────────────────────────────────────────────────────────

/** Records an HTTP request latency sample. Automatically stamps the current timestamp. */
export function recordLatency(sample: Omit<LatencySample, "timestamp">): void {
  latencySamples.push({ ...sample, timestamp: Date.now() });
  if (latencySamples.length > MAX_LATENCY_SAMPLES) latencySamples.shift();
}

/** Records a completed RSI cycle sample including proposals generated/applied and duration. */
export function recordRsiCycle(sample: Omit<RsiCycleSample, "timestamp">): void {
  rsiCycleSamples.push({ ...sample, timestamp: Date.now() });
  if (rsiCycleSamples.length > MAX_RSI_SAMPLES) rsiCycleSamples.shift();
}

/** Records an LLM API call sample including model, tokens, latency, and cost. */
export function recordLlmCall(sample: Omit<LlmCallSample, "timestamp">): void {
  llmCallSamples.push({ ...sample, timestamp: Date.now() });
  if (llmCallSamples.length > MAX_LLM_SAMPLES) llmCallSamples.shift();
}

/** Records an evaluation score sample for a specific benchmark and model. */
export function recordEvalScore(sample: Omit<EvalScoreSample, "timestamp">): void {
  evalScoreSamples.push({ ...sample, timestamp: Date.now() });
  if (evalScoreSamples.length > MAX_EVAL_SAMPLES) evalScoreSamples.shift();
}

/**
 * Records a runtime error for a specific module.
 * @param module The module name where the error occurred
 * @param error The error message string
 */
export function recordError(module: string, error: string): void {
  errorSamples.push({ module, error, timestamp: Date.now() });
  if (errorSamples.length > MAX_ERROR_SAMPLES) errorSamples.shift();
}

// ── Stats Helpers ──────────────────────────────────────────────────────────────

function percentiles(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct: number) => sorted[Math.min(Math.floor(n * pct), n - 1)];
  const avg = sorted.reduce((a, b) => a + b, 0) / n;
  return {
    p50: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
    min: sorted[0],
    max: sorted[n - 1],
    avg: Math.round(avg),
    count: n,
  };
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ── Summary ────────────────────────────────────────────────────────────────────

/**
 * Returns a comprehensive telemetry summary including latency percentiles,
 * RSI cycle stats, LLM call costs, eval score trends, and recent errors.
 */
export function getTelemetrySummary(): TelemetrySummary {
  // Request latency by endpoint
  const endpointGroups: Record<string, number[]> = {};
  for (const s of latencySamples) {
    const key = `${s.method} ${s.endpoint}`;
    if (!endpointGroups[key]) endpointGroups[key] = [];
    endpointGroups[key].push(s.durationMs);
  }
  const requestLatency: Record<string, PercentileStats> = {};
  for (const [key, vals] of Object.entries(endpointGroups)) {
    requestLatency[key] = percentiles(vals);
  }

  // RSI cycles
  const rsiTotal = rsiCycleSamples.length;
  const rsiAvgDuration = Math.round(avg(rsiCycleSamples.map(s => s.durationMs)));
  const rsiAvgProposalsGen = Math.round(avg(rsiCycleSamples.map(s => s.proposalsGenerated)));
  const rsiAvgProposalsApp = Math.round(avg(rsiCycleSamples.map(s => s.proposalsApplied)));
  const evalScoresFromRsi = rsiCycleSamples.filter(s => s.evalScore !== null).map(s => s.evalScore as number);
  const rsiAvgEvalScore = evalScoresFromRsi.length > 0 ? Math.round(avg(evalScoresFromRsi)) : null;

  // LLM calls
  const llmTotal = llmCallSamples.length;
  const llmSuccessCount = llmCallSamples.filter(s => s.success).length;
  const llmSuccessRate = llmTotal > 0 ? llmSuccessCount / llmTotal : 1;
  const llmAvgDuration = Math.round(avg(llmCallSamples.map(s => s.durationMs)));
  const llmTotalPrompt = llmCallSamples.reduce((a, s) => a + s.promptTokens, 0);
  const llmTotalCompletion = llmCallSamples.reduce((a, s) => a + s.completionTokens, 0);

  const llmByModel: Record<string, { count: number; avgDurationMs: number; successRate: number }> = {};
  for (const s of llmCallSamples) {
    if (!llmByModel[s.model]) llmByModel[s.model] = { count: 0, avgDurationMs: 0, successRate: 0 };
    const m = llmByModel[s.model];
    const prevTotal = m.count * m.avgDurationMs;
    m.count++;
    m.avgDurationMs = Math.round((prevTotal + s.durationMs) / m.count);
    m.successRate = (m.successRate * (m.count - 1) + (s.success ? 1 : 0)) / m.count;
  }

  // Eval scores
  const evalTotal = evalScoreSamples.length;
  const latestScore = evalTotal > 0 ? evalScoreSamples[evalTotal - 1].percentage : null;
  const evalAvgScore = Math.round(avg(evalScoreSamples.map(s => s.percentage)));

  let evalTrend: TelemetrySummary["evalScores"]["trend"] = "insufficient_data";
  if (evalTotal >= 3) {
    const recent = evalScoreSamples.slice(-3).map(s => s.percentage);
    const older = evalScoreSamples.slice(-6, -3).map(s => s.percentage);
    if (older.length > 0) {
      const recentAvg = avg(recent);
      const olderAvg = avg(older);
      const delta = recentAvg - olderAvg;
      evalTrend = delta > 2 ? "improving" : delta < -2 ? "declining" : "stable";
    } else {
      evalTrend = "stable";
    }
  }

  // Errors
  const errorTotal = errorSamples.length;
  const recentErrors = errorSamples.slice(-10);
  const errorsByModule: Record<string, number> = {};
  for (const e of errorSamples) {
    errorsByModule[e.module] = (errorsByModule[e.module] ?? 0) + 1;
  }

  // Memory
  const mem = process.memoryUsage();
  const toMb = (b: number) => Math.round(b / 1024 / 1024 * 10) / 10;

  return {
    uptime: Date.now() - startedAt,
    requestLatency,
    rsiCycles: {
      total: rsiTotal,
      avgDurationMs: rsiAvgDuration,
      avgProposalsGenerated: rsiAvgProposalsGen,
      avgProposalsApplied: rsiAvgProposalsApp,
      avgEvalScore: rsiAvgEvalScore,
    },
    llmCalls: {
      total: llmTotal,
      successRate: Math.round(llmSuccessRate * 1000) / 1000,
      avgDurationMs: llmAvgDuration,
      totalPromptTokens: llmTotalPrompt,
      totalCompletionTokens: llmTotalCompletion,
      byModel: llmByModel,
    },
    evalScores: {
      total: evalTotal,
      latestScore,
      avgScore: evalAvgScore,
      trend: evalTrend,
    },
    errors: {
      total: errorTotal,
      recentErrors,
      byModule: errorsByModule,
    },
    memory: {
      heapUsedMb: toMb(mem.heapUsed),
      heapTotalMb: toMb(mem.heapTotal),
      rssMb: toMb(mem.rss),
    },
  };
}

/** Returns the raw telemetry sample arrays (last 50-100 entries each) for debugging. */
export function getRawSamples() {
  return {
    latency: latencySamples.slice(-100),
    rsiCycles: rsiCycleSamples.slice(-50),
    llmCalls: llmCallSamples.slice(-100),
    evalScores: evalScoreSamples.slice(-50),
    errors: errorSamples.slice(-50),
  };
}

// ── Express Middleware ─────────────────────────────────────────────────────────

/**
 * Returns an Express middleware function that automatically records HTTP request latency.
 * Normalizes path parameters (e.g. `/api/session/abc123` → `/api/session/:id`).
 */
export function telemetryMiddleware() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    res.on("finish", () => {
      // Normalize endpoint path (strip IDs)
      const endpoint = req.path.replace(/\/[0-9a-f-]{8,}/gi, "/:id");
      recordLatency({
        endpoint,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      });
    });
    next();
  };
}

// ── Init ───────────────────────────────────────────────────────────────────────

/** Initializes the telemetry system. Called once at server startup. */
export function initTelemetry(): void {
  log.info("[telemetry] Performance telemetry initialized");
}
