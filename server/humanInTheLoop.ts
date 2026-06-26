import { ImprovementProposal } from "./selfImprove.js";
import { collectTrainingPair } from "./emergentFineTuner.js";

export interface HumanReviewResult {
  approved: boolean;
  humanEditedCode?: string;
  feedback?: string;
}

const pendingReviews = new Map<string, { proposal: ImprovementProposal; resolve: (result: HumanReviewResult) => void }>();

/**
 * Simulates posting a proposal to a Slack/Discord channel for human review.
 * In production, this would use the Slack Web API.
 */
export async function requestHumanReview(proposal: ImprovementProposal): Promise<HumanReviewResult> {
  console.log(`[HumanInTheLoop] Requesting human review for proposal ${proposal.id} (confidence: ${proposal.confidence?.toFixed(1) || 0}%)`);
  
  return new Promise((resolve) => {
    pendingReviews.set(proposal.id, { proposal, resolve });
    
    // Simulate a human responding after some time (or auto-approving in tests)
    setTimeout(() => {
      if (pendingReviews.has(proposal.id)) {
        console.log(`[HumanInTheLoop] Auto-resolving review for ${proposal.id} (simulation)`);
        const result: HumanReviewResult = { approved: true, feedback: "Looks good, auto-approved." };
        resolveReview(proposal.id, result);
      }
    }, 5000);
  });
}

/**
 * Called by the webhook endpoint when a human clicks "Approve" or "Reject" in Slack.
 */
export function resolveReview(proposalId: string, result: HumanReviewResult) {
  const pending = pendingReviews.get(proposalId);
  if (pending) {
    pending.resolve(result);
    pendingReviews.delete(proposalId);
    
    // If human edited the code, it's gold-tier training data
    if (result.approved && result.humanEditedCode) {
      console.log(`[HumanInTheLoop] Human provided edited code. Recording as gold-tier training pair.`);
      pending.proposal.proposedContent = result.humanEditedCode;
      // Weight it 10x higher than normal RSI proposals
      for (let i = 0; i < 10; i++) {
        collectTrainingPair(pending.proposal.targetFile, pending.proposal.originalContent, pending.proposal.proposedContent, pending.proposal.rationale);
      }
    }
  }
}

export function getPendingReviewCount(): number {
  return pendingReviews.size;
}
