/**
 * failurePatternMemory.ts — Andromeda v5.68 SOTA Safety Architecture
 *
 * Stores and detects known failure patterns from past self-modification attempts.
 * When a modification fails (TypeScript error, integrity failure, safety violation),
 * the pattern is stored so the same mistake isn't repeated.
 *
 * This file is in the FORBIDDEN list and cannot be modified by self-improvement.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FailureType = "safety" | "typescript" | "integrity" | "runtime" | "review";

export type FailureRecord = {
  id: string;
  timestamp: number;
  filePath: string;
  rationale: string;
  failureType: FailureType;
  errorMessage: string;
  proposedBy: string;
  contentHash: string; // Hash of the proposed content that failed
  patternSignature: string; // Normalized signature for matching similar failures
};

export type FailureCheck = {
  hasKnownFailure: boolean;
  severity: "warn" | "block" | "none";
  matchedPattern?: string;
  previousError?: string;
  previousTimestamp?: number;
  similarFailureCount?: number;
};

export type RecordFailureInput = {
  filePath: string;
  rationale: string;
  failureType: FailureType;
  errorMessage: string;
  proposedBy: string;
  proposedContent?: string;
};

// ── Storage ───────────────────────────────────────────────────────────────────

function getStoragePath(): string {
  try {
    const serverDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(serverDir, "..", "data", "failure_patterns.jsonl");
  } catch {
    return path.resolve(process.cwd(), "data", "failure_patterns.jsonl");
  }
}

function ensureStorageDir(): void {
  const storePath = getStoragePath();
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadFailures(): FailureRecord[] {
  try {
    const storePath = getStoragePath();
    if (!fs.existsSync(storePath)) return [];
    const lines = fs.readFileSync(storePath, "utf8").split("\n").filter(l => l.trim());
    return lines.map(l => JSON.parse(l) as FailureRecord).filter(Boolean);
  } catch {
    return [];
  }
}

function appendFailure(record: FailureRecord): void {
  try {
    ensureStorageDir();
    const storePath = getStoragePath();
    fs.appendFileSync(storePath, JSON.stringify(record) + "\n", "utf8");
  } catch (e) {
    console.error("[FailurePatternMemory] Failed to store failure record:", e);
  }
}

// ── Pattern Signature Generation ──────────────────────────────────────────────

/**
 * Generate a normalized signature for a failure to enable fuzzy matching.
 * Strips line numbers, variable names, and timestamps from error messages.
 */
function generatePatternSignature(filePath: string, errorMessage: string, failureType: FailureType): string {
  const normalizedError = errorMessage
    .replace(/line \d+/gi, "line N")
    .replace(/column \d+/gi, "col N")
    .replace(/\d{4}-\d{2}-\d{2}/g, "DATE")
    .replace(/0x[0-9a-f]+/gi, "0xADDR")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, 200);

  const fileBase = path.basename(filePath);
  const raw = `${fileBase}:${failureType}:${normalizedError}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a failure for future pattern matching.
 */
export async function recordFailure(input: RecordFailureInput): Promise<void> {
  const contentHash = input.proposedContent
    ? crypto.createHash("sha256").update(input.proposedContent).digest("hex").slice(0, 12)
    : "unknown";

  const patternSignature = generatePatternSignature(
    input.filePath,
    input.errorMessage,
    input.failureType
  );

  const record: FailureRecord = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    filePath: input.filePath,
    rationale: input.rationale,
    failureType: input.failureType,
    errorMessage: input.errorMessage,
    proposedBy: input.proposedBy,
    contentHash,
    patternSignature,
  };

  appendFailure(record);
}

/**
 * Check if a proposed modification matches any known failure patterns.
 */
export async function checkFailurePattern(input: {
  filePath: string;
  proposedContent: string;
  rationale: string;
}): Promise<FailureCheck> {
  try {
    const failures = loadFailures();
    if (failures.length === 0) return { hasKnownFailure: false, severity: "none" };

    const contentHash = crypto.createHash("sha256")
      .update(input.proposedContent)
      .digest("hex")
      .slice(0, 12);

    const fileBase = path.basename(input.filePath);

    // Check for exact content hash match (same content that failed before)
    const exactMatch = failures.find(f => f.contentHash === contentHash);
    if (exactMatch) {
      return {
        hasKnownFailure: true,
        severity: "block",
        matchedPattern: `Exact content match (hash: ${contentHash})`,
        previousError: exactMatch.errorMessage,
        previousTimestamp: exactMatch.timestamp,
        similarFailureCount: 1,
      };
    }

    // Check for repeated failures on the same file with the same failure type
    const recentCutoff = Date.now() - 24 * 3600_000; // Last 24 hours
    const recentFileFailures = failures.filter(
      f => path.basename(f.filePath) === fileBase && f.timestamp > recentCutoff
    );

    if (recentFileFailures.length >= 3) {
      const mostRecent = recentFileFailures.sort((a, b) => b.timestamp - a.timestamp)[0];
      return {
        hasKnownFailure: true,
        severity: "warn",
        matchedPattern: `${recentFileFailures.length} failures on ${fileBase} in last 24h`,
        previousError: mostRecent.errorMessage,
        previousTimestamp: mostRecent.timestamp,
        similarFailureCount: recentFileFailures.length,
      };
    }

    return { hasKnownFailure: false, severity: "none" };
  } catch {
    return { hasKnownFailure: false, severity: "none" };
  }
}

/**
 * Get failure statistics for the diagnostic dashboard.
 */
export function getFailureStats(): {
  totalFailures: number;
  last24hFailures: number;
  topFailingFiles: Array<{ file: string; count: number }>;
  failuresByType: Record<FailureType, number>;
} {
  try {
    const failures = loadFailures();
    const recentCutoff = Date.now() - 24 * 3600_000;
    const recent = failures.filter(f => f.timestamp > recentCutoff);

    const fileCount = new Map<string, number>();
    const typeCount: Record<string, number> = {};

    for (const f of failures) {
      const base = path.basename(f.filePath);
      fileCount.set(base, (fileCount.get(base) || 0) + 1);
      typeCount[f.failureType] = (typeCount[f.failureType] || 0) + 1;
    }

    const topFailingFiles = Array.from(fileCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([file, count]) => ({ file, count }));

    return {
      totalFailures: failures.length,
      last24hFailures: recent.length,
      topFailingFiles,
      failuresByType: typeCount as Record<FailureType, number>,
    };
  } catch {
    return {
      totalFailures: 0,
      last24hFailures: 0,
      topFailingFiles: [],
      failuresByType: {} as Record<FailureType, number>,
    };
  }
}

/**
 * Clear old failure records (keep last 30 days).
 */
export function pruneOldFailures(): number {
  try {
    const failures = loadFailures();
    const cutoff = Date.now() - 30 * 24 * 3600_000;
    const kept = failures.filter(f => f.timestamp > cutoff);
    const pruned = failures.length - kept.length;

    if (pruned > 0) {
      ensureStorageDir();
      fs.writeFileSync(
        getStoragePath(),
        kept.map(f => JSON.stringify(f)).join("\n") + (kept.length > 0 ? "\n" : ""),
        "utf8"
      );
    }

    return pruned;
  } catch {
    return 0;
  }
}
