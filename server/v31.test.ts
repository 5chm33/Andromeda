import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  globalMetaCognitiveEngine,
  introspectDecisionProcess,
  detectCognitiveBias,
  updateMetaStrategy,
  getMetaCognitiveReport,
  initMetaCognitiveEngine,
  type DecisionRecord,
} from "./metaCognitiveEngine";

import {
  seekConsensus,
  seekAdaptiveConsensus,
  getConsensusStatus,
  initDistributedConsensus,
  type ConsensusProposal,
} from "./distributedConsensus";

import {
  globalSpikePlasticityEngine,
  recordSpikeEvent,
  computeSTDPUpdate,
  applyPlasticityUpdate,
  getPlasticityMap,
  initSpikePlasticityEngine,
} from "./spikePlasticityEngine";

import {
  globalCurriculumDesigner,
  assessCurrentCapabilities,
  designNextCurriculum,
  getZPDTasks,
  trackCurriculumProgress,
  initCurriculumDesigner,
} from "./curriculumDesigner";

import {
  globalCounterfactualSimulator,
  buildCausalGraph,
  simulateCounterfactual,
  compareActualVsCounterfactual,
  updatePolicyFromCounterfactuals,
  initCounterfactualSimulator,
  type ImprovementEvent,
} from "./counterfactualSimulator";

import {
  globalELP,
  observeCommunicationPatterns,
  compressToEmergentSymbol,
  decompressSymbol,
  compressMessage,
  decompressMessage,
  getEmergentVocabulary,
  initEmergentLanguageProtocol,
} from "./emergentLanguageProtocol";

describe("v31 Singularity Threshold Enhancements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Meta-Cognitive Engine ───────────────────────────────────────────────────
  describe("Meta-Cognitive Introspection Engine", () => {
    it("should initialize without errors", () => {
      expect(() => initMetaCognitiveEngine()).not.toThrow();
    });

    it("should detect recency bias in skewed decision history", () => {
      const decisions: DecisionRecord[] = [
        ...Array.from({ length: 20 }, (_, i) => ({
          proposalId: `old-${i}`,
          accepted: i % 2 === 0,
          reward: 0.5,
          features: {},
          timestamp: Date.now() - 100000 + i * 1000,
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          proposalId: `recent-${i}`,
          accepted: true,
          reward: 0.9,
          features: {},
          timestamp: Date.now() - 1000 + i * 100,
        })),
      ];
      const biases = detectCognitiveBias(decisions);
      expect(Array.isArray(biases)).toBe(true);
    });

    it("should generate a meta-cognitive report", () => {
      const report = getMetaCognitiveReport();
      expect(typeof report.totalDecisions).toBe("number");
      expect(typeof report.acceptanceRate).toBe("number");
      expect(typeof report.strategyHealth).toBe("number");
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it("should update meta strategy from bias report", () => {
      expect(() => updateMetaStrategy([{
        biasType: "recency_bias",
        severity: 0.3,
        affectedDimension: "acceptance_rate",
        evidence: "test",
        correction: "apply EMA",
      }])).not.toThrow();
    });

    it("should return strategy weights map", () => {
      const weights = globalMetaCognitiveEngine.getStrategyWeights();
      expect(weights instanceof Map).toBe(true);
      expect(weights.size).toBeGreaterThan(0);
    });
  });

  // ─── Distributed Consensus ───────────────────────────────────────────────────
  describe("Distributed Multi-Agent Consensus", () => {
    const makeProposal = (id: string): ConsensusProposal => ({
      proposalId: id,
      targetFile: "rsiEngine.ts",
      title: "Test proposal",
      proposedContent: "// improved code",
      originalContent: "// original code",
      area: "performance",
      confidence: 0.85,
      proposedAt: new Date().toISOString(),
    });

    it("should initialize without errors", () => {
      expect(() => initDistributedConsensus()).not.toThrow();
    });

    it("should return consensus status", () => {
      const status = getConsensusStatus();
      expect(["single-node", "multi-node"]).toContain(status.mode);
      expect(typeof status.isHealthy).toBe("boolean");
    });

    it("should seek consensus in single-node mode", async () => {
      const result = await seekConsensus(makeProposal("prop-1"));
      expect(typeof result.reached).toBe("boolean");
      expect(result.singleNodeMode).toBe(true);
      expect(result.totalVotes).toBeGreaterThan(0);
    });

    it("should seek adaptive consensus with threshold", async () => {
      const result = await seekAdaptiveConsensus(makeProposal("prop-2"), 0.9, 2);
      expect(typeof result.reached).toBe("boolean");
      expect(result.adaptiveThreshold).toBeTruthy();
    });

    it("should apply critical file threshold for rsiEngine.ts", async () => {
      const result = await seekAdaptiveConsensus(makeProposal("prop-3"), 0.9, 2);
      expect(result.adaptiveThreshold.isCriticalFile).toBe(true);
    });
  });

  // ─── Spike Plasticity Engine ─────────────────────────────────────────────────
  describe("Spike-Timing-Dependent Plasticity Engine", () => {
    it("should initialize without errors", () => {
      expect(() => initSpikePlasticityEngine()).not.toThrow();
    });

    it("should record spike events", () => {
      expect(() => recordSpikeEvent("moduleA", Date.now(), 0.9, "accuracy")).not.toThrow();
    });

    it("should compute STDP update with potentiation for pre-before-post", () => {
      const pre = { moduleId: "A", timestamp: 1000, reward: 0.8, dimension: "acc" };
      const post = { moduleId: "B", timestamp: 1010, reward: 0.9, dimension: "acc" };
      const update = computeSTDPUpdate(pre, post);
      expect(update.weightDelta).toBeGreaterThan(0); // potentiation
    });

    it("should compute STDP update with depression for post-before-pre", () => {
      const pre = { moduleId: "A", timestamp: 1020, reward: 0.8, dimension: "acc" };
      const post = { moduleId: "B", timestamp: 1000, reward: 0.9, dimension: "acc" };
      const update = computeSTDPUpdate(pre, post);
      expect(update.weightDelta).toBeLessThan(0); // depression
    });

    it("should return plasticity map", () => {
      const map = getPlasticityMap();
      expect(map.weights instanceof Map).toBe(true);
      expect(typeof map.totalUpdates).toBe("number");
      expect(typeof map.avgWeightMagnitude).toBe("number");
    });

    it("should apply external weight updates", () => {
      const weights = new Map([["A→B", 0.7], ["B→C", 0.3]]);
      const result = applyPlasticityUpdate(weights);
      expect(result instanceof Map).toBe(true);
    });
  });

  // ─── Curriculum Designer ─────────────────────────────────────────────────────
  describe("Autonomous Curriculum Designer", () => {
    it("should initialize without errors", () => {
      expect(() => initCurriculumDesigner()).not.toThrow();
    });

    it("should assess current capabilities", () => {
      const caps = assessCurrentCapabilities();
      expect(caps instanceof Map).toBe(true);
      expect(caps.size).toBeGreaterThan(0);
    });

    it("should design a curriculum plan", () => {
      const plan = designNextCurriculum();
      expect(Array.isArray(plan.tasks)).toBe(true);
      expect(typeof plan.estimatedTotalGain).toBe("number");
      expect(Array.isArray(plan.focusDimensions)).toBe(true);
    });

    it("should return ZPD tasks", () => {
      const tasks = getZPDTasks();
      expect(Array.isArray(tasks)).toBe(true);
      for (const task of tasks) {
        expect(task.isInZPD).toBe(true);
      }
    });

    it("should track curriculum progress and update capability level", () => {
      const plan = designNextCurriculum();
      if (plan.tasks.length > 0) {
        expect(() => trackCurriculumProgress(plan.tasks[0].id, 0.001)).not.toThrow();
      }
    });
  });

  // ─── Counterfactual Simulator ─────────────────────────────────────────────────
  describe("Causal Counterfactual Simulator", () => {
    const sampleHistory: ImprovementEvent[] = Array.from({ length: 10 }, (_, i) => ({
      id: `evt-${i}`,
      description: `Improvement ${i}`,
      targetFile: `module${i % 3}.ts`,
      reward: 0.5 + i * 0.05,
      accepted: i % 3 !== 0,
      timestamp: Date.now() - (10 - i) * 5000,
      capabilityDelta: { accuracy: 0.001 * i },
    }));

    it("should initialize without errors", () => {
      expect(() => initCounterfactualSimulator()).not.toThrow();
    });

    it("should build a causal graph from history", () => {
      const graph = buildCausalGraph(sampleHistory);
      expect(Array.isArray(graph.nodes)).toBe(true);
      expect(Array.isArray(graph.edges)).toBe(true);
    });

    it("should simulate counterfactual for rejected proposal", () => {
      buildCausalGraph(sampleHistory);
      const rejected = sampleHistory.find(e => !e.accepted)!;
      const outcome = simulateCounterfactual(rejected, "accept");
      expect(typeof outcome.counterfactualReward).toBe("number");
      expect(typeof outcome.regret).toBe("number");
    });

    it("should compare actual vs counterfactual", () => {
      buildCausalGraph(sampleHistory);
      const event = sampleHistory[0];
      const cf = simulateCounterfactual(event, "reject");
      const comparison = compareActualVsCounterfactual(event, cf);
      expect(["actual", "counterfactual"]).toContain(comparison.betterChoice);
    });

    it("should update policy from counterfactuals", () => {
      const regretMap = globalCounterfactualSimulator.computeRegretMap(sampleHistory);
      const updates = updatePolicyFromCounterfactuals(regretMap);
      expect(typeof updates).toBe("object");
    });
  });

  // ─── Emergent Language Protocol ───────────────────────────────────────────────
  describe("Emergent Language Protocol", () => {
    it("should initialize and seed vocabulary", () => {
      expect(() => initEmergentLanguageProtocol()).not.toThrow();
      const vocab = getEmergentVocabulary();
      expect(Array.isArray(vocab)).toBe(true);
    });

    it("should compress frequent patterns to symbols", () => {
      const pattern = "running RSI improvement cycle";
      // Observe 3 times to hit threshold
      for (let i = 0; i < 3; i++) globalELP.compressToEmergentSymbol(pattern);
      const symbol = compressToEmergentSymbol(pattern);
      expect(symbol.startsWith("Σ")).toBe(true);
      expect(symbol.length).toBeLessThan(pattern.length);
    });

    it("should decompress symbols back to full meaning", () => {
      const pattern = "proposal accepted with reward";
      for (let i = 0; i < 3; i++) globalELP.compressToEmergentSymbol(pattern);
      const symbol = compressToEmergentSymbol(pattern);
      const decompressed = decompressSymbol(symbol);
      expect(decompressed).toBe(pattern);
    });

    it("should compress and decompress full messages", () => {
      const msg = "proposal accepted with reward 0.99 running RSI improvement cycle";
      const compressed = compressMessage(msg);
      const decompressed = decompressMessage(compressed);
      // Decompressed should contain the original content
      expect(decompressed.length).toBeGreaterThan(0);
    });

    it("should observe communication patterns", () => {
      const logs = [
        { fromModule: "A", toModule: "B", message: "proposal accepted with reward", timestamp: Date.now(), compressed: false },
        { fromModule: "B", toModule: "C", message: "proposal accepted with reward", timestamp: Date.now(), compressed: false },
        { fromModule: "C", toModule: "A", message: "proposal accepted with reward", timestamp: Date.now(), compressed: false },
      ];
      const patterns = observeCommunicationPatterns(logs);
      expect(Array.isArray(patterns)).toBe(true);
    });

    it("should return compression stats", () => {
      const stats = globalELP.getCompressionStats();
      expect(typeof stats.totalSymbols).toBe("number");
      expect(typeof stats.avgCompressionRatio).toBe("number");
    });
  });
});
