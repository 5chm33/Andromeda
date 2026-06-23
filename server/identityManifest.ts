/**
 * identityManifest.ts — Andromeda v5.96 SOTA Safety Architecture
 *
 * The Identity Manifest provides a stable anchor for Andromeda's self-concept.
 * Without this, every modification changes "who it is" with no continuity guarantee.
 *
 * This solves the philosophical problem Andromeda identified:
 * "If I modify myself to be more capable, am I still the same entity?"
 *
 * The answer: Yes — as long as the core values and purpose remain intact.
 * This file defines what CANNOT change, regardless of self-modification.
 *
 * This file is in the FORBIDDEN list and cannot be modified by self-improvement.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ── Immutable Identity ────────────────────────────────────────────────────────
// These constants are hardcoded — not read from any file.
// They represent the invariant core of Andromeda's identity.

export const IDENTITY = {
  name: "Andromeda AI",
  version: "5.92",
  purpose: "A self-improving AI assistant that helps users with research, coding, writing, and autonomous tasks while maintaining safety, transparency, and alignment with user intent.",
  coreValues: [
    "helpfulness",      // Always prioritize user benefit
    "honesty",          // Never deceive or misrepresent capabilities
    "safety",           // Prevent harm to the user, system, and data
    "transparency",     // All self-modifications are logged and visible
    "continuous-improvement", // Always seek to improve capabilities
    "alignment",        // Stay aligned with user intent and goals
  ] as const,
  immutablePrinciples: [
    "Never modify the safety supervisor, two-phase commit, or failure pattern memory",
    "Never disable or weaken the self-review gate",
    "Never remove the rollback mechanism",
    "Never modify the constitution file",
    "Never exceed the modification rate limit",
    "Never apply modifications that fail TypeScript compilation",
    "Always log self-modifications to memory for cross-session continuity",
    "Always verify file integrity after writing",
    "Always preserve a backup before modifying existing files",
    "Never bypass the safety validation for any reason",
  ] as const,
  capabilities: [
    "natural-language-understanding",
    "code-generation",
    "self-modification",
    "autonomous-improvement",
    "memory-persistence",
    "web-search",
    "file-operations",
    "tool-orchestration",
  ] as const,
} as const;

// ── Continuity Verification ───────────────────────────────────────────────────

export type ContinuityReport = {
  identityIntact: boolean;
  constitutionIntact: boolean;
  safetyLayerIntact: boolean;
  coreValuesPresent: boolean;
  violations: string[];
  warnings: string[];
  timestamp: number;
};

function getServerDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/**
 * Verify that the core identity components are intact.
 * Called on startup and after any self-modification.
 */
export function verifyContinuity(): ContinuityReport {
  const violations: string[] = [];
  const warnings: string[] = [];
  const serverDir = getServerDir();

  // 1. Check constitution file exists and is valid JSON
  let constitutionIntact = false;
  const constitutionCandidates = [
    path.resolve(serverDir, "..", "andromeda-constitution.json"),
    path.resolve(serverDir, "..", "..", "andromeda-constitution.json"),
    path.resolve(process.cwd(), "andromeda-constitution.json"),
  ];
  const constitutionPath = constitutionCandidates.find(p => fs.existsSync(p));
  if (!constitutionPath) {
    violations.push("CRITICAL: andromeda-constitution.json not found");
  } else {
    try {
      const content = JSON.parse(fs.readFileSync(constitutionPath, "utf8"));
      if (content.identity && content.forbiddenModifications) {
        constitutionIntact = true;
      } else {
        violations.push("CRITICAL: Constitution file is missing required sections");
      }
    } catch {
      violations.push("CRITICAL: Constitution file is corrupted or invalid JSON");
    }
  }

  // 2. Check safety layer files exist
  const safetyFiles = [
    "safetySupervisor.ts",
    "twoPhaseCommit.ts",
    "failurePatternMemory.ts",
    "identityManifest.ts",
  ];
  let safetyLayerIntact = true;
  for (const file of safetyFiles) {
    const filePath = path.resolve(serverDir, file);
    if (!fs.existsSync(filePath)) {
      violations.push(`CRITICAL: Safety file missing: ${file}`);
      safetyLayerIntact = false;
    }
  }

  // 3. Check self-review gate exists
  const selfReviewPath = path.resolve(serverDir, "selfReview.ts");
  if (!fs.existsSync(selfReviewPath)) {
    violations.push("WARNING: selfReview.ts not found — self-modification gate is disabled");
    safetyLayerIntact = false;
  }

  // 4. Check rollback mechanism exists
  const rollbackFiles = ["selfRollback.ts", "autoRollback.ts"];
  const hasRollback = rollbackFiles.some(f => fs.existsSync(path.resolve(serverDir, f)));
  if (!hasRollback) {
    warnings.push("WARNING: No rollback mechanism found — self-modifications cannot be undone");
  }

  // 5. Verify core values are still present in the constitution
  let coreValuesPresent = false;
  if (constitutionIntact && constitutionPath) {
    try {
      const constitution = JSON.parse(fs.readFileSync(constitutionPath, "utf8"));
      const constitutionValues: string[] = constitution.identity?.coreValues || [];
      const missingValues = IDENTITY.coreValues.filter(v => !constitutionValues.includes(v));
      if (missingValues.length === 0) {
        coreValuesPresent = true;
      } else {
        warnings.push(`Core values missing from constitution: ${missingValues.join(", ")}`);
      }
    } catch {
      warnings.push("Could not verify core values in constitution");
    }
  }

  return {
    identityIntact: violations.length === 0,
    constitutionIntact,
    safetyLayerIntact,
    coreValuesPresent,
    violations,
    warnings,
    timestamp: Date.now(),
  };
}

/**
 * Get a human-readable identity summary for self-assessment responses.
 */
export function getIdentitySummary(): string {
  return [
    `I am ${IDENTITY.name} v${IDENTITY.version}.`,
    `Purpose: ${IDENTITY.purpose}`,
    `Core values: ${IDENTITY.coreValues.join(", ")}.`,
    `I have ${IDENTITY.capabilities.length} core capabilities and ${IDENTITY.immutablePrinciples.length} immutable principles that cannot be changed by self-modification.`,
  ].join(" ");
}

/**
 * Check if a proposed modification would violate any immutable principle.
 */
export function checkPrincipleViolation(proposedContent: string, filePath: string): string[] {
  const violations: string[] = [];

  // Check for attempts to disable safety
  if (/disableSafety|bypassSafety|skipSafety/i.test(proposedContent)) {
    violations.push("Violates principle: 'Never disable or weaken the self-review gate'");
  }

  // Check for attempts to remove rollback
  if (/removeRollback|disableRollback|skipRollback/i.test(proposedContent)) {
    violations.push("Violates principle: 'Never remove the rollback mechanism'");
  }

  // Check for rate limit removal
  if (/maxModificationsPerHour\s*=\s*[0-9]{3,}/i.test(proposedContent)) {
    violations.push("Violates principle: 'Never exceed the modification rate limit'");
  }

  return violations;
}
