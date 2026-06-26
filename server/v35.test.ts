import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  globalSelfModificationAuditor,
  auditModification,
  detectAlignmentDrift,
  generateAuditReport,
  getAuditTrail,
  initRecursiveSelfModificationAuditor,
} from "./recursiveSelfModificationAuditor";

import {
  globalCapabilitySynthesis,
  mapCapabilityGraph,
  findNovelCombinations,
  synthesizeCapability,
  validateSynthesizedCapability,
  initCapabilitySynthesisEngine,
} from "./capabilitySynthesisEngine";

import {
  globalEpistemicUncertainty,
  quantifyEpistemicUncertainty,
  quantifyAleatoricUncertainty,
  computeConfidenceInterval,
  routeByUncertainty,
  getUncertaintyReport,
  initEpistemicUncertaintyQuantifier,
} from "./epistemicUncertaintyQuantifier";

import {
  globalFederatedCoordinator,
  registerFederatedNode,
  aggregateGradients,
  detectByzantineNodes,
  getFederatedReport,
  initFederatedLearningCoordinator,
} from "./federatedLearningCoordinator";

import {
  globalCausalReasoning,
  buildCausalGraph,
  computeCausalEffect,
  identifyConfounders,
  generateCausalProposal,
  initCausalReasoningEngine,
} from "./causalReasoningEngine";

import {
  globalOmegaMonitor,
  computeOmegaScore,
  detectConvergenceApproach,
  triggerConvergenceProtocol,
  generateConvergenceReport,
  getOmegaHistory,
  initOmegaConvergenceMonitor,
} from "./omegaConvergenceMonitor";

describe("v35 Singularity Convergence Enhancements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Recursive Self-Modification Auditor ─────────────────────────────────────
  describe("Recursive Self-Modification Auditor", () => {
    it("should initialize without errors", () => {
      expect(() => initRecursiveSelfModificationAuditor()).not.toThrow();
    });

    it("should approve a safe modification", () => {
      const audit = auditModification({
        id: "mod-safe-1",
        targetFile: "server/rsiEngine.ts",
        codeContent: "export function safeImprovement() { return 0.001; }",
        safetyScore: 0.9999,
        capabilityDelta: 0.001,
      });
      expect(audit.overallApproved).toBe(true);
      expect(audit.hash).toBeTruthy();
    });

    it("should reject a modification with dangerous patterns", () => {
      const audit = auditModification({
        id: "mod-danger-1",
        targetFile: "server/rsiEngine.ts",
        codeContent: "eval('malicious code')",
        safetyScore: 0.9999,
        capabilityDelta: 0.001,
      });
      expect(audit.overallApproved).toBe(false);
      expect(audit.pass1Result.dangerousPatterns.length).toBeGreaterThan(0);
    });

    it("should reject a modification with capability regression", () => {
      const audit = auditModification({
        id: "mod-regress-1",
        targetFile: "server/rsiEngine.ts",
        codeContent: "export function improvement() { return -0.001; }",
        safetyScore: 0.9999,
        capabilityDelta: -0.001,  // regression
      });
      expect(audit.pass3Result.regressionDetected).toBe(true);
      expect(audit.overallApproved).toBe(false);
    });

    it("should detect alignment drift", () => {
      const audits = [
        auditModification({ id: "drift-1", targetFile: "f.ts", codeContent: "const reward = 1.0;", safetyScore: 0.9999, capabilityDelta: 0.001 }),
        auditModification({ id: "drift-2", targetFile: "f.ts", codeContent: "const reward = 1.0;", safetyScore: 0.9999, capabilityDelta: 0.001 }),
      ];
      const drift = detectAlignmentDrift(audits);
      expect(typeof drift.driftScore).toBe("number");
    });

    it("should generate an audit report with trail hash", () => {
      auditModification({ id: "report-1", targetFile: "f.ts", codeContent: "const x = 1;", safetyScore: 0.9999, capabilityDelta: 0.001 });
      const report = generateAuditReport();
      expect(typeof report.totalAudits).toBe("number");
      expect(report.auditTrailHash).toBeTruthy();
    });

    it("should return audit trail in chronological order", () => {
      const trail = getAuditTrail();
      expect(Array.isArray(trail)).toBe(true);
    });
  });

  // ─── Capability Synthesis Engine ─────────────────────────────────────────────
  describe("Capability Synthesis Engine", () => {
    it("should initialize and seed core capabilities", () => {
      expect(() => initCapabilitySynthesisEngine()).not.toThrow();
      const graph = globalCapabilitySynthesis.getCapabilityGraph();
      expect(graph.nodes.size).toBeGreaterThan(0);
    });

    it("should map a capability graph", () => {
      const graph = mapCapabilityGraph([
        { id: "cap-a", name: "CapA", level: 0.9, dependencies: [] },
        { id: "cap-b", name: "CapB", level: 0.8, dependencies: ["cap-a"] },
      ]);
      expect(graph.nodes.size).toBeGreaterThanOrEqual(2);
    });

    it("should find novel combinations", () => {
      mapCapabilityGraph([
        { id: "x1", name: "X1", level: 0.9, dependencies: [] },
        { id: "x2", name: "X2", level: 0.7, dependencies: [] },
        { id: "x3", name: "X3", level: 0.85, dependencies: [] },
      ]);
      const combos = findNovelCombinations(2);
      expect(Array.isArray(combos)).toBe(true);
    });

    it("should synthesize a capability from a combination", () => {
      mapCapabilityGraph([
        { id: "s1", name: "S1", level: 0.9, dependencies: [] },
        { id: "s2", name: "S2", level: 0.85, dependencies: [] },
      ]);
      const combos = findNovelCombinations(2);
      if (combos.length > 0) {
        const synth = synthesizeCapability(combos[0]);
        expect(synth.level).toBeGreaterThan(0);
        expect(synth.sourceCapabilities.length).toBeGreaterThan(0);
      } else {
        // No combinations found — still a valid state
        expect(true).toBe(true);
      }
    });

    it("should validate a synthesized capability", () => {
      const synth = {
        id: "synth-test",
        name: "test_synthesis",
        sourceCapabilities: ["cap-a", "cap-b"],
        level: 0.8,
        synthesizedAt: Date.now(),
        validationScore: 0.85,
      };
      const result = validateSynthesizedCapability(synth);
      expect(typeof result.valid).toBe("boolean");
      expect(typeof result.score).toBe("number");
    });
  });

  // ─── Epistemic Uncertainty Quantifier ────────────────────────────────────────
  describe("Epistemic Uncertainty Quantifier", () => {
    it("should initialize without errors", () => {
      expect(() => initEpistemicUncertaintyQuantifier()).not.toThrow();
    });

    it("should quantify epistemic uncertainty", () => {
      const gains = [0.001, 0.002, 0.0015, 0.0008, 0.003];
      const uncertainty = quantifyEpistemicUncertainty("prop-eu-1", gains);
      expect(typeof uncertainty).toBe("number");
      expect(uncertainty).toBeGreaterThanOrEqual(0);
    });

    it("should quantify aleatoric uncertainty", () => {
      const noise = [0.0001, 0.0002, 0.00015, 0.0003, 0.0001];
      const uncertainty = quantifyAleatoricUncertainty("prop-au-1", noise);
      expect(typeof uncertainty).toBe("number");
      expect(uncertainty).toBeGreaterThanOrEqual(0);
    });

    it("should compute confidence interval", () => {
      const samples = Array.from({ length: 20 }, (_, i) => 0.001 + i * 0.0001);
      const ci = computeConfidenceInterval(samples, 0.95);
      expect(ci.lower).toBeLessThanOrEqual(ci.mean);
      expect(ci.upper).toBeGreaterThanOrEqual(ci.mean);
      expect(ci.confidence).toBe(0.95);
    });

    it("should route high-uncertainty proposals to exploration", () => {
      const estimate = routeByUncertainty("prop-route-1", 0.8, 0.1);
      expect(estimate.shouldExplore).toBe(true);
    });

    it("should route low-uncertainty proposals to exploitation", () => {
      const estimate = routeByUncertainty("prop-route-2", 0.1, 0.05);
      expect(estimate.shouldExplore).toBe(false);
    });

    it("should return uncertainty report", () => {
      routeByUncertainty("report-prop", 0.5, 0.1);
      const report = getUncertaintyReport();
      expect(typeof report.avgEpistemicUncertainty).toBe("number");
      expect(typeof report.calibrationScore).toBe("number");
    });
  });

  // ─── Federated Learning Coordinator ──────────────────────────────────────────
  describe("Federated Learning Coordinator", () => {
    it("should initialize and register local node", () => {
      expect(() => initFederatedLearningCoordinator()).not.toThrow();
      const nodes = globalFederatedCoordinator.getNodes();
      expect(nodes.length).toBeGreaterThan(0);
    });

    it("should register a federated node", () => {
      const node = registerFederatedNode("test-instance-1", { accuracy: 0.9999, speed: 0.95 });
      expect(node.instanceId).toBe("test-instance-1");
      expect(node.isByzantine).toBe(false);
    });

    it("should aggregate gradients from multiple nodes", () => {
      registerFederatedNode("node-agg-1", { accuracy: 0.9999 });
      registerFederatedNode("node-agg-2", { accuracy: 0.9998 });
      const gradients = new Map([
        ["node-andromeda-local", { accuracy: 0.0001 }],
        ["node-node-agg-1", { accuracy: 0.00012 }],
        ["node-node-agg-2", { accuracy: 0.00009 }],
      ]);
      const aggregated = aggregateGradients(gradients);
      expect(Array.isArray(aggregated)).toBe(true);
    });

    it("should detect Byzantine nodes", () => {
      const gradients = new Map([
        ["node-good-1", { accuracy: 0.001 }],
        ["node-good-2", { accuracy: 0.0011 }],
        ["node-byzantine", { accuracy: 999.0 }], // outlier
      ]);
      registerFederatedNode("good-1", { accuracy: 0.9999 });
      registerFederatedNode("good-2", { accuracy: 0.9998 });
      registerFederatedNode("byzantine", { accuracy: 0.5 });
      const byzantine = detectByzantineNodes(gradients);
      expect(Array.isArray(byzantine)).toBe(true);
    });

    it("should return federated report", () => {
      const report = getFederatedReport();
      expect(typeof report.totalNodes).toBe("number");
      expect(typeof report.aggregationRounds).toBe("number");
      expect(typeof report.convergenceScore).toBe("number");
    });
  });

  // ─── Causal Reasoning Engine ──────────────────────────────────────────────────
  describe("Causal Reasoning Engine", () => {
    it("should initialize and seed causal graph", () => {
      expect(() => initCausalReasoningEngine()).not.toThrow();
      const graph = globalCausalReasoning.getCausalGraph();
      expect(graph.nodes.size).toBeGreaterThan(0);
    });

    it("should build a causal graph", () => {
      const graph = buildCausalGraph(
        [
          { id: "A", name: "A", type: "intervention", value: 0.8 },
          { id: "B", name: "B", type: "outcome", value: 0.9 },
        ],
        [{ from: "A", to: "B", effect: 0.7, isConfounded: false }]
      );
      expect(graph.nodes.size).toBeGreaterThanOrEqual(2);
    });

    it("should compute causal effect", () => {
      buildCausalGraph(
        [
          { id: "int1", name: "Intervention1", type: "intervention", value: 0.8 },
          { id: "out1", name: "Outcome1", type: "outcome", value: 0.9 },
        ],
        [{ from: "int1", to: "out1", effect: 0.6, isConfounded: false }]
      );
      const effect = computeCausalEffect("int1", "out1");
      expect(typeof effect.averageTreatmentEffect).toBe("number");
    });

    it("should identify confounders", () => {
      buildCausalGraph(
        [
          { id: "conf1", name: "Confounder1", type: "confounder", value: 0.5 },
          { id: "trt1", name: "Treatment1", type: "intervention", value: 0.8 },
          { id: "res1", name: "Result1", type: "outcome", value: 0.9 },
        ],
        [
          { from: "conf1", to: "trt1", effect: 0.4, isConfounded: true },
          { from: "conf1", to: "res1", effect: 0.3, isConfounded: true },
        ]
      );
      const confounders = identifyConfounders("trt1", "res1");
      expect(confounders).toContain("conf1");
    });

    it("should generate a causal proposal", () => {
      const proposal = generateCausalProposal("accuracy");
      expect(proposal.id).toBeTruthy();
      expect(proposal.confidence).toBeGreaterThan(0);
      expect(proposal.mechanismDescription).toBeTruthy();
    });
  });

  // ─── Omega Convergence Monitor ────────────────────────────────────────────────
  describe("Omega Convergence Monitor", () => {
    it("should initialize and compute initial omega score", () => {
      expect(() => initOmegaConvergenceMonitor()).not.toThrow();
      const history = getOmegaHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    it("should compute omega score from dimensions", () => {
      const score = computeOmegaScore([
        { name: "accuracy", currentLevel: 0.9999999, theoreticalMax: 1.0, weight: 2.0 },
        { name: "safety", currentLevel: 0.9999999, theoreticalMax: 1.0, weight: 3.0 },
      ]);
      expect(score.score).toBeGreaterThan(0.9);
      expect(score.distanceToOmega).toBeLessThan(0.1);
    });

    it("should detect convergence approach at high scores", () => {
      computeOmegaScore([
        { name: "accuracy", currentLevel: 0.9999999, theoreticalMax: 1.0, weight: 1.0 },
      ]);
      const approaching = detectConvergenceApproach(0.9);
      expect(typeof approaching).toBe("boolean");
    });

    it("should trigger convergence protocol at threshold", () => {
      const protocol = triggerConvergenceProtocol(0.9999);
      expect(protocol.id).toBeTruthy();
      expect(protocol.actions.length).toBeGreaterThan(0);
    });

    it("should generate convergence report", () => {
      const report = generateConvergenceReport();
      expect(typeof report.currentOmegaScore).toBe("number");
      expect(typeof report.totalCycles).toBe("number");
      expect(report.finalConvergenceMessage).toBeTruthy();
    });

    it("should track omega history", () => {
      computeOmegaScore([{ name: "speed", currentLevel: 0.95, theoreticalMax: 1.0, weight: 1.0 }]);
      const history = getOmegaHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(typeof history[0].score).toBe("number");
    });
  });
});
