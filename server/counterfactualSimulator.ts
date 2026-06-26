/**
 * Causal Counterfactual Simulator — do-calculus reasoning engine.
 * Asks "what would have happened if we had made a different improvement?"
 * Estimates counterfactual impact of unchosen proposals to improve future decisions.
 */

export interface ImprovementEvent {
  id: string;
  description: string;
  targetFile: string;
  reward: number;
  accepted: boolean;
  timestamp: number;
  capabilityDelta: Record<string, number>;
}

export interface CausalEdge {
  from: string;
  to: string;
  strength: number;   // 0-1 causal strength
  mechanism: string;
}

export interface CausalGraph {
  nodes: string[];
  edges: CausalEdge[];
}

export interface CounterfactualOutcome {
  proposalId: string;
  actualReward: number;
  counterfactualReward: number;
  regret: number;          // counterfactual - actual (positive = we missed out)
  causalMechanism: string;
}

export interface RegretMap {
  totalRegret: number;
  avgRegret: number;
  topMissedOpportunities: CounterfactualOutcome[];
}

class CounterfactualSimulator {
  private causalGraph: CausalGraph = { nodes: [], edges: [] };
  private improvementHistory: ImprovementEvent[] = [];
  private counterfactualCache: Map<string, CounterfactualOutcome> = new Map();

  buildCausalGraph(history: ImprovementEvent[]): CausalGraph {
    this.improvementHistory = history;
    const nodes = [...new Set(history.map(e => e.targetFile))];
    const edges: CausalEdge[] = [];

    // Build edges based on temporal co-occurrence and reward correlation
    for (let i = 0; i < history.length - 1; i++) {
      for (let j = i + 1; j < Math.min(i + 5, history.length); j++) {
        const a = history[i];
        const b = history[j];
        const timeDiff = b.timestamp - a.timestamp;
        if (timeDiff > 60000) continue; // Only events within 1 minute

        // Causal strength based on reward correlation and temporal proximity
        const rewardCorr = 1 - Math.abs(a.reward - b.reward);
        const temporalDecay = Math.exp(-timeDiff / 30000);
        const strength = rewardCorr * temporalDecay;

        if (strength > 0.3) {
          edges.push({
            from: a.targetFile,
            to: b.targetFile,
            strength,
            mechanism: `temporal_correlation(dt=${timeDiff}ms, corr=${rewardCorr.toFixed(2)})`,
          });
        }
      }
    }

    this.causalGraph = { nodes, edges };
    return this.causalGraph;
  }

  /**
   * Simulate counterfactual: what if we had accepted a rejected proposal (or vice versa)?
   */
  simulateCounterfactual(proposal: ImprovementEvent, intervention: "accept" | "reject"): CounterfactualOutcome {
    const cacheKey = `${proposal.id}-${intervention}`;
    if (this.counterfactualCache.has(cacheKey)) {
      return this.counterfactualCache.get(cacheKey)!;
    }

    // Find causally downstream events
    const downstreamEdges = this.causalGraph.edges.filter(e => e.from === proposal.targetFile);
    const downstreamImpact = downstreamEdges.reduce((sum, e) => sum + e.strength, 0);

    let counterfactualReward: number;
    if (intervention === "accept" && !proposal.accepted) {
      // We rejected it — what if we had accepted?
      // Estimate: proposal.reward + downstream cascade effect
      counterfactualReward = proposal.reward * (1 + downstreamImpact * 0.1);
    } else if (intervention === "reject" && proposal.accepted) {
      // We accepted it — what if we had rejected?
      // Estimate: lose the reward but avoid any negative downstream effects
      counterfactualReward = proposal.reward * (1 - downstreamImpact * 0.05);
    } else {
      counterfactualReward = proposal.reward;
    }

    const regret = counterfactualReward - proposal.reward;
    const outcome: CounterfactualOutcome = {
      proposalId: proposal.id,
      actualReward: proposal.reward,
      counterfactualReward,
      regret,
      causalMechanism: `${intervention} intervention with ${downstreamEdges.length} downstream effects`,
    };

    this.counterfactualCache.set(cacheKey, outcome);
    return outcome;
  }

  compareActualVsCounterfactual(actual: ImprovementEvent, counterfactual: CounterfactualOutcome): {
    betterChoice: "actual" | "counterfactual";
    gainIfSwitched: number;
    confidence: number;
  } {
    const betterChoice = counterfactual.counterfactualReward > actual.reward ? "counterfactual" : "actual";
    const gainIfSwitched = Math.abs(counterfactual.counterfactualReward - actual.reward);
    const confidence = Math.min(1, gainIfSwitched * 10); // Higher gain = higher confidence

    return { betterChoice, gainIfSwitched, confidence };
  }

  updatePolicyFromCounterfactuals(regretMap: RegretMap): Record<string, number> {
    const policyUpdates: Record<string, number> = {};

    for (const opportunity of regretMap.topMissedOpportunities) {
      // Increase acceptance probability for similar proposals
      const key = `accept_bias_${opportunity.proposalId.split("-")[0]}`;
      policyUpdates[key] = (policyUpdates[key] ?? 0) + opportunity.regret * 0.01;
    }

    console.log(`[Counterfactual] Policy updated from ${regretMap.topMissedOpportunities.length} missed opportunities. Total regret: ${regretMap.totalRegret.toFixed(4)}`);
    return policyUpdates;
  }

  computeRegretMap(rejectedProposals: ImprovementEvent[]): RegretMap {
    const outcomes: CounterfactualOutcome[] = [];

    for (const proposal of rejectedProposals) {
      if (!proposal.accepted) {
        const outcome = this.simulateCounterfactual(proposal, "accept");
        if (outcome.regret > 0) {
          outcomes.push(outcome);
        }
      }
    }

    outcomes.sort((a, b) => b.regret - a.regret);
    const totalRegret = outcomes.reduce((sum, o) => sum + o.regret, 0);

    return {
      totalRegret,
      avgRegret: outcomes.length > 0 ? totalRegret / outcomes.length : 0,
      topMissedOpportunities: outcomes.slice(0, 5),
    };
  }
}

export const globalCounterfactualSimulator = new CounterfactualSimulator();

export function buildCausalGraph(history: ImprovementEvent[]): CausalGraph {
  return globalCounterfactualSimulator.buildCausalGraph(history);
}

export function simulateCounterfactual(proposal: ImprovementEvent, intervention: "accept" | "reject"): CounterfactualOutcome {
  return globalCounterfactualSimulator.simulateCounterfactual(proposal, intervention);
}

export function compareActualVsCounterfactual(actual: ImprovementEvent, counterfactual: CounterfactualOutcome) {
  return globalCounterfactualSimulator.compareActualVsCounterfactual(actual, counterfactual);
}

export function updatePolicyFromCounterfactuals(regretMap: RegretMap): Record<string, number> {
  return globalCounterfactualSimulator.updatePolicyFromCounterfactuals(regretMap);
}

export function initCounterfactualSimulator(): void {
  console.log("[Counterfactual] Causal Counterfactual Simulator initialized.");
}
