/**
 * packages/policy-promotion/index.ts — Policy & Promotion Package Boundary
 * Andromeda v5.0 (Elicit recommendation #6)
 *
 * Public API for the policy-promotion package.
 * Contains: selfImproveGuard (promotion contract), RBAC,
 *           privilege separation, recursion guard.
 *
 * PROMOTION CONTRACT — A change may only reach main if ALL of the following hold:
 *   1. Patch applies exactly (no fuzzy recovery unless explicitly opted in)
 *   2. Changed files are on the allowlist (not in the security perimeter)
 *   3. Tests actually executed (not timed out, not killed, not skipped)
 *   4. TypeScript compiles with zero errors
 *   5. Constitutional constraints pass (or fail closed if unavailable)
 *   6. A signed evidence bundle is attached to the commit
 *
 * See: SAFETY.md for the fail-open vs. fail-closed design rationale.
 * See: THREAT_MODEL.md for the adversarial threat surface.
 */

// Promotion guard — enforces the promotion contract
export {
  runTests,
  guardedApply,
  rollbackToBackup,
  getGuardConfig,
  updateGuardConfig,
  listBackups,
  generateDiffPreview,
} from "../../selfImproveGuard.js";
export type { GuardConfig, BackupEntry, GuardAuditEntry } from "../../selfImproveGuard.js";

// Daemon startup control — used by test isolation
export { isBackgroundDaemonStartupEnabled } from "../../_core/initDaemons.js";

// RBAC — role-based access control for agent operations
export type { Role } from "../../rbac.js";
export {
  roleAtLeast,
  requireRole,
  requireAdmin,
  requireOperator,
  requireEditor,
  requireSystem,
} from "../../rbac.js";

// Recursion guard — prevents infinite self-improvement loops
export {
  canModify,
  recordModification,
  enterRecursion,
  exitRecursion,
  resetGuard,
  getGuardStats,
} from "../../recursionGuard.js";
