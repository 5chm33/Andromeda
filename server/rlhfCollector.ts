/**
 * rlhfCollector.ts — v7.2.0
 *
 * Reinforcement Learning from Human Feedback (RLHF) collector.
 *
 * Closes the human-in-the-loop gap: when a user accepts, rejects, edits, or
 * rates a proposal (via the UI or API), that signal is captured here and fed
 * back into the meta-learning system to bias future proposal generation.
 *
 * Architecture:
 *   1. FeedbackStore — persists all feedback signals to data/rlhf_feedback.jsonl
 *   2. FeedbackAggregator — computes per-category and per-file reward signals
 *   3. MetaLearningBridge — injects aggregated rewards into selfImprove.ts scoring
 *   4. ReplayBuffer — periodically replays high-reward examples as few-shot prompts
 *
 * Feedback types:
 *   - "accept"   : user explicitly approved a proposal (+1.0 reward)
 *   - "reject"   : user explicitly rejected a proposal (-1.0 reward)
 *   - "edit"     : user modified the proposal before applying (+0.5 reward, partial)
 *   - "rate"     : user gave a numeric rating 1-5 (mapped to -1.0 to +1.0)
 *   - "implicit" : derived from downstream signals (eval score improved after apply)
 *
 * v7.2.0 changes:
 *   - normalizeEntry() handles HH-RLHF eval format (source=hhrlhf_eval) in addition
 *     to native FeedbackSignal format. The 119k hhrlhf entries are now converted to
 *     FeedbackSignal on load so recomputeAggregates() and getRlhfContext() work correctly.
 *   - loadFeedbackFromDisk() samples representatively: last 100 + 100 from middle.
 *   - trainRewardModelFromDisk() is called on init to warm up the reward model.
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("rlhfCollector");

// ─── Types ───────────────────────────────────────────────────────────────────

export type FeedbackType = "accept" | "reject" | "edit" | "rate" | "implicit";

export interface FeedbackSignal {
  id: string;
  proposalId: string;
  targetFile: string;
  category: string;
  title: string;
  feedbackType: FeedbackType;
  /** Normalized reward in [-1.0, +1.0] */
  reward: number;
  /** Optional user comment */
  comment?: string;
  /** For "edit" type: the diff between original and user-edited version */
  editDiff?: string;
  /** For "rate" type: raw rating 1-5 */
  rawRating?: number;
  /** For "implicit" type: the eval delta that triggered this signal */
  evalDelta?: number;
  actorId?: string;
  timestamp: string;
}

export interface AggregatedReward {
  category: string;
  sampleCount: number;
  meanReward: number;
  acceptRate: number;
  rejectRate: number;
  editRate: number;
  /** Files with highest reward in this category */
  topFiles: string[];
  /** Files with lowest reward in this category */
  bottomFiles: string[];
  lastUpdated: string;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const FEEDBACK_FILE = path.join(process.cwd(), "data", "rlhf_feedback.jsonl");
const AGGREGATES_FILE = path.join(process.cwd(), "data", "rlhf_aggregates.json");
const MAX_REPLAY_BUFFER = 200;

const feedbackBuffer: FeedbackSignal[] = [];
const aggregates: Map<string, AggregatedReward> = new Map();

function ensureDataDir(): void {
  const dir = path.dirname(FEEDBACK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function appendFeedbackToDisk(signal: FeedbackSignal): void {
  try {
    ensureDataDir();
    fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(signal) + "\n", "utf-8");
  } catch (err) {
    log.caught("non-fatal", err);
  }
}

// ─── Schema Normalization ─────────────────────────────────────────────────────

/**
 * Convert a raw JSONL entry to FeedbackSignal.
 * Handles two schemas:
 *   1. Native FeedbackSignal (has 'reward' field) — used as-is.
 *   2. HH-RLHF eval format (source=hhrlhf_eval, has 'verdict' + 'confidence') —
 *      converted: thumbs_up → accept reward=+confidence, thumbs_down → reject reward=-confidence.
 *      Category is derived from the 'categories' array if present.
 */
function normalizeEntry(raw: any): FeedbackSignal | null {
  // Native FeedbackSignal — already has reward field and proposalId
  if (typeof raw.reward === "number" && raw.proposalId) {
    return raw as FeedbackSignal;
  }

  // HH-RLHF eval format (source=hhrlhf_eval)
  if (raw.source === "hhrlhf_eval" && raw.verdict) {
    const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0.7;
    const isPositive = raw.verdict === "thumbs_up";
    const reward = isPositive ? confidence : -confidence;
    const feedbackType: FeedbackType = isPositive ? "accept" : "reject";
    const categories: string[] = Array.isArray(raw.categories) ? raw.categories : [];
    const category = categories[0] || "helpfulness";
    return {
      id: raw.id || `hhrlhf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      proposalId: raw.id || "hhrlhf",
      targetFile: "hhrlhf_eval",
      category,
      title: `HH-RLHF: ${String(raw.chosen || "").slice(0, 60)}`,
      feedbackType,
      reward,
      comment: raw.reason || undefined,
      timestamp: raw.timestamp || new Date().toISOString(),
    };
  }

  return null;
}

function loadFeedbackFromDisk(limit = MAX_REPLAY_BUFFER): void {
  try {
    if (!fs.existsSync(FEEDBACK_FILE)) return;
    const lines = fs.readFileSync(FEEDBACK_FILE, "utf-8").trim().split("\n").filter(Boolean);

    // Sample representatively: last 100 entries + 100 from the middle of the file.
    // This ensures we get a mix of old native FeedbackSignal entries and new hhrlhf entries.
    const halfLimit = Math.floor(limit / 2);
    const recent = lines.slice(-halfLimit);
    const midStart = Math.max(0, Math.floor(lines.length / 2) - Math.floor(halfLimit / 2));
    const middle = lines.slice(midStart, midStart + halfLimit);
    const sampled = [...new Set([...middle, ...recent])];

    for (const line of sampled) {
      try {
        const raw = JSON.parse(line);
        const signal = normalizeEntry(raw);
        if (signal) feedbackBuffer.push(signal);
      } catch { /* skip malformed lines */ }
    }
    log.info(`Loaded ${feedbackBuffer.length} feedback signals from disk (${lines.length} total entries in file)`);
  } catch (err) {
    log.caught("non-fatal", err);
  }
}

function saveAggregates(): void {
  try {
    ensureDataDir();
    const obj = Object.fromEntries(aggregates.entries());
    fs.writeFileSync(AGGREGATES_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch (err) {
    log.caught("non-fatal", err);
  }
}

function loadAggregates(): void {
  try {
    if (!fs.existsSync(AGGREGATES_FILE)) return;
    const obj = JSON.parse(fs.readFileSync(AGGREGATES_FILE, "utf-8")) as Record<string, AggregatedReward>;
    for (const [k, v] of Object.entries(obj)) {
      aggregates.set(k, v);
    }
    log.info(`Loaded ${aggregates.size} category aggregates`);
  } catch (err) {
    log.caught("non-fatal", err);
  }
}

// ─── Reward Normalization ─────────────────────────────────────────────────────

function normalizeReward(type: FeedbackType, rawRating?: number, evalDelta?: number): number {
  switch (type) {
    case "accept":   return 1.0;
    case "reject":   return -1.0;
    case "edit":     return 0.5;
    case "rate":     return rawRating !== undefined ? ((rawRating - 1) / 4) * 2 - 1 : 0;
    case "implicit": return evalDelta !== undefined ? Math.max(-1, Math.min(1, evalDelta / 10)) : 0;
    default:         return 0;
  }
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

function recomputeAggregates(): void {
  const byCategory = new Map<string, FeedbackSignal[]>();
  for (const signal of feedbackBuffer) {
    const cat = signal.category || "unknown";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(signal);
  }

  for (const [category, signals] of byCategory.entries()) {
    const meanReward = signals.reduce((s, f) => s + f.reward, 0) / signals.length;
    const acceptRate = signals.filter(f => f.feedbackType === "accept").length / signals.length;
    const rejectRate = signals.filter(f => f.feedbackType === "reject").length / signals.length;
    const editRate   = signals.filter(f => f.feedbackType === "edit").length / signals.length;

    // Top/bottom files by mean reward
    const fileRewards = new Map<string, number[]>();
    for (const s of signals) {
      if (!fileRewards.has(s.targetFile)) fileRewards.set(s.targetFile, []);
      fileRewards.get(s.targetFile)!.push(s.reward);
    }
    const fileMeans = Array.from(fileRewards.entries())
      .map(([f, rs]) => ({ file: f, mean: rs.reduce((a, b) => a + b, 0) / rs.length }))
      .sort((a, b) => b.mean - a.mean);

    aggregates.set(category, {
      category,
      sampleCount: signals.length,
      meanReward,
      acceptRate,
      rejectRate,
      editRate,
      topFiles: fileMeans.slice(0, 3).map(f => f.file),
      bottomFiles: fileMeans.slice(-3).map(f => f.file),
      lastUpdated: new Date().toISOString(),
    });
  }

  saveAggregates();
}

// ─── Reward Model Training ────────────────────────────────────────────────────

/**
 * Warm up the reward model from the full rlhf_feedback.jsonl file.
 * Called once on init. Non-fatal if rewardModel is unavailable.
 */
async function trainRewardModelFromDisk(): Promise<void> {
  try {
    if (!fs.existsSync(FEEDBACK_FILE)) return;
    const { trainFromRlhfFile } = await import("./rewardModel.js");
    await trainFromRlhfFile(FEEDBACK_FILE);
    log.info("Reward model trained from rlhf_feedback.jsonl");
  } catch (err) {
    log.info(`Reward model training skipped (non-fatal): ${(err as Error).message}`);
  }
  // v11.9.1: Also train from the proposal store (real code-diff DPO pairs).
  // This is the primary training signal for code quality — applied vs rejected proposals.
  try {
    const { trainFromProposalStore } = await import("./rewardModel.js");
    const proposalStorePath = path.join(path.dirname(FEEDBACK_FILE), "..", "workspace", ".andromeda_proposals.json");
    const state = trainFromProposalStore(proposalStorePath);
    if ((state.trainingPairs ?? 0) > 0) {
      log.info(`Reward model trained from proposal store: ${state.trainingPairs ?? 0} code-diff DPO pairs`);
    }
  } catch (err) {
    log.info(`Proposal store training skipped (non-fatal): ${(err as Error).message}`);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a feedback signal for a proposal.
 * Called from the API routes when a user accepts/rejects/rates a proposal.
 */
export function recordFeedback(
  proposalId: string,
  targetFile: string,
  category: string,
  title: string,
  feedbackType: FeedbackType,
  options: {
    rawRating?: number;
    comment?: string;
    editDiff?: string;
    evalDelta?: number;
    actorId?: string;
  } = {}
): FeedbackSignal {
  const reward = normalizeReward(feedbackType, options.rawRating, options.evalDelta);

  const signal: FeedbackSignal = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    proposalId,
    targetFile,
    category,
    title,
    feedbackType,
    reward,
    comment: options.comment,
    editDiff: options.editDiff,
    rawRating: options.rawRating,
    evalDelta: options.evalDelta,
    actorId: options.actorId,
    timestamp: new Date().toISOString(),
  };

  feedbackBuffer.push(signal);
  if (feedbackBuffer.length > MAX_REPLAY_BUFFER) feedbackBuffer.shift();

  appendFeedbackToDisk(signal);
  recomputeAggregates();

  log.info(`Feedback recorded: ${feedbackType} for proposal ${proposalId} (reward: ${reward.toFixed(2)}, category: ${category})`);

  return signal;
}

/**
 * Record implicit feedback from eval score changes.
 * Called by continuousImprover.ts after each eval run to derive reward signals
 * from proposals that were applied before the eval.
 */
export function recordImplicitFeedback(
  recentlyAppliedProposals: Array<{ id: string; targetFile: string; category: string; title: string }>,
  evalDelta: number
): void {
  if (recentlyAppliedProposals.length === 0) return;

  // Distribute the eval delta equally across all recently applied proposals
  const perProposalDelta = evalDelta / recentlyAppliedProposals.length;

  for (const p of recentlyAppliedProposals) {
    recordFeedback(p.id, p.targetFile, p.category, p.title, "implicit", {
      evalDelta: perProposalDelta,
      actorId: "continuousImprover",
    });
  }

  log.info(`Implicit feedback: ${recentlyAppliedProposals.length} proposals, evalDelta=${evalDelta.toFixed(2)}`);
}

/**
 * Get the RLHF meta-learning context for injection into proposal generation prompts.
 * Returns a formatted string describing which categories/files have high/low reward.
 */
export function getRlhfContext(): string {
  if (aggregates.size === 0) return "";

  const sorted = Array.from(aggregates.values()).sort((a, b) => b.meanReward - a.meanReward);
  const highReward = sorted.filter(a => a.meanReward > 0.3 && a.sampleCount >= 3).slice(0, 3);
  const lowReward  = sorted.filter(a => a.meanReward < -0.3 && a.sampleCount >= 3).slice(-3);

  const lines: string[] = [];

  if (highReward.length > 0) {
    lines.push(`RLHF HIGH-REWARD categories (users accepted these): ${highReward.map(a => `${a.category} (reward=${a.meanReward.toFixed(2)}, n=${a.sampleCount})`).join(", ")}`);
  }
  if (lowReward.length > 0) {
    lines.push(`RLHF LOW-REWARD categories (users rejected these): ${lowReward.map(a => `${a.category} (reward=${a.meanReward.toFixed(2)}, n=${a.sampleCount})`).join(", ")}`);
  }

  const totalSignals = feedbackBuffer.length;
  const overallAcceptRate = feedbackBuffer.filter(f => f.feedbackType === "accept").length / Math.max(1, totalSignals);
  lines.push(`Overall accept rate: ${(overallAcceptRate * 100).toFixed(0)}% (${totalSignals} signals)`);

  return lines.length > 0 ? `\n\nRLHF FEEDBACK CONTEXT:\n${lines.join("\n")}` : "";
}

/**
 * Get the replay buffer — the most recent high-reward feedback signals.
 * Used as few-shot examples in proposal generation prompts.
 */
export function getReplayExamples(limit = 5): FeedbackSignal[] {
  return feedbackBuffer
    .filter(f => f.reward >= 0.5)
    .slice(-limit);
}

/**
 * Get all aggregated rewards for monitoring.
 */
export function getRlhfAggregates(): AggregatedReward[] {
  return Array.from(aggregates.values()).sort((a, b) => b.sampleCount - a.sampleCount);
}

/**
 * Get recent feedback signals for monitoring.
 */
export function getRecentFeedback(limit = 20): FeedbackSignal[] {
  return feedbackBuffer.slice(-limit);
}

/**
 * Get overall RLHF stats.
 */
export function getRlhfStats(): {
  totalSignals: number;
  acceptRate: number;
  rejectRate: number;
  editRate: number;
  implicitRate: number;
  meanReward: number;
  categoryCount: number;
} {
  const total = feedbackBuffer.length;
  if (total === 0) {
    return { totalSignals: 0, acceptRate: 0, rejectRate: 0, editRate: 0, implicitRate: 0, meanReward: 0, categoryCount: 0 };
  }
  return {
    totalSignals: total,
    acceptRate:   feedbackBuffer.filter(f => f.feedbackType === "accept").length / total,
    rejectRate:   feedbackBuffer.filter(f => f.feedbackType === "reject").length / total,
    editRate:     feedbackBuffer.filter(f => f.feedbackType === "edit").length / total,
    implicitRate: feedbackBuffer.filter(f => f.feedbackType === "implicit").length / total,
    meanReward:   feedbackBuffer.reduce((s, f) => s + f.reward, 0) / total,
    categoryCount: aggregates.size,
  };
}

// ─── Init ────────────────────────────────────────────────────────────────────

export function initRlhfCollector(): void {
  loadFeedbackFromDisk();
  loadAggregates();
  recomputeAggregates();
  log.info(`RLHF collector initialized — ${feedbackBuffer.length} signals, ${aggregates.size} categories`);
  // v7.2.0: Warm up the reward model from the full feedback file (non-blocking)
  trainRewardModelFromDisk().catch(() => { /* non-fatal */ });
}
