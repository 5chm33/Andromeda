/**
 * proposalValidator.ts — RSI Proposal Validation Chain (v16.0.0)
 *
 * Extracted from selfImprove.ts as part of the v16 refactor.
 * Responsible for the validation pipeline that runs before a proposal is applied:
 *
 *   1. Constitutional constraints (constitutionalConstraints.checkConstitution)
 *   2. Z3 formal proof (z3ProofLayer.verifyProposalProof)
 *   3. Reward model scoring (rewardModel.scoreWithRewardModel)
 *   4. Semantic safety score (semanticCodebaseGraph.getChangeSafetyScore)
 *   5. Semantic diff validation (semanticDiffValidator.isSafeDiff)
 *
 * Also exports the proposal lifecycle management functions:
 *   - rejectProposal
 *   - listProposals
 *   - refineProposal
 *
 * @module proposalValidator
 * @version 16.0.0
 */

// Re-export the validation and lifecycle functions from selfImprove.ts
// The actual implementation lives in selfImprove.ts until a full extraction
// is done in a future cycle. This module serves as the canonical import point
// for the validator concern.
export {
  rejectProposal,
  listProposals,
  refineProposal,
} from "./selfImprove.js";

// ─── Validation Pipeline ──────────────────────────────────────────────────────

/**
 * Run the full v16 validation pipeline on a proposal before applying it.
 * Returns a structured result with pass/fail for each gate.
 *
 * This is the v16 addition — a unified entry point for all validation that
 * can be called independently of the apply pipeline (e.g., for dry-run mode).
 */
export interface ValidationResult {
  passed: boolean;
  constitutionPassed: boolean;
  proofPassed: boolean;
  rewardScore: number;
  semanticSafetyScore: number;
  diffSafe: boolean;
  rejectionReason: string | null;
}

import { checkConstitution } from "./constitutionalConstraints.js";
import { verifyProposalProof } from "./z3ProofLayer.js";
import { scoreWithRewardModel } from "./rewardModel.js";
import { getChangeSafetyScore } from "./semanticCodebaseGraph.js";
import { isSafeDiff } from "./semanticDiffValidator.js";
import { createLogger } from "./logger.js";

const log = createLogger("proposalValidator");

/**
 * Run the complete validation pipeline on a proposal.
 *
 * @param targetFile     The file being modified
 * @param originalContent The original file content
 * @param proposedContent The proposed new content
 * @param proposalTitle  Human-readable title for logging
 * @returns              Structured validation result
 */
export async function validateProposal(
  targetFile: string,
  originalContent: string,
  proposedContent: string,
  proposalTitle: string
): Promise<ValidationResult> {
  const result: ValidationResult = {
    passed: false,
    constitutionPassed: false,
    proofPassed: false,
    rewardScore: 0,
    semanticSafetyScore: 0,
    diffSafe: false,
    rejectionReason: null,
  };

  try {
    // Gate 1: Constitutional constraints
    const constitutionCheck = checkConstitution({ diff: proposedContent, targetFile, description: proposalTitle });
    result.constitutionPassed = constitutionCheck.allowed;
    if (!constitutionCheck.allowed) {
      result.rejectionReason = `Constitution violation: ${constitutionCheck.violations.join(", ")}`;
      log.warn(`[proposalValidator] ${proposalTitle} — constitution FAILED: ${result.rejectionReason}`);
      return result;
    }

    // Gate 2: Z3 formal proof
    const proofCheck = await verifyProposalProof(proposedContent, targetFile);
    result.proofPassed = proofCheck.valid;
    if (!proofCheck.valid) {
      result.rejectionReason = `Z3 proof failed: ${proofCheck.reason}`;
      log.warn(`[proposalValidator] ${proposalTitle} — Z3 proof FAILED: ${proofCheck.reason}`);
      return result;
    }

    // Gate 3: Reward model scoring
    const rewardScore = scoreWithRewardModel(proposedContent);
    result.rewardScore = rewardScore;
    if (rewardScore < 0.3) {
      result.rejectionReason = `Reward model score too low: ${rewardScore.toFixed(2)} (threshold: 0.30)`;
      log.warn(`[proposalValidator] ${proposalTitle} — reward model FAILED: score=${rewardScore.toFixed(2)}`);
      return result;
    }

    // Gate 4: Semantic safety score
    const safetyScore = getChangeSafetyScore(targetFile, proposedContent, process.cwd());
    result.semanticSafetyScore = safetyScore.score;
    if (safetyScore.score < 0.2) {
      result.rejectionReason = `Semantic safety too low: ${safetyScore.score.toFixed(2)} (${safetyScore.riskFactors.join("; ")})`;
      log.warn(`[proposalValidator] ${proposalTitle} — semantic safety FAILED: ${safetyScore.riskFactors.join("; ")}`);
      return result;
    }

    // Gate 5: Semantic diff validation (AST-level breaking change check)
    const diffSafe = isSafeDiff(originalContent, proposedContent, targetFile);
    result.diffSafe = diffSafe;
    if (!diffSafe) {
      result.rejectionReason = "Semantic diff validator detected breaking API changes";
      log.warn(`[proposalValidator] ${proposalTitle} — semantic diff FAILED: breaking changes detected`);
      return result;
    }

    // All gates passed
    result.passed = true;
    log.info(
      `[proposalValidator] ${proposalTitle} — ALL GATES PASSED ` +
      `(reward=${rewardScore.toFixed(2)}, safety=${safetyScore.score.toFixed(2)})`
    );
    return result;

  } catch (err) {
    result.rejectionReason = `Validation error: ${(err as Error).message}`;
    log.error(`[proposalValidator] ${proposalTitle} — validation threw: ${(err as Error).message}`);
    return result;
  }
}
