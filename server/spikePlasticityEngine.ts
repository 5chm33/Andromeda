/**
 * Spike-Timing-Dependent Plasticity Engine — STDP for the reward model.
 * Temporal correlations between improvement events reinforce each other's weights,
 * creating emergent synergies between related capabilities.
 */

export interface SpikeEvent {
  moduleId: string;
  timestamp: number;
  reward: number;
  dimension: string;
}

export interface STDPUpdate {
  preModuleId: string;
  postModuleId: string;
  weightDelta: number;
  timeDiffMs: number;
}

export interface PlasticityMap {
  weights: Map<string, number>;
  totalUpdates: number;
  avgWeightMagnitude: number;
}

class SpikePlasticityEngine {
  private spikeHistory: SpikeEvent[] = [];
  private synapticWeights: Map<string, number> = new Map();
  private totalUpdates = 0;

  // STDP window parameters
  private readonly TAU_PLUS = 20;   // ms — pre-before-post potentiation window
  private readonly TAU_MINUS = 20;  // ms — post-before-pre depression window
  private readonly A_PLUS = 0.01;   // potentiation amplitude
  private readonly A_MINUS = 0.012; // depression amplitude (slightly asymmetric)

  recordSpikeEvent(moduleId: string, timestamp: number, reward: number, dimension: string = "general"): void {
    this.spikeHistory.push({ moduleId, timestamp, reward, dimension });
    if (this.spikeHistory.length > 500) {
      this.spikeHistory.shift();
    }
    // Trigger STDP update with recent spikes
    this._applySTDPWithRecent(moduleId, timestamp);
  }

  private _applySTDPWithRecent(newModuleId: string, newTimestamp: number): void {
    const windowMs = Math.max(this.TAU_PLUS, this.TAU_MINUS) * 5;
    const recentSpikes = this.spikeHistory.filter(
      s => s.moduleId !== newModuleId && Math.abs(s.timestamp - newTimestamp) < windowMs
    );

    for (const prevSpike of recentSpikes) {
      const dt = newTimestamp - prevSpike.timestamp;
      const update = this.computeSTDPUpdate(prevSpike, { moduleId: newModuleId, timestamp: newTimestamp, reward: 0, dimension: "general" });
      this._applyWeightUpdate(prevSpike.moduleId, newModuleId, update.weightDelta);
    }
  }

  computeSTDPUpdate(preSpike: SpikeEvent, postSpike: SpikeEvent): STDPUpdate {
    const dt = postSpike.timestamp - preSpike.timestamp; // positive = pre before post

    let weightDelta: number;
    if (dt > 0) {
      // Pre fires before post → potentiation (Hebbian)
      weightDelta = this.A_PLUS * Math.exp(-dt / this.TAU_PLUS);
    } else {
      // Post fires before pre → depression (anti-Hebbian)
      weightDelta = -this.A_MINUS * Math.exp(dt / this.TAU_MINUS);
    }

    // Scale by reward signal
    weightDelta *= (preSpike.reward + postSpike.reward) / 2;

    return {
      preModuleId: preSpike.moduleId,
      postModuleId: postSpike.moduleId,
      weightDelta,
      timeDiffMs: dt,
    };
  }

  private _applyWeightUpdate(preId: string, postId: string, delta: number): void {
    const key = `${preId}→${postId}`;
    const current = this.synapticWeights.get(key) ?? 0.5;
    // Clip weights to [0, 1]
    const updated = Math.max(0, Math.min(1, current + delta));
    this.synapticWeights.set(key, updated);
    this.totalUpdates++;
  }

  applyPlasticityUpdate(weights: Map<string, number>): Map<string, number> {
    for (const [key, w] of weights) {
      const existing = this.synapticWeights.get(key) ?? 0.5;
      this.synapticWeights.set(key, (existing + w) / 2);
    }
    return new Map(this.synapticWeights);
  }

  getPlasticityMap(): PlasticityMap {
    const values = Array.from(this.synapticWeights.values());
    const avgWeightMagnitude = values.length > 0
      ? values.reduce((a, b) => a + Math.abs(b), 0) / values.length
      : 0;

    return {
      weights: new Map(this.synapticWeights),
      totalUpdates: this.totalUpdates,
      avgWeightMagnitude,
    };
  }

  getSynapticWeight(preId: string, postId: string): number {
    return this.synapticWeights.get(`${preId}→${postId}`) ?? 0.5;
  }

  getSpikeHistory(): SpikeEvent[] {
    return [...this.spikeHistory];
  }
}

export const globalSpikePlasticityEngine = new SpikePlasticityEngine();

export function recordSpikeEvent(moduleId: string, timestamp: number, reward: number, dimension?: string): void {
  globalSpikePlasticityEngine.recordSpikeEvent(moduleId, timestamp, reward, dimension);
}

export function computeSTDPUpdate(preSpike: SpikeEvent, postSpike: SpikeEvent): STDPUpdate {
  return globalSpikePlasticityEngine.computeSTDPUpdate(preSpike, postSpike);
}

export function applyPlasticityUpdate(weights: Map<string, number>): Map<string, number> {
  return globalSpikePlasticityEngine.applyPlasticityUpdate(weights);
}

export function getPlasticityMap(): PlasticityMap {
  return globalSpikePlasticityEngine.getPlasticityMap();
}

export function initSpikePlasticityEngine(): void {
  console.log("[STDP] Spike-Timing-Dependent Plasticity Engine initialized.");
  // Seed with some initial spike events
  const now = Date.now();
  globalSpikePlasticityEngine.recordSpikeEvent("srilEngine", now - 100, 0.9, "accuracy");
  globalSpikePlasticityEngine.recordSpikeEvent("rlhfPipeline", now - 50, 0.85, "reward");
  globalSpikePlasticityEngine.recordSpikeEvent("omegaConvergenceDetector", now, 0.95, "convergence");
}
