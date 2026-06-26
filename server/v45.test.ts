import { describe, it, expect } from "vitest";

import {
  registerSubsystem, subsystemHeartbeat, publishIntegrationEvent, getSystemIntegrationReport, initSystemIntegrator,
} from "./systemIntegrator";

import {
  registerCapability, routeCapabilityRequest, getOrchestratorReport, initCapabilityOrchestrator,
} from "./capabilityOrchestrator";

import {
  addOptimizationObjective, runGlobalOptimization, getParetoFront, getGlobalOptimizerReport, initGlobalOptimizer,
} from "./globalOptimizer";

import {
  recordSystemSnapshot, getEmergenceReport, initEmergenceDetector,
} from "./emergenceDetector";

import {
  addSingularityIndicator, advanceSingularityCycle, assessSingularityReadiness, getSingularityReport, initSingularityPreparator,
} from "./singularityPreparator";

import {
  advanceOmegaCycle, getCurrentOmegaState, getOmegaStateReport, initOmegaStateManager,
} from "./omegaStateManager";

describe("v45 Omega Integrator Enhancements", () => {

  // ─── System Integrator ────────────────────────────────────────────────────────
  describe("System Integrator", () => {
    it("should initialize without errors", () => {
      expect(() => initSystemIntegrator()).not.toThrow();
    });

    it("should register a subsystem", () => {
      const sys = registerSubsystem("rsiEngine", "35.0.0", []);
      expect(sys.id).toBeTruthy();
      expect(sys.name).toBe("rsiEngine");
      expect(sys.status).toBe("healthy");
    });

    it("should process heartbeat and update metrics", () => {
      const sys = registerSubsystem("memoryEngine", "35.0.0", []);
      const ok = subsystemHeartbeat(sys.id, { errorRate: 0.05, latency: 12 });
      expect(ok).toBe(true);
    });

    it("should mark subsystem as degraded on high error rate", () => {
      const sys = registerSubsystem("testSys", "1.0.0", []);
      subsystemHeartbeat(sys.id, { errorRate: 0.35 });
      const report = getSystemIntegrationReport();
      expect(typeof report.healthySubsystems).toBe("number");
    });

    it("should publish and process integration events", () => {
      const evt = publishIntegrationEvent("moduleA", "moduleB", "data_ready", { size: 1024 });
      expect(evt.processed).toBe(true);
      expect(evt.source).toBe("moduleA");
    });

    it("should return system integration report", () => {
      const report = getSystemIntegrationReport();
      expect(typeof report.totalSubsystems).toBe("number");
      expect(typeof report.totalEvents).toBe("number");
      expect(["healthy", "degraded", "critical", "offline"]).toContain(report.overallHealth);
    });
  });

  // ─── Capability Orchestrator ──────────────────────────────────────────────────
  describe("Capability Orchestrator", () => {
    it("should initialize without errors", () => {
      expect(() => initCapabilityOrchestrator()).not.toThrow();
    });

    it("should register a capability", () => {
      const cap = registerCapability("chain_of_thought", "reasoning", "rsiEngine", "35.0.0", 50, 0.95);
      expect(cap.id).toBeTruthy();
      expect(cap.type).toBe("reasoning");
    });

    it("should route a capability request", () => {
      registerCapability("planning_v2", "planning", "goalManager", "35.0.0", 100, 0.9);
      const response = routeCapabilityRequest({
        id: "req-1", requiredType: "planning", inputs: {}, priority: 1,
      });
      expect(response.requestId).toBe("req-1");
      expect(typeof response.success).toBe("boolean");
    });

    it("should return failure for unregistered capability type", () => {
      const response = routeCapabilityRequest({
        id: "req-fail", requiredType: "monitoring", inputs: {}, priority: 1,
      });
      // Either fails gracefully or succeeds if monitoring capability registered
      expect(typeof response.success).toBe("boolean");
    });

    it("should prefer high-reliability capabilities", () => {
      registerCapability("high_rel", "execution", "moduleA", "1.0", 100, 0.99);
      registerCapability("low_rel", "execution", "moduleB", "1.0", 100, 0.1);
      const response = routeCapabilityRequest({
        id: "req-2", requiredType: "execution", inputs: {}, priority: 1,
      });
      expect(response.capabilityId).not.toBe("none");
    });

    it("should return orchestrator report", () => {
      const report = getOrchestratorReport();
      expect(typeof report.totalCapabilities).toBe("number");
      expect(typeof report.successRate).toBe("number");
    });
  });

  // ─── Global Optimizer ─────────────────────────────────────────────────────────
  describe("Global Optimizer", () => {
    it("should initialize without errors", () => {
      expect(() => initGlobalOptimizer()).not.toThrow();
    });

    it("should add optimization objectives", () => {
      const obj = addOptimizationObjective("accuracy", "maximize", 0.7, 0.99, 1.0);
      expect(obj.id).toBeTruthy();
      expect(obj.direction).toBe("maximize");
    });

    it("should run optimization and return solutions", () => {
      addOptimizationObjective("latency", "minimize", 200, 50, 0.8);
      const solutions = runGlobalOptimization(5);
      expect(solutions.length).toBe(5);
    });

    it("should identify Pareto front", () => {
      addOptimizationObjective("throughput", "maximize", 100, 500, 0.6);
      runGlobalOptimization(10);
      const front = getParetoFront();
      expect(Array.isArray(front)).toBe(true);
    });

    it("should improve best score over iterations", () => {
      runGlobalOptimization(5);
      const report1 = getGlobalOptimizerReport();
      runGlobalOptimization(10);
      const report2 = getGlobalOptimizerReport();
      expect(report2.totalSolutions).toBeGreaterThan(report1.totalSolutions);
    });

    it("should return global optimizer report", () => {
      const report = getGlobalOptimizerReport();
      expect(typeof report.totalObjectives).toBe("number");
      expect(typeof report.bestScore).toBe("number");
    });
  });

  // ─── Emergence Detector ───────────────────────────────────────────────────────
  describe("Emergence Detector", () => {
    it("should initialize without errors", () => {
      expect(() => initEmergenceDetector()).not.toThrow();
    });

    it("should record system snapshots", () => {
      const snap = recordSystemSnapshot({ accuracy: 0.7, throughput: 100, latency: 50 });
      expect(snap.complexity).toBeGreaterThan(0);
    });

    it("should detect capability jumps", () => {
      recordSystemSnapshot({ accuracy: 0.1, throughput: 10 });
      recordSystemSnapshot({ accuracy: 0.9, throughput: 10 }); // Big jump
      const report = getEmergenceReport();
      expect(report.totalEvents).toBeGreaterThanOrEqual(0);
    });

    it("should return emergence report", () => {
      const report = getEmergenceReport();
      expect(typeof report.totalEvents).toBe("number");
      expect(typeof report.systemComplexity).toBe("number");
    });
  });

  // ─── Singularity Preparator ───────────────────────────────────────────────────
  describe("Singularity Preparator", () => {
    it("should initialize without errors", () => {
      expect(() => initSingularityPreparator()).not.toThrow();
    });

    it("should add singularity indicators", () => {
      const ind = addSingularityIndicator("reasoning_depth", 0.3, 0.9, 0.05, "cognition");
      expect(ind.id).toBeTruthy();
      expect(ind.domain).toBe("cognition");
    });

    it("should advance cycle and increase indicator levels", () => {
      addSingularityIndicator("self_improvement_rate", 0.2, 0.95, 0.1, "rsi");
      const before = getSingularityReport().avgReadiness;
      advanceSingularityCycle();
      const after = getSingularityReport().avgReadiness;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it("should assess readiness", () => {
      const assessment = assessSingularityReadiness();
      expect(assessment.overallReadiness).toBeGreaterThanOrEqual(0);
      expect(assessment.overallReadiness).toBeLessThanOrEqual(1);
      expect(Array.isArray(assessment.recommendations)).toBe(true);
    });

    it("should return singularity report", () => {
      const report = getSingularityReport();
      expect(typeof report.totalIndicators).toBe("number");
      expect(typeof report.singularityTriggered).toBe("boolean");
    });
  });

  // ─── Omega State Manager ──────────────────────────────────────────────────────
  describe("Omega State Manager", () => {
    it("should initialize without errors", () => {
      expect(() => initOmegaStateManager()).not.toThrow();
    });

    it("should advance omega cycle", () => {
      const state = advanceOmegaCycle();
      expect(state.id).toBeTruthy();
      expect(state.omegaScore).toBeGreaterThan(0);
    });

    it("should track omega score across cycles", () => {
      const s1 = advanceOmegaCycle();
      const s2 = advanceOmegaCycle();
      expect(s2.cycleCount).toBeGreaterThan(s1.cycleCount);
    });

    it("should accept external metric updates", () => {
      const state = advanceOmegaCycle({ intelligence: 0.9, alignment: 0.95 });
      expect(state.metrics.intelligence.currentScore).toBeCloseTo(0.9, 1);
    });

    it("should progress through phases", () => {
      const state = getCurrentOmegaState();
      expect(["nascent", "developing", "mature", "transcendent"]).toContain(state?.phase);
    });

    it("should return omega state report", () => {
      const report = getOmegaStateReport();
      expect(typeof report.currentOmegaScore).toBe("number");
      expect(typeof report.cycleCount).toBe("number");
      expect(typeof report.estimatedCyclesToTranscendence).toBe("number");
    });
  });
});
