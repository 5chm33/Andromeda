/**
 * Epistemic Uncertainty Quantifier — separates knowledge vs. irreducible uncertainty.
 * Uses Monte Carlo dropout-style estimation for confidence intervals on capability gains.
 */

export interface UncertaintyEstimate {
  proposalId: string;
  epistemicUncertainty: number;  // 0-1, reducible with more data
  aleatoricUncertainty: number;  // 0-1, irreducible noise
  totalUncertainty: number;
  confidenceInterval: [number, number];
  shouldExplore: boolean;  // true if epistemic uncertainty is high
}

export interface ConfidenceInterval {
  mean: number;
  lower: number;
  upper: number;
  width: number;
  confidence: number;  // e.g., 0.95 for 95% CI
}

export interface UncertaintyReport {
  avgEpistemicUncertainty: number;
  avgAleatoricUncertainty: number;
  explorationRecommended: boolean;
  highUncertaintyProposals: string[];
  calibrationScore: number;
}

class EpistemicUncertaintyQuantifierEngine {
  private estimates: Map<string, UncertaintyEstimate> = new Map();
  private calibrationHistory: Array<{ predicted: number; actual: number }> = [];
  private readonly MC_SAMPLES = 20;
  private readonly EXPLORATION_THRESHOLD = 0.3;

  quantifyEpistemicUncertainty(proposalId: string, predictedGains: number[]): number {
    // Epistemic uncertainty = variance of MC samples (reducible)
    const n = predictedGains.length;
    if (n === 0) return 1.0;
    const mean = predictedGains.reduce((s, v) => s + v, 0) / n;
    const variance = predictedGains.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(n - 1, 1);
    return Math.min(1, Math.sqrt(variance) * 100); // Normalize
  }

  quantifyAleatoricUncertainty(proposalId: string, historicalNoise: number[]): number {
    // Aleatoric uncertainty = irreducible noise in the environment
    const n = historicalNoise.length;
    if (n === 0) return 0.1;
    const mean = historicalNoise.reduce((s, v) => s + v, 0) / n;
    const variance = historicalNoise.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(n - 1, 1);
    return Math.min(1, Math.sqrt(variance) * 50);
  }

  computeConfidenceInterval(samples: number[], confidence = 0.95): ConfidenceInterval {
    const n = samples.length;
    if (n === 0) return { mean: 0, lower: 0, upper: 1, width: 1, confidence };

    const sorted = [...samples].sort((a, b) => a - b);
    const mean = samples.reduce((s, v) => s + v, 0) / n;
    const alpha = 1 - confidence;
    const lowerIdx = Math.floor((alpha / 2) * n);
    const upperIdx = Math.ceil((1 - alpha / 2) * n) - 1;

    const lower = sorted[Math.max(0, lowerIdx)] ?? sorted[0];
    const upper = sorted[Math.min(n - 1, upperIdx)] ?? sorted[n - 1];

    return { mean, lower, upper, width: upper - lower, confidence };
  }

  routeByUncertainty(proposalId: string, epistemicUncertainty: number, aleatoricUncertainty: number): UncertaintyEstimate {
    const totalUncertainty = Math.sqrt(epistemicUncertainty ** 2 + aleatoricUncertainty ** 2);
    const shouldExplore = epistemicUncertainty > this.EXPLORATION_THRESHOLD;

    // Generate MC samples for CI
    const mcSamples = Array.from({ length: this.MC_SAMPLES }, () =>
      Math.max(0, Math.random() * epistemicUncertainty + (1 - totalUncertainty) * 0.001)
    );
    const ci = this.computeConfidenceInterval(mcSamples);

    const estimate: UncertaintyEstimate = {
      proposalId,
      epistemicUncertainty,
      aleatoricUncertainty,
      totalUncertainty,
      confidenceInterval: [ci.lower, ci.upper],
      shouldExplore,
    };

    this.estimates.set(proposalId, estimate);
    return estimate;
  }

  updateCalibration(predictedGain: number, actualGain: number): void {
    this.calibrationHistory.push({ predicted: predictedGain, actual: actualGain });
    if (this.calibrationHistory.length > 1000) this.calibrationHistory.shift();
  }

  getUncertaintyReport(): UncertaintyReport {
    const allEstimates = Array.from(this.estimates.values());
    if (allEstimates.length === 0) {
      return {
        avgEpistemicUncertainty: 0,
        avgAleatoricUncertainty: 0,
        explorationRecommended: false,
        highUncertaintyProposals: [],
        calibrationScore: 1.0,
      };
    }

    const avgEpistemic = allEstimates.reduce((s, e) => s + e.epistemicUncertainty, 0) / allEstimates.length;
    const avgAleatoric = allEstimates.reduce((s, e) => s + e.aleatoricUncertainty, 0) / allEstimates.length;
    const highUncertainty = allEstimates.filter(e => e.epistemicUncertainty > this.EXPLORATION_THRESHOLD).map(e => e.proposalId);

    // Calibration: how well predicted uncertainty matches actual variance
    let calibrationScore = 1.0;
    if (this.calibrationHistory.length >= 10) {
      const errors = this.calibrationHistory.map(h => Math.abs(h.predicted - h.actual));
      const mse = errors.reduce((s, e) => s + e ** 2, 0) / errors.length;
      calibrationScore = Math.max(0, 1 - Math.sqrt(mse) * 10);
    }

    return {
      avgEpistemicUncertainty: avgEpistemic,
      avgAleatoricUncertainty: avgAleatoric,
      explorationRecommended: avgEpistemic > this.EXPLORATION_THRESHOLD,
      highUncertaintyProposals: highUncertainty.slice(0, 10),
      calibrationScore,
    };
  }

  getEstimates(): UncertaintyEstimate[] {
    return Array.from(this.estimates.values());
  }
}

export const globalEpistemicUncertainty = new EpistemicUncertaintyQuantifierEngine();

export function quantifyEpistemicUncertainty(proposalId: string, predictedGains: number[]): number {
  return globalEpistemicUncertainty.quantifyEpistemicUncertainty(proposalId, predictedGains);
}

export function quantifyAleatoricUncertainty(proposalId: string, historicalNoise: number[]): number {
  return globalEpistemicUncertainty.quantifyAleatoricUncertainty(proposalId, historicalNoise);
}

export function computeConfidenceInterval(samples: number[], confidence?: number): ConfidenceInterval {
  return globalEpistemicUncertainty.computeConfidenceInterval(samples, confidence);
}

export function routeByUncertainty(proposalId: string, epistemicUncertainty: number, aleatoricUncertainty: number): UncertaintyEstimate {
  return globalEpistemicUncertainty.routeByUncertainty(proposalId, epistemicUncertainty, aleatoricUncertainty);
}

export function getUncertaintyReport(): UncertaintyReport {
  return globalEpistemicUncertainty.getUncertaintyReport();
}

export function initEpistemicUncertaintyQuantifier(): void {
  console.log("[Uncertainty] Epistemic Uncertainty Quantifier initialized.");
}
