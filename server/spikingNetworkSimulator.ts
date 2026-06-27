/**
 * spikingNetworkSimulator.ts — v97.0.0 "Neuromorphic Computing & Spiking Networks"
 * Simulates networks of spiking neurons with configurable connectivity.
 */
export interface NetworkNeuron { neuronId: string; potential: number; threshold: number; leakRate: number; spikeCount: number; }
export interface Synapse { synapseId: string; sourceId: string; targetId: string; weight: number; delay: number; }
export interface NetworkSimulation {
  simId: string;
  neurons: Map<string, NetworkNeuron>;
  synapses: Synapse[];
  timestep: number;
  spikeLog: Array<{ neuronId: string; time: number }>;
}

const simulations = new Map<string, NetworkSimulation>();
let simCounter = 0;
let synapseCounter = 0;
let netNeuronCounter = 0;

export function createSimulation(): NetworkSimulation {
  const sim: NetworkSimulation = { simId: `sim-${++simCounter}`, neurons: new Map(), synapses: [], timestep: 0, spikeLog: [] };
  simulations.set(sim.simId, sim);
  return sim;
}

export function addNeuron(simId: string, threshold = 1.0, leakRate = 0.1): NetworkNeuron | null {
  const sim = simulations.get(simId);
  if (!sim) return null;
  const neuron: NetworkNeuron = { neuronId: `nn-${++netNeuronCounter}`, potential: 0, threshold, leakRate, spikeCount: 0 };
  sim.neurons.set(neuron.neuronId, neuron);
  return neuron;
}

export function addSynapse(simId: string, sourceId: string, targetId: string, weight: number, delay = 1): Synapse | null {
  const sim = simulations.get(simId);
  if (!sim) return null;
  const synapse: Synapse = { synapseId: `syn-${++synapseCounter}`, sourceId, targetId, weight, delay };
  sim.synapses.push(synapse);
  return synapse;
}

export function runTimestep(simId: string, externalInputs: Record<string, number> = {}): string[] {
  const sim = simulations.get(simId);
  if (!sim) return [];
  const spikes: string[] = [];

  // Apply external inputs
  for (const [neuronId, current] of Object.entries(externalInputs)) {
    const neuron = sim.neurons.get(neuronId);
    if (neuron) neuron.potential += current;
  }

  // Check for spikes
  for (const neuron of sim.neurons.values()) {
    neuron.potential *= (1 - neuron.leakRate);
    if (neuron.potential >= neuron.threshold) {
      spikes.push(neuron.neuronId);
      neuron.potential = 0;
      neuron.spikeCount++;
      sim.spikeLog.push({ neuronId: neuron.neuronId, time: sim.timestep });
    }
  }

  // Propagate spikes through synapses
  for (const spike of spikes) {
    for (const synapse of sim.synapses) {
      if (synapse.sourceId === spike) {
        const target = sim.neurons.get(synapse.targetId);
        if (target) target.potential += synapse.weight;
      }
    }
  }

  sim.timestep++;
  return spikes;
}

export function getSimulation(simId: string): NetworkSimulation | undefined { return simulations.get(simId); }
export function _resetSpikingNetworkSimulatorForTest(): void { simulations.clear(); simCounter = 0; synapseCounter = 0; netNeuronCounter = 0; }
