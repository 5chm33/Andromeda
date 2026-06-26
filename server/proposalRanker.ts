/**
 * proposalRanker.ts — Proposal Deduplication & Composite Ranking (v15.0.0)
 *
 * When the RSI Worker Pool generates multiple proposals (one per worker), this
 * module deduplicates semantically identical proposals and ranks the survivors
 * using a composite score to ensure only the mathematically optimal change is
 * applied per RSI cycle.
 *
 * Scoring formula (0–100):
 *   safetyScore     (0–40)  — from semanticCodebaseGraph impact radius
 *   patternScore    (0–25)  — from epistemicBeliefModel historical success rate
 *   rewardScore     (0–20)  — from the existing reward model
 *   complexityScore (0–15)  — inverse of proposal complexity (simpler = better)
 *
 * Deduplication uses character-level Jaccard similarity on the proposal diff.
 * Two proposals with similarity > 0.85 are considered duplicates; the higher-
 * ranked one is kept.
 *
 * @module proposalRanker
 * @version 15.0.0
 */

import { createLogger } from "./logger.js";

const log = createLogger("proposalRanker");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RankableProposal {
  id: string;
  title: string;
  targetFile: string;
  area: string;
  /** The proposed diff or new file content */
  content: string;
  /** Safety score from semanticCodebaseGraph (0–1) */
  safetyScore?: number;
  /** Pattern success rate from epistemicBeliefModel (0–1) */
  patternScore?: number;
  /** Reward model score (0–1) */
  rewardScore?: number;
  /** Proposal complexity (1–10, lower = simpler) */
  complexity?: number;
}

export interface RankedProposal extends RankableProposal {
  /** Final composite score (0–100) */
  compositeScore: number;
  /** Score breakdown for transparency */
  scoreBreakdown: {
    safety: number;
    pattern: number;
    reward: number;
    simplicity: number;
  };
  /** Whether this proposal was deduplicated (false = it was a duplicate) */
  isUnique: boolean;
  /** ID of the proposal this was a duplicate of (if isUnique = false) */
  duplicateOf?: string;
}

export interface RankingResult {
  /** Ranked proposals, sorted by compositeScore descending */
  ranked: RankedProposal[];
  /** The single best proposal to apply this cycle */
  winner: RankedProposal | null;
  /** Number of duplicates removed */
  duplicatesRemoved: number;
  /** Total proposals evaluated */
  totalEvaluated: number;
}

// ─── Similarity ───────────────────────────────────────────────────────────────

/**
 * Compute Jaccard similarity between two strings using character n-grams (n=3).
 * Returns a value between 0 (completely different) and 1 (identical).
 *
 * @param a  First string
 * @param b  Second string
 */
export function jaccardSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  const ngrams = (s: string, n: number): Set<string> => {
    const result = new Set<string>();
    for (let i = 0; i <= s.length - n; i++) {
      result.add(s.slice(i, i + n));
    }
    return result;
  };

  const setA = ngrams(a.toLowerCase(), 3);
  const setB = ngrams(b.toLowerCase(), 3);

  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

const DEDUP_THRESHOLD = 0.85;

/**
 * Compute the composite score for a single proposal.
 *
 * @param proposal  The proposal to score
 * @returns         Score breakdown and composite score (0–100)
 */
export function scoreProposal(proposal: RankableProposal): {
  compositeScore: number;
  scoreBreakdown: RankedProposal["scoreBreakdown"];
} {
  // Safety score (0–40): higher safety = higher score
  const safetyRaw = proposal.safetyScore ?? 0.5;
  const safety = Math.round(safetyRaw * 40);

  // Pattern score (0–25): higher historical success rate = higher score
  const patternRaw = proposal.patternScore ?? 0.5;
  const pattern = Math.round(patternRaw * 25);

  // Reward score (0–20): higher reward model score = higher score
  const rewardRaw = proposal.rewardScore ?? 0.5;
  const reward = Math.round(rewardRaw * 20);

  // Simplicity score (0–15): lower complexity = higher score (inverse)
  const complexityRaw = proposal.complexity ?? 5;
  const normalizedComplexity = Math.max(1, Math.min(10, complexityRaw));
  const simplicity = Math.round(((10 - normalizedComplexity) / 9) * 15);

  const compositeScore = safety + pattern + reward + simplicity;

  return {
    compositeScore,
    scoreBreakdown: { safety, pattern, reward, simplicity },
  };
}

// ─── Core Ranking ─────────────────────────────────────────────────────────────

/**
 * Deduplicate and rank a list of proposals from the RSI Worker Pool.
 * Returns the ranked list and the single best proposal to apply.
 *
 * @param proposals  Array of proposals from parallel workers
 * @returns          Ranking result with winner and deduplication stats
 */
export function rankProposals(proposals: RankableProposal[]): RankingResult {
  if (proposals.length === 0) {
    return { ranked: [], winner: null, duplicatesRemoved: 0, totalEvaluated: 0 };
  }

  // ── Step 1: Score all proposals ───────────────────────────────────────────
  const scored: RankedProposal[] = proposals.map(p => {
    const { compositeScore, scoreBreakdown } = scoreProposal(p);
    return { ...p, compositeScore, scoreBreakdown, isUnique: true };
  });

  // Sort by composite score descending so we keep the best of each duplicate group
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  // ── Step 2: Deduplicate using Jaccard similarity ───────────────────────────
  let duplicatesRemoved = 0;

  for (let i = 0; i < scored.length; i++) {
    if (!scored[i].isUnique) continue;

    for (let j = i + 1; j < scored.length; j++) {
      if (!scored[j].isUnique) continue;

      // Only compare proposals targeting the same file
      if (scored[i].targetFile !== scored[j].targetFile) continue;

      const similarity = jaccardSimilarity(scored[i].content, scored[j].content);
      if (similarity >= DEDUP_THRESHOLD) {
        scored[j].isUnique = false;
        scored[j].duplicateOf = scored[i].id;
        duplicatesRemoved++;
        log.info(
          `[proposalRanker] Duplicate detected: "${scored[j].title}" ≈ "${scored[i].title}" ` +
          `(similarity=${(similarity * 100).toFixed(1)}%) — keeping higher-scored proposal`
        );
      }
    }
  }

  // ── Step 3: Filter to unique proposals only ───────────────────────────────
  const unique = scored.filter(p => p.isUnique);

  // ── Step 4: Re-sort unique proposals by composite score ───────────────────
  unique.sort((a, b) => b.compositeScore - a.compositeScore);

  const winner = unique[0] ?? null;

  if (winner) {
    log.info(
      `[proposalRanker] Winner: "${winner.title}" for ${winner.targetFile} ` +
      `(score=${winner.compositeScore}/100, ` +
      `safety=${winner.scoreBreakdown.safety}/40, ` +
      `pattern=${winner.scoreBreakdown.pattern}/25, ` +
      `reward=${winner.scoreBreakdown.reward}/20, ` +
      `simplicity=${winner.scoreBreakdown.simplicity}/15)`
    );
  }

  return {
    ranked: scored, // All proposals including duplicates (for audit trail)
    winner,
    duplicatesRemoved,
    totalEvaluated: proposals.length,
  };
}

/**
 * Rank proposals grouped by target file.
 * Returns the best proposal per file (useful when workers generate multiple
 * proposals for different files in the same cycle).
 *
 * @param proposals  Array of proposals from parallel workers
 * @returns          Map of targetFile → best RankedProposal
 */
export function rankProposalsByFile(
  proposals: RankableProposal[]
): Map<string, RankedProposal> {
  const byFile = new Map<string, RankableProposal[]>();

  for (const p of proposals) {
    const existing = byFile.get(p.targetFile) ?? [];
    existing.push(p);
    byFile.set(p.targetFile, existing);
  }

  const result = new Map<string, RankedProposal>();

  for (const [file, fileProposals] of byFile) {
    const { winner } = rankProposals(fileProposals);
    if (winner) {
      result.set(file, winner);
    }
  }

  return result;
}

/**
 * Get a human-readable ranking summary for logging and dashboards.
 *
 * @param result  The ranking result from `rankProposals()`
 * @returns       Multi-line summary string
 */
export function formatRankingSummary(result: RankingResult): string {
  const lines: string[] = [
    `Ranking Summary: ${result.totalEvaluated} proposals evaluated, ${result.duplicatesRemoved} duplicates removed`,
  ];

  const unique = result.ranked.filter(p => p.isUnique);
  for (let i = 0; i < unique.length; i++) {
    const p = unique[i];
    lines.push(
      `  ${i + 1}. [${p.compositeScore}/100] "${p.title}" → ${p.targetFile}` +
      ` (safety=${p.scoreBreakdown.safety} pattern=${p.scoreBreakdown.pattern} reward=${p.scoreBreakdown.reward} simplicity=${p.scoreBreakdown.simplicity})`
    );
  }

  return lines.join("\n");
}
