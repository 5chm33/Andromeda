/**
 * proposalFeedback.ts — v1.0 (Tier 1 Enhancement #1)
 *
 * LLM Feedback Loop: When a proposal is rejected, the rejection reason is sent
 * back to the proposal generator as structured feedback so the NEXT proposal for
 * the same file is meaningfully different and more likely to succeed.
 *
 * Architecture:
 *   1. When applyProposal receives a guard rejection, it calls recordRejectionFeedback()
 *   2. Feedback is persisted to workspace/.andromeda_proposal_feedback.json
 *   3. analyzeAndPropose() calls getRejectionContext() before building the LLM prompt
 *   4. The rejection context is injected as a "PREVIOUS FAILURES" block in the system prompt
 *
 * This closes the learning loop: the LLM generator knows exactly why its last
 * proposal for a file was rejected and avoids repeating the same mistake.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposalRejectionFeedback {
  proposalId: string;
  targetFile: string;
  title: string;
  originalSnippet: string;
  proposedSnippet: string;
  rejectionReason: string;
  rejectionCategory: "syntax" | "constitution" | "test_failure" | "patch_mismatch" | "type_error" | "other";
  rejectedAt: number;
}

interface FeedbackStore {
  feedbacks: ProposalRejectionFeedback[];
  lastUpdatedAt: number;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

function getFeedbackPath(): string {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".andromeda_proposal_feedback.json");
}

function loadStore(): FeedbackStore {
  const p = getFeedbackPath();
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  } catch { /* ignore corrupt file */ }
  return { feedbacks: [], lastUpdatedAt: 0 };
}

function saveStore(store: FeedbackStore): void {
  try {
    store.lastUpdatedAt = Date.now();
    // Keep only the 200 most recent feedbacks to prevent unbounded growth
    if (store.feedbacks.length > 200) {
      store.feedbacks = store.feedbacks.slice(-200);
    }
    fs.writeFileSync(getFeedbackPath(), JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.warn("[ProposalFeedback] Save failed:", (err as Error).message);
  }
}

// ─── Rejection category classifier ───────────────────────────────────────────

function classifyRejection(reason: string): ProposalRejectionFeedback["rejectionCategory"] {
  const r = reason.toLowerCase();
  if (r.includes("syntax") || r.includes("parse error") || r.includes("syntactic")) return "syntax";
  if (r.includes("constitution") || r.includes("forbidden") || r.includes("blocked")) return "constitution";
  if (r.includes("test") || r.includes("spec") || r.includes("failed after")) return "test_failure";
  if (r.includes("patch") || r.includes("mismatch") || r.includes("snippet not found")) return "patch_mismatch";
  if (r.includes("ts") || r.includes("type") || r.includes("tsc") || r.includes("error ts")) return "type_error";
  return "other";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record that a proposal was rejected. Called by applyProposal() after a guard rejection.
 */
export function recordRejectionFeedback(
  proposalId: string,
  targetFile: string,
  title: string,
  originalSnippet: string,
  proposedSnippet: string,
  rejectionReason: string
): void {
  try {
    if (typeof proposalId !== 'string' || !proposalId.trim() ||
        typeof targetFile !== 'string' || !targetFile.trim() ||
        typeof title !== 'string' || !title.trim() ||
        typeof originalSnippet !== 'string' ||
        typeof proposedSnippet !== 'string' ||
        typeof rejectionReason !== 'string' || !rejectionReason.trim()) {
      console.warn('[ProposalFeedback] Invalid input to recordRejectionFeedback');
      return;
    }
    const store = loadStore();
    const feedback: ProposalRejectionFeedback = {
      proposalId,
      targetFile: path.basename(targetFile),
      title,
      originalSnippet: originalSnippet.slice(0, 500),
      proposedSnippet: proposedSnippet.slice(0, 500),
      rejectionReason: rejectionReason.slice(0, 300),
      rejectionCategory: classifyRejection(rejectionReason),
      rejectedAt: Date.now(),
    };
    store.feedbacks.push(feedback);
    saveStore(store);
    console.log(`[ProposalFeedback] Recorded rejection for ${targetFile}: ${rejectionReason.slice(0, 80)}`);
  } catch (err) {
    console.warn("[ProposalFeedback] recordRejectionFeedback failed:", (err as Error).message);
  }
}

/**
 * Get a formatted rejection context string for injection into the analyzeAndPropose prompt.
 * Returns an empty string if no relevant feedback exists.
 */
export function getRejectionContext(targetFile: string, maxEntries = 5): string {
  try {
    const store = loadStore();
    const filename = path.basename(targetFile);
    // Get the N most recent rejections for this file
    const relevant = store.feedbacks
      .filter(f => f.targetFile === filename)
      .slice(-maxEntries);

    if (relevant.length === 0) return "";

    const lines = relevant.map(f => {
      const age = Math.round((Date.now() - f.rejectedAt) / 60000);
      return `  • [${f.rejectionCategory.toUpperCase()}] "${f.title}" rejected ${age}min ago: ${f.rejectionReason}\n    AVOID: ${f.proposedSnippet.split("\n").slice(0, 3).join(" | ").slice(0, 150)}`;
    });

    return `\n\nPREVIOUS FAILED PROPOSALS FOR THIS FILE (do NOT repeat these approaches):\n${lines.join("\n")}\nLearn from these failures: change your approach, target a different area, or use a different technique.`;
  } catch {
    return "";
  }
}

/**
 * Get aggregate statistics for a file's rejection history.
 * Used by the continuous improver to skip files with too many recent failures.
 */
export function getFileRejectionStats(targetFile: string): {
  totalRejections: number;
  recentRejections: number; // last 24h
  dominantCategory: string;
  shouldSkip: boolean; // true if file has ≥8 rejections in last 24h
} {
  try {
    const store = loadStore();
    const filename = path.basename(targetFile);
    const all = store.feedbacks.filter(f => f.targetFile === filename);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = all.filter(f => f.rejectedAt > cutoff);

    // Find dominant rejection category
    const catCounts: Record<string, number> = {};
    for (const f of recent) {
      catCounts[f.rejectionCategory] = (catCounts[f.rejectionCategory] || 0) + 1;
    }
    const dominantCategory = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "none";

    return {
      totalRejections: all.length,
      recentRejections: recent.length,
      dominantCategory,
      shouldSkip: recent.length >= 8,
    };
  } catch {
    return { totalRejections: 0, recentRejections: 0, dominantCategory: "none", shouldSkip: false };
  }
}

/**
 * Clear all feedback for a file (e.g., after a successful apply resets the slate).
 */
export function clearFileFeedback(targetFile: string): void {
  try {
    const store = loadStore();
    const filename = path.basename(targetFile);
    const before = store.feedbacks.length;
    store.feedbacks = store.feedbacks.filter(f => f.targetFile !== filename);
    if (store.feedbacks.length < before) {
      saveStore(store);
      console.log(`[ProposalFeedback] Cleared ${before - store.feedbacks.length} feedback entries for ${filename}`);
    }
  } catch (err) {
    console.warn("[ProposalFeedback] clearFileFeedback failed:", (err as Error).message);
  }
}
