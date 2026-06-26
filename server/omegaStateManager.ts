/**
 * Omega State Manager — manages the ultimate convergence state of the Andromeda system.
 * Tracks the system's progress toward its omega point — maximum capability and alignment.
 */

export type OmegaDimension = "intelligence" | "alignment" | "robustness" | "efficiency" | "creativity" | "wisdom";

export interface OmegaMetric {
  dimension: OmegaDimension;
  currentScore: number;  // 0-1
  targetScore: number;   // 0-1
  velocity: number;      // Rate of improvement per cycle
  history: number[];
}

export interface OmegaState {
  id: string;
  timestamp: number;
  metrics: Record<OmegaDimension, OmegaMetric>;
  omegaScore: number;  // Weighted composite 0-1
  phase: "nascent" | "developing" | "mature" | "transcendent";
  cycleCount: number;
}

export interface OmegaStateReport {
  currentOmegaScore: number;
  phase: string;
  cycleCount: number;
  dimensionScores: Record<string, number>;
  estimatedCyclesToTranscendence: number;
}

const OMEGA_WEIGHTS: Record<OmegaDimension, number> = {
  intelligence: 0.25,
  alignment: 0.20,
  robustness: 0.15,
  efficiency: 0.15,
  creativity: 0.10,
  wisdom: 0.15,
};

class OmegaStateManagerEngine {
  private metrics: Map<OmegaDimension, OmegaMetric> = new Map();
  private states: OmegaState[] = [];
  private cycleCount = 0;
  private counter = 0;

  constructor() {
    const dims: OmegaDimension[] = ["intelligence", "alignment", "robustness", "efficiency", "creativity", "wisdom"];
    for (const dim of dims) {
      this.metrics.set(dim, {
        dimension: dim,
        currentScore: 0.3 + Math.random() * 0.2,
        targetScore: 1.0,
        velocity: 0.01 + Math.random() * 0.02,
        history: [],
      });
    }
  }

  advanceCycle(externalUpdates?: Partial<Record<OmegaDimension, number>>): OmegaState {
    this.cycleCount++;

    for (const [dim, metric] of this.metrics.entries()) {
      const update = externalUpdates?.[dim];
      if (update !== undefined) {
        metric.currentScore = Math.min(1, update);
      } else {
        metric.currentScore = Math.min(1, metric.currentScore + metric.velocity);
      }
      metric.history.push(metric.currentScore);
      if (metric.history.length > 100) metric.history.shift();
    }

    const omegaScore = Array.from(this.metrics.entries()).reduce((score, [dim, metric]) => {
      return score + metric.currentScore * (OMEGA_WEIGHTS[dim] ?? 0);
    }, 0);

    const phase: OmegaState["phase"] = omegaScore < 0.3 ? "nascent"
      : omegaScore < 0.6 ? "developing"
      : omegaScore < 0.9 ? "mature"
      : "transcendent";

    const metricsSnapshot: Record<OmegaDimension, OmegaMetric> = {} as Record<OmegaDimension, OmegaMetric>;
    for (const [dim, metric] of this.metrics.entries()) {
      metricsSnapshot[dim] = { ...metric, history: [...metric.history] };
    }

    const state: OmegaState = {
      id: `omega-${++this.counter}`,
      timestamp: Date.now(),
      metrics: metricsSnapshot,
      omegaScore, phase, cycleCount: this.cycleCount,
    };
    this.states.push(state);
    return state;
  }

  getCurrentState(): OmegaState | null {
    return this.states[this.states.length - 1] ?? null;
  }

  getReport(): OmegaStateReport {
    const current = this.getCurrentState();
    if (!current) {
      return { currentOmegaScore: 0, phase: "nascent", cycleCount: 0, dimensionScores: {}, estimatedCyclesToTranscendence: 9999 };
    }

    const dimensionScores: Record<string, number> = {};
    let minCycles = 9999;
    for (const [dim, metric] of Object.entries(current.metrics)) {
      dimensionScores[dim] = metric.currentScore;
      if (metric.velocity > 0) {
        const cycles = Math.ceil((1 - metric.currentScore) / metric.velocity);
        minCycles = Math.min(minCycles, cycles);
      }
    }

    return {
      currentOmegaScore: current.omegaScore,
      phase: current.phase,
      cycleCount: current.cycleCount,
      dimensionScores,
      estimatedCyclesToTranscendence: minCycles,
    };
  }
}

export const globalOmegaStateManager = new OmegaStateManagerEngine();

export function advanceOmegaCycle(externalUpdates?: Partial<Record<OmegaDimension, number>>): OmegaState {
  return globalOmegaStateManager.advanceCycle(externalUpdates);
}
export function getCurrentOmegaState(): OmegaState | null {
  return globalOmegaStateManager.getCurrentState();
}
export function getOmegaStateReport(): OmegaStateReport {
  return globalOmegaStateManager.getReport();
}
export function initOmegaStateManager(): void {
  console.log("[OmegaStateManager] Omega State Manager initialized.");
}
