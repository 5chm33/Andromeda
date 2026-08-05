/**
 * hebbianLearner.ts — v97.0.0 "Neuromorphic Computing & Spiking Networks"
 * Hebbian learning rule: "neurons that fire together, wire together."
 */
export interface HebbianSynapse {
  synapseId: string;
  preNeuronId: string;
  postNeuronId: string;
  weight: number;
  minWeight: number;
  maxWeight: number;
  learningRate: number;
  updateCount: number;
}

export interface LearningEvent {
  eventId: string;
  synapseId: string;
  preFired: boolean;
  postFired: boolean;
  weightDelta: number;
  newWeight: number;
  timestamp: number;
}

const synapses = new Map<string, HebbianSynapse>();
const events: LearningEvent[] = [];
let synapseCounter = 0;
let eventCounter = 0;

export function createSynapse(preNeuronId: string, postNeuronId: string, initialWeight = 0.5, learningRate = 0.01, minWeight = 0, maxWeight = 1): HebbianSynapse {
  const synapse: HebbianSynapse = { synapseId: `hs-${++synapseCounter}`, preNeuronId, postNeuronId, weight: initialWeight, minWeight, maxWeight, learningRate, updateCount: 0 };
  synapses.set(synapse.synapseId, synapse);
  return synapse;
}

export function applyHebbianRule(synapseId: string, preFired: boolean, postFired: boolean): LearningEvent | null {
  const synapse = synapses.get(synapseId);
  if (!synapse) return null;

  // Hebbian: increase weight if both fire, decrease if only one fires
  let weightDelta = 0;
  if (preFired && postFired) weightDelta = synapse.learningRate * (1 - synapse.weight);
  else if (preFired && !postFired) weightDelta = -synapse.learningRate * synapse.weight * 0.5;
  else if (!preFired && postFired) weightDelta = -synapse.learningRate * synapse.weight * 0.5;

  synapse.weight = Math.max(synapse.minWeight, Math.min(synapse.maxWeight, synapse.weight + weightDelta));
  synapse.updateCount++;

  const event: LearningEvent = { eventId: `le-${++eventCounter}`, synapseId, preFired, postFired, weightDelta, newWeight: synapse.weight, timestamp: Date.now() };
  events.push(event);
  return event;
}

export function getSynapse(synapseId: string): HebbianSynapse | undefined { return synapses.get(synapseId); }
export function getAllSynapses(): HebbianSynapse[] { return [...synapses.values()]; }
export function getLearningHistory(synapseId?: string): LearningEvent[] { return synapseId ? events.filter(e => e.synapseId === synapseId) : [...events]; }
export function _resetHebbianLearnerForTest(): void { synapses.clear(); events.length = 0; synapseCounter = 0; eventCounter = 0; }
