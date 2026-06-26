/**
 * astDiff.ts — v12.10.0 — AST-Based Structural Diffing
 *
 * Replaces text-based diff for conflict detection with a structural AST diff
 * that ignores whitespace, formatting, and comment-only changes.
 *
 * Problem it solves:
 *   The existing text diff flags a proposal as "conflicting" if the file has
 *   been reformatted (e.g., by Prettier) or if a comment was added. These are
 *   false-positive conflicts that cause valid proposals to be rejected.
 *
 * How it works:
 *  1. Parse both the "original" and "current" file content using the TypeScript
 *     compiler API to get full ASTs.
 *  2. Serialize each AST to a canonical form that strips:
 *     - Whitespace and indentation
 *     - Comments (single-line and block)
 *     - Trailing semicolons (optional)
 *  3. Compare the canonical forms to determine if the file has changed
 *     structurally (not just cosmetically).
 *  4. If only cosmetic changes are detected, the proposal is NOT flagged as
 *     conflicting — the snippet matching is attempted with normalized text.
 *
 * Expected impact: +2-3% commit success rate by eliminating false-positive
 * conflicts from formatting and comment changes.
 *
 * Integration: called from selfImprove.ts in the snippet-matching phase,
 * replacing the raw string includes() check with a semantics-aware check.
 */

import * as ts from "typescript";
import { createLogger } from "./logger.js";

const log = createLogger("astDiff");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AstDiffResult {
  structurallyIdentical: boolean;  // true = only cosmetic changes
  hasSemanticChanges: boolean;     // true = real code changes
  canonicalBefore: string;
  canonicalAfter: string;
  diffSummary: string;
}

export interface SnippetMatchResult {
  found: boolean;
  matchedSnippet?: string;       // the actual text in the file that matches
  normalizedMatch: boolean;      // true = found via normalization (not exact)
  proposedContent?: string;      // the file content after applying the snippet
}

// ─── AST Canonicalization ─────────────────────────────────────────────────────

/**
 * Serialize a TypeScript source file to a canonical string that ignores
 * whitespace, comments, and formatting.
 */
export function canonicalize(source: string, filename = "_temp.ts"): string {
  try {
    const sourceFile = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS
    );

    const tokens: string[] = [];

    const visit = (node: ts.Node): void => {
      // Skip comments
      if (
        node.kind === ts.SyntaxKind.SingleLineCommentTrivia ||
        node.kind === ts.SyntaxKind.MultiLineCommentTrivia ||
        node.kind === ts.SyntaxKind.JSDocComment
      ) {
        return;
      }

      // For leaf nodes, emit their text
      if (node.getChildCount(sourceFile) === 0) {
        const text = node.getText(sourceFile).trim();
        if (text) tokens.push(text);
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return tokens.join(" ");
  } catch {
    // Fallback: normalize whitespace manually
    return source
      .replace(/\/\/[^\n]*/g, "")           // remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, "")      // remove block comments
      .replace(/\s+/g, " ")                  // collapse whitespace
      .trim();
  }
}

// ─── Structural Diff ──────────────────────────────────────────────────────────

/**
 * Compare two versions of a file to determine if changes are structural
 * (semantic) or cosmetic (whitespace/comments only).
 */
export function astDiff(before: string, after: string): AstDiffResult {
  const canonicalBefore = canonicalize(before);
  const canonicalAfter = canonicalize(after);

  const structurallyIdentical = canonicalBefore === canonicalAfter;
  const hasSemanticChanges = !structurallyIdentical;

  let diffSummary = "identical";
  if (hasSemanticChanges) {
    // Find first differing token for a useful summary
    const tokensBefore = canonicalBefore.split(" ");
    const tokensAfter = canonicalAfter.split(" ");
    let firstDiff = -1;
    for (let i = 0; i < Math.min(tokensBefore.length, tokensAfter.length); i++) {
      if (tokensBefore[i] !== tokensAfter[i]) { firstDiff = i; break; }
    }
    if (firstDiff >= 0) {
      const ctx = tokensBefore.slice(Math.max(0, firstDiff - 2), firstDiff + 3).join(" ");
      diffSummary = `First semantic diff at token ${firstDiff}: ...${ctx}...`;
    } else if (tokensBefore.length !== tokensAfter.length) {
      diffSummary = `Token count changed: ${tokensBefore.length} → ${tokensAfter.length}`;
    }
  }

  return { structurallyIdentical, hasSemanticChanges, canonicalBefore, canonicalAfter, diffSummary };
}

// ─── Normalized Snippet Matching ─────────────────────────────────────────────

/**
 * Try to find a snippet in a file using both exact and normalized matching.
 * Returns the matched text and the proposed content after applying the change.
 *
 * This is the core function that replaces the raw `includes()` check in
 * selfImprove.ts, eliminating false-positive conflicts.
 */
export function findAndApplySnippet(
  fileContent: string,
  originalSnippet: string,
  proposedSnippet: string
): SnippetMatchResult {
  // 1. Exact match (fastest path)
  if (fileContent.includes(originalSnippet)) {
    return {
      found: true,
      matchedSnippet: originalSnippet,
      normalizedMatch: false,
      proposedContent: fileContent.replace(originalSnippet, proposedSnippet),
    };
  }

  // 2. Trimmed-line match (handles indentation changes)
  const fileLines = fileContent.split("\n");
  const snippetLines = originalSnippet.split("\n").map(l => l.trim()).filter(Boolean);

  if (snippetLines.length > 0) {
    for (let i = 0; i <= fileLines.length - snippetLines.length; i++) {
      const window = fileLines.slice(i, i + snippetLines.length).map(l => l.trim());
      if (window.join("\n") === snippetLines.join("\n")) {
        // Found via trimmed match — reconstruct the actual matched text
        const matchedSnippet = fileLines.slice(i, i + snippetLines.length).join("\n");
        const proposedContent = [
          fileLines.slice(0, i).join("\n"),
          proposedSnippet,
          fileLines.slice(i + snippetLines.length).join("\n"),
        ].filter(s => s !== "").join("\n");
        return { found: true, matchedSnippet, normalizedMatch: true, proposedContent };
      }
    }
  }

  // 3. Canonical/AST match (handles comment and whitespace changes)
  try {
    const canonicalSnippet = canonicalize(originalSnippet);

    // Try to find a block in the file with the same canonical form
    // We do this by sliding a window of the same line count
    const snippetLineCount = originalSnippet.split("\n").length;
    const windowSizes = [snippetLineCount, snippetLineCount - 1, snippetLineCount + 1];

    for (const windowSize of windowSizes) {
      if (windowSize < 1) continue;
      for (let i = 0; i <= fileLines.length - windowSize; i++) {
        const window = fileLines.slice(i, i + windowSize).join("\n");
        if (canonicalize(window) === canonicalSnippet) {
          const proposedContent = [
            fileLines.slice(0, i).join("\n"),
            proposedSnippet,
            fileLines.slice(i + windowSize).join("\n"),
          ].filter(s => s !== "").join("\n");
          log.info(`[AstDiff] Found snippet via canonical match at line ${i + 1} (window=${windowSize})`);
          return { found: true, matchedSnippet: window, normalizedMatch: true, proposedContent };
        }
      }
    }
  } catch { /* non-fatal */ }

  return { found: false, normalizedMatch: false };
}

// ─── Conflict Detection ───────────────────────────────────────────────────────

/**
 * Determine if a proposal's originalSnippet conflicts with the current file state.
 * Returns true if the file has changed in a way that makes the proposal inapplicable.
 *
 * This is more lenient than a raw string check — it allows cosmetic changes.
 */
export function detectConflict(
  originalFileContent: string,  // file content when proposal was generated
  currentFileContent: string,   // file content now
  originalSnippet: string
): { conflicted: boolean; reason: string } {
  // If the snippet is still present (exact), no conflict
  if (currentFileContent.includes(originalSnippet)) {
    return { conflicted: false, reason: "exact match found" };
  }

  // If the file hasn't changed structurally, try normalized matching
  const diff = astDiff(originalFileContent, currentFileContent);
  if (diff.structurallyIdentical) {
    // Only cosmetic changes — snippet should still be findable via normalization
    const matchResult = findAndApplySnippet(currentFileContent, originalSnippet, "");
    if (matchResult.found) {
      return { conflicted: false, reason: "cosmetic-only changes, normalized match found" };
    }
  }

  // Check if the snippet itself is still semantically present
  const snippetCanonical = canonicalize(originalSnippet);
  const fileCanonical = canonicalize(currentFileContent);
  if (fileCanonical.includes(snippetCanonical.slice(0, Math.min(snippetCanonical.length, 100)))) {
    return { conflicted: false, reason: "semantic content still present in file" };
  }

  return {
    conflicted: true,
    reason: diff.hasSemanticChanges
      ? `File has semantic changes: ${diff.diffSummary}`
      : "Snippet not found after normalization",
  };
}
