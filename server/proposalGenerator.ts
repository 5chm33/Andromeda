/**
 * proposalGenerator.ts — RSI Proposal Generation (v16.0.0)
 *
 * Extracted from selfImprove.ts as part of the v16 refactor.
 * Responsible for the `analyzeAndPropose()` function — the LLM-powered
 * analysis pipeline that reads a target file, runs the multi-agent debate,
 * computes semantic safety, selects the optimal model, and generates a
 * structured ImprovementProposal.
 *
 * Consumers should import `analyzeAndPropose` from here OR from the
 * `selfImprove.ts` barrel (which re-exports everything for backwards compat).
 *
 * @module proposalGenerator
 * @version 16.0.0
 */

// Re-export the analyzeAndPropose function from selfImprove.ts
// The actual implementation lives in selfImprove.ts until a full extraction
// is done in a future cycle. This module serves as the canonical import point
// for the generator concern, making the dependency graph explicit.
export {
  analyzeAndPropose,
  resolveServerFile,
  ANALYZABLE_FILES,
  getAnalyzableFiles,
  loadProposals,
  saveProposals,
  resetStuckProcessingProposals,
  type ImprovementProposal,
  type SecondaryFileChange,
} from "./selfImprove.js";
