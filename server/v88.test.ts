/**
 * v88.test.ts — Explainability & Interpretability
 * Comprehensive tests for all 6 v88 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { analyzeFeatureImportance, getTopFeatures, compareAnalyses, _resetFeatureImportanceForTest } from "./featureImportanceAnalyzer";
import { generateTextSaliency, generateTabularSaliency, getSaliencyMap, getHighSaliencyRegions, _resetSaliencyMapperForTest } from "./saliencyMapper";
import { extractRule, explainDecision, getExplanation, getExplanationsForInput, _resetDecisionExplainerForTest } from "./decisionExplainer";
import { generateCounterfactual, getCounterfactual, getCounterfactualsForInput, _resetCounterfactualGeneratorForTest } from "./counterfactualGenerator";
import { auditFairness, getReport as getFairnessReport, _resetFairnessAuditorForTest } from "./fairnessAuditor";
import { generateXAIReport, summarizeExplanations, getReport as getXAIReport, _resetExplanationReporterForTest } from "./explanationReporter";

// ─── featureImportanceAnalyzer ───────────────────────────────────────────────
describe("featureImportanceAnalyzer", () => {
  beforeEach(() => _resetFeatureImportanceForTest());

  it("analyzes feature importance", () => {
    const analysis = analyzeFeatureImportance("model-1",
      { age: [25, 35, 45, 55], income: [30000, 50000, 70000, 90000] },
      [0, 0, 1, 1]
    );
    expect(analysis.analysisId).toMatch(/^ia-/);
    expect(analysis.features.length).toBe(2);
  });

  it("ranks features by importance", () => {
    const analysis = analyzeFeatureImportance("model-2",
      { strong: [1, 2, 3, 4, 5], weak: [5, 5, 5, 5, 5] },
      [1, 2, 3, 4, 5]
    );
    expect(analysis.features[0].rank).toBe(1);
    expect(analysis.features[0].featureName).toBe("strong");
  });

  it("normalizes importance scores", () => {
    const analysis = analyzeFeatureImportance("model-3",
      { a: [1, 2, 3], b: [3, 2, 1] },
      [1, 2, 3]
    );
    const total = analysis.features.reduce((s, f) => s + f.normalizedImportance, 0);
    expect(total).toBeCloseTo(1.0, 2);
  });

  it("returns top features", () => {
    const analysis = analyzeFeatureImportance("model-4",
      { f1: [1, 2, 3], f2: [3, 2, 1], f3: [2, 2, 2] },
      [1, 2, 3]
    );
    const top = getTopFeatures(analysis.analysisId, 2);
    expect(top.length).toBe(2);
  });

  it("compares two analyses", () => {
    const a1 = analyzeFeatureImportance("m1", { x: [1, 2, 3] }, [1, 2, 3]);
    const a2 = analyzeFeatureImportance("m1", { x: [3, 2, 1] }, [1, 2, 3]);
    const comparison = compareAnalyses(a1.analysisId, a2.analysisId);
    expect(comparison["x"]).toBeDefined();
  });
});

// ─── saliencyMapper ──────────────────────────────────────────────────────────
describe("saliencyMapper", () => {
  beforeEach(() => _resetSaliencyMapperForTest());

  it("generates text saliency map", () => {
    const map = generateTextSaliency("input-1", ["The", "cat", "sat"], [0.1, 0.9, 0.3]);
    expect(map.mapId).toMatch(/^sm-/);
    expect(map.regions.length).toBe(3);
    expect(map.topRegions[0].label).toBe("cat");
  });

  it("generates tabular saliency map", () => {
    const map = generateTabularSaliency("input-2", { age: 0.8, income: 0.3, education: 0.6 });
    expect(map.inputType).toBe("tabular");
    expect(map.regions.length).toBe(3);
  });

  it("normalizes saliency scores", () => {
    const map = generateTextSaliency("input-3", ["a", "b", "c"], [2, 4, 6]);
    const maxScore = Math.max(...map.regions.map(r => r.normalizedScore));
    expect(maxScore).toBeCloseTo(1.0, 5);
  });

  it("filters high saliency regions", () => {
    const map = generateTextSaliency("input-4", ["low", "high", "mid"], [0.1, 0.9, 0.5]);
    const high = getHighSaliencyRegions(map.mapId, 0.8);
    expect(high.length).toBe(1);
    expect(high[0].label).toBe("high");
  });

  it("retrieves map by ID", () => {
    const map = generateTextSaliency("input-5", ["x"], [0.5]);
    expect(getSaliencyMap(map.mapId)?.mapId).toBe(map.mapId);
  });
});

// ─── decisionExplainer ───────────────────────────────────────────────────────
describe("decisionExplainer", () => {
  beforeEach(() => _resetDecisionExplainerForTest());

  it("explains a decision", () => {
    const explanation = explainDecision("input-1", "approved", 0.85, { credit_score: 0.9, income: 0.7, debt: -0.3 }, []);
    expect(explanation.explanationId).toMatch(/^exp-/);
    expect(explanation.prediction).toBe("approved");
    expect(explanation.naturalLanguage).toContain("approved");
  });

  it("identifies supporting and contradicting factors", () => {
    const explanation = explainDecision("input-2", "denied", 0.7, { risk: 0.8, collateral: -0.5 }, []);
    expect(explanation.supportingFactors.length).toBeGreaterThan(0);
    expect(explanation.contradictingFactors.length).toBeGreaterThan(0);
  });

  it("matches rules to decision", () => {
    const rule = extractRule([{ feature: "credit_score", operator: ">", value: 0.7 }], "approved", 0.9);
    const explanation = explainDecision("input-3", "approved", 0.9, { credit_score: 0.8 }, [rule]);
    expect(explanation.rules.length).toBe(1);
  });

  it("retrieves explanations by input", () => {
    explainDecision("input-4", "yes", 0.8, { x: 1 }, []);
    explainDecision("input-4", "yes", 0.9, { x: 2 }, []);
    expect(getExplanationsForInput("input-4").length).toBe(2);
  });

  it("resets cleanly", () => {
    explainDecision("i", "p", 0.5, {}, []);
    _resetDecisionExplainerForTest();
    expect(getExplanation("exp-1")).toBeUndefined();
  });
});

// ─── counterfactualGenerator ─────────────────────────────────────────────────
describe("counterfactualGenerator", () => {
  beforeEach(() => _resetCounterfactualGeneratorForTest());

  it("generates a counterfactual", () => {
    const cf = generateCounterfactual(
      "input-1",
      { age: 25, income: 30000, credit_score: 600 },
      "denied",
      "approved",
      { age: { min: 18, max: 80 }, income: { min: 0, max: 200000 }, credit_score: { min: 300, max: 850 } }
    );
    expect(cf.cfId).toMatch(/^cf-/);
    expect(cf.originalPrediction).toBe("denied");
    expect(cf.targetPrediction).toBe("approved");
    expect(cf.changes.length).toBeGreaterThan(0);
  });

  it("generates natural language explanation", () => {
    const cf = generateCounterfactual("input-2", { score: 50 }, "fail", "pass", { score: { min: 0, max: 100 } });
    expect(cf.naturalLanguage).toContain("fail");
    expect(cf.naturalLanguage).toContain("pass");
  });

  it("computes feasibility score", () => {
    const cf = generateCounterfactual("input-3", { x: 5 }, "no", "yes", { x: { min: 0, max: 10 } });
    expect(cf.feasibilityScore).toBeGreaterThan(0);
    expect(cf.feasibilityScore).toBeLessThanOrEqual(1);
  });

  it("respects actionable features", () => {
    const cf = generateCounterfactual("input-4", { age: 25, income: 30000 }, "denied", "approved", { age: { min: 18, max: 80 }, income: { min: 0, max: 200000 } }, ["income"]);
    expect(cf.changes.every(c => c.feature === "income")).toBe(true);
  });

  it("retrieves counterfactuals by input", () => {
    generateCounterfactual("input-5", { x: 1 }, "a", "b", { x: { min: 0, max: 10 } });
    expect(getCounterfactualsForInput("input-5").length).toBe(1);
  });
});

// ─── fairnessAuditor ─────────────────────────────────────────────────────────
describe("fairnessAuditor", () => {
  beforeEach(() => _resetFairnessAuditorForTest());

  it("audits fair predictions", () => {
    const predictions = [
      { groupValue: "A", predicted: true, actual: true },
      { groupValue: "A", predicted: false, actual: false },
      { groupValue: "B", predicted: true, actual: true },
      { groupValue: "B", predicted: false, actual: false },
    ];
    const report = auditFairness("model-1", "gender", predictions);
    expect(report.reportId).toMatch(/^fr-/);
    expect(report.groups.length).toBe(2);
  });

  it("detects demographic parity disparity", () => {
    // Group A: 4/4 positive rate = 1.0; Group B: 0/4 positive rate = 0.0 → ratio = 0 < 0.8
    const predictions = [
      { groupValue: "A", predicted: true, actual: true },
      { groupValue: "A", predicted: true, actual: true },
      { groupValue: "A", predicted: true, actual: true },
      { groupValue: "A", predicted: true, actual: true },
      { groupValue: "B", predicted: false, actual: true },
      { groupValue: "B", predicted: false, actual: false },
      { groupValue: "B", predicted: false, actual: true },
      { groupValue: "B", predicted: false, actual: false },
    ];
    const report = auditFairness("model-2", "race", predictions, { demographic_parity: 0.8 });
    // A positive rate = 1.0, B positive rate = 0.0 → ratio = 0 → fails
    expect(report.metrics.demographic_parity.passed).toBe(false);
  });

  it("generates recommendations for failed metrics", () => {
    // Group X: 2/2 positive = 1.0; Group Y: 0/2 positive = 0.0 → demographic parity fails
    const predictions = [
      { groupValue: "X", predicted: true, actual: true },
      { groupValue: "X", predicted: true, actual: false },
      { groupValue: "Y", predicted: false, actual: true },
      { groupValue: "Y", predicted: false, actual: false },
    ];
    const report = auditFairness("model-3", "age", predictions, { demographic_parity: 0.8 });
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it("retrieves report by ID", () => {
    const predictions = [{ groupValue: "A", predicted: true, actual: true }];
    const report = auditFairness("m", "attr", predictions);
    expect(getFairnessReport(report.reportId)?.reportId).toBe(report.reportId);
  });
});

// ─── explanationReporter ─────────────────────────────────────────────────────
describe("explanationReporter", () => {
  beforeEach(() => _resetExplanationReporterForTest());

  it("generates an XAI report", () => {
    const report = generateXAIReport("model-1", "summary", {
      predictions: [{ prediction: "yes", confidence: 0.9, features: { x: 1 } }],
      topFeatures: ["x", "y"],
      fairnessScore: 0.95,
    });
    expect(report.reportId).toMatch(/^xai-/);
    expect(report.sections.length).toBeGreaterThan(0);
  });

  it("includes technical section for technical format", () => {
    const report = generateXAIReport("model-2", "technical", {
      predictions: [{ prediction: "no", confidence: 0.7, features: {} }],
      topFeatures: ["a"],
    });
    expect(report.sections.some(s => s.title === "Technical Details")).toBe(true);
  });

  it("generates recommendations for low confidence", () => {
    const report = generateXAIReport("model-3", "executive", {
      predictions: [{ prediction: "maybe", confidence: 0.5, features: {} }],
      topFeatures: [],
    });
    expect(report.recommendations.some(r => r.includes("calibration"))).toBe(true);
  });

  it("summarizes explanations", () => {
    const summary = summarizeExplanations(
      [{ prediction: "yes", confidence: 0.9 }, { prediction: "no", confidence: 0.7 }],
      ["feature1"],
      "fair"
    );
    expect(summary.totalExplanations).toBe(2);
    expect(summary.averageConfidence).toBeCloseTo(0.8, 1);
  });

  it("retrieves report by ID", () => {
    const report = generateXAIReport("m", "summary", { predictions: [], topFeatures: [] });
    expect(getXAIReport(report.reportId)?.reportId).toBe(report.reportId);
  });
});
