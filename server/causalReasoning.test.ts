/**
 * causalReasoning.test.ts
 * Tests for the Causal Bayesian Network root-cause analysis module.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  CausalNetwork,
  RootCauseAnalyzer,
  getRootCauseAnalyzer,
  resetRootCauseAnalyzer,
  type CausalNode,
  type CausalEdge,
  type FailureEvent,
} from "./causalReasoning.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNode(id: string, type: CausalNode["type"] = "module", priorFailure = 0.3): CausalNode {
  return {
    id,
    type,
    label: id,
    priorFailure,
    failureCount: 3,
    passCount: 7,
    metadata: {},
  };
}

function makeEdge(from: string, to: string, prob = 0.8): CausalEdge {
  return {
    from,
    to,
    conditionalProbability: prob,
    observationCount: 5,
    strength: prob,
  };
}

// ── CausalNetwork ─────────────────────────────────────────────────────────────

describe("CausalNetwork", () => {
  let net: CausalNetwork;

  beforeEach(() => {
    net = new CausalNetwork("/tmp/test_causal_" + Date.now());
  });

  it("adds and retrieves nodes", () => {
    const node = makeNode("moduleA");
    net.addNode(node);
    expect(net.getNode("moduleA")).toEqual(node);
  });

  it("adds and retrieves edges", () => {
    net.addNode(makeNode("A"));
    net.addNode(makeNode("B"));
    const edge = makeEdge("A", "B");
    net.addEdge(edge);
    expect(net.getEdge("A", "B")).toEqual(edge);
  });

  it("returns parents and children correctly", () => {
    net.addNode(makeNode("root"));
    net.addNode(makeNode("child1"));
    net.addNode(makeNode("child2"));
    net.addEdge(makeEdge("root", "child1"));
    net.addEdge(makeEdge("root", "child2"));

    expect(net.getChildren("root")).toContain("child1");
    expect(net.getChildren("root")).toContain("child2");
    expect(net.getParents("child1")).toContain("root");
  });

  it("removes a node and its edges", () => {
    net.addNode(makeNode("A"));
    net.addNode(makeNode("B"));
    net.addEdge(makeEdge("A", "B"));
    net.removeNode("A");
    expect(net.getNode("A")).toBeUndefined();
    expect(net.getEdge("A", "B")).toBeUndefined();
  });

  it("infers failure probability for a leaf node", () => {
    const node = makeNode("leaf", "module", 0.4);
    net.addNode(node);
    const prob = net.inferFailureProbability("leaf");
    expect(prob).toBeCloseTo(0.4, 2);
  });

  it("infers higher failure probability when parent is failing", () => {
    net.addNode(makeNode("parent", "module", 0.9));
    net.addNode(makeNode("child", "module", 0.1));
    net.addEdge(makeEdge("parent", "child", 0.8));

    const prob = net.inferFailureProbability("child");
    // Should be higher than the prior of 0.1 because parent has high failure prob
    expect(prob).toBeGreaterThan(0.1);
  });

  it("returns 1.0 for a node with direct evidence of failure", () => {
    net.addNode(makeNode("A", "module", 0.3));
    const evidence = new Map([["A", true]]);
    expect(net.inferFailureProbability("A", evidence)).toBe(1.0);
  });

  it("returns 0.0 for a node with direct evidence of passing", () => {
    net.addNode(makeNode("A", "module", 0.3));
    const evidence = new Map([["A", false]]);
    expect(net.inferFailureProbability("A", evidence)).toBe(0.0);
  });

  it("performs do-intervention and returns result", () => {
    net.addNode(makeNode("cause", "module", 0.8));
    net.addNode(makeNode("effect", "test", 0.5));
    net.addEdge(makeEdge("cause", "effect", 0.9));

    const result = net.doIntervention("cause", "fix");
    expect(result.interventionNodeId).toBe("cause");
    expect(result.interventionValue).toBe("fix");
    expect(result.predictedImpact).toBeGreaterThanOrEqual(0);
  });

  it("identifies root cause for a simple chain", () => {
    net.addNode(makeNode("root_bug", "function", 0.9));
    net.addNode(makeNode("failing_test", "test", 0.5));
    net.addEdge(makeEdge("root_bug", "failing_test", 0.85));

    const event: FailureEvent = {
      id: "evt1",
      timestamp: Date.now(),
      failedNodeId: "failing_test",
      context: {},
    };

    const chain = net.identifyRootCause(event);
    expect(chain).not.toBeNull();
    expect(chain!.rootCause.id).toBe("root_bug");
    expect(chain!.recommendation).toContain("root_bug");
  });

  it("returns null when failed node is not in the graph", () => {
    const event: FailureEvent = {
      id: "evt2",
      timestamp: Date.now(),
      failedNodeId: "nonexistent",
      context: {},
    };
    expect(net.identifyRootCause(event)).toBeNull();
  });

  it("recordFailure updates prior probability", () => {
    net.recordFailure("modX", "module", "ModuleX");
    net.recordFailure("modX", "module", "ModuleX");
    const node = net.getNode("modX")!;
    expect(node.failureCount).toBe(2);
    expect(node.priorFailure).toBeGreaterThan(0.5);
  });

  it("recordPass decreases prior probability", () => {
    net.recordFailure("modY", "module", "ModuleY");
    net.recordPass("modY");
    net.recordPass("modY");
    net.recordPass("modY");
    const node = net.getNode("modY")!;
    expect(node.passCount).toBe(3);
    expect(node.priorFailure).toBeLessThan(0.5);
  });

  it("recordFailure creates causal edges to causedBy nodes", () => {
    net.addNode(makeNode("dep", "dependency", 0.6));
    net.recordFailure("modZ", "module", "ModuleZ", ["dep"]);
    expect(net.getEdge("dep", "modZ")).toBeDefined();
  });

  it("resets the graph", () => {
    net.addNode(makeNode("A"));
    net.reset();
    expect(net.getNodes()).toHaveLength(0);
    expect(net.getEdges()).toHaveLength(0);
  });
});

// ── RootCauseAnalyzer ─────────────────────────────────────────────────────────

describe("RootCauseAnalyzer", () => {
  let analyzer: RootCauseAnalyzer;

  beforeEach(() => {
    analyzer = new RootCauseAnalyzer(new CausalNetwork("/tmp/test_rca_" + Date.now()));
    const net = analyzer.getNetwork();
    net.addNode(makeNode("buggy_fn", "function", 0.85));
    net.addNode(makeNode("test_suite", "test", 0.5));
    net.addEdge(makeEdge("buggy_fn", "test_suite", 0.9));
  });

  it("analyzes a batch of failures and returns chains", () => {
    const failures: FailureEvent[] = [
      { id: "f1", timestamp: Date.now(), failedNodeId: "test_suite", context: {} },
    ];
    const chains = analyzer.analyzeFailures(failures);
    expect(chains.length).toBeGreaterThan(0);
    expect(chains[0].rootCause.id).toBe("buggy_fn");
  });

  it("deduplicates root causes across multiple failures", () => {
    const failures: FailureEvent[] = [
      { id: "f1", timestamp: Date.now(), failedNodeId: "test_suite", context: {} },
      { id: "f2", timestamp: Date.now(), failedNodeId: "test_suite", context: {} },
    ];
    const chains = analyzer.analyzeFailures(failures);
    // Should deduplicate — only one chain for "buggy_fn"
    expect(chains.length).toBe(1);
  });

  it("ranks interventions by predicted impact", () => {
    const failures: FailureEvent[] = [
      { id: "f1", timestamp: Date.now(), failedNodeId: "test_suite", context: {} },
    ];
    const chains = analyzer.analyzeFailures(failures);
    const interventions = analyzer.rankInterventions(chains);
    expect(interventions.length).toBeGreaterThan(0);
    expect(interventions[0].interventionValue).toBe("fix");
  });
});

// ── Singleton ─────────────────────────────────────────────────────────────────

describe("getRootCauseAnalyzer singleton", () => {
  beforeEach(() => {
    resetRootCauseAnalyzer();
  });

  it("returns the same instance on repeated calls", () => {
    const a = getRootCauseAnalyzer("/tmp/test_singleton_" + Date.now());
    const b = getRootCauseAnalyzer();
    expect(a).toBe(b);
  });

  it("returns a new instance after reset", () => {
    const a = getRootCauseAnalyzer("/tmp/test_singleton2_" + Date.now());
    resetRootCauseAnalyzer();
    const b = getRootCauseAnalyzer("/tmp/test_singleton3_" + Date.now());
    expect(a).not.toBe(b);
  });
});
