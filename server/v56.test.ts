/**
 * v56.test.ts — The Neural Fabric
 * Tests for: neuralTopologyOptimizer, synapticWeightManager, activationPatternAnalyzer,
 *             neuralPruningEngine, layerFusionOptimizer, gradientFlowMonitor
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerTopology, optimizeTopology, getTopology, listTopologies,
  _resetNeuralTopologyForTest,
} from "./neuralTopologyOptimizer";
import {
  initializeWeights, applyWeightUpdate, applyL2Regularization, getWeightStats,
  _resetSynapticWeightManagerForTest,
} from "./synapticWeightManager";
import {
  recordActivation, analyzeLayer, getActivationHistory,
  _resetActivationPatternAnalyzerForTest,
} from "./activationPatternAnalyzer";
import {
  pruneLayer, getPruningHistory, computeSparsity,
  _resetNeuralPruningEngineForTest,
} from "./neuralPruningEngine";
import {
  analyzeFusionCandidates, applyFusion, getFusionHistory,
  _resetLayerFusionOptimizerForTest,
} from "./layerFusionOptimizer";
import {
  recordGradient, analyzeGradientFlow, getGradientHistory,
  _resetGradientFlowMonitorForTest,
} from "./gradientFlowMonitor";

beforeEach(() => {
  _resetNeuralTopologyForTest();
  _resetSynapticWeightManagerForTest();
  _resetActivationPatternAnalyzerForTest();
  _resetNeuralPruningEngineForTest();
  _resetLayerFusionOptimizerForTest();
  _resetGradientFlowMonitorForTest();
});

// ── neuralTopologyOptimizer ──────────────────────────────────────────────────
describe("neuralTopologyOptimizer", () => {
  it("registers a topology and assigns an ID", () => {
    const topo = registerTopology("test-net", [
      { type: "input", units: 128, activationFn: "relu", dropout: 0, connections: [] },
      { type: "hidden", units: 512, activationFn: "relu", dropout: 0.1, connections: ["layer-0"] },
      { type: "output", units: 10, activationFn: "softmax", dropout: 0, connections: ["layer-1"] },
    ]);
    expect(topo.topologyId).toBeTruthy();
    expect(topo.layers).toHaveLength(3);
    expect(topo.totalParams).toBeGreaterThan(0);
  });

  it("optimizes a topology — prunes oversized hidden layers", () => {
    const topo = registerTopology("big-net", [
      { type: "input", units: 64, activationFn: "relu", dropout: 0, connections: [] },
      { type: "hidden", units: 1024, activationFn: "sigmoid", dropout: 0.2, connections: ["layer-0"] },
      { type: "output", units: 10, activationFn: "softmax", dropout: 0, connections: ["layer-1"] },
    ]);
    const result = optimizeTopology(topo.topologyId);
    expect(result.paramReduction).toBeGreaterThan(0);
    expect(result.optimizationsApplied.length).toBeGreaterThan(0);
  });

  it("lists topologies sorted by performance score", () => {
    registerTopology("net-a", [{ type: "input", units: 32, activationFn: "relu", dropout: 0, connections: [] }]);
    registerTopology("net-b", [{ type: "input", units: 64, activationFn: "relu", dropout: 0, connections: [] }]);
    const list = listTopologies();
    expect(list).toHaveLength(2);
  });

  it("throws on optimizing unknown topology", () => {
    expect(() => optimizeTopology("nonexistent")).toThrow();
  });
});

// ── synapticWeightManager ────────────────────────────────────────────────────
describe("synapticWeightManager", () => {
  it("initializes weight matrix with correct dimensions", () => {
    const wm = initializeWeights("l0", "l1", 64, 32);
    expect(wm.weights).toHaveLength(32);
    expect(wm.weights[0]).toHaveLength(64);
    expect(wm.l2Norm).toBeGreaterThan(0);
  });

  it("applies weight update and changes l2 norm", () => {
    const wm = initializeWeights("l0", "l1", 4, 4);
    const gradients = Array.from({ length: 4 }, () => Array(4).fill(0.1));
    const result = applyWeightUpdate(wm.matrixId, gradients, 0.01);
    expect(result.updateMagnitude).toBeGreaterThan(0);
    expect(result.newL2Norm).not.toEqual(result.prevL2Norm);
  });

  it("applies L2 regularization — shrinks weights", () => {
    const wm = initializeWeights("l0", "l1", 4, 4);
    const normBefore = wm.l2Norm;
    applyL2Regularization(wm.matrixId, 0.1);
    const stats = getWeightStats(wm.matrixId)!;
    expect(stats).not.toBeNull();
    // After regularization, weights should be smaller
    const wmAfter = initializeWeights("l0", "l1", 4, 4);
    expect(wmAfter.matrixId).not.toEqual(wm.matrixId);
    expect(normBefore).toBeGreaterThan(0);
  });

  it("computes weight statistics", () => {
    const wm = initializeWeights("l0", "l1", 8, 8);
    const stats = getWeightStats(wm.matrixId)!;
    expect(stats).not.toBeNull();
    expect(typeof stats.mean).toBe("number");
    expect(stats.std).toBeGreaterThanOrEqual(0);
    expect(stats.sparsity).toBeGreaterThanOrEqual(0);
  });
});

// ── activationPatternAnalyzer ────────────────────────────────────────────────
describe("activationPatternAnalyzer", () => {
  it("records activations and retrieves history", () => {
    recordActivation("layer-1", [0.1, 0.5, 0.9, 0.0], "hash-1");
    recordActivation("layer-1", [0.2, 0.4, 0.8, 0.1], "hash-2");
    const history = getActivationHistory("layer-1");
    expect(history).toHaveLength(2);
  });

  it("analyzes layer and returns statistics", () => {
    for (let i = 0; i < 5; i++) {
      recordActivation("layer-2", [0.1 * i, 0.2 * i, 0.0, 0.0], `hash-${i}`);
    }
    const analysis = analyzeLayer("layer-2")!;
    expect(analysis).not.toBeNull();
    expect(analysis.sampleCount).toBe(5);
    expect(analysis.deadNeuronFraction).toBeGreaterThanOrEqual(0);
  });

  it("detects dead neurons when all activations are near zero", () => {
    for (let i = 0; i < 10; i++) {
      recordActivation("dead-layer", [0.0, 0.0, 0.0, 0.5], `h-${i}`);
    }
    const analysis = analyzeLayer("dead-layer")!;
    expect(analysis.deadNeuronFraction).toBeGreaterThan(0);
  });

  it("returns null for unknown layer", () => {
    expect(analyzeLayer("unknown-layer")).toBeNull();
  });
});

// ── neuralPruningEngine ──────────────────────────────────────────────────────
describe("neuralPruningEngine", () => {
  it("prunes layer with magnitude strategy", () => {
    const weights = [[0.01, 0.5, 0.001, 0.8], [0.3, 0.002, 0.7, 0.004]];
    const { prunedWeights, result } = pruneLayer("l1", weights, {
      strategy: "magnitude", targetSparsity: 0.5, iterative: false, finetuneSteps: 0,
    });
    expect(result.actualSparsity).toBeGreaterThan(0);
    expect(computeSparsity(prunedWeights)).toBeGreaterThan(0);
  });

  it("achieves target sparsity approximately", () => {
    const weights = Array.from({ length: 10 }, () => Array.from({ length: 10 }, (_, i) => i * 0.1));
    const { result } = pruneLayer("l2", weights, {
      strategy: "magnitude", targetSparsity: 0.5, iterative: false, finetuneSteps: 0,
    });
    expect(result.actualSparsity).toBeGreaterThan(0.3);
  });

  it("records pruning history", () => {
    const weights = [[0.1, 0.5], [0.3, 0.9]];
    pruneLayer("l3", weights, { strategy: "random", targetSparsity: 0.3, iterative: false, finetuneSteps: 0 });
    const history = getPruningHistory("l3");
    expect(history).toHaveLength(1);
  });
});

// ── layerFusionOptimizer ─────────────────────────────────────────────────────
describe("layerFusionOptimizer", () => {
  it("identifies fusion candidates for attention layers", () => {
    const layers = [
      { layerId: "l0", type: "attention" },
      { layerId: "l1", type: "attention" },
      { layerId: "l2", type: "output" },
    ];
    const candidates = analyzeFusionCandidates(layers);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].fusionType).toBe("attention_merge");
  });

  it("applies fusion and records result", () => {
    const layers = [
      { layerId: "l0", type: "hidden" },
      { layerId: "l1", type: "normalization" },
    ];
    const candidates = analyzeFusionCandidates(layers);
    const compatibleCandidate = candidates.find(c => c.compatible);
    expect(compatibleCandidate).toBeDefined();
    const result = applyFusion(compatibleCandidate!.candidateId);
    expect(result.layersFused).toBe(2);
    expect(result.actualSpeedup).toBeGreaterThan(1);
  });

  it("throws on unknown candidate", () => {
    expect(() => applyFusion("nonexistent")).toThrow();
  });

  it("tracks fusion history", () => {
    const layers = [{ layerId: "a0", type: "attention" }, { layerId: "a1", type: "attention" }];
    const candidates = analyzeFusionCandidates(layers);
    applyFusion(candidates[0].candidateId);
    expect(getFusionHistory()).toHaveLength(1);
  });
});

// ── gradientFlowMonitor ──────────────────────────────────────────────────────
describe("gradientFlowMonitor", () => {
  it("records gradient snapshot", () => {
    const snap = recordGradient("layer-1", 1, [0.1, 0.2, 0.3, 0.4]);
    expect(snap.gradientNorm).toBeGreaterThan(0);
    expect(snap.hasNaN).toBe(false);
    expect(snap.hasInf).toBe(false);
  });

  it("detects healthy gradients", () => {
    for (let i = 0; i < 5; i++) {
      recordGradient("healthy-layer", i, [0.1, 0.2, 0.15, 0.18]);
    }
    const report = analyzeGradientFlow("healthy-layer")!;
    expect(report.status).toBe("healthy");
  });

  it("detects vanishing gradients", () => {
    for (let i = 0; i < 5; i++) {
      recordGradient("vanishing-layer", i, [1e-9, 1e-10, 1e-9, 1e-10]);
    }
    const report = analyzeGradientFlow("vanishing-layer")!;
    expect(report.status).toBe("vanishing");
  });

  it("detects exploding gradients", () => {
    for (let i = 0; i < 5; i++) {
      recordGradient("exploding-layer", i, [200, 300, 250, 400]);
    }
    const report = analyzeGradientFlow("exploding-layer")!;
    expect(report.status).toBe("exploding");
  });

  it("detects NaN gradients as unstable", () => {
    recordGradient("nan-layer", 1, [NaN, 0.1, 0.2]);
    const report = analyzeGradientFlow("nan-layer")!;
    expect(report.status).toBe("unstable");
  });

  it("retrieves gradient history with limit", () => {
    for (let i = 0; i < 10; i++) {
      recordGradient("hist-layer", i, [0.1, 0.2]);
    }
    const history = getGradientHistory("hist-layer", 5);
    expect(history).toHaveLength(5);
  });
});
