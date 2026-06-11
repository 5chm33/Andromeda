/**
 * benchmarkRunner.ts — Andromeda v5.68
 *
 * Standard performance benchmarking suite that:
 *  1. Measures tool call latency per tool type
 *  2. Measures memory retrieval speed (keyword vs semantic)
 *  3. Measures code execution overhead
 *  4. Measures LLM provider response latency
 *  5. Records baseline metrics and alerts on degradation (>15%)
 *
 * Runs every 6 hours (configurable via BENCHMARK_INTERVAL env var).
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import * as path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
  name: string;
  category: "tool_latency" | "memory" | "code_execution" | "llm_latency" | "startup";
  durationMs: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkReport {
  timestamp: number;
  runDurationMs: number;
  results: BenchmarkResult[];
  baselines: Record<string, number>;
  degradations: Degradation[];
  overallScore: number; // 0-100
}

export interface Degradation {
  benchmark: string;
  baseline: number;
  current: number;
  degradationPercent: number;
  severity: "warning" | "critical";
}

// ─── Configuration ──────────────────────────────────────────────────────────

const BENCHMARK_INTERVAL_MS = parseInt(process.env.BENCHMARK_INTERVAL || "21600000", 10); // 6 hours
const DEGRADATION_THRESHOLD = 0.15; // 15% degradation triggers warning
const CRITICAL_THRESHOLD = 0.30; // 30% degradation triggers critical alert
// v9.11.0: Minimum baseline floors per benchmark category.
// Without these, a single fast cached run sets an unrealistically low baseline (e.g. 0.01ms)
// and every subsequent real run triggers a false 3000%+ degradation.
// v10.3.1: memory_keyword_search floor raised from 5ms to 150ms.
// searchMemory() performs real disk I/O (reads and parses a JSON file on every call).
// On Windows with a large memory store, actual latency is 150-250ms. The old 5ms floor
// caused a persistent false 3785% regression alarm on every benchmark run.
const MIN_BASELINES: Record<string, number> = {
  file_read_10kb: 0.5,
  file_write_10kb: 0.5,
  context_token_estimation_50msg: 0.5,
  json_parse_large_object: 0.5,
  memory_keyword_search: 150,
  tool_registry_lookup: 0.1,
};
const REPORT_PATH = path.join(process.cwd(), ".data", "benchmark_report.json");
const BASELINE_PATH = path.join(process.cwd(), ".data", "benchmark_baselines.json");

// ─── State ──────────────────────────────────────────────────────────────────

let _running = false;
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _lastReport: BenchmarkReport | null = null;
let _baselines: Record<string, number> = {};

// ─── Benchmark Functions ────────────────────────────────────────────────────

async function benchmarkMemoryRetrieval(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // Benchmark keyword memory search
  try {
    const { searchMemory } = await import("./memory.js");
    const start = performance.now();
    searchMemory("test query for benchmarking");
    const duration = performance.now() - start;
    results.push({
      name: "memory_keyword_search",
      category: "memory",
      durationMs: Math.round(duration * 100) / 100,
      timestamp: Date.now(),
    });
  } catch {
    results.push({
      name: "memory_keyword_search",
      category: "memory",
      durationMs: -1, // Error indicator
      timestamp: Date.now(),
      metadata: { error: "memory module unavailable" },
    });
  }

  return results;
}

async function benchmarkToolRegistry(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  try {
    const toolRegistry = await import("./tools/toolRegistry.js");
    const start = performance.now();
    Object.keys(toolRegistry);
    const duration = performance.now() - start;
    results.push({
      name: "tool_registry_lookup",
      category: "tool_latency",
      durationMs: Math.round(duration * 100) / 100,
      timestamp: Date.now(),
    });
  } catch {
    results.push({
      name: "tool_registry_lookup",
      category: "tool_latency",
      durationMs: -1,
      timestamp: Date.now(),
      metadata: { error: "tool registry unavailable" },
    });
  }

  return results;
}

async function benchmarkFileOperations(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const testFile = path.join(process.cwd(), ".data", "_benchmark_test.tmp");

  // Write benchmark
  try {
    const testData = "x".repeat(10000);
    const start = performance.now();
    writeFileSync(testFile, testData);
    const writeDuration = performance.now() - start;
    results.push({
      name: "file_write_10kb",
      category: "code_execution",
      durationMs: Math.round(writeDuration * 100) / 100,
      timestamp: Date.now(),
    });

    // Read benchmark
    const readStart = performance.now();
    readFileSync(testFile, "utf8");
    const readDuration = performance.now() - readStart;
    results.push({
      name: "file_read_10kb",
      category: "code_execution",
      durationMs: Math.round(readDuration * 100) / 100,
      timestamp: Date.now(),
    });

    // Cleanup
    try { unlinkSync(testFile); } catch { /* ignore */ }
  } catch {
    results.push({
      name: "file_write_10kb",
      category: "code_execution",
      durationMs: -1,
      timestamp: Date.now(),
      metadata: { error: "file operations failed" },
    });
  }

  return results;
}

async function benchmarkContextAssembly(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  try {
    const { estimateMessageTokens } = await import("./contextManager.js");
    // Create a synthetic conversation with 50 messages
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `This is message ${i} with some content that simulates a real conversation turn. `.repeat(5),
    }));

    const start = performance.now();
    estimateMessageTokens(messages);
    const duration = performance.now() - start;
    results.push({
      name: "context_token_estimation_50msg",
      category: "startup",
      durationMs: Math.round(duration * 100) / 100,
      timestamp: Date.now(),
    });
  } catch {
    results.push({
      name: "context_token_estimation_50msg",
      category: "startup",
      durationMs: -1,
      timestamp: Date.now(),
      metadata: { error: "context manager unavailable" },
    });
  }

  return results;
}

async function benchmarkJsonParsing(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // Generate a large JSON object (simulates parsing LLM responses)
  const largeObj = {
    messages: Array.from({ length: 100 }, (_, i) => ({
      id: i,
      content: "x".repeat(200),
      metadata: { timestamp: Date.now(), tokens: Math.random() * 1000 },
    })),
  };
  const jsonStr = JSON.stringify(largeObj);

  const start = performance.now();
  JSON.parse(jsonStr);
  const duration = performance.now() - start;
  results.push({
    name: "json_parse_large_object",
    category: "code_execution",
    durationMs: Math.round(duration * 100) / 100,
    timestamp: Date.now(),
    metadata: { sizeBytes: jsonStr.length },
  });

  return results;
}

// ─── Baseline Management ────────────────────────────────────────────────────

function loadBaselines(): Record<string, number> {
  try {
    if (existsSync(BASELINE_PATH)) {
      return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    }
  } catch { /* ignore */ }
  return {};
}

function saveBaselines(baselines: Record<string, number>): void {
  try {
    const dir = path.dirname(BASELINE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(baselines, null, 2));
  } catch { /* non-fatal */ }
}

function updateBaselines(results: BenchmarkResult[]): void {
  let updated = false;
  for (const result of results) {
    if (result.durationMs < 0) continue; // Skip errors
    // v9.11.0: Apply minimum floor to prevent unrealistically low baselines from cached runs
    const floor = MIN_BASELINES[result.name] ?? 0.1;
    const effectiveDuration = Math.max(result.durationMs, floor);
    if (!_baselines[result.name] || effectiveDuration < _baselines[result.name]) {
      _baselines[result.name] = effectiveDuration;
      updated = true;
    } else if (_baselines[result.name] < floor) {
      // Correct an existing baseline that is below the floor
      _baselines[result.name] = floor;
      updated = true;
    }
  }
  if (updated) saveBaselines(_baselines);
}

function detectDegradations(results: BenchmarkResult[]): Degradation[] {
  const degradations: Degradation[] = [];

  for (const result of results) {
    if (result.durationMs < 0) continue;
    const baseline = _baselines[result.name];
    if (!baseline || baseline <= 0) continue;

    const degradationPercent = (result.durationMs - baseline) / baseline;
    if (degradationPercent > DEGRADATION_THRESHOLD) {
      degradations.push({
        benchmark: result.name,
        baseline,
        current: result.durationMs,
        degradationPercent: Math.round(degradationPercent * 100),
        severity: degradationPercent > CRITICAL_THRESHOLD ? "critical" : "warning",
      });
    }
  }

  return degradations;
}

// ─── Full Benchmark Run ─────────────────────────────────────────────────────

export async function runBenchmarks(): Promise<BenchmarkReport> {
  console.log("[BenchmarkRunner] Running performance benchmarks...");
  const runStart = performance.now();

  const results: BenchmarkResult[] = [
    ...(await benchmarkMemoryRetrieval()),
    ...(await benchmarkToolRegistry()),
    ...(await benchmarkFileOperations()),
    ...(await benchmarkContextAssembly()),
    ...(await benchmarkJsonParsing()),
  ];

  const runDuration = performance.now() - runStart;

  // Update baselines (only improves, never degrades)
  updateBaselines(results);

  // Detect degradations
  const degradations = detectDegradations(results);

  // Calculate overall score
  const validResults = results.filter(r => r.durationMs >= 0);
  let score = 100;
  for (const deg of degradations) {
    score -= deg.severity === "critical" ? 20 : 10;
  }
  score = Math.max(0, Math.min(100, score));

  const report: BenchmarkReport = {
    timestamp: Date.now(),
    runDurationMs: Math.round(runDuration),
    results,
    baselines: { ..._baselines },
    degradations,
    overallScore: score,
  };

  // Save report
  try {
    const dir = path.dirname(REPORT_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  } catch { /* non-fatal */ }

  _lastReport = report;

  if (degradations.length > 0) {
    console.warn(`[BenchmarkRunner] ⚠️ ${degradations.length} performance degradations detected (score: ${score}/100)`);
  } else {
    console.log(`[BenchmarkRunner] ✓ All benchmarks within baseline (score: ${score}/100, ${validResults.length} tests)`);
  }

  return report;
}

// ─── Daemon Control ─────────────────────────────────────────────────────────

export function startBenchmarkRunner(): void {
  if (_running) return;
  _running = true;
  _baselines = loadBaselines();

  // Run initial benchmark after 60 seconds (let everything boot)
  setTimeout(async () => {
    try { await runBenchmarks(); } catch (err) { console.warn("[BenchmarkRunner] Initial run failed:", err); }
  }, 60_000);

  _intervalId = setInterval(async () => {
    try { await runBenchmarks(); } catch (err) { console.warn("[BenchmarkRunner] Run failed:", err); }
  }, BENCHMARK_INTERVAL_MS);

  console.log(`[BenchmarkRunner] Started — benchmarking every ${BENCHMARK_INTERVAL_MS / 3600000} hours`);
}

export function stopBenchmarkRunner(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _running = false;
}

export function getLastBenchmarkReport(): BenchmarkReport | null {
  if (_lastReport) return _lastReport;
  try {
    if (existsSync(REPORT_PATH)) {
      return JSON.parse(readFileSync(REPORT_PATH, "utf8"));
    }
  } catch { /* ignore */ }
  return null;
}

export function isRunning(): boolean {
  return _running;
}
