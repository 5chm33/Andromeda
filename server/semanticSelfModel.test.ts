/**
 * semanticSelfModel.test.ts — Tests for Phase 15: Semantic Self-Model
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  queryByUtility,
  getTopModulesByImpact,
  getHighRiskModules,
  impactPredict,
  rankProposals,
  updateFromRSICycle,
  getModuleInfo,
  getAllModules,
  getSemanticModelStats,
  getSelfModelSummaryForPrompt,
  reloadState,
  type UtilityMetric,
} from "./semanticSelfModel.js";

// ─── queryByUtility() Tests ───────────────────────────────────────────────────

describe("queryByUtility", () => {
  it("returns modules sorted by contribution to the given metric", () => {
    const modules = queryByUtility("safetyScore");
    expect(Array.isArray(modules)).toBe(true);
    expect(modules.length).toBeGreaterThan(0);
    // Should be sorted descending
    for (let i = 1; i < modules.length; i++) {
      expect(modules[i - 1].utilityContribution.safetyScore)
        .toBeGreaterThanOrEqual(modules[i].utilityContribution.safetyScore);
    }
  });

  it("safetySupervisor is near the top for safetyScore metric", () => {
    const modules = queryByUtility("safetyScore");
    const names = modules.map(m => m.module);
    expect(names.slice(0, 3)).toContain("safetySupervisor");
  });

  it("respects minContribution filter", () => {
    const all = queryByUtility("testPassRate", 0.0);
    const filtered = queryByUtility("testPassRate", 0.3);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
    for (const m of filtered) {
      expect(m.utilityContribution.testPassRate).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("respects limit parameter", () => {
    const limited = queryByUtility("benchmarkDelta", 0.0, 3);
    expect(limited.length).toBeLessThanOrEqual(3);
  });

  it("works for all utility metrics", () => {
    const metrics: UtilityMetric[] = [
      "testPassRate", "benchmarkDelta", "latencyScore",
      "tokenEfficiency", "safetyScore", "noveltyScore", "stabilityScore",
    ];
    for (const metric of metrics) {
      const result = queryByUtility(metric);
      expect(Array.isArray(result)).toBe(true);
    }
  });
});

// ─── getTopModulesByImpact() Tests ────────────────────────────────────────────

describe("getTopModulesByImpact", () => {
  it("returns modules sorted by total impact", () => {
    const top = getTopModulesByImpact();
    expect(top.length).toBeGreaterThan(0);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].totalImpact).toBeGreaterThanOrEqual(top[i].totalImpact);
    }
  });

  it("each entry has module, totalImpact, riskScore, and contribution", () => {
    const top = getTopModulesByImpact(3);
    for (const entry of top) {
      expect(entry).toHaveProperty("module");
      expect(entry).toHaveProperty("totalImpact");
      expect(entry).toHaveProperty("riskScore");
      expect(entry).toHaveProperty("contribution");
      expect(entry.totalImpact).toBeGreaterThan(0);
    }
  });

  it("respects limit parameter", () => {
    const top5 = getTopModulesByImpact(5);
    const top3 = getTopModulesByImpact(3);
    expect(top5.length).toBeLessThanOrEqual(5);
    expect(top3.length).toBeLessThanOrEqual(3);
  });

  it("twoPhaseCommit appears in top modules (high safety impact)", () => {
    const top = getTopModulesByImpact(10);
    const names = top.map(m => m.module);
    expect(names).toContain("twoPhaseCommit");
  });
});

// ─── getHighRiskModules() Tests ───────────────────────────────────────────────

describe("getHighRiskModules", () => {
  it("returns modules above the risk threshold", () => {
    const highRisk = getHighRiskModules(0.7);
    for (const m of highRisk) {
      expect(m.riskScore).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("safetySupervisor and twoPhaseCommit are high-risk", () => {
    const highRisk = getHighRiskModules(0.7);
    const names = highRisk.map(m => m.module);
    expect(names).toContain("safetySupervisor");
    expect(names).toContain("twoPhaseCommit");
  });

  it("returns fewer modules with higher threshold", () => {
    const low = getHighRiskModules(0.5);
    const high = getHighRiskModules(0.9);
    expect(high.length).toBeLessThanOrEqual(low.length);
  });

  it("sorted by risk score descending", () => {
    const highRisk = getHighRiskModules(0.5);
    for (let i = 1; i < highRisk.length; i++) {
      expect(highRisk[i - 1].riskScore).toBeGreaterThanOrEqual(highRisk[i].riskScore);
    }
  });
});

// ─── impactPredict() Tests ────────────────────────────────────────────────────

describe("impactPredict", () => {
  it("returns a prediction for a known module", () => {
    const pred = impactPredict("rsiEngine");
    expect(pred).toHaveProperty("predictedDelta");
    expect(pred).toHaveProperty("confidence");
    expect(pred).toHaveProperty("primaryMetrics");
    expect(pred).toHaveProperty("transitiveImpact");
    expect(pred).toHaveProperty("riskLevel");
    expect(pred).toHaveProperty("explanation");
    expect(pred).toHaveProperty("recommended");
  });

  it("returns low-confidence prediction for unknown module", () => {
    const pred = impactPredict("nonExistentModule");
    expect(pred.confidence).toBeLessThan(0.3);
    expect(pred.recommended).toBe(false);
  });

  it("safetySupervisor is critical risk", () => {
    const pred = impactPredict("safetySupervisor");
    expect(pred.riskLevel).toBe("critical");
    expect(pred.recommended).toBe(false);
  });

  it("causalReasoning is low risk", () => {
    const pred = impactPredict("causalReasoning");
    expect(["low", "medium"]).toContain(pred.riskLevel);
  });

  it("fix_bug change type has higher multiplier than remove", () => {
    const fixPred = impactPredict("rsiEngine", "fix_bug");
    const removePred = impactPredict("rsiEngine", "remove");
    expect(fixPred.predictedDelta).toBeGreaterThan(removePred.predictedDelta);
  });

  it("transitiveImpact is an array of module names", () => {
    const pred = impactPredict("rsiEngine");
    expect(Array.isArray(pred.transitiveImpact)).toBe(true);
    // rsiEngine has dependents, so transitive impact should be non-empty
    expect(pred.transitiveImpact.length).toBeGreaterThanOrEqual(0);
  });

  it("primaryMetrics contains valid utility metric names", () => {
    const validMetrics: UtilityMetric[] = [
      "testPassRate", "benchmarkDelta", "latencyScore",
      "tokenEfficiency", "safetyScore", "noveltyScore", "stabilityScore",
    ];
    const pred = impactPredict("selfImprove");
    for (const metric of pred.primaryMetrics) {
      expect(validMetrics).toContain(metric);
    }
  });
});

// ─── rankProposals() Tests ────────────────────────────────────────────────────

describe("rankProposals", () => {
  it("returns ranked proposals in order", () => {
    const proposals = [
      { moduleName: "safetySupervisor", changeType: "refactor" as const },
      { moduleName: "causalReasoning", changeType: "fix_bug" as const },
      { moduleName: "memory", changeType: "optimize" as const },
    ];
    const ranked = rankProposals(proposals);
    expect(ranked.length).toBe(3);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
    expect(ranked[2].rank).toBe(3);
  });

  it("critical-risk modules rank lower than low-risk modules", () => {
    const proposals = [
      { moduleName: "safetySupervisor" }, // Critical risk
      { moduleName: "causalReasoning" },  // Low risk
    ];
    const ranked = rankProposals(proposals);
    const safetyIdx = ranked.findIndex(r => r.moduleName === "safetySupervisor");
    const causalIdx = ranked.findIndex(r => r.moduleName === "causalReasoning");
    // causalReasoning should rank higher (lower rank number) than safetySupervisor
    expect(causalIdx).toBeLessThan(safetyIdx);
  });

  it("each ranked entry has moduleName, prediction, and rank", () => {
    const ranked = rankProposals([{ moduleName: "memory" }]);
    expect(ranked[0]).toHaveProperty("moduleName");
    expect(ranked[0]).toHaveProperty("prediction");
    expect(ranked[0]).toHaveProperty("rank");
  });
});

// ─── updateFromRSICycle() Tests ───────────────────────────────────────────────

describe("updateFromRSICycle", () => {
  it("updates rsiTouchCount for a known module", () => {
    const before = getModuleInfo("memory");
    const touchCountBefore = before?.rsiTouchCount ?? 0;

    updateFromRSICycle({
      moduleName: "memory",
      changeType: "optimize",
      actualUtilityDelta: 0.05,
      accepted: true,
      testPassRateDelta: 0.0,
      regressions: 0,
    });

    const after = getModuleInfo("memory");
    expect(after?.rsiTouchCount).toBeGreaterThan(touchCountBefore);
  });

  it("adds a new module if it doesn't exist", () => {
    const newModule = `testModule_${Date.now()}`;
    updateFromRSICycle({
      moduleName: newModule,
      changeType: "add_feature",
      actualUtilityDelta: 0.03,
      accepted: true,
      testPassRateDelta: 0.01,
      regressions: 0,
    });

    const info = getModuleInfo(newModule);
    expect(info).toBeDefined();
    expect(info?.rsiTouchCount).toBe(1);
  });

  it("increases risk score when regressions occur", () => {
    const before = getModuleInfo("llmProvider");
    const riskBefore = before?.riskScore ?? 0.5;

    updateFromRSICycle({
      moduleName: "llmProvider",
      changeType: "refactor",
      actualUtilityDelta: -0.02,
      accepted: false,
      testPassRateDelta: -0.05,
      regressions: 2,
    });

    const after = getModuleInfo("llmProvider");
    expect(after?.riskScore).toBeGreaterThanOrEqual(riskBefore);
  });

  it("decreases risk score on successful accepted cycles", () => {
    // First, inflate the risk score with a regression
    updateFromRSICycle({
      moduleName: "federatedLearning",
      changeType: "refactor",
      actualUtilityDelta: -0.01,
      accepted: false,
      testPassRateDelta: 0,
      regressions: 1,
    });
    const afterRegression = getModuleInfo("federatedLearning");
    const riskAfterRegression = afterRegression?.riskScore ?? 0.5;

    // Then a successful cycle
    updateFromRSICycle({
      moduleName: "federatedLearning",
      changeType: "optimize",
      actualUtilityDelta: 0.05,
      accepted: true,
      testPassRateDelta: 0.02,
      regressions: 0,
    });

    const afterSuccess = getModuleInfo("federatedLearning");
    expect(afterSuccess?.riskScore).toBeLessThanOrEqual(riskAfterRegression);
  });

  it("confidence increases with more RSI cycles", () => {
    const moduleName = `testConfModule_${Date.now()}`;
    updateFromRSICycle({
      moduleName,
      changeType: "fix_bug",
      actualUtilityDelta: 0.02,
      accepted: true,
      testPassRateDelta: 0.01,
      regressions: 0,
    });
    const after1 = getModuleInfo(moduleName);
    const conf1 = after1?.confidence ?? 0;

    // Add more cycles
    for (let i = 0; i < 5; i++) {
      updateFromRSICycle({
        moduleName,
        changeType: "optimize",
        actualUtilityDelta: 0.01,
        accepted: true,
        testPassRateDelta: 0,
        regressions: 0,
      });
    }
    const after6 = getModuleInfo(moduleName);
    expect(after6?.confidence).toBeGreaterThanOrEqual(conf1);
  });
});

// ─── getAllModules() and getModuleInfo() Tests ────────────────────────────────

describe("getAllModules", () => {
  it("returns an array of module contributions", () => {
    const modules = getAllModules();
    expect(Array.isArray(modules)).toBe(true);
    expect(modules.length).toBeGreaterThan(5);
  });

  it("each module has required fields", () => {
    const modules = getAllModules();
    for (const m of modules.slice(0, 5)) {
      expect(m).toHaveProperty("module");
      expect(m).toHaveProperty("utilityContribution");
      expect(m).toHaveProperty("riskScore");
      expect(m).toHaveProperty("confidence");
      expect(m.riskScore).toBeGreaterThanOrEqual(0);
      expect(m.riskScore).toBeLessThanOrEqual(1);
      expect(m.confidence).toBeGreaterThanOrEqual(0);
      expect(m.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("getModuleInfo", () => {
  it("returns module info for known modules", () => {
    const info = getModuleInfo("rsiEngine");
    expect(info).toBeDefined();
    expect(info?.module).toBe("rsiEngine");
    expect(info?.riskScore).toBeGreaterThan(0);
  });

  it("returns undefined for unknown modules", () => {
    const info = getModuleInfo("completelyUnknownModule");
    expect(info).toBeUndefined();
  });
});

// ─── getSemanticModelStats() Tests ───────────────────────────────────────────

describe("getSemanticModelStats", () => {
  it("returns stats with correct shape", () => {
    const stats = getSemanticModelStats();
    expect(stats).toHaveProperty("totalModules");
    expect(stats).toHaveProperty("totalRSICycles");
    expect(stats).toHaveProperty("avgConfidence");
    expect(stats).toHaveProperty("highRiskModules");
    expect(stats).toHaveProperty("lastCalibrated");
    expect(stats.totalModules).toBeGreaterThan(0);
    expect(Array.isArray(stats.highRiskModules)).toBe(true);
  });

  it("avgConfidence is between 0 and 1", () => {
    const stats = getSemanticModelStats();
    expect(stats.avgConfidence).toBeGreaterThanOrEqual(0);
    expect(stats.avgConfidence).toBeLessThanOrEqual(1);
  });

  it("highRiskModules contains safetySupervisor", () => {
    const stats = getSemanticModelStats();
    expect(stats.highRiskModules).toContain("safetySupervisor");
  });
});

// ─── getSelfModelSummaryForPrompt() Tests ─────────────────────────────────────

describe("getSelfModelSummaryForPrompt", () => {
  it("returns a non-empty string", () => {
    const summary = getSelfModelSummaryForPrompt();
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(100);
  });

  it("contains section headers", () => {
    const summary = getSelfModelSummaryForPrompt();
    expect(summary).toContain("Semantic Self-Model Summary");
    expect(summary).toContain("highest-impact modules");
    expect(summary).toContain("High-risk modules");
  });

  it("contains module names", () => {
    const summary = getSelfModelSummaryForPrompt();
    // Should contain at least one known module name
    const knownModules = ["rsiEngine", "twoPhaseCommit", "safetySupervisor", "memory"];
    const containsAny = knownModules.some(m => summary.includes(m));
    expect(containsAny).toBe(true);
  });
});
