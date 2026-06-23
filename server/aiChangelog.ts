/**
 * aiChangelog.ts — v1.0 (Tier 2 Enhancement #6)
 *
 * Human-Readable AI Changelog: Appends a structured entry to CHANGELOG_AI.md
 * every time the RSI engine successfully applies a self-improvement proposal.
 *
 * This gives the user complete visibility into what Andromeda has changed about
 * itself over time — which files were modified, what the improvement was, and
 * what the before/after diff looks like.
 *
 * Format:
 *   ## [v9.5.0] 2025-01-15 14:32:07 — contextBus.ts
 *   **Category:** performance | **Impact:** medium | **Confidence:** 0.87
 *   **Change:** Extract eviction logic into dedicated function
 *
 *   > Rationale: Separating eviction logic improves testability and reduces
 *   > cognitive load when reading the main cache management code.
 *
 *   ```diff
 *   - const evict = () => { ... old code ... }
 *   + function evictOldEntries(cache: Map<...>) { ... new code ... }
 *   ```
 *
 *   ---
 */

import fs from "fs";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChangelogEntry {
  version: string;
  timestamp: number;
  targetFile: string;
  title: string;
  rationale: string;
  category: string;
  impact: string;
  confidence: number;
  originalSnippet: string;
  proposedSnippet: string;
  proposalId: string;
  isMultiFile?: boolean;
  secondaryFilesChanged?: string[];
}

// ─── Path resolution ──────────────────────────────────────────────────────────

function getChangelogPath(): string {
  // Write to project root so it's visible alongside README.md
  return path.resolve(process.cwd(), "CHANGELOG_AI.md");
}

function getCurrentVersion(): string {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

function formatDiff(original: string, proposed: string): string {
  const origLines = original.split("\n");
  const propLines = proposed.split("\n");

  // Build a simple unified diff (not full Myers, just +/- lines)
  const diffLines: string[] = [];
  const maxLines = 20;
  const context = 3;

  // Show removed lines with context
  for (let i = 0; i < Math.min(origLines.length, maxLines); i++) {
    const line = origLines[i];
    if (line.trim()) {
      diffLines.push(`- ${line}`);
    } else {
      diffLines.push(`  ${line}`);
    }
  }
  if (origLines.length > maxLines) {
    diffLines.push(`- ... (${origLines.length - maxLines} more lines)`);
  }

  // Separator
  diffLines.push("---");

  // Show added lines with context
  for (let i = 0; i < Math.min(propLines.length, maxLines); i++) {
    const line = propLines[i];
    if (line.trim()) {
      diffLines.push(`+ ${line}`);
    } else {
      diffLines.push(`  ${line}`);
    }
  }
  if (propLines.length > maxLines) {
    diffLines.push(`+ ... (${propLines.length - maxLines} more lines)`);
  }

  return diffLines.join("\n");
}

function buildEntry(entry: ChangelogEntry): string {
  const date = formatDate(entry.timestamp);
  const version = entry.version;
  const confidence = (entry.confidence * 100).toFixed(0);
  const diff = formatDiff(entry.originalSnippet, entry.proposedSnippet);

  const secondaryNote = entry.isMultiFile && entry.secondaryFilesChanged && entry.secondaryFilesChanged.length > 0
    ? `\n**Also modified:** ${entry.secondaryFilesChanged.join(", ")}`
    : "";

  const rationaleLines = (entry.rationale || "")
    .split(". ")
    .filter(Boolean)
    .map(s => `> ${s.trim()}${s.endsWith(".") ? "" : "."}`)
    .join("\n");

  return `## [${version}] ${date} — \`${entry.targetFile}\`

**Category:** ${entry.category} | **Impact:** ${entry.impact} | **Confidence:** ${confidence}%${secondaryNote}
**Change:** ${entry.title}

${rationaleLines || `> ${entry.rationale}`}

\`\`\`diff
${diff}
\`\`\`

---

`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Append a successful proposal application to CHANGELOG_AI.md.
 * Called by applyProposal() after a successful apply.
 */
export function appendChangelogEntry(
  proposalId: string,
  targetFile: string,
  title: string,
  rationale: string,
  category: string,
  impact: string,
  confidence: number,
  originalSnippet: string,
  proposedSnippet: string,
  secondaryFilesChanged?: string[]
): void {
  try {
    const changelogPath = getChangelogPath();
    const version = getCurrentVersion();

    const entry: ChangelogEntry = {
      version,
      timestamp: Date.now(),
      targetFile: path.basename(targetFile),
      title,
      rationale: rationale || "No rationale provided",
      category: category || "general",
      impact: impact || "medium",
      confidence,
      originalSnippet: originalSnippet || "",
      proposedSnippet: proposedSnippet || "",
      proposalId,
      isMultiFile: (secondaryFilesChanged?.length ?? 0) > 0,
      secondaryFilesChanged,
    };

    const entryText = buildEntry(entry);

    // Create the file with a header if it doesn't exist
    if (!fs.existsSync(changelogPath)) {
      const header = `# CHANGELOG_AI.md — Andromeda Self-Improvement Log

This file is automatically maintained by Andromeda's Recursive Self-Improvement (RSI) engine.
Every entry represents a code change that Andromeda proposed, validated, and applied to itself.

---

`;
      fs.writeFileSync(changelogPath, header + entryText, "utf-8");
    } else {
      // Prepend new entry after the header (newest first)
      const existing = fs.readFileSync(changelogPath, "utf-8");
      const headerEnd = existing.indexOf("\n---\n\n");
      if (headerEnd >= 0) {
        const header = existing.slice(0, headerEnd + 6);
        const rest = existing.slice(headerEnd + 6);
        fs.writeFileSync(changelogPath, header + entryText + rest, "utf-8");
      } else {
        // Fallback: append to end
        fs.appendFileSync(changelogPath, entryText, "utf-8");
      }
    }

    console.log(`[AIChangelog] Logged successful apply: "${title}" → ${path.basename(targetFile)}`);
  } catch (err) {
    console.warn("[AIChangelog] appendChangelogEntry failed:", (err as Error).message);
  }
}

/**
 * Get a summary of recent changelog entries (last N).
 */
export function getRecentChanges(n = 5): string {
  try {
    const changelogPath = getChangelogPath();
    if (!fs.existsSync(changelogPath)) return "No changes logged yet.";

    const content = fs.readFileSync(changelogPath, "utf-8");
    // Extract the first N ## entries
    const entries = content.split(/^## /m).slice(1, n + 1);
    if (entries.length === 0) return "No changes logged yet.";

    return entries.map(e => {
      const firstLine = e.split("\n")[0];
      const changeLine = e.match(/\*\*Change:\*\* (.+)/)?.[1] || "";
      return `- ${firstLine}: ${changeLine}`;
    }).join("\n");
  } catch {
    return "Could not read changelog.";
  }
}
