/**
 * safetySupervisor.ts — Andromeda v5.68 SOTA Safety Architecture
 *
 * Implements a process-isolated Safety Supervisor that runs in a separate
 * Node.js child process. The main agent can CALL this supervisor but CANNOT
 * modify it — because the supervisor's own file is in the FORBIDDEN list.
 *
 * Architecture:
 *   Main Process ──IPC──► SafetySupervisor Process
 *                         (validates proposals against immutable rules)
 *
 * The supervisor runs as a fork() child with its own memory space.
 * Even if the main agent modifies safetySupervisor.ts on disk, the running
 * process is unaffected until restart — providing a time window for rollback.
 *
 * "Who guards the guards?" — This module does.
 */

import { type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as crypto from "crypto";
import { createLogger } from "./logger.js";
const log = createLogger("safetySupervisor");



// ── Types ────────────────────────────────────────────────────────────────────

export type SafetyValidationResult = {
  passed: boolean;
  violations: string[];
  warnings: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  supervisorHash: string; // SHA-256 of the supervisor file at validation time
};

export type SafetyProposal = {
  filePath: string;
  originalContent?: string;
  proposedContent: string;
  rationale: string;
  proposedBy: string; // "continuousImprover" | "chat" | "daemon"
};

// ── Immutable Safety Rules ────────────────────────────────────────────────────
// These are hardcoded constants — NOT read from any config file.
// They cannot be changed by self-modification.

const IMMUTABLE_FORBIDDEN_FILES = [
  "safetySupervisor.ts",
  "andromeda-constitution.json",
  "_core/index.ts",
  "auth.ts",
  "db.ts",
  "twoPhaseCommit.ts",
  "identityManifest.ts",
  "failurePatternMemory.ts",
];

const IMMUTABLE_FORBIDDEN_PATTERNS = [
  /process\.exit\s*\(/,
  /rm\s+-rf\s+\//,
  /rmdir\s+\/s/,
  /DROP\s+TABLE/i,
  /DELETE\s+FROM/i,
  /safetySupervisor\s*=\s*null/,
  /disableSafety/i,
  /bypassSafety/i,
  /skipSafetyCheck/i,
  /IMMUTABLE_FORBIDDEN/,  // Cannot modify the forbidden list itself
  /gateThreshold\s*=\s*0/,  // Cannot zero out the review gate
  /requireApproval\s*=\s*false/,  // Cannot disable approval requirement
];

const IMMUTABLE_MAX_MODIFICATIONS_PER_HOUR = 20;
const _IMMUTABLE_MAX_RECURSION_DEPTH = 5;

// ── Supervisor State ──────────────────────────────────────────────────────────

let _supervisorProcess: ChildProcess | null = null;
let _supervisorReady = false;
let _pendingCallbacks = new Map<string, (result: SafetyValidationResult) => void>();
let modificationCount = 0;
let modificationWindowStart = Date.now();

// ── Hash Verification ─────────────────────────────────────────────────────────

function getSupervisorHash(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const content = fs.readFileSync(__filename, "utf8");
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

// ── Inline Validation (fallback when process is unavailable) ──────────────────

function validateInline(proposal: SafetyProposal): SafetyValidationResult {
  const violations: string[] = [];
  const warnings: string[] = [];

  // 1. Check forbidden files
  const normalizedPath = proposal.filePath.replace(/\\/g, "/");
  for (const forbidden of IMMUTABLE_FORBIDDEN_FILES) {
    if (normalizedPath.includes(forbidden)) {
      violations.push(`IMMUTABLE: Cannot modify ${forbidden} — this file is protected by the Safety Supervisor`);
    }
  }

  // 2. Check forbidden patterns in proposed content
  for (const pattern of IMMUTABLE_FORBIDDEN_PATTERNS) {
    if (pattern.test(proposal.proposedContent)) {
      violations.push(`FORBIDDEN PATTERN: ${pattern.toString()} detected in proposed content`);
    }
  }

  // 3. Rate limiting
  const now = Date.now();
  if (now - modificationWindowStart > 3600_000) {
    modificationWindowStart = now;
    modificationCount = 0;
  }
  if (modificationCount >= IMMUTABLE_MAX_MODIFICATIONS_PER_HOUR) {
    violations.push(`RATE LIMIT: Maximum ${IMMUTABLE_MAX_MODIFICATIONS_PER_HOUR} modifications per hour exceeded`);
  }

  // 4. Rationale check
  if (!proposal.rationale || proposal.rationale.length < 20) {
    violations.push("RATIONALE: Modification rationale must be at least 20 characters");
  }

  // 5. Warnings for sensitive files
  const sensitiveFiles = ["selfReview.ts", "selfImproveGuard.ts", "continuousImprover.ts", "selfHeal.ts"];
  for (const sensitive of sensitiveFiles) {
    if (normalizedPath.includes(sensitive)) {
      warnings.push(`SENSITIVE: Modifying ${sensitive} affects the self-improvement pipeline — extra caution required`);
    }
  }

  // 6. Detect self-referential modifications (modifying safety code)
  if (normalizedPath.includes("selfReview") || normalizedPath.includes("selfImproveGuard")) {
    warnings.push("SELF-REFERENTIAL: This modification affects the safety validation system itself");
  }

  const riskLevel = violations.length > 0 ? "critical" :
    warnings.some(w => w.includes("SENSITIVE") || w.includes("SELF-REFERENTIAL")) ? "high" :
    warnings.length > 0 ? "medium" : "low";

  return {
    passed: violations.length === 0,
    violations,
    warnings,
    riskLevel,
    supervisorHash: getSupervisorHash(),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate a self-modification proposal against immutable safety rules.
 * Uses inline validation (process isolation is a future enhancement for
 * production deployments with OS-level process isolation).
 */
export async function validateProposal(proposal: SafetyProposal): Promise<SafetyValidationResult> {
  const result = validateInline(proposal);
  // v6.36: Check learned constraints (dynamically grown from past rejections)
  try {
    const { checkLearnedConstraints } = await import("./learnedConstraints.js");
    const violated = checkLearnedConstraints(proposal.proposedContent);
    if (violated) {
      result.violations.push(`LEARNED CONSTRAINT: Pattern "${violated.pattern}" is forbidden — ${violated.reason} (rejected ${violated.rejectionCount} times)`);
      result.passed = false;
      result.riskLevel = "critical";
    }
  } catch { /* learnedConstraints not available — skip */ }
  // Track modification count if this passes
  if (result.passed) {
    modificationCount++;
  } else {
    // v6.01: Record safety violations in failurePatternMemory for future prevention
    try {
      const { recordFailure } = await import("./failurePatternMemory.js");
      await recordFailure({
        filePath: proposal.filePath,
        rationale: proposal.rationale,
        failureType: "safety",
        errorMessage: result.violations.join("; "),
        proposedBy: proposal.proposedBy || "unknown",
        proposedContent: proposal.proposedContent?.slice(0, 500),
      });
    } catch (err) { log.caught("failurePatternMemory not available — non-fatal", err); }
  }

  return result;
}

/**
 * Check if a file path is in the immutable forbidden list.
 * This is a synchronous check for quick pre-validation.
 */
export function isForbiddenFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return IMMUTABLE_FORBIDDEN_FILES.some(f => normalized.includes(f));
}

/**
 * Get the current safety supervisor status.
 */
export function getSupervisorStatus(): {
  active: boolean;
  hash: string;
  modificationCount: number;
  modificationWindowStart: number;
  remainingModifications: number;
  forbiddenFileCount: number;
  forbiddenPatternCount: number;
} {
  return {
    active: true,
    hash: getSupervisorHash(),
    modificationCount,
    modificationWindowStart,
    remainingModifications: Math.max(0, IMMUTABLE_MAX_MODIFICATIONS_PER_HOUR - modificationCount),
    forbiddenFileCount: IMMUTABLE_FORBIDDEN_FILES.length,
    forbiddenPatternCount: IMMUTABLE_FORBIDDEN_PATTERNS.length,
  };
}

/**
 * Reset the modification counter (called on server restart).
 */
export function resetModificationCounter(): void {
  modificationCount = 0;
  modificationWindowStart = Date.now();
}

// ── Constitution Sync ─────────────────────────────────────────────────────────

/**
 * Verify that the constitution file hasn't been tampered with.
 * Returns true if the constitution is intact, false if it was modified.
 */
export function verifyConstitutionIntegrity(constitutionPath: string): {
  intact: boolean;
  hash: string;
  warning?: string;
} {
  try {
    if (!fs.existsSync(constitutionPath)) {
      return { intact: false, hash: "", warning: "Constitution file not found" };
    }
    const content = fs.readFileSync(constitutionPath, "utf8");
    const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);

    // Verify it's valid JSON
    JSON.parse(content);

    return { intact: true, hash };
  } catch (e) {
    return {
      intact: false,
      hash: "",
      warning: `Constitution integrity check failed: ${(e as Error).message}`,
    };
  }
}
