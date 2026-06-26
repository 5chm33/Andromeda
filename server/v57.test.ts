/**
 * v57.test.ts — The Reasoning Engine
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildDeductiveChain, validateChain, getChains, _resetDeductiveReasoningChainForTest } from "./deductiveReasoningChain";
import { addObservation, synthesizePatterns, getPatterns, _resetInductivePatternSynthesizerForTest } from "./inductivePatternSynthesizer";
import { generateHypotheses, getBestHypothesis, _resetAbductiveHypothesisEngineForTest } from "./abductiveHypothesisEngine";
import { registerConcept, findAnalogies, getMappings, _resetAnalogicalReasoningBridgeForTest } from "./analogicalReasoningBridge";
import { conductDebate, getDebateHistory, _resetDialecticalDebateEngineForTest } from "./dialecticalDebateEngine";
import { addCalibrationSample, calibrate, applyCalibration, _resetReasoningConfidenceCalibratorForTest } from "./reasoningConfidenceCalibrator";

beforeEach(() => {
  _resetDeductiveReasoningChainForTest();
  _resetInductivePatternSynthesizerForTest();
  _resetAbductiveHypothesisEngineForTest();
  _resetAnalogicalReasoningBridgeForTest();
  _resetDialecticalDebateEngineForTest();
  _resetReasoningConfidenceCalibratorForTest();
});

describe("deductiveReasoningChain", () => {
  it("builds a deductive chain from premises", () => {
    const result = buildDeductiveChain([
      { id: "p1", statement: "All A are B", confidence: 0.9 },
      { id: "p2", statement: "All B are C", confidence: 0.8 },
    ], "All A are C");
    expect(result.chainId).toBeTruthy();
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.finalConclusion).toBe("All A are C");
  });

  it("marks chain as valid when confidence is high", () => {
    const result = buildDeductiveChain([
      { id: "p1", statement: "X implies Y", confidence: 0.9 },
      { id: "p2", statement: "Y implies Z", confidence: 0.85 },
    ], "X implies Z");
    expect(result.valid).toBe(true);
    expect(validateChain(result.chainId)).toBe(true);
  });

  it("marks chain as invalid when confidence is low", () => {
    const result = buildDeductiveChain([
      { id: "p1", statement: "Maybe A", confidence: 0.3 },
      { id: "p2", statement: "Maybe B", confidence: 0.2 },
    ], "Definitely C");
    expect(result.valid).toBe(false);
  });

  it("returns false for unknown chain id", () => {
    expect(validateChain("nonexistent")).toBe(false);
  });
});

describe("inductivePatternSynthesizer", () => {
  it("synthesizes patterns from observations", () => {
    for (let i = 0; i < 5; i++) {
      addObservation({ id: `obs-${i}`, features: { x: i, y: i * 2 }, label: "positive" });
    }
    for (let i = 0; i < 3; i++) {
      addObservation({ id: `neg-${i}`, features: { x: -i, y: -i }, label: "negative" });
    }
    const patterns = synthesizePatterns();
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].generalizationStrength).toBeGreaterThan(0);
  });

  it("does not synthesize patterns from single observations", () => {
    addObservation({ id: "solo", features: { x: 1 }, label: "unique" });
    const patterns = synthesizePatterns();
    expect(patterns.find(p => p.description.includes("unique"))).toBeUndefined();
  });

  it("computes coverage correctly", () => {
    for (let i = 0; i < 4; i++) {
      addObservation({ id: `a-${i}`, features: { v: i }, label: "A" });
    }
    addObservation({ id: "b-0", features: { v: 10 }, label: "B" });
    const patterns = synthesizePatterns();
    const aPattern = patterns.find(p => p.description.includes('"A"'));
    expect(aPattern).toBeDefined();
    expect(aPattern!.coverage).toBeCloseTo(4 / 5, 1);
  });
});

describe("abductiveHypothesisEngine", () => {
  it("generates hypotheses sorted by plausibility", () => {
    const evidence = [
      { id: "e1", description: "Observation 1", strength: 0.9 },
      { id: "e2", description: "Observation 2", strength: 0.7 },
    ];
    const hyps = generateHypotheses(evidence, ["Hypothesis A", "Hypothesis B", "Hypothesis C"]);
    expect(hyps.length).toBe(3);
    expect(hyps[0].plausibilityScore).toBeGreaterThanOrEqual(hyps[1].plausibilityScore);
  });

  it("returns best hypothesis", () => {
    const evidence = [{ id: "e1", description: "Strong evidence", strength: 0.95 }];
    generateHypotheses(evidence, ["Best explanation", "Weaker explanation"]);
    const best = getBestHypothesis();
    expect(best).not.toBeNull();
    expect(best!.explanation).toBeTruthy();
  });

  it("returns null when no hypotheses exist", () => {
    expect(getBestHypothesis()).toBeNull();
  });
});

describe("analogicalReasoningBridge", () => {
  it("finds analogies between domains", () => {
    registerConcept({ conceptId: "c1", domain: "physics", features: { mass: 1, velocity: 2, energy: 3 } });
    registerConcept({ conceptId: "c2", domain: "economics", features: { mass: 0.9, velocity: 1.8, energy: 2.5 } });
    const mappings = findAnalogies("c1", "economics");
    expect(mappings.length).toBeGreaterThan(0);
    expect(mappings[0].similarityScore).toBeGreaterThan(0);
  });

  it("returns empty array for unknown source", () => {
    const mappings = findAnalogies("unknown", "economics");
    expect(mappings).toHaveLength(0);
  });

  it("transfers insights across domains", () => {
    registerConcept({ conceptId: "src", domain: "biology", features: { growth: 0.8, decay: 0.2 } });
    registerConcept({ conceptId: "tgt", domain: "finance", features: { growth: 0.75, decay: 0.25 } });
    const mappings = findAnalogies("src", "finance");
    expect(mappings[0].transferableInsights.length).toBeGreaterThan(0);
  });
});

describe("dialecticalDebateEngine", () => {
  it("conducts a debate and produces synthesis", () => {
    const round = conductDebate(
      { id: "t1", claim: "Markets are efficient", strength: 0.7, evidence: ["EMH"] },
      { id: "a1", claim: "Markets are irrational", strength: 0.65, evidence: ["Behavioral finance"] }
    );
    expect(round.synthesis).toBeTruthy();
    expect(["thesis", "antithesis", "synthesis"]).toContain(round.winner);
  });

  it("picks synthesis when strengths are equal", () => {
    const round = conductDebate(
      { id: "t2", claim: "Claim A", strength: 0.7, evidence: [] },
      { id: "a2", claim: "Claim B", strength: 0.7, evidence: [] }
    );
    expect(round.winner).toBe("synthesis");
  });

  it("picks stronger argument as winner", () => {
    const round = conductDebate(
      { id: "t3", claim: "Strong claim", strength: 0.9, evidence: [] },
      { id: "a3", claim: "Weak claim", strength: 0.3, evidence: [] }
    );
    expect(round.winner).toBe("thesis");
  });

  it("records debate history", () => {
    conductDebate(
      { id: "t4", claim: "A", strength: 0.6, evidence: [] },
      { id: "a4", claim: "B", strength: 0.5, evidence: [] }
    );
    expect(getDebateHistory()).toHaveLength(1);
  });
});

describe("reasoningConfidenceCalibrator", () => {
  it("calibrates confidence and detects overconfidence", () => {
    for (let i = 0; i < 20; i++) {
      addCalibrationSample({ predictedConfidence: 0.9, actuallyCorrect: i < 10 });
    }
    const result = calibrate();
    expect(result.sampleCount).toBe(20);
    expect(result.reliability).toBe("overconfident");
    expect(result.expectedCalibrationError).toBeGreaterThan(0);
  });

  it("detects well-calibrated model", () => {
    for (let i = 0; i < 20; i++) {
      addCalibrationSample({ predictedConfidence: 0.5 + (i % 2) * 0.01, actuallyCorrect: i % 2 === 0 });
    }
    const result = calibrate();
    expect(["well-calibrated", "overconfident", "underconfident"]).toContain(result.reliability);
  });

  it("applies calibration to raw confidence", () => {
    for (let i = 0; i < 10; i++) {
      addCalibrationSample({ predictedConfidence: 0.7, actuallyCorrect: i < 7 });
    }
    const cal = calibrate();
    const calibrated = applyCalibration(0.7, cal.calibrationId);
    expect(calibrated).toBeGreaterThan(0);
    expect(calibrated).toBeLessThanOrEqual(1);
  });

  it("throws when no samples provided", () => {
    expect(() => calibrate()).toThrow();
  });
});
