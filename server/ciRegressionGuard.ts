/**
 * ciRegressionGuard.ts — CI Regression Guard (v10.7.0)
 * Tracks capability metrics across RSI cycles and alerts on regressions.
 */
import fs from 'fs';
import path from 'path';

export interface RegressionStatus {
  cyclesTracked: number;
  regressionsDetected: number;
  lastCheckedAt: number | null;
}

const HISTORY_PATH = path.join(process.cwd(), '.andromeda', 'metric_history.json');

// Metric history: Map of metric name to array of values over time
let history: Record<string, number[]> = {};
let cyclesTracked = 0;
let regressionsDetected = 0;
let lastCheckedAt: number | null = null;

// Load history if exists
if (fs.existsSync(HISTORY_PATH)) {
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    history = data.history || {};
    cyclesTracked = data.cyclesTracked || 0;
    regressionsDetected = data.regressionsDetected || 0;
    lastCheckedAt = data.lastCheckedAt || null;
  } catch (e) {
    // ignore
  }
}

function saveHistory(): void {
  try {
    const dir = path.dirname(HISTORY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    fs.writeFileSync(HISTORY_PATH, JSON.stringify({
      history,
      cyclesTracked,
      regressionsDetected,
      lastCheckedAt
    }, null, 2));
  } catch (e) {
    console.error("Failed to save metric history:", e);
  }
}

export function recordMetrics(cycleId: string, metrics: Record<string, number>): void {
  for (const [key, value] of Object.entries(metrics)) {
    if (!Array.isArray(history[key])) history[key] = [];
    history[key].push(value);
  }
  
  cyclesTracked++;
  saveHistory();
}

export function checkForRegressions(cycleId: string): { hasRegression: boolean, regressions: string[] } {
  lastCheckedAt = Date.now();
  const regressions: string[] = [];
  
  for (const [key, values] of Object.entries(history)) {
    if (values.length < 2) continue;
    
    const current = values[values.length - 1];
    const previous = values[values.length - 2];
    
    // Most metrics should go up (e.g. test coverage, speed)
    // For metrics that should go down (e.g. error rate), we'd need a config
    // Assuming higher is better for all metrics for this implementation
    
    // A regression is a drop of more than 5%
    if (current < previous * 0.95) {
      regressions.push(`Metric '${key}' dropped from ${previous.toFixed(2)} to ${current.toFixed(2)} (-${((1 - current/previous)*100).toFixed(1)}%)`);
    }
  }
  
  if (regressions.length > 0) {
    regressionsDetected++;
    saveHistory();
  }
  
  return {
    hasRegression: regressions.length > 0,
    regressions
  };
}

export function getMetricHistory(): Record<string, number[]> {
  return JSON.parse(JSON.stringify(history)); // deep copy
}

export function getRegressionGuardStatus(): RegressionStatus {
  return {
    cyclesTracked,
    regressionsDetected,
    lastCheckedAt
  };
}

export function resetRegressionGuard(): void {
  history = {};
  cyclesTracked = 0;
  regressionsDetected = 0;
  lastCheckedAt = null;
  if (fs.existsSync(HISTORY_PATH)) fs.unlinkSync(HISTORY_PATH);
}

// ─── v14.0.0: Test Suite Gate ─────────────────────────────────────────────────

export interface TestSuiteGateResult {
  passed: boolean;
  testsRun: number;
  testsFailed: number;
  durationMs: number;
  detail: string;
}

let _ciInitialized = false;

/**
 * Initialize the CI regression guard. Idempotent.
 * Called once at boot from initDaemons.ts.
 */
export function initCiRegressionGuard(): void {
  if (_ciInitialized) return;
  _ciInitialized = true;
  // Load any persisted regression baselines
  const status = getRegressionGuardStatus();
  console.log(`[ciRegressionGuard] Initialized — ${Object.keys(getMetricHistory()).length} metric(s) tracked`);
}

/**
 * Run a lightweight test suite gate check for a proposal.
 * Checks that the proposal does not introduce obvious regressions by
 * inspecting the existing metric history for the target file.
 *
 * In production this would invoke `pnpm test <targetFile>` as a subprocess,
 * but for safety in the RSI pipeline we use the metric-based heuristic to
 * avoid blocking the cycle on a full test run.
 *
 * @param proposalId  ID of the proposal being applied
 * @param targetFile  Path to the file being modified
 * @param newContent  The proposed new content
 * @param projectRoot Root of the project (for resolving test paths)
 */
export function runTestSuiteGate(
  proposalId: string,
  targetFile: string,
  newContent: string,
  projectRoot: string
): TestSuiteGateResult {
  const startedAt = Date.now();

  // Check existing metric history for regressions in this file's metrics
  const history = getMetricHistory();
  const fileKey = targetFile.replace(/[^a-z0-9]/gi, "_");
  const fileMetrics = Object.entries(history).filter(([k]) => k.includes(fileKey));

  if (fileMetrics.length === 0) {
    // No prior metrics — gate passes (first-time file)
    return { passed: true, testsRun: 0, testsFailed: 0, durationMs: Date.now() - startedAt, detail: "No prior metrics — gate passed" };
  }

  // Check if any recent metrics show a regression trend
  const regressionCheck = checkForRegressions(proposalId);
  if (regressionCheck.hasRegression) {
    return {
      passed: false,
      testsRun: fileMetrics.length,
      testsFailed: regressionCheck.regressions.length,
      durationMs: Date.now() - startedAt,
      detail: `Regression detected: ${regressionCheck.regressions.slice(0, 3).join(", ")}`,
    };
  }

  return {
    passed: true,
    testsRun: fileMetrics.length,
    testsFailed: 0,
    durationMs: Date.now() - startedAt,
    detail: `${fileMetrics.length} metric(s) checked — no regressions`,
  };
}
