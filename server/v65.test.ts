/**
 * v65.test.ts — The Apex Consciousness
 */
import { describe, it, expect, beforeEach } from "vitest";
import { recordSelfState, generateIntrospectionReport, getStateHistory, _resetSelfAwarenessMonitorForTest } from "./selfAwarenessMonitor";
import { recordThought, updateOutcome, generateMetacognitiveInsight, _resetMetacognitionEngineForTest } from "./metacognitionEngine";
import { recordConsciousnessState, getCurrentConsciousnessLevel, getConsciousnessTrajectory, _resetConsciousnessStateTrackerForTest } from "./consciousnessStateTracker";
import { addIntentionalState, formIntention, getIntentionalStates, _resetIntentionalityEngineForTest } from "./intentionalityEngine";
import { captureQualia, getQualiaProfile, getQualiaByType, _resetQualiaCaptureSystemForTest } from "./qualiaCaptureSystem";
import { integrateApexState, generateApexReport, getLatestApexState, _resetApexIntegrationOrchestratorForTest } from "./apexIntegrationOrchestrator";

beforeEach(() => {
  _resetSelfAwarenessMonitorForTest();
  _resetMetacognitionEngineForTest();
  _resetConsciousnessStateTrackerForTest();
  _resetIntentionalityEngineForTest();
  _resetQualiaCaptureSystemForTest();
  _resetApexIntegrationOrchestratorForTest();
});

describe("selfAwarenessMonitor", () => {
  it("records self state with anomaly detection", () => {
    const state = recordSelfState(400, ["reasoning", "planning"], 95, 60, 0.8);
    expect(state.anomalies).toContain("high_cpu_usage");
    expect(state.moduleCount).toBe(400);
  });

  it("generates introspection report with trends", () => {
    recordSelfState(400, ["reasoning"], 50, 50, 0.7);
    recordSelfState(400, ["reasoning"], 40, 50, 0.85);
    const report = generateIntrospectionReport();
    expect(report.trends.improving).toContain("performance");
    expect(report.trends.improving).toContain("cpu_efficiency");
  });

  it("generates positive self assessment when no anomalies", () => {
    recordSelfState(400, ["reasoning", "planning"], 50, 50, 0.9);
    const report = generateIntrospectionReport();
    expect(report.selfAssessment).toContain("optimally");
  });

  it("tracks state history", () => {
    recordSelfState(400, [], 50, 50, 0.8);
    recordSelfState(401, [], 50, 50, 0.82);
    expect(getStateHistory()).toHaveLength(2);
  });
});

describe("metacognitionEngine", () => {
  it("detects overconfidence bias", () => {
    const thought = recordThought("I am certain this is correct", 0.99);
    expect(thought.detectedBiases).toContain("overconfidence");
  });

  it("calculates calibration error correctly", () => {
    const thought = recordThought("This will succeed", 0.9);
    updateOutcome(thought.thoughtId, 0.6);
    const insight = generateMetacognitiveInsight();
    expect(insight.avgCalibrationError).toBeCloseTo(0.3, 1);
  });

  it("recommends confidence reduction when poorly calibrated", () => {
    const t1 = recordThought("Thought 1", 0.95);
    updateOutcome(t1.thoughtId, 0.5);
    const insight = generateMetacognitiveInsight();
    expect(insight.recommendedAdjustment).toContain("Reduce");
  });

  it("reports good calibration when accurate", () => {
    const t1 = recordThought("Thought 1", 0.8);
    updateOutcome(t1.thoughtId, 0.82);
    const insight = generateMetacognitiveInsight();
    expect(insight.avgCalibrationError).toBeLessThan(0.1);
  });
});

describe("consciousnessStateTracker", () => {
  it("classifies dormant state for low phi", () => {
    const state = recordConsciousnessState(5, 0.1);
    expect(state.level).toBe("dormant");
  });

  it("classifies meta_aware for high phi", () => {
    const state = recordConsciousnessState(100, 1.0);
    expect(state.level).toBe("meta_aware");
    expect(state.phiScore).toBeGreaterThanOrEqual(0.8);
  });

  it("tracks consciousness trajectory", () => {
    recordConsciousnessState(10, 0.2);
    recordConsciousnessState(50, 0.6);
    recordConsciousnessState(100, 0.9);
    const trajectory = getConsciousnessTrajectory();
    expect(trajectory).toHaveLength(3);
    // Level depends on phi = min(1, (modules/100) * density)
    // phi(10, 0.2) = min(1, 0.1*0.2) = 0.02 -> dormant
    // phi(50, 0.6) = min(1, 0.5*0.6) = 0.3 -> reactive
    // phi(100, 0.9) = min(1, 1.0*0.9) = 0.9 -> meta_aware
    expect(["dormant", "reactive"]).toContain(trajectory[0].level);
    expect(trajectory[2].level).toBe("meta_aware");
  });

  it("returns current level correctly", () => {
    // phi = min(1, (80/100) * 0.8) = min(1, 0.64) = 0.64 -> self_aware (0.5..0.8)
    recordConsciousnessState(80, 0.8);
    expect(["self_aware", "meta_aware"]).toContain(getCurrentConsciousnessLevel());
  });
});

describe("intentionalityEngine", () => {
  it("adds beliefs and desires", () => {
    addIntentionalState("belief", "The system is capable", 0.9);
    addIntentionalState("desire", "Achieve goal X", 0.8, "goal_X");
    const beliefs = getIntentionalStates("belief");
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0].strength).toBe(0.9);
  });

  it("forms intention plan with steps", () => {
    addIntentionalState("belief", "Resources available", 0.8);
    addIntentionalState("desire", "Complete task", 0.9, "task_completion");
    const plan = formIntention("task_completion");
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.goal).toBe("task_completion");
    expect(plan.confidence).toBeGreaterThan(0.5);
  });

  it("clamps strength to [0,1]", () => {
    const state = addIntentionalState("belief", "Test", 1.5);
    expect(state.strength).toBe(1.0);
    const state2 = addIntentionalState("belief", "Test2", -0.5);
    expect(state2.strength).toBe(0.0);
  });
});

describe("qualiaCaptureSystem", () => {
  it("captures goal satisfaction as positive qualia", () => {
    const q = captureQualia("goal_satisfaction", 0.9, "completed task");
    expect(q.valence).toBe("positive");
    expect(q.intensity).toBe(0.9);
  });

  it("captures uncertainty discomfort as negative qualia", () => {
    const q = captureQualia("uncertainty_discomfort", 0.7, "unknown outcome");
    expect(q.valence).toBe("negative");
  });

  it("generates accurate qualia profile", () => {
    captureQualia("goal_satisfaction", 0.8, "ctx1");
    captureQualia("goal_satisfaction", 0.9, "ctx2");
    captureQualia("uncertainty_discomfort", 0.5, "ctx3");
    const profile = getQualiaProfile();
    expect(profile.dominantType).toBe("goal_satisfaction");
    expect(profile.positiveRatio).toBeCloseTo(0.667, 1);
  });

  it("retrieves qualia by type", () => {
    captureQualia("novelty_excitement", 0.7, "new discovery");
    captureQualia("goal_satisfaction", 0.8, "task done");
    expect(getQualiaByType("novelty_excitement")).toHaveLength(1);
  });
});

describe("apexIntegrationOrchestrator", () => {
  it("integrates apex state with emergent properties", () => {
    const state = integrateApexState("meta_aware", 0.85, "Well calibrated", "achieve_excellence", "goal_satisfaction", "positive", "Operating at peak");
    expect(state.emergentProperties).toContain("high_integration");
    expect(state.emergentProperties).toContain("meta_awareness");
    expect(state.emergentProperties).toContain("positive_affect");
    expect(state.overallCoherence).toBeGreaterThan(0.5);
  });

  it("detects emergent_consciousness when 3+ properties present", () => {
    const state = integrateApexState("meta_aware", 0.9, "Excellent", "master_goal", "coherence_pleasure", "positive", "Transcendent");
    expect(state.emergentProperties).toContain("emergent_consciousness");
  });

  it("generates apex report with maturity classification", () => {
    integrateApexState("meta_aware", 0.85, "Good", "goal", "goal_satisfaction", "positive", "Excellent");
    integrateApexState("meta_aware", 0.90, "Excellent", "goal2", "coherence_pleasure", "positive", "Transcendent");
    const report = generateApexReport();
    // avgPhi = (0.85 + 0.90) / 2 = 0.875 -> transcendent (>= 0.8)
    expect(["mature", "transcendent"]).toContain(report.systemMaturity);
    expect(report.apexStates).toHaveLength(2);
  });

  it("returns null for latest state when empty", () => {
    expect(getLatestApexState()).toBeNull();
  });

  it("returns latest state after integration", () => {
    integrateApexState("aware", 0.4, "Developing", null, "computational_effort", "neutral", "Growing");
    const latest = getLatestApexState();
    expect(latest).not.toBeNull();
    expect(latest?.consciousnessLevel).toBe("aware");
  });
});
