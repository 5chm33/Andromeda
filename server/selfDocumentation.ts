/**
 * selfDocumentation.ts — v5.16
 *
 * Self-Documentation Updater Module.
 *
 * After successful self-improvement, this module auto-updates ANDROMEDA.md
 * with a changelog entry documenting what was changed and why.
 *
 * Features:
 * - Appends structured changelog entries to ANDROMEDA.md
 * - Maintains a "Recent Changes" section at the top
 * - Records version, timestamp, affected file, and summary
 * - Can be triggered automatically after applyProposal or manually via API
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChangelogEntry {
  version: string;
  timestamp: string;
  change: string;
  category?: string;
  targetFile?: string;
  automated?: boolean;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

function getServerDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function getAndromedaMdPath(): string {
  return path.resolve(getServerDir(), "..", "ANDROMEDA.md");
}

function getChangelogPath(): string {
  const cwd = process.cwd();
  if (!cwd) {
    throw new Error("process.cwd() returned undefined");
  }
  const workspaceDir = path.resolve(cwd, "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".andromeda_changelog.json");
}

// ─── Changelog Store ──────────────────────────────────────────────────────────

function loadChangelog(): ChangelogEntry[] {
  const p = getChangelogPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as ChangelogEntry[];
  } catch {
    return [];
  }
}

function saveChangelog(entries: ChangelogEntry[]): void {
  fs.writeFileSync(getChangelogPath(), JSON.stringify(entries, null, 2), "utf-8");
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Update ANDROMEDA.md with a new changelog entry.
 * Also persists to the JSON changelog for structured access.
 */
export function updateSelfDocumentation(
  change: string,
  version: string = "5.16.0",
  options: { category?: string; targetFile?: string; automated?: boolean } = {}
): { success: boolean; message: string; entry: ChangelogEntry } {
  const entry: ChangelogEntry = {
    version,
    timestamp: new Date().toISOString(),
    change,
    category: options.category || "self-improvement",
    targetFile: options.targetFile,
    automated: options.automated ?? true,
  };

  // 1. Persist to JSON changelog
  const changelog = loadChangelog();
  changelog.unshift(entry); // newest first
  // Keep last 100 entries
  if (changelog.length > 100) changelog.length = 100;
  saveChangelog(changelog);

  // 2. Update ANDROMEDA.md
  const mdPath = getAndromedaMdPath();
  let mdContent = "";

  if (fs.existsSync(mdPath)) {
    mdContent = fs.readFileSync(mdPath, "utf-8");
  } else {
    // Create initial ANDROMEDA.md
    mdContent = `# ANDROMEDA — Persistent Memory & Changelog

This file is automatically maintained by Andromeda's self-documentation system.
It records self-improvements, configuration changes, and system events.

---

## Recent Changes

`;
  }

  // Format the entry as markdown
  const dateStr = new Date(entry.timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const entryMd = `- **[v${entry.version}]** ${dateStr} — ${entry.change}${
    entry.targetFile ? ` (\`${entry.targetFile}\`)` : ""
  }${entry.automated ? " [auto]" : ""}\n`;

  // Insert after "## Recent Changes" header
  const recentChangesHeader = "## Recent Changes";
  const headerIdx = mdContent.indexOf(recentChangesHeader);

  if (headerIdx >= 0) {
    const insertIdx = headerIdx + recentChangesHeader.length;
    // Find the next newline after the header
    const nextNewline = mdContent.indexOf("\n", insertIdx);
    if (nextNewline >= 0) {
      mdContent =
        mdContent.slice(0, nextNewline + 1) +
        "\n" +
        entryMd +
        mdContent.slice(nextNewline + 1);
    } else {
      mdContent += "\n\n" + entryMd;
    }
  } else {
    // No "Recent Changes" section — append at end
    mdContent += `\n## Recent Changes\n\n${entryMd}`;
  }

  fs.writeFileSync(mdPath, mdContent, "utf-8");

  return {
    success: true,
    message: `Documented: ${change}`,
    entry,
  };
}

/**
 * Get the full changelog as structured data.
 */
export function getChangelog(limit: number = 50): ChangelogEntry[] {
  return loadChangelog().slice(0, limit);
}

/**
 * Record a self-improvement application in the documentation.
 * Called automatically after successful applyProposal.
 */
export function documentSelfImprovement(
  targetFile: string,
  title: string,
  category: string,
  version: string = "5.16.0"
): void {
  try {
    updateSelfDocumentation(
      `Self-improvement applied: ${title}`,
      version,
      { category, targetFile, automated: true }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[SelfDoc] Failed to document improvement:", message);
  }
}

/**
 * Record a system event (startup, config change, etc.).
 */
export function documentSystemEvent(
  event: string,
  version: string = "5.16.0"
): void {
  try {
    updateSelfDocumentation(event, version, { category: "system", automated: true });
  } catch (err) {
    console.warn("[SelfDoc] Failed to document event:", (err as Error).message);
  }
}
