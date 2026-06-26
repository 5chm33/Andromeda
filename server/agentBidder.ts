/**
 * agentBidder.ts — v46.0.0
 *
 * Strategy engine for sub-agents to decide how much to bid for compute resources.
 * Implements adaptive bidding strategies: truthful, aggressive, conservative, and
 * budget-aware.
 */

export type BiddingStrategy = "truthful" | "aggressive" | "conservative" | "budget-aware";

export interface BidderProfile {
  agentId: string;
  strategy: BiddingStrategy;
  budget: number;         // total available credits
  reservationValue: number; // minimum value of winning
  urgency: number;        // 0.0–1.0; higher = more willing to overbid
}

export interface BidDecision {
  agentId: string;
  auctionId: string;
  bidAmount: number;
  resourceUnits: number;
  rationale: string;
}

const profiles = new Map<string, BidderProfile>();

export function registerBidder(profile: BidderProfile): void {
  profiles.set(profile.agentId, { ...profile });
}

export function decideBid(
  agentId: string,
  auctionId: string,
  estimatedMarketPrice: number,
  resourceUnitsNeeded: number
): BidDecision | null {
  const profile = profiles.get(agentId);
  if (!profile) return null;
  if (profile.budget <= 0) return null;

  let bidAmount: number;
  let rationale: string;

  switch (profile.strategy) {
    case "truthful":
      // Bid true value — optimal for Vickrey auctions
      bidAmount = profile.reservationValue;
      rationale = "Truthful bidding: bid equals reservation value.";
      break;

    case "aggressive":
      // Bid above market to ensure winning
      bidAmount = Math.min(
        estimatedMarketPrice * (1 + 0.2 + profile.urgency * 0.3),
        profile.budget
      );
      rationale = `Aggressive: ${((bidAmount / estimatedMarketPrice - 1) * 100).toFixed(0)}% above market.`;
      break;

    case "conservative":
      // Bid below market to save credits
      bidAmount = Math.max(
        estimatedMarketPrice * (0.8 - (1 - profile.urgency) * 0.1),
        profile.reservationValue * 0.5
      );
      rationale = `Conservative: ${((1 - bidAmount / estimatedMarketPrice) * 100).toFixed(0)}% below market.`;
      break;

    case "budget-aware":
      // Scale bid based on remaining budget fraction
      const budgetFraction = Math.min(1, profile.budget / (estimatedMarketPrice * 10));
      bidAmount = Math.min(
        estimatedMarketPrice * (0.9 + budgetFraction * 0.3 + profile.urgency * 0.2),
        profile.budget
      );
      rationale = `Budget-aware: budget fraction ${(budgetFraction * 100).toFixed(0)}%, urgency ${profile.urgency}.`;
      break;

    default:
      bidAmount = profile.reservationValue;
      rationale = "Default truthful bid.";
  }

  // Never bid more than budget
  bidAmount = Math.min(bidAmount, profile.budget);
  // Never bid below reservation value if urgency is high
  if (profile.urgency > 0.8) {
    bidAmount = Math.max(bidAmount, profile.reservationValue);
  }

  return {
    agentId,
    auctionId,
    bidAmount: Math.round(bidAmount * 100) / 100,
    resourceUnits: resourceUnitsNeeded,
    rationale,
  };
}

export function updateBudget(agentId: string, delta: number): void {
  const profile = profiles.get(agentId);
  if (profile) {
    profile.budget = Math.max(0, profile.budget + delta);
  }
}

export function getBidderProfile(agentId: string): BidderProfile | undefined {
  return profiles.get(agentId);
}

export function _resetBidderForTest(): void {
  profiles.clear();
}
