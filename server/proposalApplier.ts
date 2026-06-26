/**
 * proposalApplier.ts — RSI Proposal Application Pipeline (v16.0.0)
 *
 * Extracted from selfImprove.ts as part of the v16 refactor.
 * Responsible for the `applyProposal()` function — the guarded apply pipeline
 * that backs up files, applies diffs, runs TypeScript type-checking, runs the
 * CI regression gate, validates with the semantic diff validator, records
 * pattern outcomes, and rolls back on failure.
 *
 * The pipeline order is:
 *   1. Backup (selfRollback.createSnapshot)
 *   2. Apply diff (applyPatch)
 *   3. TypeScript check (tsc --noEmit)
 *   4. CI regression gate (ciRegressionGuard.runTestSuiteGate)
 *   5. Semantic diff validation (semanticDiffValidator.isSafeDiff)
 *   6. Record pattern outcome (epistemicBeliefModel.recordPatternOutcome)
 *   7. Record fine-tuning example (continuousFineTuner.recordSuccess)
 *   8. Git commit (gitSandbox.gitCommitSelfImprovement)
 *   9. Transaction commit (transactionLog.commitTransaction)
 *
 * On any failure: rollback → transaction rollback → record failure pattern.
 *
 * @module proposalApplier
 * @version 16.0.0
 */

// Re-export the apply functions from selfImprove.ts
// The actual implementation lives in selfImprove.ts until a full extraction
// is done in a future cycle. This module serves as the canonical import point
// for the applier concern.
export {
  applyProposal,
  autoApplyHighConfidence,
  getAutoApplyConfig,
  setAutoApplyConfig,
  getAutoApplyStatus,
  type AutoApplyConfig,
  type AutoApplyResult,
} from "./selfImprove.js";
