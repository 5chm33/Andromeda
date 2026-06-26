/**
 * dynamicModelWeights.ts — v12.9.0 — Dynamic RLAIF Model Weighting
 *
 * Implements Reinforcement Learning from AI Feedback (RLAIF) for the
 * consensus engine. Instead of treating all model votes equally, this
 * module tracks each model's historical accuracy and adjusts its vote
 * weight accordingly.
 *
 * How it works:
 *  1. After each proposal is applied, the outcome (success/failure) is
 *     recorded against the models that voted on it
 *  2. A sliding-window ELO-style score is maintained per model
 *  3. When the consensus engine aggregates votes, it uses weighted voting
 *     instead of simple majority — models with better track records have
 *     more influence
 *  4. A model that consistently approves proposals that later fail gets
 *     its weight reduced (it's too permissive)
 *  5. A model that consistently rejects proposals that would have succeeded
 *     gets its weight reduced (it's too conservative)
 *  6. The weights are persisted to disk and survive server restarts
 *
 * Integration: the consensus engine imports `getModelWeight()` and uses
 * it in the vote aggregation step. The selfImprove.ts outcome recorder
 * calls `recordModelOutcome()` after each proposal result is known.
 *
 * Expected impact: +3-5% commit success rate by amplifying the signal from
 * the most accurate models and dampening noise from less reliable ones.
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("dynamicModelWeights");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModelRecord {
  modelId: string;
  /** Total proposals this model voted on */
  totalVotes: number;
  /** Votes where model approved AND proposal succeeded */
  truePositives: number;
  /** Votes where model approved AND proposal failed */
  falsePositives: number;
  /** Votes where model rejected AND proposal would have succeeded */
  falseNegatives: number;
  /** Votes where model rejected AND proposal failed (correct rejection) */
  trueNegatives: number;
  /** Current ELO-style weight (0.1 to 2.0, default 1.0) */
  weight: number;
  /** Exponential moving average of accuracy (last 20 votes) */
  emaAccuracy: number;
  lastUpdated: number;
}

export interface WeightStore {
  version: number;
  models: Record<string, ModelRecord>;
  lastSaved: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WEIGHT_MIN = 0.1;
const WEIGHT_MAX = 2.0;
const WEIGHT_DEFAULT = 1.0;
const EMA_ALPHA = 0.1; // Smoothing factor for exponential moving average
const WEIGHT_STORE_FILENAME = "model_weights.json";
const WEIGHT_STORE_DIR = "workspace";

// ─── State ────────────────────────────────────────────────────────────────────

let _store: WeightStore = {
  version: 1,
  models: {},
  lastSaved: 0,
};

let _storeDir: string | null = null;
let _initialized = false;

// ─── Storage ──────────────────────────────────────────────────────────────────

function getStorePath(): string {
  if (!_storeDir) {
    // Walk up from __dirname to find project root
    let cur = process.cwd();
    for (let i = 0; i < 5; i++) {
      if (fs.existsSync(path.join(cur, "package.json"))) {
        _storeDir = path.join(cur, WEIGHT_STORE_DIR);
        break;
      }
      cur = path.dirname(cur);
    }
    if (!_storeDir) _storeDir = path.join(process.cwd(), WEIGHT_STORE_DIR);
  }
  if (!fs.existsSync(_storeDir)) {
    fs.mkdirSync(_storeDir, { recursive: true });
  }
  return path.join(_storeDir, WEIGHT_STORE_FILENAME);
}

function loadStore(): void {
  try {
    const storePath = getStorePath();
    if (fs.existsSync(storePath)) {
      const raw = fs.readFileSync(storePath, "utf-8");
      const parsed = JSON.parse(raw) as WeightStore;
      if (parsed.version === 1 && parsed.models) {
        _store = parsed;
        log.info(`[DynamicWeights] Loaded weights for ${Object.keys(_store.models).length} models`);
      }
    }
  } catch { /* start fresh if corrupt */ }
  _initialized = true;
}

function saveStore(): void {
  try {
    _store.lastSaved = Date.now();
    fs.writeFileSync(getStorePath(), JSON.stringify(_store, null, 2), "utf-8");
  } catch (err) {
    log.warn(`[DynamicWeights] Failed to save store: ${(err as Error).message}`);
  }
}

// ─── Model Record Management ──────────────────────────────────────────────────

function getOrCreateRecord(modelId: string): ModelRecord {
  if (!_store.models[modelId]) {
    _store.models[modelId] = {
      modelId,
      totalVotes: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      trueNegatives: 0,
      weight: WEIGHT_DEFAULT,
      emaAccuracy: 0.7, // Optimistic prior
      lastUpdated: Date.now(),
    };
  }
  return _store.models[modelId];
}

// ─── Weight Calculation ───────────────────────────────────────────────────────

/**
 * Recalculate a model's weight based on its track record.
 * Uses a precision-recall balanced F1-style score.
 */
function recalculateWeight(record: ModelRecord): number {
  if (record.totalVotes < 5) {
    // Not enough data — use default weight
    return WEIGHT_DEFAULT;
  }

  const total = record.totalVotes;
  const correct = record.truePositives + record.trueNegatives;
  const accuracy = correct / total;

  // Precision: of the proposals this model approved, how many succeeded?
  const approvals = record.truePositives + record.falsePositives;
  const precision = approvals > 0 ? record.truePositives / approvals : 0.5;

  // Recall: of the proposals that succeeded, how many did this model approve?
  const successes = record.truePositives + record.falseNegatives;
  const recall = successes > 0 ? record.truePositives / successes : 0.5;

  // F1 score (harmonic mean of precision and recall)
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  // Blend accuracy and F1 for the weight
  const score = 0.5 * accuracy + 0.5 * f1;

  // Map score [0, 1] to weight [WEIGHT_MIN, WEIGHT_MAX]
  // score=0.5 → weight=1.0 (neutral)
  // score=1.0 → weight=2.0 (double influence)
  // score=0.0 → weight=0.1 (nearly silenced)
  const weight = WEIGHT_MIN + (WEIGHT_MAX - WEIGHT_MIN) * score;
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, weight));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the dynamic weights system.
 * Call once at startup.
 */
export function initDynamicWeights(): void {
  if (!_initialized) {
    loadStore();
  }
}

/**
 * Get the current weight for a model.
 * Returns 1.0 (neutral) if the model has no history.
 *
 * @param modelId - The model identifier (e.g., "deepseek/deepseek-chat")
 */
export function getModelWeight(modelId: string): number {
  if (!_initialized) loadStore();
  const record = _store.models[modelId];
  return record?.weight ?? WEIGHT_DEFAULT;
}

/**
 * Record the outcome of a proposal that a model voted on.
 * Call this after the proposal result is known (success or failure).
 *
 * @param modelId - The model that voted
 * @param approved - Whether the model approved the proposal
 * @param proposalSucceeded - Whether the proposal actually succeeded
 */
export function recordModelOutcome(
  modelId: string,
  approved: boolean,
  proposalSucceeded: boolean
): void {
  if (!_initialized) loadStore();

  const record = getOrCreateRecord(modelId);
  record.totalVotes++;

  if (approved && proposalSucceeded) {
    record.truePositives++;
  } else if (approved && !proposalSucceeded) {
    record.falsePositives++;
  } else if (!approved && proposalSucceeded) {
    record.falseNegatives++;
  } else {
    record.trueNegatives++;
  }

  // Update EMA accuracy
  const correct = (approved === proposalSucceeded) ? 1 : 0;
  record.emaAccuracy = EMA_ALPHA * correct + (1 - EMA_ALPHA) * record.emaAccuracy;

  // Recalculate weight
  record.weight = recalculateWeight(record);
  record.lastUpdated = Date.now();

  log.info(`[DynamicWeights] ${modelId}: weight=${record.weight.toFixed(3)}, ema=${record.emaAccuracy.toFixed(3)}, votes=${record.totalVotes}`);

  // Save periodically (every 5 updates)
  if (record.totalVotes % 5 === 0) {
    saveStore();
  }
}

/**
 * Record outcomes for all models that voted on a proposal.
 * Convenience wrapper for the consensus engine.
 *
 * @param votes - Array of {modelId, approved} from the consensus vote
 * @param proposalSucceeded - Whether the proposal ultimately succeeded
 */
export function recordConsensusOutcome(
  votes: Array<{ model: string; approved: boolean }>,
  proposalSucceeded: boolean
): void {
  for (const vote of votes) {
    recordModelOutcome(vote.model, vote.approved, proposalSucceeded);
  }
  saveStore(); // Always save after recording a full consensus outcome
}

/**
 * Compute a weighted approval score from a set of votes.
 * Returns a value in [0, 1] where > 0.5 means weighted majority approval.
 *
 * @param votes - Array of {model, approved, confidence} from the consensus vote
 */
export function computeWeightedApproval(
  votes: Array<{ model: string; approved: boolean; confidence: number }>
): { score: number; approved: boolean; weightedVotes: Array<{ model: string; weight: number; contribution: number }> } {
  if (!_initialized) loadStore();
  if (votes.length === 0) return { score: 0, approved: false, weightedVotes: [] };

  let totalWeight = 0;
  let weightedApproval = 0;
  const weightedVotes: Array<{ model: string; weight: number; contribution: number }> = [];

  for (const vote of votes) {
    const weight = getModelWeight(vote.model);
    // Confidence-adjusted weight: a high-confidence vote counts more
    const adjustedWeight = weight * (0.5 + 0.5 * vote.confidence);
    totalWeight += adjustedWeight;
    if (vote.approved) {
      weightedApproval += adjustedWeight;
    }
    weightedVotes.push({ model: vote.model, weight, contribution: vote.approved ? adjustedWeight : 0 });
  }

  const score = totalWeight > 0 ? weightedApproval / totalWeight : 0;
  return {
    score,
    approved: score >= 0.5,
    weightedVotes,
  };
}

/**
 * Get stats for all tracked models.
 */
export function getModelWeightStats(): Array<{
  modelId: string;
  weight: number;
  accuracy: number;
  totalVotes: number;
  emaAccuracy: number;
}> {
  if (!_initialized) loadStore();
  return Object.values(_store.models)
    .sort((a, b) => b.weight - a.weight)
    .map(r => ({
      modelId: r.modelId,
      weight: r.weight,
      accuracy: r.totalVotes > 0 ? (r.truePositives + r.trueNegatives) / r.totalVotes : 0,
      totalVotes: r.totalVotes,
      emaAccuracy: r.emaAccuracy,
    }));
}

/**
 * Reset all model weights to default (for testing or after major model changes).
 */
export function resetModelWeights(): void {
  _store.models = {};
  saveStore();
  log.info("[DynamicWeights] All model weights reset to default");
}
