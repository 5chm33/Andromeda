/**
 * v92.test.ts — Recursive Self-Improvement & Introspection
 */
import { describe, it, expect, beforeEach } from "vitest";

import { assessCapabilities, reflect, getLatestReport, getReflections, _resetSelfInspectorForTest } from "./selfInspector";
import { defineRule, applyRules, getRules, getResults, _resetCodeRewriterForTest } from "./codeRewriter";
import { startSession, record, endSession, getHotspots, getSession, _resetPerformanceProfilerForTest } from "./performanceProfiler";
import { registerStage, detectBottlenecks, getBottlenecks, getStage, _resetBottleneckDetectorForTest } from "./bottleneckDetector";
import { suggestOptimization, generatePlan, getSuggestions, getPlans, _resetOptimizationSuggesterForTest } from "./optimizationSuggester";
import { proposeModification, runSafetyTests, applyModification, rollback, getModifications, _resetSelfModifierForTest } from "./selfModifier";

// ─── selfInspector ────────────────────────────────────────────────────────────
describe("selfInspector", () => {
  beforeEach(() => _resetSelfInspectorForTest());

  it("assesses capabilities", () => {
    const report = assessCapabilities("agent-1", { reasoning: { level: 0.8, confidence: 0.9 }, memory: { level: 0.6, confidence: 0.7 } });
    expect(report.reportId).toMatch(/^cr-/);
    expect(report.overallScore).toBeGreaterThan(0);
  });

  it("identifies limitations", () => {
    const report = assessCapabilities("agent-2", { vision: { level: 0.1, confidence: 0.9 } });
    expect(report.limitations).toContain("Low proficiency in vision");
  });

  it("identifies knowledge gaps", () => {
    const report = assessCapabilities("agent-3", { math: { level: 0.8, confidence: 0.2 } });
    expect(report.knowledgeGaps).toContain("Uncertain about math");
  });

  it("logs reflections", () => {
    reflect("agent-4", "What are my strengths?", "I excel at pattern recognition", 0.8);
    expect(getReflections("agent-4").length).toBe(1);
  });

  it("retrieves latest report", () => {
    assessCapabilities("agent-5", { x: { level: 0.5, confidence: 0.5 } });
    expect(getLatestReport("agent-5")).not.toBeNull();
  });
});

// ─── codeRewriter ─────────────────────────────────────────────────────────────
describe("codeRewriter", () => {
  beforeEach(() => _resetCodeRewriterForTest());

  it("defines a rewrite rule", () => {
    const rule = defineRule("Remove console.log", "optimize", "console.log(", "// console.log(", 8);
    expect(rule.ruleId).toMatch(/^rr-/);
    expect(rule.priority).toBe(8);
  });

  it("applies rules to code", () => {
    defineRule("Simplify var", "simplify", "var ", "const ", 5);
    const result = applyRules("var x = 1; var y = 2;");
    expect(result.rewrittenCode).toBe("const x = 1; const y = 2;");
    expect(result.appliedRules.length).toBe(1);
  });

  it("calculates improvement score", () => {
    defineRule("R1", "optimize", "slow()", "fast()", 5);
    defineRule("R2", "optimize", "bad()", "good()", 5);
    const result = applyRules("slow() bad()");
    expect(result.estimatedImprovementScore).toBeGreaterThan(0);
  });

  it("filters rules by type", () => {
    defineRule("A", "simplify", "x", "y", 5);
    defineRule("B", "optimize", "a", "b", 5);
    expect(getRules("simplify").length).toBe(1);
  });

  it("stores results", () => {
    applyRules("some code");
    expect(getResults().length).toBe(1);
  });
});

// ─── performanceProfiler ──────────────────────────────────────────────────────
describe("performanceProfiler", () => {
  beforeEach(() => _resetPerformanceProfilerForTest());

  it("starts a session", () => {
    const session = startSession("test-run");
    expect(session.sessionId).toMatch(/^ps-/);
    expect(session.endedAt).toBeNull();
  });

  it("records function calls", () => {
    const session = startSession("run");
    record(session.sessionId, "fetchData", 150);
    expect(getSession(session.sessionId)!.totalCallsRecorded).toBe(1);
  });

  it("tracks min/max/avg time", () => {
    const session = startSession("run");
    record(session.sessionId, "fn", 100);
    record(session.sessionId, "fn", 200);
    record(session.sessionId, "fn", 300);
    const entry = [...getSession(session.sessionId)!.entries.values()][0];
    expect(entry.minTimeMs).toBe(100);
    expect(entry.maxTimeMs).toBe(300);
    expect(entry.avgTimeMs).toBe(200);
  });

  it("ends session", () => {
    const session = startSession("run");
    endSession(session.sessionId);
    expect(getSession(session.sessionId)!.endedAt).not.toBeNull();
  });

  it("returns hotspots", () => {
    const session = startSession("run");
    record(session.sessionId, "slow", 1000);
    record(session.sessionId, "fast", 10);
    const hotspots = getHotspots(session.sessionId, 1);
    expect(hotspots[0].functionName).toBe("slow");
  });
});

// ─── bottleneckDetector ───────────────────────────────────────────────────────
describe("bottleneckDetector", () => {
  beforeEach(() => _resetBottleneckDetectorForTest());

  it("registers a pipeline stage", () => {
    const stage = registerStage("Parser", 50, 100, 0.01, 5);
    expect(stage.stageId).toMatch(/^stg-/);
  });

  it("detects critical bottleneck", () => {
    registerStage("Fast", 10, 1000, 0.01, 0);
    registerStage("Slow", 50, 10, 0.01, 0); // 5x slower — avg=30, slow=50 > 30*1.5
    registerStage("VerySlow", 200, 5, 0.01, 0); // 20x avg — critical
    const found = detectBottlenecks();
    expect(found.some(b => b.severity === "critical" || b.severity === "high")).toBe(true);
  });

  it("detects high error rate bottleneck", () => {
    registerStage("Flaky", 20, 100, 0.2, 0); // 20% error rate
    detectBottlenecks();
    expect(getBottlenecks("high").length).toBeGreaterThan(0);
  });

  it("detects queue buildup", () => {
    registerStage("Backed", 20, 100, 0.01, 200); // queue depth 200
    detectBottlenecks();
    expect(getBottlenecks("medium").length).toBeGreaterThan(0);
  });

  it("filters bottlenecks by severity", () => {
    registerStage("A", 10, 100, 0.01, 0);
    registerStage("B", 50, 10, 0.01, 0);
    registerStage("C", 200, 5, 0.01, 0); // avg=86, C=200 > 86*2 => high or critical
    detectBottlenecks();
    const critOrHigh = getBottlenecks("critical").length + getBottlenecks("high").length;
    expect(critOrHigh).toBeGreaterThan(0);
  });
});

// ─── optimizationSuggester ────────────────────────────────────────────────────
describe("optimizationSuggester", () => {
  beforeEach(() => _resetOptimizationSuggesterForTest());

  it("creates a suggestion", () => {
    const s = suggestOptimization("caching", "Add Redis cache", "Cache DB queries", "database", 2.5, "low");
    expect(s.suggestionId).toMatch(/^os-/);
    expect(s.priority).toBeGreaterThan(0);
  });

  it("low complexity gets higher priority", () => {
    const low = suggestOptimization("caching", "Easy cache", "desc", "db", 2.0, "low");
    const high = suggestOptimization("algorithmic", "Hard refactor", "desc", "db", 2.0, "high");
    expect(low.priority).toBeGreaterThan(high.priority);
  });

  it("generates an optimization plan", () => {
    suggestOptimization("caching", "Cache", "desc", "api", 1.5, "low");
    suggestOptimization("parallelism", "Parallel", "desc", "api", 2.0, "medium");
    const plan = generatePlan("agent-1", ["api"]);
    expect(plan.suggestions.length).toBe(2);
    expect(plan.estimatedTotalSpeedup).toBeGreaterThan(0);
  });

  it("filters suggestions by category", () => {
    suggestOptimization("memory", "Reduce allocs", "desc", "core", 1.0, "medium");
    suggestOptimization("io", "Async IO", "desc", "net", 1.5, "low");
    expect(getSuggestions("memory").length).toBe(1);
  });
});

// ─── selfModifier ─────────────────────────────────────────────────────────────
describe("selfModifier", () => {
  beforeEach(() => _resetSelfModifierForTest());

  it("proposes a modification", () => {
    const mod = proposeModification("agent-1", "planner", "Increase lookahead", "parameter_update", { lookahead: 5 }, { lookahead: 3 });
    expect(mod.modificationId).toMatch(/^mod-/);
    expect(mod.status).toBe("proposed");
  });

  it("approves modification after passing tests", () => {
    const mod = proposeModification("agent-2", "memory", "Expand buffer", "optimization", {}, {});
    runSafetyTests(mod.modificationId, [
      { testName: "regression", passed: true, score: 0.9 },
      { testName: "performance", passed: true, score: 0.85 },
    ]);
    expect(mod.status).toBe("approved");
    expect(mod.safetyScore).toBeGreaterThan(0.7);
  });

  it("rejects modification after failing tests", () => {
    const mod = proposeModification("agent-3", "planner", "Risky change", "behavior_change", {}, {});
    runSafetyTests(mod.modificationId, [
      { testName: "safety", passed: false, score: 0.2 },
    ]);
    expect(mod.status).toBe("rejected");
  });

  it("applies approved modification", () => {
    const mod = proposeModification("agent-4", "core", "Safe opt", "optimization", {}, {});
    runSafetyTests(mod.modificationId, [{ testName: "t", passed: true, score: 0.95 }]);
    applyModification(mod.modificationId);
    expect(mod.status).toBe("applied");
    expect(mod.appliedAt).not.toBeNull();
  });

  it("rolls back applied modification", () => {
    const mod = proposeModification("agent-5", "core", "Rollback test", "optimization", {}, {});
    runSafetyTests(mod.modificationId, [{ testName: "t", passed: true, score: 0.95 }]);
    applyModification(mod.modificationId);
    rollback(mod.modificationId);
    expect(mod.status).toBe("rolled_back");
  });
});
