/**
 * sweBenchHarness.ts — SWE-bench Evaluation Harness (v11.0.0)
 *
 * Server-side bridge between the RSI engine and the real SWE-bench
 * evaluation infrastructure.
 *
 * v11.0.0 changes (audit fix):
 *   - Removed ALL mock/simulated scoring (was returning fake 15% + 8.5% delta)
 *   - comparePrePostRsi now reads real result files instead of simulating
 *   - runBaseline reads real result JSON instead of a mock JSONL file
 *   - Added getPerformanceSummary() for RSI self-reporting
 *   - Baseline v2 score (19.2%) is the known ground truth from the full run
 *
 * The actual prediction generation is done by swebench_sota_agent_v3.py
 * (Python, runs on the cloud computer). This TS module reads the results
 * those runs produce and exposes them to the RSI engine.
 */

import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = util.promisify(exec);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessStatus {
  baselineScore: number | null;
  lastRunAt: number | null;
  resolvedCount: number;
  totalCount: number;
  resolveRate: number;
  resultsPath: string | null;
}

export interface EvalResult {
  resolved: string[];
  unresolved: string[];
  errors: string[];
  total: number;
  resolveRate: number;
  runId: string;
  completedAt: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

let status: HarnessStatus = {
  baselineScore: null,
  lastRunAt: null,
  resolvedCount: 0,
  totalCount: 0,
  resolveRate: 0,
  resultsPath: null,
};

// ─── Results Discovery ────────────────────────────────────────────────────────

/**
 * Finds the most recent SWE-bench results JSON file in the data directory.
 * Checks the aggregated final results file first, then searches the data dir.
 */
function findLatestResultsFile(): string | null {
  const candidates = [
    path.join(process.cwd(), '..', 'andromeda_final_results.json'),
    path.join(process.cwd(), 'data', 'swebench', 'andromeda_sota_v3_final_results.json'),
    path.join(process.cwd(), 'data', 'swebench', 'andromeda_final_results.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Search data/swebench for any *_results.json
  const dataDir = path.join(process.cwd(), 'data', 'swebench');
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('_final_results.json') || f.endsWith('_results.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dataDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length > 0) {
      return path.join(dataDir, files[0].name);
    }
  }

  return null;
}

/**
 * Parses a SWE-bench results JSON file into a structured EvalResult.
 * Handles both the aggregated format and the harness output format.
 */
function parseResultsFile(filePath: string): EvalResult | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;

    // Aggregated format (andromeda_final_results.json)
    if (data['resolved_ids'] && Array.isArray(data['resolved_ids'])) {
      const resolved = data['resolved_ids'] as string[];
      const unresolved = (data['unresolved_ids'] as string[]) || [];
      const errors = (data['error_ids'] as string[]) || [];
      const total = (data['total_instances'] as number) || (resolved.length + unresolved.length + errors.length);
      return {
        resolved,
        unresolved,
        errors,
        total,
        resolveRate: total > 0 ? resolved.length / total : 0,
        runId: (data['run_id'] as string) || 'unknown',
        completedAt: (data['completed_at'] as string) || new Date().toISOString(),
      };
    }

    // Harness output format (has 'resolved' array at top level)
    if (data['resolved'] && Array.isArray(data['resolved'])) {
      const resolved = data['resolved'] as string[];
      const total = (data['total_instances'] as number) || 500;
      return {
        resolved,
        unresolved: [],
        errors: [],
        total,
        resolveRate: total > 0 ? resolved.length / total : 0,
        runId: (data['run_id'] as string) || 'unknown',
        completedAt: new Date().toISOString(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads the latest available SWE-bench results and updates the harness status.
 * Returns the real score from disk — no mock data.
 */
export async function runBaseline(taskCount = 500): Promise<{
  score: number;
  tasksRun: number;
  resolveRate: number;
}> {
  const resultsPath = findLatestResultsFile();

  if (!resultsPath) {
    status = {
      baselineScore: 0,
      lastRunAt: Date.now(),
      resolvedCount: 0,
      totalCount: taskCount,
      resolveRate: 0,
      resultsPath: null,
    };
    return { score: 0, tasksRun: 0, resolveRate: 0 };
  }

  const result = parseResultsFile(resultsPath);
  if (!result) {
    return { score: 0, tasksRun: 0, resolveRate: 0 };
  }

  const score = result.resolveRate * 100;
  status = {
    baselineScore: score,
    lastRunAt: Date.now(),
    resolvedCount: result.resolved.length,
    totalCount: result.total,
    resolveRate: result.resolveRate,
    resultsPath,
  };

  return {
    score,
    tasksRun: result.resolved.length + result.unresolved.length,
    resolveRate: result.resolveRate,
  };
}

/**
 * Compares the v2 baseline (19.2% zero-shot agentless) to the current v3
 * pipeline score. Both are read from real result files on disk.
 *
 * Returns delta = 0 until the v3 pipeline has completed a full run.
 */
export async function comparePrePostRsi(): Promise<{
  before: number;
  after: number;
  delta: number;
}> {
  // Known ground truth from the completed v2 full run (96/500 = 19.2%)
  const BASELINE_V2 = 19.2;

  // Look for a v3 results file (will be populated after the next full run)
  const dataDir = path.join(process.cwd(), 'data', 'swebench');
  let afterScore = BASELINE_V2;

  if (fs.existsSync(dataDir)) {
    const v3Files = fs.readdirSync(dataDir)
      .filter(f => f.includes('sota_v3') && f.endsWith('_results.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dataDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (v3Files.length > 0) {
      const v3Result = parseResultsFile(path.join(dataDir, v3Files[0].name));
      if (v3Result) {
        afterScore = v3Result.resolveRate * 100;
      }
    }
  }

  return {
    before: BASELINE_V2,
    after: afterScore,
    delta: afterScore - BASELINE_V2,
  };
}

/**
 * Returns the current harness status without triggering a new evaluation.
 * Lazy-loads from disk on first call.
 */
export function getHarnessStatus(): HarnessStatus {
  if (status.baselineScore === null) {
    const resultsPath = findLatestResultsFile();
    if (resultsPath) {
      const result = parseResultsFile(resultsPath);
      if (result) {
        status = {
          baselineScore: result.resolveRate * 100,
          lastRunAt: Date.now(),
          resolvedCount: result.resolved.length,
          totalCount: result.total,
          resolveRate: result.resolveRate,
          resultsPath,
        };
      }
    }
  }
  return { ...status };
}

/**
 * Resets the in-memory harness status (forces re-read from disk on next call).
 */
export function resetHarnessStatus(): void {
  status = {
    baselineScore: null,
    lastRunAt: null,
    resolvedCount: 0,
    totalCount: 0,
    resolveRate: 0,
    resultsPath: null,
  };
}

/**
 * Returns a human-readable summary of the current SWE-bench performance.
 * Used by the RSI engine for self-reporting.
 */
export function getPerformanceSummary(): string {
  const s = getHarnessStatus();
  if (s.baselineScore === null) {
    return 'SWE-bench: No evaluation results available yet. Run swebench_sota_agent_v3.py to generate predictions.';
  }
  return (
    `SWE-bench Verified: ${s.resolvedCount}/${s.totalCount} resolved ` +
    `(${s.baselineScore.toFixed(1)}% resolve rate). ` +
    `Pipeline: v3 (traceback loop + multi-agent consensus). ` +
    `Results: ${s.resultsPath ?? 'N/A'}`
  );
}
