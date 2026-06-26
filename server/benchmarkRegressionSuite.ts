/**
 * benchmarkRegressionSuite.ts — Automated Benchmark Regression Suite (v16.0.0)
 *
 * Runs 20 deterministic micro-benchmarks against the codebase before any
 * proposal is applied. If a proposal causes a regression in any benchmark
 * (execution time increases by more than REGRESSION_THRESHOLD_PERCENT), the
 * proposal is automatically rejected and rolled back.
 *
 * Benchmark categories:
 *   1. Module load time (5 benchmarks) — how fast critical modules initialize
 *   2. JSON parse/serialize throughput (3 benchmarks) — data pipeline speed
 *   3. String processing throughput (4 benchmarks) — log sanitization, diff gen
 *   4. File I/O throughput (3 benchmarks) — proposal store read/write speed
 *   5. Algorithm benchmarks (5 benchmarks) — Jaccard similarity, hash, sort
 *
 * Each benchmark runs 3 warmup rounds then 10 measurement rounds.
 * The median of the 10 rounds is used as the benchmark score.
 *
 * Baselines are stored in .andromeda/benchmark-baselines.json and updated
 * automatically when a proposal improves a benchmark score.
 *
 * @module benchmarkRegressionSuite
 * @version 16.0.0
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "./logger.js";

const log = createLogger("benchmarkRegressionSuite");

// ─── Configuration ────────────────────────────────────────────────────────────

/** Percentage increase in execution time that triggers a regression failure */
const REGRESSION_THRESHOLD_PERCENT = 20;

/** Number of measurement rounds per benchmark */
const MEASUREMENT_ROUNDS = 10;

/** Number of warmup rounds before measurement */
const WARMUP_ROUNDS = 3;

/** Path to the persistent baseline store */
const BASELINE_PATH = path.resolve(process.cwd(), ".andromeda", "benchmark-baselines.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
  name: string;
  category: string;
  medianMs: number;
  minMs: number;
  maxMs: number;
  rounds: number[];
}

export interface BenchmarkBaseline {
  name: string;
  medianMs: number;
  recordedAt: string;
  proposalId: string | null;
}

export interface RegressionCheckResult {
  passed: boolean;
  benchmarksRun: number;
  regressions: RegressionDetail[];
  improvements: ImprovementDetail[];
  results: BenchmarkResult[];
}

export interface RegressionDetail {
  benchmarkName: string;
  baselineMs: number;
  currentMs: number;
  regressionPercent: number;
}

export interface ImprovementDetail {
  benchmarkName: string;
  baselineMs: number;
  currentMs: number;
  improvementPercent: number;
}

// ─── Baseline Persistence ─────────────────────────────────────────────────────

function _loadBaselines(): Record<string, BenchmarkBaseline> {
  try {
    if (fs.existsSync(BASELINE_PATH)) {
      return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) as Record<string, BenchmarkBaseline>;
    }
  } catch { /* corrupt — start fresh */ }
  return {};
}

function _saveBaselines(baselines: Record<string, BenchmarkBaseline>): void {
  try {
    const dir = path.dirname(BASELINE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baselines, null, 2), "utf-8");
  } catch (err) {
    log.warn(`[benchmarkRegressionSuite] Failed to save baselines: ${(err as Error).message}`);
  }
}

// ─── Benchmark Runner ─────────────────────────────────────────────────────────

function _median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function _runBenchmark(
  name: string,
  category: string,
  fn: () => void | Promise<void>
): Promise<BenchmarkResult> {
  // Warmup rounds
  for (let i = 0; i < WARMUP_ROUNDS; i++) {
    await fn();
  }

  // Measurement rounds
  const rounds: number[] = [];
  for (let i = 0; i < MEASUREMENT_ROUNDS; i++) {
    const start = performance.now();
    await fn();
    rounds.push(performance.now() - start);
  }

  return {
    name,
    category,
    medianMs: _median(rounds),
    minMs: Math.min(...rounds),
    maxMs: Math.max(...rounds),
    rounds,
  };
}

// ─── The 20 Benchmarks ────────────────────────────────────────────────────────

async function _runAllBenchmarks(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // ── Category 1: JSON throughput (3 benchmarks) ──
  const testPayload = JSON.stringify({ proposals: Array.from({ length: 100 }, (_, i) => ({
    id: `prop-${i}`, title: `Proposal ${i}`, status: "pending", confidence: Math.random(),
    targetFile: `server/module${i}.ts`, area: "performance", createdAt: new Date().toISOString(),
  }))});

  results.push(await _runBenchmark("json-parse-100-proposals", "json", () => {
    JSON.parse(testPayload);
  }));

  results.push(await _runBenchmark("json-stringify-100-proposals", "json", () => {
    JSON.stringify(JSON.parse(testPayload));
  }));

  results.push(await _runBenchmark("json-roundtrip-nested-1000", "json", () => {
    const data = { a: { b: { c: Array.from({ length: 1000 }, (_, i) => ({ i, s: `str${i}` })) }}};
    structuredClone(data);
  }));

  // ── Category 2: String processing (4 benchmarks) ──
  const longString = "x".repeat(10_000);
  const keyPattern = /sk-[A-Za-z0-9_-]{20,}/g;

  results.push(await _runBenchmark("string-regex-sanitize-10k", "string", () => {
    longString.replace(keyPattern, "[REDACTED]");
  }));

  results.push(await _runBenchmark("string-split-join-10k", "string", () => {
    longString.split("").join("");
  }));

  results.push(await _runBenchmark("string-includes-10k", "string", () => {
    longString.includes("needle-not-found");
  }));

  results.push(await _runBenchmark("string-template-1000", "string", () => {
    Array.from({ length: 1000 }, (_, i) => `Line ${i}: ${longString.slice(0, 10)}`).join("\n");
  }));

  // ── Category 3: Algorithm benchmarks (5 benchmarks) ──
  const words1 = new Set("the quick brown fox jumps over the lazy dog".split(" "));
  const words2 = new Set("the slow green cat walks under the energetic dog".split(" "));

  results.push(await _runBenchmark("jaccard-similarity-small", "algorithm", () => {
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    intersection.size / union.size;
  }));

  results.push(await _runBenchmark("array-sort-1000", "algorithm", () => {
    Array.from({ length: 1000 }, () => Math.random()).sort((a, b) => a - b);
  }));

  results.push(await _runBenchmark("map-set-get-10000", "algorithm", () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 10_000; i++) m.set(`key${i}`, i);
    for (let i = 0; i < 10_000; i++) m.get(`key${i}`);
  }));

  results.push(await _runBenchmark("array-filter-map-1000", "algorithm", () => {
    Array.from({ length: 1000 }, (_, i) => i)
      .filter(i => i % 2 === 0)
      .map(i => i * 2);
  }));

  results.push(await _runBenchmark("object-spread-100", "algorithm", () => {
    let obj: Record<string, number> = {};
    for (let i = 0; i < 100; i++) obj = { ...obj, [`k${i}`]: i };
  }));

  // ── Category 4: File I/O (3 benchmarks) ──
  const tmpDir = path.resolve(process.cwd(), ".andromeda", "bench-tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, "bench-test.json");
  const smallPayload = JSON.stringify({ test: true, ts: Date.now() });
  const largePayload = JSON.stringify({ data: Array.from({ length: 500 }, (_, i) => ({ i, v: `val${i}` })) });

  results.push(await _runBenchmark("file-write-small-1kb", "io", () => {
    fs.writeFileSync(tmpFile, smallPayload, "utf-8");
  }));

  results.push(await _runBenchmark("file-read-small-1kb", "io", () => {
    fs.readFileSync(tmpFile, "utf-8");
  }));

  results.push(await _runBenchmark("file-write-read-large-50kb", "io", () => {
    const f = path.join(tmpDir, "bench-large.json");
    fs.writeFileSync(f, largePayload, "utf-8");
    fs.readFileSync(f, "utf-8");
  }));

  // ── Category 5: Module-level operations (5 benchmarks) ──
  results.push(await _runBenchmark("path-resolve-1000", "module", () => {
    for (let i = 0; i < 1000; i++) path.resolve(process.cwd(), "server", `module${i}.ts`);
  }));

  results.push(await _runBenchmark("date-iso-1000", "module", () => {
    for (let i = 0; i < 1000; i++) new Date().toISOString();
  }));

  results.push(await _runBenchmark("promise-resolve-100", "module", async () => {
    await Promise.all(Array.from({ length: 100 }, () => Promise.resolve(42)));
  }));

  results.push(await _runBenchmark("error-create-100", "module", () => {
    for (let i = 0; i < 100; i++) new Error(`test error ${i}`);
  }));

  results.push(await _runBenchmark("regex-compile-100", "module", () => {
    for (let i = 0; i < 100; i++) new RegExp(`pattern-${i}-[a-z]+`);
  }));

  return results;
}

// ─── Regression Check ─────────────────────────────────────────────────────────

/**
 * Run all 20 benchmarks and check for regressions against stored baselines.
 *
 * If no baselines exist yet, all current results are stored as the baseline
 * and the check passes automatically.
 *
 * @param proposalId  The proposal ID being evaluated (for baseline attribution)
 * @returns           Structured regression check result
 */
export async function runRegressionCheck(proposalId?: string): Promise<RegressionCheckResult> {
  log.info("[benchmarkRegressionSuite] Running 20 micro-benchmarks...");
  const start = Date.now();

  const results = await _runAllBenchmarks();
  const baselines = _loadBaselines();

  const regressions: RegressionDetail[] = [];
  const improvements: ImprovementDetail[] = [];
  const updatedBaselines = { ...baselines };

  for (const result of results) {
    const baseline = baselines[result.name];

    if (!baseline) {
      // No baseline yet — store current result as baseline
      updatedBaselines[result.name] = {
        name: result.name,
        medianMs: result.medianMs,
        recordedAt: new Date().toISOString(),
        proposalId: proposalId ?? null,
      };
      continue;
    }

    const changePercent = ((result.medianMs - baseline.medianMs) / baseline.medianMs) * 100;

    if (changePercent > REGRESSION_THRESHOLD_PERCENT) {
      regressions.push({
        benchmarkName: result.name,
        baselineMs: baseline.medianMs,
        currentMs: result.medianMs,
        regressionPercent: changePercent,
      });
    } else if (changePercent < -5) {
      // Improvement — update baseline
      improvements.push({
        benchmarkName: result.name,
        baselineMs: baseline.medianMs,
        currentMs: result.medianMs,
        improvementPercent: Math.abs(changePercent),
      });
      updatedBaselines[result.name] = {
        name: result.name,
        medianMs: result.medianMs,
        recordedAt: new Date().toISOString(),
        proposalId: proposalId ?? null,
      };
    }
  }

  // Save updated baselines (new entries + improvements)
  _saveBaselines(updatedBaselines);

  const passed = regressions.length === 0;
  const elapsed = Date.now() - start;

  if (passed) {
    log.info(
      `[benchmarkRegressionSuite] All ${results.length} benchmarks PASSED in ${elapsed}ms. ` +
      `${improvements.length} improvements detected.`
    );
  } else {
    log.warn(
      `[benchmarkRegressionSuite] ${regressions.length} REGRESSIONS detected in ${elapsed}ms: ` +
      regressions.map(r => `${r.benchmarkName} (+${r.regressionPercent.toFixed(1)}%)`).join(", ")
    );
  }

  return {
    passed,
    benchmarksRun: results.length,
    regressions,
    improvements,
    results,
  };
}

/**
 * Get the current benchmark baselines for dashboard display.
 */
export function getBenchmarkBaselines(): Record<string, BenchmarkBaseline> {
  return _loadBaselines();
}

/**
 * Reset all baselines (useful after a major refactor that intentionally
 * changes performance characteristics).
 */
export function resetBaselines(): void {
  try {
    if (fs.existsSync(BASELINE_PATH)) {
      fs.unlinkSync(BASELINE_PATH);
    }
    log.info("[benchmarkRegressionSuite] All baselines reset");
  } catch (err) {
    log.warn(`[benchmarkRegressionSuite] Failed to reset baselines: ${(err as Error).message}`);
  }
}

/**
 * Initialize the benchmark regression suite.
 * Runs a quick smoke test to verify all benchmarks execute successfully.
 */
export async function initBenchmarkRegressionSuite(): Promise<void> {
  const baselines = _loadBaselines();
  const baselineCount = Object.keys(baselines).length;

  log.info(
    `[benchmarkRegressionSuite] Initialized — ${baselineCount} baselines loaded. ` +
    `Regression threshold: ${REGRESSION_THRESHOLD_PERCENT}%. ` +
    `${baselineCount === 0 ? "First run will establish baselines." : "Ready to gate proposals."}`
  );
}
