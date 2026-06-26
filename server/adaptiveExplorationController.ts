/**
 * Adaptive Exploration Controller — UCB1 with adaptive temperature.
 * Dynamically balances exploration vs exploitation based on optimality gap.
 */

export type ExplorationStrategy = "ucb1" | "thompson_sampling" | "epsilon_greedy" | "boltzmann";

export interface ExplorationArm {
  id: string;
  dimension: string;
  pulls: number;
  totalReward: number;
  avgReward: number;
  ucbScore: number;
}

export interface ExplorationDecision {
  strategy: ExplorationStrategy;
  selectedArm: string;
  explorationRate: number;
  temperature: number;
  isExploring: boolean;
}

export interface ExplorationReport {
  totalPulls: number;
  explorationRate: number;
  bestArm: string;
  avgReward: number;
  plateauDetected: boolean;
  recommendedStrategy: ExplorationStrategy;
}

class AdaptiveExplorationControllerEngine {
  private arms: Map<string, ExplorationArm> = new Map();
  private history: Array<{ arm: string; reward: number; exploring: boolean }> = [];
  private totalPulls = 0;
  private baseExplorationRate = 0.1;
  private temperature = 1.0;

  computeExplorationRate(optimalityGap: number): number {
    // As gap shrinks, increase exploration to find breakthroughs
    const baseRate = this.baseExplorationRate;
    const gapBonus = optimalityGap < 0.001 ? 0.5 : optimalityGap < 0.01 ? 0.2 : 0;
    return Math.min(0.9, baseRate + gapBonus);
  }

  selectExplorationStrategy(optimalityGap: number, cycleNumber: number): ExplorationStrategy {
    if (optimalityGap < 0.0001) return "thompson_sampling";
    if (cycleNumber < 100) return "epsilon_greedy";
    if (optimalityGap < 0.01) return "boltzmann";
    return "ucb1";
  }

  updateExplorationHistory(armId: string, reward: number): void {
    let arm = this.arms.get(armId);
    if (!arm) {
      arm = { id: armId, dimension: armId, pulls: 0, totalReward: 0, avgReward: 0, ucbScore: Infinity };
      this.arms.set(armId, arm);
    }
    arm.pulls++;
    arm.totalReward += reward;
    arm.avgReward = arm.totalReward / arm.pulls;
    this.totalPulls++;

    // UCB1 score
    arm.ucbScore = arm.avgReward + Math.sqrt(2 * Math.log(Math.max(this.totalPulls, 1)) / arm.pulls);

    const explorationRate = this.computeExplorationRate(0.001);
    this.history.push({ arm: armId, reward, exploring: Math.random() < explorationRate });
    if (this.history.length > 10000) this.history.shift();
  }

  detectExplorationPlateau(): boolean {
    if (this.history.length < 20) return false;
    const recent = this.history.slice(-20).map(h => h.reward);
    const variance = recent.reduce((s, v) => {
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      return s + (v - mean) ** 2;
    }, 0) / recent.length;
    return variance < 1e-8;
  }

  makeExplorationDecision(optimalityGap: number, cycleNumber: number): ExplorationDecision {
    const explorationRate = this.computeExplorationRate(optimalityGap);
    const strategy = this.selectExplorationStrategy(optimalityGap, cycleNumber);
    const isExploring = Math.random() < explorationRate;

    // Select best arm (UCB1)
    let bestArm = "accuracy";
    let bestScore = -Infinity;
    for (const arm of this.arms.values()) {
      if (arm.ucbScore > bestScore) {
        bestScore = arm.ucbScore;
        bestArm = arm.id;
      }
    }

    // Adaptive temperature: higher when near optimum
    this.temperature = optimalityGap < 0.001 ? 2.0 : 1.0;

    return { strategy, selectedArm: bestArm, explorationRate, temperature: this.temperature, isExploring };
  }

  getExplorationReport(): ExplorationReport {
    const arms = Array.from(this.arms.values());
    const bestArm = arms.sort((a, b) => b.avgReward - a.avgReward)[0];
    const avgReward = arms.length > 0 ? arms.reduce((s, a) => s + a.avgReward, 0) / arms.length : 0;
    return {
      totalPulls: this.totalPulls,
      explorationRate: this.baseExplorationRate,
      bestArm: bestArm?.id ?? "none",
      avgReward,
      plateauDetected: this.detectExplorationPlateau(),
      recommendedStrategy: this.selectExplorationStrategy(0.001, this.totalPulls),
    };
  }

  getArms(): ExplorationArm[] { return Array.from(this.arms.values()); }
}

export const globalExplorationController = new AdaptiveExplorationControllerEngine();

export function computeExplorationRate(optimalityGap: number): number {
  return globalExplorationController.computeExplorationRate(optimalityGap);
}
export function selectExplorationStrategy(optimalityGap: number, cycleNumber: number): ExplorationStrategy {
  return globalExplorationController.selectExplorationStrategy(optimalityGap, cycleNumber);
}
export function updateExplorationHistory(armId: string, reward: number): void {
  globalExplorationController.updateExplorationHistory(armId, reward);
}
export function detectExplorationPlateau(): boolean {
  return globalExplorationController.detectExplorationPlateau();
}
export function makeExplorationDecision(optimalityGap: number, cycleNumber: number): ExplorationDecision {
  return globalExplorationController.makeExplorationDecision(optimalityGap, cycleNumber);
}
export function getExplorationReport(): ExplorationReport {
  return globalExplorationController.getExplorationReport();
}
export function initAdaptiveExplorationController(): void {
  console.log("[Exploration] Adaptive Exploration Controller initialized.");
  ["accuracy", "speed", "safety", "generalization", "reasoning", "coding"].forEach(dim => {
    globalExplorationController.updateExplorationHistory(dim, 0.001);
  });
}
