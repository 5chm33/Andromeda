/**
 * semanticMergeResolver.ts — Semantic Merge Conflict Resolution (v16.0.0)
 *
 * When the RSI worker pool generates multiple proposals for the same target
 * file in parallel, the current system discards all but the highest-ranked
 * proposal. This wastes valid improvements.
 *
 * This module implements a 3-phase merge strategy:
 *
 *   Phase 1 — Conflict Detection
 *     Parse both proposals' diffs into AST-level change hunks.
 *     Two proposals conflict if they modify the same function/class/line range.
 *
 *   Phase 2 — Compatible Merge
 *     If proposals touch non-overlapping AST nodes, merge them automatically.
 *     The merged proposal gets a composite confidence score.
 *
 *   Phase 3 — Conflict Resolution
 *     If proposals conflict, use the higher-confidence proposal as the base
 *     and attempt to cherry-pick non-conflicting hunks from the other.
 *     Any irreconcilable conflicts are discarded (not the whole proposal).
 *
 * This turns a "pick one" situation into a "take the best of both" outcome,
 * increasing the net improvement per RSI cycle.
 *
 * @module semanticMergeResolver
 * @version 16.0.0
 */

import { createLogger } from "./logger.js";

const log = createLogger("semanticMergeResolver");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MergeableProposal {
  id: string;
  targetFile: string;
  title: string;
  originalContent: string;
  proposedContent: string;
  confidence: number;
  area: string;
}

export interface ChangeHunk {
  /** Start line in the original file */
  startLine: number;
  /** End line in the original file */
  endLine: number;
  /** The new lines replacing [startLine, endLine] */
  newLines: string[];
  /** AST node type being modified (function, class, import, variable, etc.) */
  nodeType: string;
  /** Name of the AST node (function name, class name, etc.) */
  nodeName: string;
}

export interface MergeResult {
  /** Whether the merge was successful */
  success: boolean;
  /** The merged proposal content (if successful) */
  mergedContent: string | null;
  /** Composite confidence score */
  mergedConfidence: number;
  /** Number of hunks merged from proposal A */
  hunksFromA: number;
  /** Number of hunks merged from proposal B */
  hunksFromB: number;
  /** Number of conflicting hunks that were discarded */
  conflictsDiscarded: number;
  /** Human-readable description of what was merged */
  description: string;
}

// ─── Diff Parsing ─────────────────────────────────────────────────────────────

/**
 * Extract change hunks by comparing original and proposed content line-by-line.
 * Groups consecutive changed lines into hunks.
 */
function _extractHunks(original: string, proposed: string): ChangeHunk[] {
  const origLines = original.split("\n");
  const propLines = proposed.split("\n");
  const hunks: ChangeHunk[] = [];

  // Simple LCS-based diff to find changed regions
  const maxLines = Math.max(origLines.length, propLines.length);
  let i = 0;

  while (i < maxLines) {
    const origLine = origLines[i] ?? "";
    const propLine = propLines[i] ?? "";

    if (origLine !== propLine) {
      // Start of a changed region — find where it ends
      const hunkStart = i;
      const newLines: string[] = [];

      while (i < maxLines && (origLines[i] ?? "") !== (propLines[i] ?? "")) {
        if (i < propLines.length) newLines.push(propLines[i]);
        i++;
      }

      // Detect the AST node type from context
      const contextLine = origLines[hunkStart] ?? propLines[hunkStart] ?? "";
      const { nodeType, nodeName } = _detectNodeType(contextLine, origLines, hunkStart);

      hunks.push({
        startLine: hunkStart,
        endLine: i - 1,
        newLines,
        nodeType,
        nodeName,
      });
    } else {
      i++;
    }
  }

  return hunks;
}

/**
 * Detect the AST node type and name from a line and its context.
 */
function _detectNodeType(
  line: string,
  allLines: string[],
  lineIndex: number
): { nodeType: string; nodeName: string } {
  // Look back up to 5 lines for the enclosing declaration
  const contextLines = allLines.slice(Math.max(0, lineIndex - 5), lineIndex + 1);

  for (let i = contextLines.length - 1; i >= 0; i--) {
    const ctx = contextLines[i];

    const fnMatch = ctx.match(/(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
    if (fnMatch) return { nodeType: "function", nodeName: fnMatch[1] ?? fnMatch[2] ?? "unknown" };

    const classMatch = ctx.match(/class\s+(\w+)/);
    if (classMatch) return { nodeType: "class", nodeName: classMatch[1] };

    const importMatch = ctx.match(/^import\s+/);
    if (importMatch) return { nodeType: "import", nodeName: "import-statement" };

    const exportMatch = ctx.match(/^export\s+(?:const|let|var|function|class)\s+(\w+)/);
    if (exportMatch) return { nodeType: "export", nodeName: exportMatch[1] };

    const ifMatch = ctx.match(/^\s*if\s*\(/);
    if (ifMatch) return { nodeType: "conditional", nodeName: `if-at-line-${lineIndex}` };
  }

  return { nodeType: "statement", nodeName: `line-${lineIndex}` };
}

// ─── Conflict Detection ───────────────────────────────────────────────────────

/**
 * Check if two hunks conflict (overlap in the original file's line space).
 */
function _hunksConflict(a: ChangeHunk, b: ChangeHunk): boolean {
  // Two hunks conflict if their line ranges overlap
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * Check if two hunks touch the same named AST node.
 */
function _sameNode(a: ChangeHunk, b: ChangeHunk): boolean {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName;
}

// ─── Merge Engine ─────────────────────────────────────────────────────────────

/**
 * Apply a set of change hunks to the original content.
 * Hunks must be sorted by startLine in ascending order.
 */
function _applyHunks(original: string, hunks: ChangeHunk[]): string {
  if (hunks.length === 0) return original;

  const lines = original.split("\n");
  const sortedHunks = [...hunks].sort((a, b) => a.startLine - b.startLine);

  const result: string[] = [];
  let cursor = 0;

  for (const hunk of sortedHunks) {
    // Add unchanged lines before this hunk
    while (cursor < hunk.startLine && cursor < lines.length) {
      result.push(lines[cursor]);
      cursor++;
    }

    // Add the new lines from this hunk
    result.push(...hunk.newLines);

    // Skip the original lines that were replaced
    cursor = hunk.endLine + 1;
  }

  // Add any remaining unchanged lines after the last hunk
  while (cursor < lines.length) {
    result.push(lines[cursor]);
    cursor++;
  }

  return result.join("\n");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attempt to merge two proposals for the same target file.
 *
 * Returns a merged proposal if the proposals are compatible (non-conflicting
 * or partially compatible). Returns failure if proposals are fundamentally
 * incompatible (e.g., both rewrite the same function in different ways).
 *
 * @param proposalA  The higher-confidence proposal (used as base)
 * @param proposalB  The lower-confidence proposal (cherry-picked from)
 */
export function mergeProposals(
  proposalA: MergeableProposal,
  proposalB: MergeableProposal
): MergeResult {
  if (proposalA.targetFile !== proposalB.targetFile) {
    return {
      success: false,
      mergedContent: null,
      mergedConfidence: 0,
      hunksFromA: 0,
      hunksFromB: 0,
      conflictsDiscarded: 0,
      description: "Cannot merge proposals targeting different files",
    };
  }

  log.info(
    `[semanticMergeResolver] Attempting merge: "${proposalA.title}" + "${proposalB.title}" ` +
    `on ${proposalA.targetFile}`
  );

  // Extract change hunks from both proposals
  const hunksA = _extractHunks(proposalA.originalContent, proposalA.proposedContent);
  const hunksB = _extractHunks(proposalB.originalContent, proposalB.proposedContent);

  if (hunksA.length === 0 && hunksB.length === 0) {
    return {
      success: false,
      mergedContent: null,
      mergedConfidence: 0,
      hunksFromA: 0,
      hunksFromB: 0,
      conflictsDiscarded: 0,
      description: "Both proposals produced no detectable changes",
    };
  }

  // Find which hunks from B are compatible with A (non-conflicting)
  const compatibleBHunks: ChangeHunk[] = [];
  let conflictsDiscarded = 0;

  for (const hunkB of hunksB) {
    const conflictsWithA = hunksA.some(
      hunkA => _hunksConflict(hunkA, hunkB) || _sameNode(hunkA, hunkB)
    );

    if (conflictsWithA) {
      conflictsDiscarded++;
      log.debug(
        `[semanticMergeResolver] Discarding conflicting hunk from B: ` +
        `${hunkB.nodeType} "${hunkB.nodeName}" at lines ${hunkB.startLine}-${hunkB.endLine}`
      );
    } else {
      compatibleBHunks.push(hunkB);
    }
  }

  // If no compatible hunks from B, just return A as-is
  if (compatibleBHunks.length === 0) {
    return {
      success: true,
      mergedContent: proposalA.proposedContent,
      mergedConfidence: proposalA.confidence,
      hunksFromA: hunksA.length,
      hunksFromB: 0,
      conflictsDiscarded,
      description: `Used proposal A entirely (all ${conflictsDiscarded} hunks from B conflicted)`,
    };
  }

  // Apply A's hunks first (to the original), then cherry-pick compatible B hunks
  try {
    // Start from original and apply A's changes
    const afterA = proposalA.proposedContent;

    // Re-extract hunks from B relative to the original content
    // and apply compatible ones on top of A's result
    const mergedContent = _applyHunks(afterA, compatibleBHunks);

    // Composite confidence: weighted average favoring A
    const mergedConfidence = (proposalA.confidence * 0.7) + (proposalB.confidence * 0.3);

    const description =
      `Merged ${hunksA.length} hunks from A + ${compatibleBHunks.length} compatible hunks from B` +
      (conflictsDiscarded > 0 ? ` (${conflictsDiscarded} conflicting hunks from B discarded)` : "");

    log.info(`[semanticMergeResolver] Merge successful: ${description}`);

    return {
      success: true,
      mergedContent,
      mergedConfidence,
      hunksFromA: hunksA.length,
      hunksFromB: compatibleBHunks.length,
      conflictsDiscarded,
      description,
    };

  } catch (err) {
    log.warn(`[semanticMergeResolver] Merge failed during hunk application: ${(err as Error).message}`);
    return {
      success: false,
      mergedContent: null,
      mergedConfidence: 0,
      hunksFromA: hunksA.length,
      hunksFromB: 0,
      conflictsDiscarded,
      description: `Merge failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Given a list of proposals for the same target file, merge them all into
 * a single best-of-all proposal.
 *
 * Proposals are sorted by confidence (highest first) and merged pairwise.
 *
 * @param proposals  Two or more proposals for the same target file
 * @returns          A single merged proposal, or the best single proposal if merge fails
 */
export function mergeProposalGroup(proposals: MergeableProposal[]): MergeableProposal {
  if (proposals.length === 0) throw new Error("Cannot merge empty proposal group");
  if (proposals.length === 1) return proposals[0];

  // Sort by confidence descending
  const sorted = [...proposals].sort((a, b) => b.confidence - a.confidence);

  let base = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const result = mergeProposals(base, sorted[i]);

    if (result.success && result.mergedContent) {
      base = {
        ...base,
        title: `[Merged] ${base.title}`,
        proposedContent: result.mergedContent,
        confidence: result.mergedConfidence,
      };
    }
    // If merge fails, just keep the current base (best single proposal)
  }

  return base;
}

/**
 * Group proposals by target file and merge each group.
 * Returns one merged proposal per target file.
 *
 * @param proposals  Array of proposals (may target different files)
 * @returns          Deduplicated and merged proposals
 */
export function mergeAllProposals(proposals: MergeableProposal[]): MergeableProposal[] {
  // Group by target file
  const groups = new Map<string, MergeableProposal[]>();

  for (const proposal of proposals) {
    const group = groups.get(proposal.targetFile) ?? [];
    group.push(proposal);
    groups.set(proposal.targetFile, group);
  }

  // Merge each group
  const merged: MergeableProposal[] = [];

  for (const [file, group] of groups) {
    if (group.length === 1) {
      merged.push(group[0]);
    } else {
      log.info(
        `[semanticMergeResolver] Merging ${group.length} proposals for ${file}`
      );
      merged.push(mergeProposalGroup(group));
    }
  }

  return merged;
}
