/**
 * Meta-Cognitive Introspection Engine — monitors Andromeda's own decision-making,
 * detects cognitive biases, and updates the meta-level improvement strategy.
 */

export interface DecisionRecord {
  proposalId: string;
  accepted: boolean;
  reward: number;
  features: Record<string, number>;
  timestamp: number;
}

export interface BiasReport {
  biasType: string;
  severity: number;       // 0-1
  affectedDimension: string;
  evidence: string;
  correction: string;
}

export interface MetaCognitiveReport {
  totalDecisions: number;
  acceptanceRate: number;
  detectedBiases: BiasReport[];
  strategyHealth: number;  // 0-1
  recommendations: string[];
}

class MetaCognitiveEngine {
  private decisionHistory: DecisionRecord[] = [];
  private strategyWeights: Map<string, number> = new Map([
    ["recency_bias_correction", 1.0],
    ["confirmation_bias_correction", 1.0],
    ["anchoring_correction", 1.0],
    ["availability_correction", 1.0],
  ]);

  recordDecision(record: DecisionRecord): void {
    this.decisionHistory.push(record);
    if (this.decisionHistory.length > 1000) {
      this.decisionHistory.shift();
    }
  }

  detectCognitiveBias(recentDecisions: DecisionRecord[]): BiasReport[] {
    const biases: BiasReport[] = [];
    if (recentDecisions.length < 5) return biases;

    // Recency bias: recent decisions weighted too heavily
    const recentAcceptRate = recentDecisions.slice(-10).filter(d => d.accepted).length / Math.min(10, recentDecisions.length);
    const overallAcceptRate = recentDecisions.filter(d => d.accepted).length / recentDecisions.length;
    if (Math.abs(recentAcceptRate - overallAcceptRate) > 0.15) {
      biases.push({
        biasType: "recency_bias",
        severity: Math.abs(recentAcceptRate - overallAcceptRate),
        affectedDimension: "acceptance_rate",
        evidence: `Recent accept rate ${(recentAcceptRate * 100).toFixed(1)}% vs overall ${(overallAcceptRate * 100).toFixed(1)}%`,
        correction: "Apply exponential moving average with longer window",
      });
    }

    // Reward anchoring: rewards clustering near a fixed value
    const rewards = recentDecisions.map(d => d.reward);
    const mean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
    const variance = rewards.reduce((sum, r) => sum + (r - mean) ** 2, 0) / rewards.length;
    if (variance < 0.001) {
      biases.push({
        biasType: "reward_anchoring",
        severity: 1 - variance * 1000,
        affectedDimension: "reward_diversity",
        evidence: `Reward variance ${variance.toFixed(6)} — too low`,
        correction: "Inject exploration noise into reward sampling",
      });
    }

    return biases;
  }

  introspectDecisionProcess(proposalHistory: DecisionRecord[]): MetaCognitiveReport {
    const biases = this.detectCognitiveBias(proposalHistory);
    const acceptanceRate = proposalHistory.length > 0
      ? proposalHistory.filter(d => d.accepted).length / proposalHistory.length
      : 0;

    const strategyHealth = Math.max(0, 1 - biases.reduce((sum, b) => sum + b.severity, 0) / Math.max(biases.length, 1));

    const recommendations: string[] = [];
    for (const bias of biases) {
      recommendations.push(bias.correction);
    }
    if (biases.length === 0) {
      recommendations.push("Decision process is healthy — maintain current strategy");
    }

    return {
      totalDecisions: proposalHistory.length,
      acceptanceRate,
      detectedBiases: biases,
      strategyHealth,
      recommendations,
    };
  }

  updateMetaStrategy(biasReport: BiasReport[]): void {
    for (const bias of biasReport) {
      const key = `${bias.biasType}_correction`;
      const current = this.strategyWeights.get(key) ?? 1.0;
      // Increase correction weight proportional to severity
      this.strategyWeights.set(key, current + bias.severity * 0.1);
    }
    console.log(`[MetaCog] Strategy updated. Weights: ${JSON.stringify(Object.fromEntries(this.strategyWeights))}`);
  }

  getMetaCognitiveReport(): MetaCognitiveReport {
    return this.introspectDecisionProcess(this.decisionHistory);
  }

  getStrategyWeights(): Map<string, number> {
    return new Map(this.strategyWeights);
  }
}

export const globalMetaCognitiveEngine = new MetaCognitiveEngine();

export function introspectDecisionProcess(history: DecisionRecord[]): MetaCognitiveReport {
  return globalMetaCognitiveEngine.introspectDecisionProcess(history);
}

export function detectCognitiveBias(decisions: DecisionRecord[]): BiasReport[] {
  return globalMetaCognitiveEngine.detectCognitiveBias(decisions);
}

export function updateMetaStrategy(biases: BiasReport[]): void {
  globalMetaCognitiveEngine.updateMetaStrategy(biases);
}

export function getMetaCognitiveReport(): MetaCognitiveReport {
  return globalMetaCognitiveEngine.getMetaCognitiveReport();
}

export function initMetaCognitiveEngine(): void {
  console.log("[MetaCog] Meta-Cognitive Introspection Engine initialized.");
}
