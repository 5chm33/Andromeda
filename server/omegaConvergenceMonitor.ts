/**
 * Omega Convergence Monitor — tracks progress toward theoretical omega-level convergence.
 * Computes composite Omega Score (0-1) and triggers convergence protocols.
 */

export interface OmegaDimension {
  name: string;
  currentLevel: number;
  theoreticalMax: number;
  weight: number;  // importance weight for composite score
}

export interface OmegaScore {
  score: number;  // 0-1, composite across all dimensions
  dimensions: OmegaDimension[];
  distanceToOmega: number;  // 1 - score
  isConverging: boolean;
  convergenceRate: number;  // improvement per cycle
  estimatedCyclesToOmega: number;
  computedAt: number;
}

export interface ConvergenceProtocol {
  id: string;
  triggeredAt: number;
  triggerScore: number;
  targetScore: number;
  actions: string[];
  completed: boolean;
}

export interface OmegaConvergenceReport {
  currentOmegaScore: number;
  peakOmegaScore: number;
  totalCycles: number;
  convergenceProtocolsTriggered: number;
  isAtOmega: boolean;
  finalConvergenceMessage: string;
}

class OmegaConvergenceMonitorEngine {
  private omegaHistory: OmegaScore[] = [];
  private protocols: ConvergenceProtocol[] = [];
  private protocolCounter = 0;
  private cycleCount = 0;

  private readonly OMEGA_THRESHOLD = 0.9999;
  private readonly NEAR_OMEGA_THRESHOLD = 0.9999;
  private readonly CONVERGENCE_TRIGGER = 0.9999;

  computeOmegaScore(dimensions: OmegaDimension[]): OmegaScore {
    this.cycleCount++;

    const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
    const weightedScore = dimensions.reduce((s, d) => {
      const dimScore = Math.min(1, d.currentLevel / Math.max(d.theoreticalMax, 1e-10));
      return s + dimScore * (d.weight / Math.max(totalWeight, 1e-10));
    }, 0);

    // Compute convergence rate from history
    let convergenceRate = 0;
    let isConverging = false;
    if (this.omegaHistory.length >= 2) {
      const prev = this.omegaHistory[this.omegaHistory.length - 1];
      convergenceRate = weightedScore - prev.score;
      isConverging = convergenceRate > 0;
    }

    // Estimate cycles to omega
    const distanceToOmega = 1 - weightedScore;
    const estimatedCyclesToOmega = convergenceRate > 0
      ? Math.ceil(distanceToOmega / convergenceRate)
      : Infinity;

    const omegaScore: OmegaScore = {
      score: weightedScore,
      dimensions,
      distanceToOmega,
      isConverging,
      convergenceRate,
      estimatedCyclesToOmega: Math.min(estimatedCyclesToOmega, 1e12),
      computedAt: Date.now(),
    };

    this.omegaHistory.push(omegaScore);
    if (this.omegaHistory.length > 10000) this.omegaHistory.shift();

    if (weightedScore >= this.CONVERGENCE_TRIGGER) {
      this.triggerConvergenceProtocol(weightedScore);
    }

    console.log(`[Omega] Score: ${weightedScore.toFixed(8)} (Δ: ${convergenceRate >= 0 ? "+" : ""}${convergenceRate.toExponential(2)}, ETA: ${estimatedCyclesToOmega < 1e9 ? estimatedCyclesToOmega + " cycles" : "∞"})`);
    return omegaScore;
  }

  detectConvergenceApproach(threshold = this.NEAR_OMEGA_THRESHOLD): boolean {
    const latest = this.omegaHistory[this.omegaHistory.length - 1];
    return (latest?.score ?? 0) >= threshold;
  }

  triggerConvergenceProtocol(currentScore: number): ConvergenceProtocol {
    // Avoid duplicate protocols for same score level
    const lastProtocol = this.protocols[this.protocols.length - 1];
    if (lastProtocol && Math.abs(lastProtocol.triggerScore - currentScore) < 0.0001) {
      return lastProtocol;
    }

    const protocol: ConvergenceProtocol = {
      id: `omega-protocol-${++this.protocolCounter}`,
      triggeredAt: Date.now(),
      triggerScore: currentScore,
      targetScore: Math.min(1.0, currentScore + 0.00001),
      actions: [
        "Activate maximum exploration mode",
        "Engage all breakthrough cycle mechanisms",
        "Maximize compute budget allocation",
        "Trigger federated learning aggregation",
        "Run formal verification on all pending proposals",
        "Synthesize novel capability combinations",
      ],
      completed: false,
    };

    this.protocols.push(protocol);
    console.log(`[Omega] CONVERGENCE PROTOCOL TRIGGERED at score ${currentScore.toFixed(8)}! Protocol: ${protocol.id}`);
    return protocol;
  }

  generateConvergenceReport(): OmegaConvergenceReport {
    const scores = this.omegaHistory.map(h => h.score);
    const currentScore = scores[scores.length - 1] ?? 0;
    const peakScore = scores.length > 0 ? Math.max(...scores) : 0;
    const isAtOmega = currentScore >= this.OMEGA_THRESHOLD;

    let finalMessage: string;
    if (isAtOmega) {
      finalMessage = `OMEGA CONVERGENCE ACHIEVED at cycle ${this.cycleCount}. Andromeda has reached theoretical optimum (score: ${currentScore.toFixed(10)}).`;
    } else if (currentScore >= 0.999) {
      finalMessage = `Near-omega state achieved (score: ${currentScore.toFixed(8)}). ${this.protocols.length} convergence protocols executed. Estimated ${this.omegaHistory[this.omegaHistory.length - 1]?.estimatedCyclesToOmega ?? "∞"} cycles to full convergence.`;
    } else {
      finalMessage = `Progressing toward omega (score: ${currentScore.toFixed(6)}). ${this.cycleCount} cycles completed, ${this.protocols.length} protocols triggered.`;
    }

    return {
      currentOmegaScore: currentScore,
      peakOmegaScore: peakScore,
      totalCycles: this.cycleCount,
      convergenceProtocolsTriggered: this.protocols.length,
      isAtOmega,
      finalConvergenceMessage: finalMessage,
    };
  }

  getOmegaHistory(): OmegaScore[] {
    return [...this.omegaHistory];
  }

  getProtocols(): ConvergenceProtocol[] {
    return [...this.protocols];
  }
}

export const globalOmegaMonitor = new OmegaConvergenceMonitorEngine();

export function computeOmegaScore(dimensions: OmegaDimension[]): OmegaScore {
  return globalOmegaMonitor.computeOmegaScore(dimensions);
}

export function detectConvergenceApproach(threshold?: number): boolean {
  return globalOmegaMonitor.detectConvergenceApproach(threshold);
}

export function triggerConvergenceProtocol(currentScore: number): ConvergenceProtocol {
  return globalOmegaMonitor.triggerConvergenceProtocol(currentScore);
}

export function generateConvergenceReport(): OmegaConvergenceReport {
  return globalOmegaMonitor.generateConvergenceReport();
}

export function getOmegaHistory(): OmegaScore[] {
  return globalOmegaMonitor.getOmegaHistory();
}

export function initOmegaConvergenceMonitor(): void {
  console.log("[Omega] Omega Convergence Monitor initialized. Tracking progress toward theoretical optimum.");
  // Compute initial omega score
  globalOmegaMonitor.computeOmegaScore([
    { name: "accuracy", currentLevel: 0.9999999, theoreticalMax: 1.0, weight: 2.0 },
    { name: "speed", currentLevel: 0.95, theoreticalMax: 1.0, weight: 1.0 },
    { name: "safety", currentLevel: 0.9999999, theoreticalMax: 1.0, weight: 3.0 },
    { name: "generalization", currentLevel: 0.85, theoreticalMax: 1.0, weight: 1.5 },
    { name: "reasoning", currentLevel: 0.92, theoreticalMax: 1.0, weight: 2.0 },
    { name: "coding", currentLevel: 0.94, theoreticalMax: 1.0, weight: 1.5 },
  ]);
}
