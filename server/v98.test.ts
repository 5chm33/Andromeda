/**
 * v98.test.ts — Causal Inference & Counterfactual Reasoning
 */
import { describe, it, expect, beforeEach } from "vitest";

import { addNode, addEdge, getParents, getChildren, findPaths, getAllNodes, getAllEdges, _resetCausalGraphForTest } from "./causalGraph";
import { registerVariable, intervene, measureEffect, removeIntervention, getVariable, getInterventions, _resetInterventionEngineForTest } from "./interventionEngine";
import { createScenario, query, compareScenarios, getScenario, getQueries, _resetCounterfactualReasonerForTest } from "./counterfactualReasoner";
import { analyzeConfounding, getAnalyses, _resetConfoundingDetectorForTest } from "./confoundingDetector";
import { discoverStructure, getStructures, _resetCausalDiscoveryForTest } from "./causalDiscovery";
import { createDoExpression, applyRule, identifyAdjustmentSet, computeATE, getExpressions, _resetDoCalculusForTest } from "./doCalculus";

// ─── causalGraph ──────────────────────────────────────────────────────────────
describe("causalGraph", () => {
  beforeEach(() => _resetCausalGraphForTest());

  it("adds nodes", () => {
    const n = addNode("Smoking", "cause");
    expect(n.nodeId).toMatch(/^cn-/);
    expect(getAllNodes().length).toBe(1);
  });

  it("adds edges between nodes", () => {
    const a = addNode("Smoking", "cause");
    const b = addNode("Cancer", "effect");
    const e = addEdge(a.nodeId, b.nodeId, 0.8);
    expect(e).not.toBeNull();
    expect(getAllEdges().length).toBe(1);
  });

  it("returns null for edge with missing node", () => {
    addNode("X", "cause");
    const e = addEdge("cn-1", "nonexistent", 0.5);
    expect(e).toBeNull();
  });

  it("finds parents of a node", () => {
    const a = addNode("A", "cause");
    const b = addNode("B", "effect");
    addEdge(a.nodeId, b.nodeId);
    const parents = getParents(b.nodeId);
    expect(parents.length).toBe(1);
    expect(parents[0].name).toBe("A");
  });

  it("finds causal paths", () => {
    const a = addNode("A", "cause");
    const b = addNode("B", "mediator");
    const c = addNode("C", "effect");
    addEdge(a.nodeId, b.nodeId);
    addEdge(b.nodeId, c.nodeId);
    const paths = findPaths(a.nodeId, c.nodeId);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].nodes).toContain(b.nodeId);
  });
});

// ─── interventionEngine ───────────────────────────────────────────────────────
describe("interventionEngine", () => {
  beforeEach(() => _resetInterventionEngineForTest());

  it("registers variables", () => {
    const v = registerVariable("smoking", 0);
    expect(v.name).toBe("smoking");
    expect(v.isIntervened).toBe(false);
  });

  it("intervenes on a variable", () => {
    registerVariable("smoking", 0);
    const intervention = intervene("smoking", 1);
    expect(intervention).not.toBeNull();
    expect(getVariable("smoking")!.value).toBe(1);
    expect(getVariable("smoking")!.isIntervened).toBe(true);
  });

  it("measures effect of intervention", () => {
    registerVariable("treatment", 0);
    const intv = intervene("treatment", 1)!;
    const result = measureEffect(intv.interventionId, "outcome", { outcome: 0.3 }, { outcome: 0.7 });
    expect(result.estimatedEffect).toBeCloseTo(0.4);
  });

  it("removes intervention", () => {
    registerVariable("x", 0);
    intervene("x", 5);
    removeIntervention("x");
    expect(getVariable("x")!.isIntervened).toBe(false);
  });

  it("tracks interventions", () => {
    registerVariable("a", 0);
    intervene("a", 1);
    expect(getInterventions().length).toBe(1);
  });
});

// ─── counterfactualReasoner ───────────────────────────────────────────────────
describe("counterfactualReasoner", () => {
  beforeEach(() => _resetCounterfactualReasonerForTest());

  it("creates a scenario", () => {
    const s = createScenario("No smoking", { smoking: 1, income: 50 }, { smoking: 0, income: 50 });
    expect(s.scenarioId).toMatch(/^sc-/);
    expect(s.changedVariables).toContain("smoking");
  });

  it("queries counterfactual outcome", () => {
    const s = createScenario("Test", { x: 1 }, { x: 2 });
    const q = query(s.scenarioId, "What if x=2?", "y", (v) => v["x"] * 3);
    expect(q).not.toBeNull();
    expect(q!.factualOutcome).toBe(3);
    expect(q!.counterfactualOutcome).toBe(6);
    expect(q!.difference).toBe(3);
  });

  it("computes percentage change", () => {
    const s = createScenario("Pct", { x: 2 }, { x: 4 });
    const q = query(s.scenarioId, "Double x?", "y", (v) => v["x"]);
    expect(q!.percentageChange).toBe(100);
  });

  it("compares scenarios", () => {
    const a = createScenario("A", { x: 1, y: 2 }, { x: 2, y: 2 });
    const b = createScenario("B", { x: 1, y: 2 }, { x: 1, y: 3 });
    const comp = compareScenarios(a.scenarioId, b.scenarioId);
    expect(comp).not.toBeNull();
    expect(comp!.similarity).toBeGreaterThan(0);
  });

  it("stores queries", () => {
    const s = createScenario("S", { x: 1 }, { x: 2 });
    query(s.scenarioId, "q?", "y", (v) => v["x"]);
    expect(getQueries(s.scenarioId).length).toBe(1);
  });
});

// ─── confoundingDetector ──────────────────────────────────────────────────────
describe("confoundingDetector", () => {
  beforeEach(() => _resetConfoundingDetectorForTest());

  it("analyzes confounding", () => {
    const treatment = { variableName: "drug", values: [0, 1, 0, 1, 0, 1] };
    const outcome = { variableName: "recovery", values: [0.3, 0.8, 0.2, 0.9, 0.3, 0.7] };
    const age = { variableName: "age", values: [20, 60, 25, 55, 22, 58] };
    const result = analyzeConfounding(treatment, outcome, [age]);
    expect(result.analysisId).toMatch(/^ca-/);
    expect(result.potentialConfounders.length).toBe(1);
  });

  it("detects confounders with high correlation", () => {
    const t = { variableName: "T", values: [0, 0, 1, 1, 0, 1] };
    const o = { variableName: "O", values: [0.1, 0.2, 0.8, 0.9, 0.1, 0.85] };
    const c = { variableName: "C", values: [0, 0, 1, 1, 0, 1] }; // perfectly correlated with T
    const result = analyzeConfounding(t, o, [c]);
    expect(result.potentialConfounders[0].confoundingScore).toBeGreaterThan(0);
  });

  it("stores analyses", () => {
    analyzeConfounding({ variableName: "t", values: [1, 0] }, { variableName: "o", values: [1, 0] }, []);
    expect(getAnalyses().length).toBe(1);
  });
});

// ─── causalDiscovery ──────────────────────────────────────────────────────────
describe("causalDiscovery", () => {
  beforeEach(() => _resetCausalDiscoveryForTest());

  it("discovers structure from data", () => {
    const data = { X: [1, 2, 3, 4, 5], Y: [2, 4, 6, 8, 10] }; // perfectly correlated
    const structure = discoverStructure(data, 0.5);
    expect(structure.structureId).toMatch(/^cs-/);
    expect(structure.edges.length).toBeGreaterThan(0);
  });

  it("ignores uncorrelated variables", () => {
    const data = { X: [1, 2, 3, 4, 5], Z: [5, 1, 3, 2, 4] }; // random
    const structure = discoverStructure(data, 0.9);
    expect(structure.edges.length).toBe(0);
  });

  it("stores discovered structures", () => {
    discoverStructure({ A: [1, 2, 3], B: [1, 2, 3] });
    expect(getStructures().length).toBe(1);
  });
});

// ─── doCalculus ───────────────────────────────────────────────────────────────
describe("doCalculus", () => {
  beforeEach(() => _resetDoCalculusForTest());

  it("creates a do-expression", () => {
    const expr = createDoExpression("Y", "X", 1);
    expect(expr.expressionId).toMatch(/^do-/);
    expect(expr.query).toContain("do(X=1)");
  });

  it("applies do-calculus rules", () => {
    const expr = createDoExpression("Y", "X", 1);
    applyRule(expr.expressionId, "rule1");
    expect(getExpressions()[0].appliedRules).toContain("rule1");
  });

  it("identifies adjustment set", () => {
    const set = identifyAdjustmentSet("X", "Y", ["Z"], "backdoor");
    expect(set.setId).toMatch(/^as-/);
    expect(set.type).toBe("backdoor");
  });

  it("computes average treatment effect", () => {
    const treatment = [0, 0, 0, 1, 1, 1];
    const outcome = [0.2, 0.3, 0.25, 0.7, 0.8, 0.75];
    const ate = computeATE(treatment, outcome, 1);
    expect(ate).toBeGreaterThan(0);
  });

  it("handles conditioning variables in query", () => {
    const expr = createDoExpression("Y", "X", 1, ["Z", "W"]);
    expect(expr.query).toContain("Z");
    expect(expr.conditioningVariables).toContain("W");
  });
});
