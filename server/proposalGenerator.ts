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

// ─── v17.0.0: Genealogy-aware generation wrappers ─────────────────────────────

import { recordProposalGenerated } from "./proposalGenealogy.js";
import { log } from "./logger.js";

export interface GenerateOptions {
  area?: string;
  cycleId?: string;
  agentPersona?: string;
  parentIds?: string[];
}

export interface GenerateResult {
  proposal: import("./selfImprove.js").ImprovementProposal | null;
  genealogyId: string | null;
  durationMs: number;
}

/**
 * Generate a single improvement proposal for a target file with full
 * genealogy tracking. This is the v17 entry point.
 */
export async function generateProposal(
  targetFile: string,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const startMs = Date.now();
  const { area = "general", cycleId = `cycle-${Date.now()}`, agentPersona, parentIds = [] } = options;

  log.info(`[proposalGenerator] Generating for ${targetFile} (area: ${area})`);

  let proposal: import("./selfImprove.js").ImprovementProposal | null = null;
  try {
    const { analyzeAndPropose } = await import("./selfImprove.js");
    proposal = await analyzeAndPropose(targetFile, area);
  } catch (err) {
    log.error(`[proposalGenerator] analyzeAndPropose failed: ${err}`);
  }

  let genealogyId: string | null = null;
  if (proposal) {
    try {
      genealogyId = proposal.id;
      recordProposalGenerated({
        id: proposal.id,
        targetFile,
        cycleId,
        agentPersona: agentPersona ?? undefined,
        mergedFrom: parentIds,
        semanticSafetyScore: 0.5,
        rewardScore: 0,
      });
    } catch (err) {
      log.warn(`[proposalGenerator] Genealogy registration failed (non-fatal): ${err}`);
    }
  }

  return { proposal, genealogyId, durationMs: Date.now() - startMs };
}

/**
 * Generate proposals for multiple files in parallel.
 */
export async function generateProposalBatch(
  targetFiles: string[],
  options: GenerateOptions = {}
): Promise<GenerateResult[]> {
  const results = await Promise.allSettled(
    targetFiles.map(f => generateProposal(f, options))
  );
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    log.error(`[proposalGenerator] Batch item ${i} failed: ${r.reason}`);
    return { proposal: null, genealogyId: null, durationMs: 0 };
  });
}
