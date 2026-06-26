/**
 * rewardCalibrator.ts — v18.0.0
 *
 * Platt scaling layer to correct reward model confidence scores.
 *
 * The reward model often outputs overconfident or underconfident scores.
 * Platt scaling fits a logistic regression on top of the raw scores using
 * observed accept/reject outcomes, transforming raw scores into well-calibrated
 * probabilities. This is a lightweight online calibration that updates with
 * every proposal outcome.
 *
 * Mathematical basis:
 *   calibrated = sigmoid(A * rawScore + B)
 *   where A and B are learned via gradient descent on binary cross-entropy.
 *
 * Exported API:
 *   initRewardCalibrator()                  → void
 *   calibrateScore(rawScore, context?)      → number (0–1)
 *   updateCalibration(rawScore, accepted)   → void
 *   getCalibrationStats()                   → CalibrationStats
 *   _resetRewardCalibratorForTest()         → void
 */

import { createLogger } from "./logger.js";

const log = createLogger("rewardCalibrator");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalibrationStats {
  sampleCount: number;
  plattA: number;
  plattB: number;
  expectedCalibrationError: number;
  overconfidenceRate: number;
  underconfidenceRate: number;
  isCalibrated: boolean;
}

export interface CalibrationContext {
  area?: string;
  agentPersona?: string;
  targetFile?: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

// Platt scaling parameters: calibrated = sigmoid(A * raw + B)
// Start with identity mapping: A=1, B=0 → sigmoid(raw) ≈ raw for raw near 0
let _plattA = 1.0;
let _plattB = 0.0;

// Training history for ECE computation
interface CalibrationSample {
  rawScore: number;
  accepted: boolean;
  calibratedScore: number;
  recordedAt: string;
}

let _samples: CalibrationSample[] = [];
let _initialized = false;

// Hyperparameters
const LEARNING_RATE = 0.01;
const MIN_SAMPLES_FOR_CALIBRATION = 20;
const MAX_SAMPLES_RETAINED = 1000;
const ECE_BINS = 10;

// ─── Math Utilities ───────────────────────────────────────────────────────────

function _sigmoid(x: number): number {
  return 1.0 / (1.0 + Math.exp(-x));
}

function _logit(p: number): number {
  const clamped = Math.max(1e-7, Math.min(1 - 1e-7, p));
  return Math.log(clamped / (1 - clamped));
}

// ─── Calibration Core ─────────────────────────────────────────────────────────

/**
 * Apply Platt scaling to a raw reward score.
 * Returns a calibrated probability in [0, 1].
 */
export function calibrateScore(rawScore: number, _context?: CalibrationContext): number {
  // Clamp input to reasonable range
  const clamped = Math.max(0, Math.min(1, rawScore));

  if (_samples.length < MIN_SAMPLES_FOR_CALIBRATION) {
    // Not enough data yet — return identity sigmoid of raw score
    return _sigmoid(_logit(clamped));
  }

  return _sigmoid(_plattA * _logit(clamped) + _plattB);
}

/**
 * Update the Platt scaling parameters with a new observed outcome.
 * Uses online gradient descent on binary cross-entropy loss.
 *
 * @param rawScore   The raw score output by the reward model (0–1)
 * @param accepted   Whether the proposal was actually accepted
 */
export function updateCalibration(rawScore: number, accepted: boolean): void {
  const clamped = Math.max(0, Math.min(1, rawScore));
  const logitRaw = _logit(clamped);

  // Forward pass
  const calibrated = _sigmoid(_plattA * logitRaw + _plattB);

  // Record sample
  _samples.push({
    rawScore: clamped,
    accepted,
    calibratedScore: calibrated,
    recordedAt: new Date().toISOString(),
  });

  // Keep sample buffer bounded
  if (_samples.length > MAX_SAMPLES_RETAINED) {
    _samples = _samples.slice(-MAX_SAMPLES_RETAINED);
  }

  // Gradient of binary cross-entropy w.r.t. A and B
  const y = accepted ? 1.0 : 0.0;
  const error = calibrated - y;

  const gradA = error * logitRaw;
  const gradB = error;

  _plattA -= LEARNING_RATE * gradA;
  _plattB -= LEARNING_RATE * gradB;

  // Log calibration drift if significant
  if (_samples.length % 50 === 0) {
    const stats = getCalibrationStats();
    log.info(
      `[rewardCalibrator] Updated — samples: ${stats.sampleCount}, ` +
      `A: ${_plattA.toFixed(4)}, B: ${_plattB.toFixed(4)}, ` +
      `ECE: ${stats.expectedCalibrationError.toFixed(4)}`
    );
  }
}

/**
 * Compute Expected Calibration Error (ECE) using equal-width bins.
 * ECE = Σ (|bin| / N) * |accuracy(bin) - confidence(bin)|
 */
function _computeECE(): number {
  if (_samples.length < MIN_SAMPLES_FOR_CALIBRATION) return 0;

  const binSize = 1.0 / ECE_BINS;
  let ece = 0;

  for (let b = 0; b < ECE_BINS; b++) {
    const lo = b * binSize;
    const hi = (b + 1) * binSize;
    const binSamples = _samples.filter(s => s.calibratedScore >= lo && s.calibratedScore < hi);
    if (binSamples.length === 0) continue;

    const avgConfidence = binSamples.reduce((sum, s) => sum + s.calibratedScore, 0) / binSamples.length;
    const accuracy = binSamples.filter(s => s.accepted).length / binSamples.length;
    ece += (binSamples.length / _samples.length) * Math.abs(accuracy - avgConfidence);
  }

  return ece;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get calibration statistics for monitoring and dashboards.
 */
export function getCalibrationStats(): CalibrationStats {
  const ece = _computeECE();

  // Overconfidence: predicted > 0.7 but rejected
  const overconfident = _samples.filter(s => s.calibratedScore > 0.7 && !s.accepted).length;
  const overconfidenceRate = _samples.length > 0 ? overconfident / _samples.length : 0;

  // Underconfidence: predicted < 0.3 but accepted
  const underconfident = _samples.filter(s => s.calibratedScore < 0.3 && s.accepted).length;
  const underconfidenceRate = _samples.length > 0 ? underconfident / _samples.length : 0;

  return {
    sampleCount: _samples.length,
    plattA: _plattA,
    plattB: _plattB,
    expectedCalibrationError: ece,
    overconfidenceRate,
    underconfidenceRate,
    isCalibrated: _samples.length >= MIN_SAMPLES_FOR_CALIBRATION && ece < 0.1,
  };
}

/**
 * Initialize the reward calibrator.
 * Loads any persisted calibration parameters from environment if available.
 */
export function initRewardCalibrator(): void {
  if (_initialized) return;
  _initialized = true;

  // Allow overriding initial Platt parameters from environment
  const envA = process.env.REWARD_CALIBRATOR_A;
  const envB = process.env.REWARD_CALIBRATOR_B;
  if (envA) _plattA = parseFloat(envA);
  if (envB) _plattB = parseFloat(envB);

  log.info(
    `[rewardCalibrator] Initialized — Platt A: ${_plattA.toFixed(4)}, B: ${_plattB.toFixed(4)}`
  );
}

/**
 * Reset state for testing.
 */
export function _resetRewardCalibratorForTest(): void {
  _plattA = 1.0;
  _plattB = 0.0;
  _samples = [];
  _initialized = false;
}
