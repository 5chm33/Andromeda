/**
 * genealogyGuidedGeneration.ts — v18.0.0
 *
 * Queries the proposal genealogy DAG to find the best previously-rejected
 * proposals for a given file and generates targeted refinements that address
 * the specific rejection reasons. This is the key mechanism for pushing the
 * RSI acceptance rate from ~93% toward 99%.
 *
 * The core insight: a rejected proposal contains valuable signal. Instead of
 * starting from scratch, we ask "what would make this rejected proposal
 * acceptable?" and generate a targeted refinement.
 *
 * Exported API:
 *   buildRefinementContext(targetFile)       → RefinementContext
 *   generateRefinementBrief(targetFile)      → string (injected into LLM prompt)
 *   recordRefinementOutcome(id, accepted)    → void
 *   getRefinementStats()                     → RefinementStats
 *   _resetRefinementStateForTest()           → void
 */

import { createLogger } from "./logger.js";
import {
  getGenealogyStats,
  getGenealogyGraph,
  type GenealogyNode,
} from "./proposalGenealogy.js";

const log = createLogger("genealogyGuidedGeneration");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RejectedProposalSummary {
  proposalId: string;
  targetFile: string;
  cycleId: string;
  rejectionReason: string | null;
  rewardScore: number;
  generatedAt: string;
  agentPersona: string | null;
}

export interface RefinementContext {
  targetFile: string;
  hasRejectedHistory: boolean;
  topRejectedProposals: RejectedProposalSummary[];
  commonRejectionPatterns: string[];
  successfulApproaches: string[];
  refinementBrief: string;
}

export interface RefinementStats {
  totalRefinementsGenerated: number;
  totalRefinementsAccepted: number;
  refinementAcceptanceRate: number;
  topImprovedFiles: Array<{ file: string; improvementDelta: number }>;
}

// ─── State ────────────────────────────────────────────────────────────────────

interface RefinementRecord {
  id: string;
  targetFile: string;
  accepted: boolean;
  generatedAt: string;
}

let _refinements: RefinementRecord[] = [];

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Analyze the genealogy DAG for a target file and extract:
 * - The top rejected proposals (highest reward score despite rejection)
 * - Common rejection patterns
 * - Successful approaches that have worked before
 */
export function buildRefinementContext(targetFile: string): RefinementContext {
  // Get all nodes for this target file from the genealogy graph
  const allNodes: GenealogyNode[] = getGenealogyGraph(500)
    .filter(n => n.targetFile === targetFile);

  if (allNodes.length === 0) {
    return {
      targetFile,
      hasRejectedHistory: false,
      topRejectedProposals: [],
      commonRejectionPatterns: [],
      successfulApproaches: [],
      refinementBrief: "",
    };
  }

  // Extract rejected proposals sorted by reward score (highest first — most promising failures)
  const rejectedNodes = allNodes
    .filter(n => n.outcome === "rejected" || n.outcome === "rolled_back")
    .sort((a, b) => (b.rewardScore ?? 0) - (a.rewardScore ?? 0))
    .slice(0, 5);

  const topRejectedProposals: RejectedProposalSummary[] = rejectedNodes.map(n => ({
    proposalId: n.id,
    targetFile: n.targetFile,
    cycleId: n.cycleId,
    rejectionReason: n.rejectionReason ?? null,
    rewardScore: n.rewardScore ?? 0,
    generatedAt: n.generatedAt,
    agentPersona: n.agentPersona ?? null,
  }));

  // Find common rejection patterns
  const rejectionReasons = rejectedNodes
    .map(n => n.rejectionReason)
    .filter((r): r is string => !!r);

  const patternCounts = new Map<string, number>();
  for (const reason of rejectionReasons) {
    const patterns = _extractPatterns(reason);
    for (const p of patterns) {
      patternCounts.set(p, (patternCounts.get(p) ?? 0) + 1);
    }
  }

  const commonRejectionPatterns = Array.from(patternCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([pattern]) => pattern);

  // Find successful approaches
  const successfulNodes = allNodes
    .filter(n => n.outcome === "applied")
    .sort((a, b) => (b.rewardScore ?? 0) - (a.rewardScore ?? 0))
    .slice(0, 3);

  const successfulApproaches = successfulNodes.map(n =>
    `cycle ${n.cycleId}: reward ${(n.rewardScore ?? 0).toFixed(2)}` +
    (n.agentPersona ? ` [${n.agentPersona}]` : "")
  );

  const refinementBrief = _buildRefinementBrief(
    targetFile,
    topRejectedProposals,
    commonRejectionPatterns,
    successfulApproaches
  );

  return {
    targetFile,
    hasRejectedHistory: topRejectedProposals.length > 0,
    topRejectedProposals,
    commonRejectionPatterns,
    successfulApproaches,
    refinementBrief,
  };
}

/**
 * Generate a concise refinement brief string suitable for injection into
 * an LLM system prompt. Returns empty string if no history exists.
 */
export function generateRefinementBrief(targetFile: string): string {
  const ctx = buildRefinementContext(targetFile);
  return ctx.refinementBrief;
}

/**
 * Record whether a refinement-guided proposal was accepted or rejected.
 */
export function recordRefinementOutcome(proposalId: string, accepted: boolean): void {
  const existing = _refinements.find(r => r.id === proposalId);
  if (existing) {
    existing.accepted = accepted;
  } else {
    _refinements.push({
      id: proposalId,
      targetFile: "unknown",
      accepted,
      generatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Get aggregate stats on refinement-guided generation performance.
 */
export function getRefinementStats(): RefinementStats {
  const total = _refinements.length;
  const accepted = _refinements.filter(r => r.accepted).length;
  const rate = total > 0 ? accepted / total : 0;

  // Group by file and compute improvement delta vs baseline
  const fileMap = new Map<string, { total: number; accepted: number }>();
  for (const r of _refinements) {
    const entry = fileMap.get(r.targetFile) ?? { total: 0, accepted: 0 };
    entry.total++;
    if (r.accepted) entry.accepted++;
    fileMap.set(r.targetFile, entry);
  }

  const topImprovedFiles = Array.from(fileMap.entries())
    .map(([file, stats]) => ({
      file,
      improvementDelta: stats.total > 0 ? (stats.accepted / stats.total) - 0.87 : 0,
    }))
    .filter(f => f.improvementDelta > 0)
    .sort((a, b) => b.improvementDelta - a.improvementDelta)
    .slice(0, 5);

  return {
    totalRefinementsGenerated: total,
    totalRefinementsAccepted: accepted,
    refinementAcceptanceRate: rate,
    topImprovedFiles,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _extractPatterns(reason: string): string[] {
  const patterns: string[] = [];
  const lower = reason.toLowerCase();

  if (lower.includes("type") || lower.includes("typescript")) patterns.push("TypeScript type error");
  if (lower.includes("test") || lower.includes("fail")) patterns.push("Test failure");
  if (lower.includes("syntax") || lower.includes("parse")) patterns.push("Syntax error");
  if (lower.includes("import") || lower.includes("module")) patterns.push("Import/module error");
  if (lower.includes("security") || lower.includes("injection")) patterns.push("Security violation");
  if (lower.includes("performance") || lower.includes("slow")) patterns.push("Performance regression");
  if (lower.includes("rollback") || lower.includes("revert")) patterns.push("Rollback required");
  if (lower.includes("constitution") || lower.includes("constraint")) patterns.push("Constitutional constraint");
  if (lower.includes("proof") || lower.includes("z3")) patterns.push("Formal proof failure");
  if (lower.includes("reward") || lower.includes("score")) patterns.push("Low reward score");

  return patterns.length > 0 ? patterns : ["Unknown rejection reason"];
}

function _buildRefinementBrief(
  targetFile: string,
  rejected: RejectedProposalSummary[],
  patterns: string[],
  successes: string[]
): string {
  if (rejected.length === 0) return "";

  const lines: string[] = [
    `\n--- GENEALOGY-GUIDED REFINEMENT CONTEXT for ${targetFile} ---`,
  ];

  lines.push(`\nPreviously REJECTED proposals (do NOT repeat these approaches):`);
  for (const r of rejected.slice(0, 3)) {
    lines.push(`  • proposal ${r.proposalId} (reward: ${r.rewardScore.toFixed(2)})`);
    if (r.rejectionReason) {
      lines.push(`    Rejection reason: ${r.rejectionReason}`);
    }
  }

  if (patterns.length > 0) {
    lines.push(`\nCommon failure patterns to AVOID: ${patterns.join(", ")}`);
  }

  if (successes.length > 0) {
    lines.push(`\nSuccessful approaches that WORKED before:`);
    for (const s of successes) {
      lines.push(`  ✓ ${s}`);
    }
  }

  lines.push(`\nYour proposal MUST address a different aspect than the rejected ones above.`);
  lines.push(`--- END GENEALOGY CONTEXT ---\n`);

  return lines.join("\n");
}

/**
 * Reset state for testing.
 */
export function _resetRefinementStateForTest(): void {
  _refinements = [];
}

// ─── Startup log ──────────────────────────────────────────────────────────────

const stats = getGenealogyStats();
if (stats.totalProposals > 0) {
  log.info(`[genealogyGuidedGeneration] Loaded genealogy DAG — ${stats.totalProposals} proposals, ${stats.applied} applied, ${stats.rejected} rejected`);
}
