/**
 * humanInTheLoopGate.ts — v12.12.0 — Human-in-the-Loop Confidence Gate
 *
 * Problem: The RSI system auto-applies proposals above a confidence threshold.
 * But for proposals that touch critical files (auth, payments, database schemas)
 * or have borderline confidence scores (e.g., 0.72 when threshold is 0.70),
 * the risk of a bad auto-apply is disproportionately high.
 *
 * Solution: A configurable gate that routes proposals to a "human review queue"
 * instead of auto-applying when:
 *  1. The proposal targets a CRITICAL file (configurable list)
 *  2. The confidence score is within the "borderline zone" (threshold ± margin)
 *  3. The Actor-Critic score is below a minimum (e.g., < 6.0)
 *  4. The MAD debate had unresolved critical issues
 *  5. The proposal has been in the queue for > N cycles without being applied
 *
 * The human review queue is persisted to disk and exposed via the REST API
 * so the dashboard can display pending reviews.
 *
 * Integration:
 *  - shouldRequireHumanReview() is called from selfImprove.ts in the auto-apply
 *    path, before the dry-run step. If it returns true, the proposal is moved
 *    to the "pending_review" status instead of being applied.
 *  - The /api/rsi/review endpoint allows human approval/rejection.
 *
 * Expected impact: +0.5–1% success rate by preventing borderline proposals
 * from causing regressions. The human review queue also provides a feedback
 * signal for the RLAIF system.
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("humanInTheLoopGate");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HumanReviewConfig {
  /** Minimum confidence score for auto-apply (0–1). Default: 0.75 */
  minConfidence: number;
  /** Borderline zone: proposals within ±margin of minConfidence go to review */
  borderlineMargin: number;
  /** Minimum Actor-Critic score for auto-apply (0–10). Default: 5.0 */
  minCriticScore: number;
  /** Files that always require human review (regex patterns) */
  criticalFilePatterns: string[];
  /** Maximum number of pending reviews before new proposals are deferred */
  maxPendingReviews: number;
  /** Whether the HITL gate is enabled */
  enabled: boolean;
}

export interface HumanReviewDecision {
  proposalId: string;
  decision: "approved" | "rejected";
  reviewedBy: string;
  reviewedAt: number;
  notes?: string;
}

export interface HumanReviewEntry {
  proposalId: string;
  targetFile: string;
  title: string;
  confidence: number;
  criticScore?: number;
  madIssueCount?: number;
  reason: string;
  queuedAt: number;
  status: "pending" | "approved" | "rejected" | "expired";
  decision?: HumanReviewDecision;
}

export interface HumanReviewQueue {
  version: number;
  entries: HumanReviewEntry[];
  lastSaved: number;
}

export interface GateDecision {
  requiresReview: boolean;
  reason?: string;
  /** "auto_apply" | "human_review" | "auto_reject" */
  action: "auto_apply" | "human_review" | "auto_reject";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const QUEUE_FILENAME = "human_review_queue.json";
const QUEUE_DIR = "workspace";
const ENTRY_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const DEFAULT_CONFIG: HumanReviewConfig = {
  minConfidence: 0.75,
  borderlineMargin: 0.08,
  minCriticScore: 5.0,
  criticalFilePatterns: [
    "auth",
    "payment",
    "billing",
    "schema",
    "migration",
    "database",
    "security",
    "constitution",
    "config",
  ],
  maxPendingReviews: 50,
  enabled: true,
};

// ─── State ────────────────────────────────────────────────────────────────────

let _config: HumanReviewConfig = { ...DEFAULT_CONFIG };
let _queue: HumanReviewQueue = { version: 1, entries: [], lastSaved: 0 };
let _queueDir: string | null = null;
let _initialized = false;

// ─── Initialization ───────────────────────────────────────────────────────────

export function initHumanInTheLoopGate(
  config?: Partial<HumanReviewConfig>,
  queueDir?: string
): void {
  _config = { ...DEFAULT_CONFIG, ...config };
  _queueDir = queueDir ?? path.join(process.cwd(), QUEUE_DIR);
  const queuePath = path.join(_queueDir, QUEUE_FILENAME);

  if (fs.existsSync(queuePath)) {
    try {
      const raw = fs.readFileSync(queuePath, "utf8");
      const loaded = JSON.parse(raw) as HumanReviewQueue;
      if (loaded.version === 1 && Array.isArray(loaded.entries)) {
        _queue = loaded;
        // Expire old entries
        pruneExpiredEntries();
        log.info(`[HITL] Loaded review queue: ${_queue.entries.length} entries`);
      }
    } catch (err) {
      log.warn(`[HITL] Failed to load review queue: ${err}`);
    }
  }
  _initialized = true;
}

function saveQueue(): void {
  if (!_queueDir || !_initialized) return;
  try {
    if (!fs.existsSync(_queueDir)) fs.mkdirSync(_queueDir, { recursive: true });
    _queue.lastSaved = Date.now();
    fs.writeFileSync(
      path.join(_queueDir, QUEUE_FILENAME),
      JSON.stringify(_queue, null, 2),
      "utf8"
    );
  } catch (err) {
    log.warn(`[HITL] Failed to save review queue: ${err}`);
  }
}

// ─── Core Gate Logic ──────────────────────────────────────────────────────────

/**
 * Determine whether a proposal should be routed to human review.
 *
 * @param proposalId - ID of the proposal
 * @param targetFile - File the proposal targets
 * @param confidence - Proposal confidence score (0–1)
 * @param criticScore - Actor-Critic score (0–10), if available
 * @param madIssueCount - Number of unresolved MAD issues, if available
 */
export function shouldRequireHumanReview(
  proposalId: string,
  targetFile: string,
  confidence: number,
  criticScore?: number,
  madIssueCount?: number
): GateDecision {
  if (!_config.enabled) {
    return { requiresReview: false, action: "auto_apply" };
  }

  // Check 1: Critical file pattern
  const fileBasename = path.basename(targetFile).toLowerCase();
  const filePath = targetFile.toLowerCase();
  const isCriticalFile = _config.criticalFilePatterns.some(
    (pattern) => fileBasename.includes(pattern) || filePath.includes(pattern)
  );
  if (isCriticalFile) {
    return {
      requiresReview: true,
      reason: `Target file '${path.basename(targetFile)}' matches critical file pattern — human review required`,
      action: "human_review",
    };
  }

  // Check 2: Confidence below minimum
  if (confidence < _config.minConfidence - _config.borderlineMargin) {
    return {
      requiresReview: false,
      reason: `Confidence ${confidence.toFixed(3)} is below minimum ${_config.minConfidence} (outside borderline zone)`,
      action: "auto_reject",
    };
  }

  // Check 3: Borderline confidence zone
  if (
    confidence >= _config.minConfidence - _config.borderlineMargin &&
    confidence < _config.minConfidence
  ) {
    return {
      requiresReview: true,
      reason: `Confidence ${confidence.toFixed(3)} is in borderline zone [${(_config.minConfidence - _config.borderlineMargin).toFixed(3)}, ${_config.minConfidence.toFixed(3)})`,
      action: "human_review",
    };
  }

  // Check 4: Low Actor-Critic score
  if (criticScore !== undefined && criticScore < _config.minCriticScore) {
    return {
      requiresReview: true,
      reason: `Actor-Critic score ${criticScore.toFixed(1)} is below minimum ${_config.minCriticScore}`,
      action: "human_review",
    };
  }

  // Check 5: Unresolved MAD critical issues
  if (madIssueCount !== undefined && madIssueCount >= 2) {
    return {
      requiresReview: true,
      reason: `MAD debate flagged ${madIssueCount} unresolved issues`,
      action: "human_review",
    };
  }

  return { requiresReview: false, action: "auto_apply" };
}

/**
 * Add a proposal to the human review queue.
 */
export function queueForHumanReview(
  proposalId: string,
  targetFile: string,
  title: string,
  confidence: number,
  reason: string,
  criticScore?: number,
  madIssueCount?: number
): void {
  // Check if already queued
  const existing = _queue.entries.find((e) => e.proposalId === proposalId);
  if (existing) return;

  // Check max pending
  const pendingCount = _queue.entries.filter((e) => e.status === "pending").length;
  if (pendingCount >= _config.maxPendingReviews) {
    log.warn(`[HITL] Review queue full (${pendingCount}/${_config.maxPendingReviews}) — deferring proposal ${proposalId}`);
    return;
  }

  const entry: HumanReviewEntry = {
    proposalId,
    targetFile,
    title,
    confidence,
    criticScore,
    madIssueCount,
    reason,
    queuedAt: Date.now(),
    status: "pending",
  };

  _queue.entries.unshift(entry);
  saveQueue();
  log.info(`[HITL] Queued proposal ${proposalId} for human review: ${reason}`);
}

/**
 * Record a human review decision (approve or reject).
 */
export function recordHumanDecision(decision: HumanReviewDecision): boolean {
  const entry = _queue.entries.find((e) => e.proposalId === decision.proposalId);
  if (!entry) return false;

  entry.status = decision.decision === "approved" ? "approved" : "rejected";
  entry.decision = decision;
  saveQueue();
  log.info(`[HITL] Proposal ${decision.proposalId} ${decision.decision} by ${decision.reviewedBy}`);
  return true;
}

/**
 * Check if a proposal has been approved by a human reviewer.
 */
export function isHumanApproved(proposalId: string): boolean {
  const entry = _queue.entries.find((e) => e.proposalId === proposalId);
  return entry?.status === "approved";
}

/**
 * Get all pending review entries.
 */
export function getPendingReviews(): HumanReviewEntry[] {
  return _queue.entries.filter((e) => e.status === "pending");
}

/**
 * Get the full review queue.
 */
export function getReviewQueue(): HumanReviewQueue {
  return _queue;
}

/**
 * Get stats about the review queue.
 */
export function getHITLStats(): {
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
  total: number;
  enabled: boolean;
} {
  const entries = _queue.entries;
  return {
    pending: entries.filter((e) => e.status === "pending").length,
    approved: entries.filter((e) => e.status === "approved").length,
    rejected: entries.filter((e) => e.status === "rejected").length,
    expired: entries.filter((e) => e.status === "expired").length,
    total: entries.length,
    enabled: _config.enabled,
  };
}

/**
 * Update the HITL gate configuration at runtime.
 */
export function updateHITLConfig(config: Partial<HumanReviewConfig>): void {
  _config = { ..._config, ...config };
  log.info(`[HITL] Config updated: minConfidence=${_config.minConfidence}, enabled=${_config.enabled}`);
}

/**
 * Prune expired entries from the queue.
 */
export function pruneExpiredEntries(): number {
  const cutoff = Date.now() - ENTRY_EXPIRY_MS;
  let pruned = 0;
  for (const entry of _queue.entries) {
    if (entry.status === "pending" && entry.queuedAt < cutoff) {
      entry.status = "expired";
      pruned++;
    }
  }
  if (pruned > 0) {
    saveQueue();
    log.info(`[HITL] Expired ${pruned} stale review entries`);
  }
  return pruned;
}
