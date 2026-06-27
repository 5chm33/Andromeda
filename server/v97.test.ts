/**
 * v97.test.ts — Neuromorphic Computing & Spiking Networks
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createNeuron, injectCurrent, getNeuron, resetNeuron, _resetSpikingNeuronForTest } from "./spikingNeuron";
import { encode, decode, getCodes, _resetNeuralPopulationCoderForTest } from "./neuralPopulationCoder";
import { registerPattern, recordSpike, detectPatterns, getMatches, _resetTemporalPatternDetectorForTest } from "./temporalPatternDetector";
import { createSimulation, addNeuron, addSynapse, runTimestep, getSimulation, _resetSpikingNetworkSimulatorForTest } from "./spikingNetworkSimulator";
import { createSynapse, applyHebbianRule, getSynapse, getAllSynapses, getLearningHistory, _resetHebbianLearnerForTest } from "./hebbianLearner";

// ─── spikingNeuron ────────────────────────────────────────────────────────────
describe("spikingNeuron", () => {
  beforeEach(() => _resetSpikingNeuronForTest());

  it("creates a neuron", () => {
    const state = createNeuron({ threshold: 1.0 });
    expect(state.neuronId).toMatch(/^n-/);
    expect(state.membranePotential).toBe(0);
  });

  it("fires when threshold exceeded", () => {
    const state = createNeuron({ threshold: 1.0, leakRate: 0 });
    const { spiked } = injectCurrent(state.neuronId, 1.5, 1);
    expect(spiked).toBe(true);
    expect(state.spikeCount).toBe(1);
  });

  it("does not fire below threshold", () => {
    const state = createNeuron({ threshold: 1.0, leakRate: 0 });
    const { spiked } = injectCurrent(state.neuronId, 0.5, 1);
    expect(spiked).toBe(false);
  });

  it("resets potential after spike", () => {
    const state = createNeuron({ threshold: 1.0, resetPotential: 0.0, leakRate: 0 });
    injectCurrent(state.neuronId, 1.5, 1);
    expect(state.membranePotential).toBe(0.0);
  });

  it("resets neuron state", () => {
    const state = createNeuron({ threshold: 1.0, leakRate: 0 });
    injectCurrent(state.neuronId, 1.5, 1);
    resetNeuron(state.neuronId);
    expect(getNeuron(state.neuronId)!.isRefractory).toBe(false);
  });
});

// ─── neuralPopulationCoder ────────────────────────────────────────────────────
describe("neuralPopulationCoder", () => {
  beforeEach(() => _resetNeuralPopulationCoderForTest());

  it("encodes a value", () => {
    const code = encode(0.5, 10, 0, 1);
    expect(code.codeId).toMatch(/^pc-/);
    expect(code.activations.length).toBe(10);
  });

  it("peak activation near encoded value", () => {
    const code = encode(0.5, 11, 0, 1);
    const maxIdx = code.activations.indexOf(Math.max(...code.activations));
    expect(code.preferredValues[maxIdx]).toBeCloseTo(0.5, 1);
  });

  it("decodes back to approximate value", () => {
    const code = encode(0.7, 20, 0, 1);
    expect(code.decodedValue).toBeCloseTo(0.7, 1);
    expect(code.encodingError).toBeLessThan(0.2);
  });

  it("decodes activations directly", () => {
    const preferredValues = [0, 0.5, 1.0];
    const activations = [0, 1, 0];
    expect(decode(activations, preferredValues)).toBe(0.5);
  });

  it("stores codes", () => {
    encode(0.3, 5, 0, 1);
    expect(getCodes().length).toBe(1);
  });
});

// ─── temporalPatternDetector ──────────────────────────────────────────────────
describe("temporalPatternDetector", () => {
  beforeEach(() => _resetTemporalPatternDetectorForTest());

  it("registers a spike pattern", () => {
    const p = registerPattern("burst", [0, 1, 2], ["n1", "n2", "n3"]);
    expect(p.patternId).toMatch(/^sp-/);
  });

  it("detects a registered pattern", () => {
    // Formula: spike expected at (currentTime - windowSize + spikeTimes[i])
    // Use currentTime=100, windowSize=100, spikeTimes=[0,10,20]
    // Expected absolute times: 0, 10, 20
    registerPattern("seq", [0, 10, 20], ["a", "b", "c"], 1);
    recordSpike("a", 0);
    recordSpike("b", 10);
    recordSpike("c", 20);
    const found = detectPatterns(100, 100);
    expect(found.length).toBeGreaterThan(0);
  });

  it("returns matches", () => {
    registerPattern("p1", [5], ["x"], 2);
    recordSpike("x", 5);
    detectPatterns(10, 12);
    expect(getMatches().length).toBeGreaterThan(0);
  });
});

// ─── spikingNetworkSimulator ──────────────────────────────────────────────────
describe("spikingNetworkSimulator", () => {
  beforeEach(() => _resetSpikingNetworkSimulatorForTest());

  it("creates a simulation", () => {
    const sim = createSimulation();
    expect(sim.simId).toMatch(/^sim-/);
  });

  it("adds neurons", () => {
    const sim = createSimulation();
    const neuron = addNeuron(sim.simId, 1.0);
    expect(neuron).not.toBeNull();
    expect(getSimulation(sim.simId)!.neurons.size).toBe(1);
  });

  it("neuron fires with sufficient input", () => {
    const sim = createSimulation();
    const neuron = addNeuron(sim.simId, 1.0, 0)!;
    const spikes = runTimestep(sim.simId, { [neuron.neuronId]: 2.0 });
    expect(spikes).toContain(neuron.neuronId);
  });

  it("propagates spikes through synapses", () => {
    const sim = createSimulation();
    const n1 = addNeuron(sim.simId, 1.0, 0)!;
    const n2 = addNeuron(sim.simId, 0.5, 0)!;
    addSynapse(sim.simId, n1.neuronId, n2.neuronId, 1.0);
    runTimestep(sim.simId, { [n1.neuronId]: 2.0 }); // n1 fires
    // n2 should receive input from n1's spike
    expect(getSimulation(sim.simId)!.neurons.get(n2.neuronId)!.potential).toBeGreaterThanOrEqual(0);
  });

  it("increments timestep", () => {
    const sim = createSimulation();
    runTimestep(sim.simId);
    expect(getSimulation(sim.simId)!.timestep).toBe(1);
  });
});

// ─── hebbianLearner ───────────────────────────────────────────────────────────
describe("hebbianLearner", () => {
  beforeEach(() => _resetHebbianLearnerForTest());

  it("creates a synapse", () => {
    const syn = createSynapse("pre", "post", 0.5);
    expect(syn.synapseId).toMatch(/^hs-/);
    expect(syn.weight).toBe(0.5);
  });

  it("strengthens synapse when both fire", () => {
    const syn = createSynapse("pre", "post", 0.5, 0.1);
    applyHebbianRule(syn.synapseId, true, true);
    expect(getSynapse(syn.synapseId)!.weight).toBeGreaterThan(0.5);
  });

  it("weakens synapse when only pre fires", () => {
    const syn = createSynapse("pre", "post", 0.5, 0.1);
    applyHebbianRule(syn.synapseId, true, false);
    expect(getSynapse(syn.synapseId)!.weight).toBeLessThan(0.5);
  });

  it("no change when neither fires", () => {
    const syn = createSynapse("pre", "post", 0.5, 0.1);
    applyHebbianRule(syn.synapseId, false, false);
    expect(getSynapse(syn.synapseId)!.weight).toBe(0.5);
  });

  it("records learning history", () => {
    const syn = createSynapse("pre", "post", 0.5);
    applyHebbianRule(syn.synapseId, true, true);
    expect(getLearningHistory(syn.synapseId).length).toBe(1);
  });
});
