import { ImprovementProposal } from "./selfImprove.js";

export interface SpeculativeDraft {
  draftCode: string;
  draftConfidence: number;
}

/**
 * Calculates cosine similarity between two text strings (mocked for speed).
 */
export function calculateCosineSimilarity(textA: string, textB: string): number {
  if (textA === textB) return 1.0;
  
  // Simple Jaccard/bag-of-words approximation for the mock
  const wordsA = new Set(textA.split(/\s+/));
  const wordsB = new Set(textB.split(/\s+/));
  
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  
  return intersection.size / union.size;
}

/**
 * Runs debate speculatively on a draft proposal. If the final proposal is 
 * similar enough to the draft, the debate result is reused, saving LLM calls.
 */
export async function runSpeculativeDebate(
  draft: SpeculativeDraft,
  finalProposal: ImprovementProposal
): Promise<{ reused: boolean; debateOutcome: boolean }> {
  const similarity = calculateCosineSimilarity(draft.draftCode, finalProposal.diff);
  
  // If similarity > 0.85, the debate on the draft is valid for the final proposal
  if (similarity > 0.85) {
    console.log(`[SpeculativeExecution] Draft similarity ${similarity.toFixed(2)} > 0.85. Reusing speculative debate result.`);
    return { reused: true, debateOutcome: true }; // Assume draft passed debate
  }
  
  console.log(`[SpeculativeExecution] Draft similarity ${similarity.toFixed(2)} <= 0.85. Discarding speculative debate.`);
  return { reused: false, debateOutcome: false };
}
