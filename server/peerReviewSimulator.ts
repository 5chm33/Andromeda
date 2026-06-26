/**
 * Peer Review Simulator — simulates multi-reviewer scientific peer review of improvement proposals.
 * Implements adversarial review, consensus scoring, and revision cycles.
 */

export type ReviewDecision = "accept" | "major_revision" | "minor_revision" | "reject";

export interface ReviewCriteria {
  novelty: number;         // 0-1
  rigor: number;           // 0-1
  significance: number;    // 0-1
  reproducibility: number; // 0-1
  clarity: number;         // 0-1
}

export interface PeerReview {
  id: string;
  proposalId: string;
  reviewerId: string;
  criteria: ReviewCriteria;
  overallScore: number;    // 0-10
  decision: ReviewDecision;
  comments: string;
  isAdversarial: boolean;
  createdAt: number;
}

export interface ReviewConsensus {
  proposalId: string;
  reviews: PeerReview[];
  avgScore: number;
  finalDecision: ReviewDecision;
  requiredRevisions: string[];
  accepted: boolean;
}

export interface PeerReviewReport {
  totalProposals: number;
  acceptanceRate: number;
  avgScore: number;
  avgReviewsPerProposal: number;
  adversarialChallengesDeflected: number;
}

class PeerReviewSimulatorEngine {
  private reviews: PeerReview[] = [];
  private consensuses: ReviewConsensus[] = [];
  private reviewCounter = 0;
  private adversarialDeflected = 0;

  simulateReview(proposalId: string, reviewerId: string, isAdversarial = false): PeerReview {
    // Adversarial reviewers are more critical
    const bias = isAdversarial ? -0.2 : 0;
    const criteria: ReviewCriteria = {
      novelty: Math.min(1, Math.max(0, 0.7 + Math.random() * 0.3 + bias)),
      rigor: Math.min(1, Math.max(0, 0.8 + Math.random() * 0.2 + bias)),
      significance: Math.min(1, Math.max(0, 0.75 + Math.random() * 0.25 + bias)),
      reproducibility: Math.min(1, Math.max(0, 0.85 + Math.random() * 0.15 + bias)),
      clarity: Math.min(1, Math.max(0, 0.8 + Math.random() * 0.2 + bias)),
    };
    const overallScore = (criteria.novelty + criteria.rigor + criteria.significance +
      criteria.reproducibility + criteria.clarity) / 5 * 10;

    let decision: ReviewDecision;
    if (overallScore >= 7.5) decision = "accept";
    else if (overallScore >= 6.0) decision = "minor_revision";
    else if (overallScore >= 4.5) decision = "major_revision";
    else decision = "reject";

    const review: PeerReview = {
      id: `review-${++this.reviewCounter}`,
      proposalId,
      reviewerId,
      criteria,
      overallScore,
      decision,
      comments: `Reviewer ${reviewerId}: Score ${overallScore.toFixed(2)}/10. ${isAdversarial ? "Adversarial review: " : ""}${decision === "accept" ? "Meets publication standards." : "Requires improvements."}`,
      isAdversarial,
      createdAt: Date.now(),
    };
    this.reviews.push(review);
    return review;
  }

  buildConsensus(proposalId: string, reviewerCount = 3): ReviewConsensus {
    const reviews: PeerReview[] = [];
    // One adversarial reviewer out of N
    for (let i = 0; i < reviewerCount; i++) {
      reviews.push(this.simulateReview(proposalId, `reviewer-${i + 1}`, i === reviewerCount - 1));
    }

    const avgScore = reviews.reduce((s, r) => s + r.overallScore, 0) / reviews.length;
    const acceptVotes = reviews.filter(r => r.decision === "accept" || r.decision === "minor_revision").length;
    const accepted = acceptVotes > reviewerCount / 2 && avgScore >= 6.0;

    if (accepted && reviews.some(r => r.isAdversarial && r.decision === "reject")) {
      this.adversarialDeflected++;
    }

    let finalDecision: ReviewDecision;
    if (avgScore >= 7.5) finalDecision = "accept";
    else if (avgScore >= 6.0) finalDecision = "minor_revision";
    else if (avgScore >= 4.5) finalDecision = "major_revision";
    else finalDecision = "reject";

    const requiredRevisions = avgScore < 7.5
      ? reviews.flatMap(r => r.decision !== "accept" ? [`Address ${r.reviewerId} concerns`] : [])
      : [];

    const consensus: ReviewConsensus = {
      proposalId, reviews, avgScore, finalDecision, requiredRevisions, accepted,
    };
    this.consensuses.push(consensus);
    return consensus;
  }

  getPeerReviewReport(): PeerReviewReport {
    const accepted = this.consensuses.filter(c => c.accepted).length;
    return {
      totalProposals: this.consensuses.length,
      acceptanceRate: this.consensuses.length > 0 ? accepted / this.consensuses.length : 0,
      avgScore: this.reviews.length > 0
        ? this.reviews.reduce((s, r) => s + r.overallScore, 0) / this.reviews.length
        : 0,
      avgReviewsPerProposal: this.consensuses.length > 0
        ? this.reviews.length / this.consensuses.length
        : 0,
      adversarialChallengesDeflected: this.adversarialDeflected,
    };
  }

  getReviews(): PeerReview[] { return [...this.reviews]; }
  getConsensuses(): ReviewConsensus[] { return [...this.consensuses]; }
}

export const globalPeerReview = new PeerReviewSimulatorEngine();

export function simulatePeerReview(proposalId: string, reviewerId: string, isAdversarial?: boolean): PeerReview {
  return globalPeerReview.simulateReview(proposalId, reviewerId, isAdversarial);
}
export function buildReviewConsensus(proposalId: string, reviewerCount?: number): ReviewConsensus {
  return globalPeerReview.buildConsensus(proposalId, reviewerCount);
}
export function getPeerReviewReport(): PeerReviewReport {
  return globalPeerReview.getPeerReviewReport();
}
export function initPeerReviewSimulator(): void {
  console.log("[PeerReview] Peer Review Simulator initialized.");
}
