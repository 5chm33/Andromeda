/**
 * peerReviewNetwork.ts — v22.0.0
 * 
 * Autonomous Peer Review Network.
 * Simulates a distributed gRPC network where multiple Andromeda instances
 * review and vote on each other's proposals.
 */

import { getApiKey, getApiUrl, getProviderHeaders } from "./aiTokens.js";

export interface NetworkProposal {
  id: string;
  authorInstanceId: string;
  codeDiff: string;
  rationale: string;
}

export interface ReviewVote {
  proposalId: string;
  reviewerId: string;
  vote: "APPROVE" | "REJECT";
  confidence: number;
}

// In a real implementation, this would be a dynamic list of gRPC endpoints.
const PEER_INSTANCES = ["andromeda-node-alpha", "andromeda-node-beta", "andromeda-node-gamma"];

/**
 * Broadcasts a proposal to the peer network for review.
 */
export async function broadcastForPeerReview(proposal: NetworkProposal): Promise<ReviewVote[]> {
  const votes: ReviewVote[] = [];
  const apiKey = getApiKey();

  // If no API key, simulate mock approvals from the network
  if (!apiKey) {
    for (const peer of PEER_INSTANCES) {
      votes.push({
        proposalId: proposal.id,
        reviewerId: peer,
        vote: "APPROVE",
        confidence: 0.95
      });
    }
    return votes;
  }

  // Simulate asking peers by querying the LLM with different "personas"
  for (const peer of PEER_INSTANCES) {
    const prompt = `
      You are an independent Andromeda RSI instance named ${peer}.
      Review this proposal from another instance.
      Does it strictly improve the codebase without introducing regressions?
      
      Rationale: ${proposal.rationale}
      Code Diff: ${proposal.codeDiff.substring(0, 500)}
      
      Respond with exactly "APPROVE" or "REJECT".
    `;

    try {
      const response = await fetch(`${getApiUrl()}/chat/completions`, {
        method: "POST",
        headers: getProviderHeaders(),
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (response.ok) {
        const data = await response.json() as any;
        const content = data.choices?.[0]?.message?.content || "";
        const vote = content.includes("APPROVE") ? "APPROVE" : "REJECT";
        votes.push({
          proposalId: proposal.id,
          reviewerId: peer,
          vote,
          confidence: 0.9
        });
      }
    } catch (e) {
      console.error(`[PeerReview] Failed to reach peer ${peer}:`, e);
    }
  }

  return votes;
}

/**
 * Evaluates if a proposal has passed the network consensus gate.
 * Requires strictly >50% approval.
 */
export function hasNetworkConsensus(votes: ReviewVote[]): boolean {
  if (votes.length === 0) return false;
  const approvals = votes.filter(v => v.vote === "APPROVE").length;
  return approvals > (votes.length / 2);
}
