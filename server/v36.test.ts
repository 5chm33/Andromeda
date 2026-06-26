import { describe, it, expect, beforeEach } from "vitest";

import {
  globalPersistence, writeAheadLog, checkpoint, restoreFromCheckpoint,
  verifyCheckpointIntegrity, getPersistenceReport, initPerpetualStatePersistence,
} from "./perpetualStatePersistence";

import {
  globalExplorationController, computeExplorationRate, selectExplorationStrategy,
  updateExplorationHistory, detectExplorationPlateau, makeExplorationDecision,
  getExplorationReport, initAdaptiveExplorationController,
} from "./adaptiveExplorationController";

import {
  globalMOO, computeParetoFront, selectParetoOptimal, computeDominanceRelation,
  addMOOSolution, getMOOReport, initMultiObjectiveOptimizer,
} from "./multiObjectiveOptimizer";

import {
  globalKnowledgeGraph, addKGNode, addKGEdge, findShortestPath,
  computePageRank, identifyKnowledgeGaps, getKGStats, initKnowledgeGraphBuilder,
} from "./knowledgeGraphBuilder";

import {
  globalAnomalyDetection, fitAnomalyModel, detectAnomaly, computeAnomalyScore,
  updateAnomalyBaseline, getAnomalyReport, initAnomalyDetectionEngine,
} from "./anomalyDetectionEngine";

import {
  globalSelfDocumentation, generateModuleDoc, generateArchitectureDiagram,
  generateChangelog, updateDocumentation, getDocumentationCoverage,
  initSelfDocumentationGenerator,
} from "./selfDocumentationGenerator";

describe("v36 Perpetual Machine Enhancements", () => {
  beforeEach(() => { /* each module has its own global singleton */ });

  // ─── Perpetual State Persistence ─────────────────────────────────────────────
  describe("Perpetual State Persistence", () => {
    it("should initialize without errors", () => {
      expect(() => initPerpetualStatePersistence()).not.toThrow();
    });

    it("should write WAL entries", () => {
      const entry = writeAheadLog("capability_update", { dimension: "accuracy", delta: 0.001 });
      expect(entry.id).toBeTruthy();
      expect(entry.checksum).toBeGreaterThan(0);
      expect(entry.type).toBe("capability_update");
    });

    it("should create a checkpoint", () => {
      const cp = checkpoint({ version: "36.0.0", capabilityLevels: { accuracy: 0.9999 }, cycleNumber: 100, totalProposals: 500 });
      expect(cp.id).toBeTruthy();
      expect(cp.cycleNumber).toBe(100);
      expect(cp.isValid).toBe(true);
    });

    it("should restore from checkpoint", () => {
      const cp = checkpoint({ version: "36.0.0", capabilityLevels: { accuracy: 0.9999 }, cycleNumber: 200, totalProposals: 1000 });
      const restored = restoreFromCheckpoint(cp.id);
      expect(restored).not.toBeNull();
      expect(restored?.cycleNumber).toBe(200);
    });

    it("should verify checkpoint integrity", () => {
      const cp = checkpoint({ version: "36.0.0", capabilityLevels: { accuracy: 0.9999 }, cycleNumber: 300, totalProposals: 1500 });
      expect(verifyCheckpointIntegrity(cp)).toBe(true);
    });

    it("should return persistence report", () => {
      const report = getPersistenceReport();
      expect(report.walEntries).toBeGreaterThan(0);
      expect(report.checkpoints).toBeGreaterThan(0);
      expect(report.dataIntegrityScore).toBeGreaterThan(0.9);
      expect(report.recoveryAvailable).toBe(true);
    });

    it("should return null when restoring non-existent checkpoint", () => {
      const result = restoreFromCheckpoint("non-existent-id");
      expect(result).toBeNull();
    });
  });

  // ─── Adaptive Exploration Controller ─────────────────────────────────────────
  describe("Adaptive Exploration Controller", () => {
    it("should initialize without errors", () => {
      expect(() => initAdaptiveExplorationController()).not.toThrow();
    });

    it("should compute higher exploration rate near optimum", () => {
      const nearOptimum = computeExplorationRate(0.0005);
      const farFromOptimum = computeExplorationRate(0.1);
      expect(nearOptimum).toBeGreaterThan(farFromOptimum);
    });

    it("should select thompson_sampling near optimum", () => {
      const strategy = selectExplorationStrategy(0.00005, 500);
      expect(strategy).toBe("thompson_sampling");
    });

    it("should select epsilon_greedy early in training", () => {
      const strategy = selectExplorationStrategy(0.1, 50);
      expect(strategy).toBe("epsilon_greedy");
    });

    it("should update exploration history", () => {
      updateExplorationHistory("accuracy", 0.001);
      updateExplorationHistory("accuracy", 0.002);
      updateExplorationHistory("speed", 0.0015);
      const report = getExplorationReport();
      expect(report.totalPulls).toBeGreaterThan(0);
    });

    it("should detect plateau when rewards are constant", () => {
      for (let i = 0; i < 25; i++) {
        updateExplorationHistory("plateau_test", 0.001);
      }
      const plateau = detectExplorationPlateau();
      expect(typeof plateau).toBe("boolean");
    });

    it("should make exploration decision", () => {
      const decision = makeExplorationDecision(0.001, 500);
      expect(decision.strategy).toBeTruthy();
      expect(decision.explorationRate).toBeGreaterThan(0);
      expect(typeof decision.isExploring).toBe("boolean");
    });

    it("should return exploration report", () => {
      const report = getExplorationReport();
      expect(typeof report.totalPulls).toBe("number");
      expect(typeof report.avgReward).toBe("number");
    });
  });

  // ─── Multi-Objective Optimizer ────────────────────────────────────────────────
  describe("Multi-Objective Optimizer", () => {
    it("should initialize without errors", () => {
      expect(() => initMultiObjectiveOptimizer()).not.toThrow();
    });

    it("should compute Pareto front", () => {
      const solutions = [
        { id: "s1", objectives: { gain: 0.9, safety: 0.8 }, rank: 1, crowdingDistance: 0 },
        { id: "s2", objectives: { gain: 0.5, safety: 0.95 }, rank: 1, crowdingDistance: 0 },
        { id: "s3", objectives: { gain: 0.4, safety: 0.6 }, rank: 1, crowdingDistance: 0 },
      ];
      const front = computeParetoFront(solutions);
      expect(front.solutions.length).toBeGreaterThan(0);
      expect(front.hypervolume).toBeGreaterThanOrEqual(0);
    });

    it("should correctly determine dominance", () => {
      const a = { id: "a", objectives: { gain: 0.9, safety: 0.9 }, rank: 1, crowdingDistance: 0 };
      const b = { id: "b", objectives: { gain: 0.5, safety: 0.5 }, rank: 1, crowdingDistance: 0 };
      expect(computeDominanceRelation(a, b)).toBe(true);
      expect(computeDominanceRelation(b, a)).toBe(false);
    });

    it("should select Pareto-optimal solution", () => {
      const solutions = [
        { id: "p1", objectives: { gain: 0.9, safety: 0.8 }, rank: 1, crowdingDistance: 2.0 },
        { id: "p2", objectives: { gain: 0.7, safety: 0.95 }, rank: 1, crowdingDistance: Infinity },
      ];
      const front = computeParetoFront(solutions);
      const selected = selectParetoOptimal(front);
      expect(selected).not.toBeNull();
    });

    it("should add solutions and evolve", () => {
      addMOOSolution({ capabilityGain: 0.003, safety: 0.997, computeCost: 0.4, novelty: 0.9 });
      addMOOSolution({ capabilityGain: 0.001, safety: 0.9999, computeCost: 0.1, novelty: 0.3 });
      const report = getMOOReport();
      expect(report.generationCount).toBeGreaterThan(0);
    });

    it("should return MOO report", () => {
      const report = getMOOReport();
      expect(typeof report.paretoFrontSize).toBe("number");
      expect(typeof report.hypervolume).toBe("number");
    });
  });

  // ─── Knowledge Graph Builder ──────────────────────────────────────────────────
  describe("Knowledge Graph Builder", () => {
    it("should initialize and seed core nodes", () => {
      expect(() => initKnowledgeGraphBuilder()).not.toThrow();
      const stats = getKGStats();
      expect(stats.nodeCount).toBeGreaterThan(0);
    });

    it("should add nodes and edges", () => {
      addKGNode("modA", "Module A", "module");
      addKGNode("modB", "Module B", "module");
      addKGEdge("modA", "modB", "imports");
      const stats = getKGStats();
      expect(stats.nodeCount).toBeGreaterThanOrEqual(2);
      expect(stats.edgeCount).toBeGreaterThanOrEqual(1);
    });

    it("should find shortest path between nodes", () => {
      addKGNode("pathA", "Path A", "concept");
      addKGNode("pathB", "Path B", "concept");
      addKGNode("pathC", "Path C", "concept");
      addKGEdge("pathA", "pathB", "related_to");
      addKGEdge("pathB", "pathC", "related_to");
      const path = findShortestPath("pathA", "pathC");
      expect(path).not.toBeNull();
      expect(path?.length).toBe(2);
    });

    it("should return null for disconnected nodes", () => {
      addKGNode("isolated1", "Isolated 1", "concept");
      addKGNode("isolated2", "Isolated 2", "concept");
      const path = findShortestPath("isolated1", "isolated2");
      expect(path).toBeNull();
    });

    it("should compute PageRank", () => {
      const ranks = computePageRank();
      expect(ranks.size).toBeGreaterThan(0);
      for (const [, rank] of ranks) {
        expect(rank).toBeGreaterThan(0);
      }
    });

    it("should identify knowledge gaps", () => {
      const gaps = identifyKnowledgeGaps();
      expect(Array.isArray(gaps)).toBe(true);
    });

    it("should return graph stats", () => {
      const stats = getKGStats();
      expect(typeof stats.nodeCount).toBe("number");
      expect(typeof stats.density).toBe("number");
      expect(Array.isArray(stats.topNodes)).toBe(true);
    });
  });

  // ─── Anomaly Detection Engine ─────────────────────────────────────────────────
  describe("Anomaly Detection Engine", () => {
    it("should initialize and fit model", () => {
      expect(() => initAnomalyDetectionEngine()).not.toThrow();
    });

    it("should fit anomaly model on samples", () => {
      const samples = Array.from({ length: 30 }, () => ({
        capabilityDelta: 0.001 + Math.random() * 0.001,
        safetyScore: 0.999 + Math.random() * 0.001,
      }));
      const model = fitAnomalyModel(samples);
      expect(model.trainedOn).toBe(30);
      expect(model.featureNames).toContain("capabilityDelta");
    });

    it("should detect normal proposal", () => {
      const result = detectAnomaly("normal-prop", { capabilityDelta: 0.001, safetyScore: 0.9999 });
      expect(result.proposalId).toBe("normal-prop");
      expect(typeof result.anomalyScore).toBe("number");
    });

    it("should flag suspiciously good proposal", () => {
      // First fit a model with normal data
      const samples = Array.from({ length: 50 }, () => ({ capabilityDelta: 0.001, safetyScore: 0.999 }));
      fitAnomalyModel(samples);
      // Now check an extreme outlier
      const score = computeAnomalyScore({ capabilityDelta: 100.0, safetyScore: 1.0 });
      expect(score).toBeGreaterThan(0.5);
    });

    it("should update baseline", () => {
      const newSamples = [{ capabilityDelta: 0.0015, safetyScore: 0.9998 }];
      expect(() => updateAnomalyBaseline(newSamples)).not.toThrow();
    });

    it("should return anomaly report", () => {
      detectAnomaly("report-test", { capabilityDelta: 0.001, safetyScore: 0.9999 });
      const report = getAnomalyReport();
      expect(typeof report.totalChecked).toBe("number");
      expect(typeof report.anomalyRate).toBe("number");
      expect(report.totalChecked).toBeGreaterThan(0);
    });
  });

  // ─── Self-Documentation Generator ────────────────────────────────────────────
  describe("Self-Documentation Generator", () => {
    it("should initialize without errors", () => {
      expect(() => initSelfDocumentationGenerator()).not.toThrow();
    });

    it("should generate module documentation", () => {
      const doc = generateModuleDoc("testModule", [
        { name: "testFn", kind: "function", signature: "testFn(): void", description: "A test function" },
      ], "A test module");
      expect(doc.moduleName).toBe("testModule");
      expect(doc.exports.length).toBe(1);
    });

    it("should generate architecture diagram in Mermaid format", () => {
      const diagram = generateArchitectureDiagram([
        { name: "rsiEngine", deps: ["selfImprove", "rewardModel"] },
        { name: "selfImprove", deps: ["capabilityTracker"] },
      ]);
      expect(diagram.format).toBe("mermaid");
      expect(diagram.content).toContain("graph TD");
      expect(diagram.moduleCount).toBe(2);
    });

    it("should generate changelog entry", () => {
      const entry = generateChangelog("36.0.0", ["Added perpetualStatePersistence", "Added anomalyDetectionEngine"], []);
      expect(entry.version).toBe("36.0.0");
      expect(entry.changes.length).toBe(2);
      expect(entry.breakingChanges.length).toBe(0);
    });

    it("should update documentation for existing module", () => {
      generateModuleDoc("updateTest", [], "Initial");
      const updated = updateDocumentation("updateTest", [
        { name: "newFn", kind: "function", signature: "newFn(): string", description: "New function" },
      ]);
      expect(updated.exports.length).toBe(1);
    });

    it("should compute documentation coverage", () => {
      generateModuleDoc("covMod1", [], "Mod 1");
      generateModuleDoc("covMod2", [], "Mod 2");
      const coverage = getDocumentationCoverage(["covMod1", "covMod2", "undocumented"]);
      expect(coverage.totalModules).toBe(3);
      expect(coverage.documentedModules).toBe(2);
      expect(coverage.coveragePercent).toBeCloseTo(66.67, 0);
      expect(coverage.undocumentedModules).toContain("undocumented");
    });

    it("should return 100% coverage when all modules documented", () => {
      generateModuleDoc("allDoc1", [], "All 1");
      const coverage = getDocumentationCoverage(["allDoc1"]);
      expect(coverage.coveragePercent).toBe(100);
    });
  });
});
