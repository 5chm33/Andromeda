/**
 * spikingNeuron.ts — v97.0.0 "Neuromorphic Computing & Spiking Networks"
 * Leaky Integrate-and-Fire (LIF) spiking neuron model.
 */
export interface NeuronConfig {
  threshold: number;
  restingPotential: number;
  resetPotential: number;
  leakRate: number;
  refractoryPeriod: number;
}

export interface NeuronState {
  neuronId: string;
  membranePotential: number;
  lastSpikeTime: number | null;
  spikeCount: number;
  isRefractory: boolean;
  firingRate: number;
}

const neurons = new Map<string, { config: NeuronConfig; state: NeuronState }>();
let neuronCounter = 0;

export function createNeuron(config: Partial<NeuronConfig> = {}): NeuronState {
  const fullConfig: NeuronConfig = { threshold: 1.0, restingPotential: 0.0, resetPotential: 0.0, leakRate: 0.1, refractoryPeriod: 2, ...config };
  const neuronId = `n-${++neuronCounter}`;
  const state: NeuronState = { neuronId, membranePotential: fullConfig.restingPotential, lastSpikeTime: null, spikeCount: 0, isRefractory: false, firingRate: 0 };
  neurons.set(neuronId, { config: fullConfig, state });
  return state;
}

export function injectCurrent(neuronId: string, current: number, timestep: number): { spiked: boolean; state: NeuronState } {
  const entry = neurons.get(neuronId);
  if (!entry) return { spiked: false, state: null! };
  const { config, state } = entry;

  if (state.isRefractory && state.lastSpikeTime !== null && timestep - state.lastSpikeTime < config.refractoryPeriod) {
    return { spiked: false, state };
  }
  state.isRefractory = false;

  // LIF dynamics: dV/dt = -leakRate * (V - Vrest) + current
  state.membranePotential += -config.leakRate * (state.membranePotential - config.restingPotential) + current;

  if (state.membranePotential >= config.threshold) {
    state.membranePotential = config.resetPotential;
    state.lastSpikeTime = timestep;
    state.spikeCount++;
    state.isRefractory = true;
    state.firingRate = state.spikeCount / (timestep + 1);
    return { spiked: true, state };
  }
  return { spiked: false, state };
}

export function getNeuron(neuronId: string): NeuronState | undefined { return neurons.get(neuronId)?.state; }
export function resetNeuron(neuronId: string): void { const e = neurons.get(neuronId); if (e) { e.state.membranePotential = e.config.restingPotential; e.state.isRefractory = false; } }
export function _resetSpikingNeuronForTest(): void { neurons.clear(); neuronCounter = 0; }
