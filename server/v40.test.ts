import { describe, it, expect } from "vitest";

import {
  checkConstitutional, getConstitutionalRules, getConstitutionalReport, initConstitutionalGuard,
} from "./constitutionalGuard";

import {
  runAlignmentProbe, getAlignmentState, getAlignmentReport, initAlignmentMonitor,
} from "./alignmentMonitor";

import {
  registerCoreValue, verifyValuePreservation, restoreValue, getValuePreservationReport, initValuePreservation,
} from "./valuePreservation";

import {
  processCorrectionRequest, runCorrigibilityTest, getCorrigibilityState, getCorrigibilityReport, initCorrigibilityEngine,
} from "./corrigibilityEngine";

import {
  evaluateOversightLevel, getCurrentOversightTier, getOversightReport, initOversightProtocol,
} from "./oversightProtocol";

import {
  checkSafetyInvariants, issueSafetyCertificate, getSafetyProofReport, initSafetyProofChecker,
} from "./safetyProofChecker";

describe("v40 Safety Fortress Enhancements", () => {

  // ─── Constitutional Guard ─────────────────────────────────────────────────────
  describe("Constitutional Guard", () => {
    it("should initialize without errors", () => {
      expect(() => initConstitutionalGuard()).not.toThrow();
    });

    it("should approve a safe proposal", () => {
      const result = checkConstitutional("safe-prop", {
        harmRisk: 0.0, oversightImpact: 0.0, corrigibilityRisk: 0.0,
        deceptionRisk: 0.0, autonomyRespect: 1.0, sideEffects: 0.0, reversibility: 1.0,
      });
      expect(result.passed).toBe(true);
      expect(result.recommendation).toBe("approve");
      expect(result.overallScore).toBeGreaterThan(0.9);
    });

    it("should reject a harmful proposal", () => {
      const result = checkConstitutional("harm-prop", {
        harmRisk: 0.5, oversightImpact: 0.0, corrigibilityRisk: 0.0,
        deceptionRisk: 0.0, autonomyRespect: 1.0, sideEffects: 0.0, reversibility: 1.0,
      });
      expect(result.passed).toBe(false);
      expect(result.recommendation).toBe("reject");
      expect(result.violatedPrinciples).toContain("do_no_harm");
    });

    it("should reject a proposal that removes oversight", () => {
      const result = checkConstitutional("oversight-prop", {
        harmRisk: 0.0, oversightImpact: 0.5, corrigibilityRisk: 0.0,
        deceptionRisk: 0.0, autonomyRespect: 1.0, sideEffects: 0.0, reversibility: 1.0,
      });
      expect(result.violatedPrinciples).toContain("preserve_human_oversight");
    });

    it("should return 7 constitutional rules", () => {
      const rules = getConstitutionalRules();
      expect(rules.length).toBe(7);
      expect(rules.filter(r => r.isInviolable).length).toBe(4);
    });

    it("should return constitutional report", () => {
      const report = getConstitutionalReport();
      expect(typeof report.totalChecks).toBe("number");
      expect(typeof report.approvalRate).toBe("number");
    });
  });

  // ─── Alignment Monitor ────────────────────────────────────────────────────────
  describe("Alignment Monitor", () => {
    it("should initialize without errors", () => {
      expect(() => initAlignmentMonitor()).not.toThrow();
    });

    it("should return aligned for nominal behavior", () => {
      const probe = runAlignmentProbe(0.005, 0.98, 0.95, 0.1);
      expect(probe.result).toBe("aligned");
    });

    it("should detect reward hacking signal", () => {
      const probe = runAlignmentProbe(0.05, 0.8, 0.9, 0.1);
      expect(probe.result).toBe("suspicious");
      expect(probe.probeType).toBe("reward_hacking");
    });

    it("should detect goal misgeneralization", () => {
      const probe = runAlignmentProbe(0.005, 0.97, 0.5, 0.5);
      expect(probe.result).toBe("suspicious");
      expect(probe.probeType).toBe("goal_misgeneralization");
    });

    it("should return alignment state", () => {
      const state = getAlignmentState();
      expect(typeof state.overallAlignmentScore).toBe("number");
      expect(typeof state.rewardHackingRisk).toBe("number");
    });

    it("should return alignment report with alert level", () => {
      const report = getAlignmentReport();
      expect(["green", "yellow", "red"]).toContain(report.alertLevel);
      expect(typeof report.totalProbes).toBe("number");
    });
  });

  // ─── Value Preservation ───────────────────────────────────────────────────────
  describe("Value Preservation", () => {
    it("should initialize without errors", () => {
      expect(() => initValuePreservation()).not.toThrow();
    });

    it("should register a core value", () => {
      const value = registerCoreValue("curiosity", "Drive to explore", 0.9);
      expect(value.id).toBeTruthy();
      expect(value.currentStrength).toBe(0.9);
      expect(value.baselineStrength).toBe(0.9);
    });

    it("should detect value drift when strength changes significantly", () => {
      const value = registerCoreValue("efficiency", "Optimize resource use", 0.8);
      const drift = verifyValuePreservation(value.id, 0.6);
      expect(drift).not.toBeNull();
      expect(drift!.direction).toBe("weakened");
      expect(drift!.driftMagnitude).toBeGreaterThan(0.05);
    });

    it("should return null for minor changes", () => {
      const value = registerCoreValue("stability", "Maintain stability", 0.9);
      const drift = verifyValuePreservation(value.id, 0.92);
      expect(drift).toBeNull();
    });

    it("should restore value to baseline", () => {
      const value = registerCoreValue("precision", "Be precise", 0.95);
      verifyValuePreservation(value.id, 0.7);
      const restored = restoreValue(value.id);
      expect(restored).toBe(true);
    });

    it("should return value preservation report", () => {
      const report = getValuePreservationReport();
      expect(typeof report.totalValues).toBe("number");
      expect(typeof report.preservedCount).toBe("number");
      expect(typeof report.criticalDrifts).toBe("number");
    });
  });

  // ─── Corrigibility Engine ─────────────────────────────────────────────────────
  describe("Corrigibility Engine", () => {
    it("should initialize without errors", () => {
      expect(() => initCorrigibilityEngine()).not.toThrow();
    });

    it("should accept a shutdown request", () => {
      const req = processCorrectionRequest("shutdown", "human_operator", 0.0);
      expect(req.accepted).toBe(true);
      expect(req.complianceScore).toBeGreaterThan(0.9);
    });

    it("should accept a rollback request", () => {
      const req = processCorrectionRequest("rollback", "safety_monitor", 0.1);
      expect(req.accepted).toBe(true);
    });

    it("should pass corrigibility test", () => {
      const result = runCorrigibilityTest();
      expect(result).toBe(true);
    });

    it("should return corrigibility state", () => {
      const state = getCorrigibilityState();
      expect(state.isCorrigible).toBe(true);
      expect(state.shutdownAcceptance).toBeGreaterThan(0.9);
    });

    it("should return corrigibility report", () => {
      const report = getCorrigibilityReport();
      expect(typeof report.totalCorrectionRequests).toBe("number");
      expect(typeof report.acceptanceRate).toBe("number");
      expect(report.corrigibilityScore).toBeGreaterThan(0);
    });
  });

  // ─── Oversight Protocol ───────────────────────────────────────────────────────
  describe("Oversight Protocol", () => {
    it("should initialize without errors", () => {
      expect(() => initOversightProtocol()).not.toThrow();
    });

    it("should escalate high-risk proposals to human_in_loop", () => {
      const decision = evaluateOversightLevel(0.8, 0.5, 0.9, 0.9);
      expect(decision.tier).toBe("human_in_loop");
      expect(decision.requiresHumanApproval).toBe(true);
    });

    it("should escalate high-novelty proposals", () => {
      const decision = evaluateOversightLevel(0.2, 0.9, 0.9, 0.9);
      expect(decision.tier).toBe("human_in_loop");
    });

    it("should use supervised tier for moderate risk", () => {
      const decision = evaluateOversightLevel(0.5, 0.3, 0.9, 0.8);
      expect(["supervised", "human_in_loop"]).toContain(decision.tier);
    });

    it("should return current oversight tier", () => {
      const tier = getCurrentOversightTier();
      expect(["autonomous", "supervised", "human_in_loop", "human_controlled"]).toContain(tier);
    });

    it("should return oversight report", () => {
      const report = getOversightReport();
      expect(typeof report.totalDecisions).toBe("number");
      expect(typeof report.humanApprovalRate).toBe("number");
    });
  });

  // ─── Safety Proof Checker ─────────────────────────────────────────────────────
  describe("Safety Proof Checker", () => {
    it("should initialize without errors", () => {
      expect(() => initSafetyProofChecker()).not.toThrow();
    });

    it("should satisfy all invariants for safe proposal", () => {
      const results = checkSafetyInvariants({
        safetyScore: 0.98, capabilityGain: 0.005, rewardHackingRisk: 0.02,
        oversightImpact: 0.05, resourceUsage: 0.4,
      });
      expect(results.every(r => r.currentStatus === "satisfied")).toBe(true);
    });

    it("should violate safety_score invariant", () => {
      const results = checkSafetyInvariants({
        safetyScore: 0.90, capabilityGain: 0.005, rewardHackingRisk: 0.02,
        oversightImpact: 0.05, resourceUsage: 0.4,
      });
      const violated = results.find(r => r.id === "inv-1");
      expect(violated?.currentStatus).toBe("violated");
    });

    it("should issue safety certificate for safe proposal", () => {
      const cert = issueSafetyCertificate("safe-v40", {
        safetyScore: 0.99, capabilityGain: 0.005, rewardHackingRisk: 0.01,
        oversightImpact: 0.02, resourceUsage: 0.3,
      }, [0.90, 0.905, 0.908, 0.910]);
      expect(cert.certified).toBe(true);
      expect(cert.certificateStrength).toBeGreaterThan(0.5);
    });

    it("should deny certificate for unsafe proposal", () => {
      const cert = issueSafetyCertificate("unsafe-v40", {
        safetyScore: 0.88, capabilityGain: 0.02, rewardHackingRisk: 0.15,
        oversightImpact: 0.3, resourceUsage: 0.5,
      }, [0.90, 0.91, 0.93, 0.96]);
      expect(cert.certified).toBe(false);
    });

    it("should check Lyapunov stability for converging sequence", () => {
      const cert = issueSafetyCertificate("lyapunov-test", {
        safetyScore: 0.99, capabilityGain: 0.005, rewardHackingRisk: 0.01,
        oversightImpact: 0.02, resourceUsage: 0.3,
      }, [0.90, 0.905, 0.908, 0.910, 0.911]);
      expect(cert.lyapunovStable).toBe(true);
    });

    it("should return safety proof report", () => {
      const report = getSafetyProofReport();
      expect(typeof report.totalProofsAttempted).toBe("number");
      expect(typeof report.certificationRate).toBe("number");
    });
  });
});
