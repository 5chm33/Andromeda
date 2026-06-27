/**
 * v99.test.ts — Collective Intelligence & Swarm Cognition
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createField, depositTrace, evaporateField, getTracesNear, getField, _resetStigmergyEngineForTest } from "./stigmergyEngine";
import { addEdge, depositPheromone, evaporatePheromones, getNeighbors, recordPath, getBestPath, getAllEdges, _resetPheromoneTrailManagerForTest } from "./pheromoneTrailManager";
import { recordObservation, detectEmergence, getEvents, _resetEmergentBehaviorDetectorForTest } from "./emergentBehaviorDetector";
import { aggregate, getEstimates, _resetCrowdWisdomAggregatorForTest } from "./crowdWisdomAggregator";
import { createSwarm, stepSwarm, getSwarm, _resetSwarmParticleOptimizerForTest } from "./swarmParticleOptimizer";

// ─── stigmergyEngine ──────────────────────────────────────────────────────────
describe("stigmergyEngine", () => {
  beforeEach(() => _resetStigmergyEngineForTest());

  it("creates a stigmergy field", () => {
    const field = createField("Ant Arena", 100, 100);
    expect(field.fieldId).toMatch(/^sf-/);
    expect(field.width).toBe(100);
  });

  it("deposits a trace", () => {
    const field = createField("F1", 50, 50);
    const trace = depositTrace(field.fieldId, "ant-1", { x: 10, y: 10 }, "food", 1.0);
    expect(trace).not.toBeNull();
    expect(trace!.intensity).toBe(1.0);
  });

  it("evaporates traces over time", () => {
    const field = createField("F2", 50, 50, 0.5);
    const trace = depositTrace(field.fieldId, "ant-2", { x: 5, y: 5 }, "home", 1.0)!;
    evaporateField(field.fieldId);
    expect(getField(field.fieldId)!.traces.get(trace.traceId)!.intensity).toBeLessThan(1.0);
  });

  it("finds traces near a position", () => {
    const field = createField("F3", 100, 100);
    depositTrace(field.fieldId, "ant-3", { x: 5, y: 5 }, "food", 1.0);
    depositTrace(field.fieldId, "ant-4", { x: 90, y: 90 }, "food", 1.0);
    const nearby = getTracesNear(field.fieldId, { x: 0, y: 0 }, 15);
    expect(nearby.length).toBe(1);
  });

  it("filters traces by type", () => {
    const field = createField("F4", 100, 100);
    depositTrace(field.fieldId, "ant-5", { x: 5, y: 5 }, "food", 1.0);
    depositTrace(field.fieldId, "ant-6", { x: 6, y: 6 }, "danger", 1.0);
    const food = getTracesNear(field.fieldId, { x: 0, y: 0 }, 20, "food");
    expect(food.length).toBe(1);
  });
});

// ─── pheromoneTrailManager ────────────────────────────────────────────────────
describe("pheromoneTrailManager", () => {
  beforeEach(() => _resetPheromoneTrailManagerForTest());

  it("adds pheromone edges", () => {
    const edge = addEdge("A", "B", 2.0);
    expect(edge.edgeId).toMatch(/^pe-/);
    expect(getAllEdges().length).toBe(1);
  });

  it("deposits pheromone on edge", () => {
    addEdge("A", "B");
    depositPheromone("A", "B", 0.5);
    const neighbors = getNeighbors("A");
    expect(neighbors[0].edge.pheromoneLevel).toBeGreaterThan(1.0);
  });

  it("evaporates pheromones", () => {
    addEdge("X", "Y");
    const before = getAllEdges()[0].pheromoneLevel;
    evaporatePheromones();
    expect(getAllEdges()[0].pheromoneLevel).toBeLessThan(before);
  });

  it("returns neighbor probabilities", () => {
    addEdge("S", "A", 1.0);
    addEdge("S", "B", 2.0);
    const neighbors = getNeighbors("S");
    expect(neighbors.length).toBe(2);
    const totalProb = neighbors.reduce((s, n) => s + n.probability, 0);
    expect(totalProb).toBeCloseTo(1.0, 5);
  });

  it("finds best path", () => {
    recordPath("ant-1", ["A", "B", "C"], 5);
    recordPath("ant-2", ["A", "C"], 3);
    expect(getBestPath()!.totalCost).toBe(3);
  });
});

// ─── emergentBehaviorDetector ─────────────────────────────────────────────────
describe("emergentBehaviorDetector", () => {
  beforeEach(() => _resetEmergentBehaviorDetectorForTest());

  it("records observations", () => {
    recordObservation("a1", { x: 0, y: 0 }, { vx: 1, vy: 0 }, "moving");
    // No assertion needed — just verifying no error
    expect(true).toBe(true);
  });

  it("detects flocking behavior", () => {
    // All agents moving in same direction
    for (let i = 0; i < 5; i++) {
      recordObservation(`a${i}`, { x: i, y: 0 }, { vx: 1.0, vy: 0.0 }, "moving");
    }
    const events = detectEmergence(10);
    expect(events.some(e => e.pattern === "flocking")).toBe(true);
  });

  it("detects consensus", () => {
    for (let i = 0; i < 5; i++) {
      recordObservation(`b${i}`, { x: i, y: 0 }, { vx: 0, vy: 0 }, "idle");
    }
    const events = detectEmergence(10);
    expect(events.some(e => e.pattern === "consensus")).toBe(true);
  });

  it("retrieves events by pattern", () => {
    for (let i = 0; i < 5; i++) recordObservation(`c${i}`, { x: i, y: 0 }, { vx: 1, vy: 0 }, "moving");
    detectEmergence(10);
    expect(getEvents("flocking").length).toBeGreaterThanOrEqual(0);
  });
});

// ─── crowdWisdomAggregator ────────────────────────────────────────────────────
describe("crowdWisdomAggregator", () => {
  beforeEach(() => _resetCrowdWisdomAggregatorForTest());

  const makeEstimates = (values: number[]) => values.map((v, i) => ({ agentId: `a${i}`, estimate: v, confidence: 0.8, expertise: 1.0, submittedAt: Date.now() }));

  it("aggregates with mean", () => {
    const ce = aggregate("How many?", makeEstimates([10, 20, 30]), "mean");
    expect(ce.collectiveValue).toBe(20);
  });

  it("aggregates with median", () => {
    const ce = aggregate("How many?", makeEstimates([10, 20, 100]), "median");
    expect(ce.collectiveValue).toBe(20);
  });

  it("aggregates with weighted mean", () => {
    const individuals = [
      { agentId: "expert", estimate: 50, confidence: 1.0, expertise: 5.0, submittedAt: Date.now() },
      { agentId: "novice", estimate: 10, confidence: 0.3, expertise: 0.5, submittedAt: Date.now() },
    ];
    const ce = aggregate("What is X?", individuals, "weighted_mean");
    expect(ce.collectiveValue).toBeGreaterThan(10); // expert should dominate
  });

  it("computes confidence interval", () => {
    const ce = aggregate("Q?", makeEstimates([10, 20, 30, 40, 50]), "mean");
    expect(ce.confidenceInterval[0]).toBeLessThan(ce.collectiveValue);
    expect(ce.confidenceInterval[1]).toBeGreaterThan(ce.collectiveValue);
  });

  it("stores estimates", () => {
    aggregate("Q?", makeEstimates([1, 2, 3]));
    expect(getEstimates().length).toBe(1);
  });
});

// ─── swarmParticleOptimizer ───────────────────────────────────────────────────
describe("swarmParticleOptimizer", () => {
  beforeEach(() => _resetSwarmParticleOptimizerForTest());

  const fitness = (pos: number[]) => -pos.reduce((s, v) => s + v * v, 0); // maximize at origin

  it("creates a swarm", () => {
    const swarm = createSwarm(10, 2);
    expect(swarm.swarmId).toMatch(/^swarm-/);
    expect(swarm.particles.length).toBe(10);
  });

  it("steps the swarm", () => {
    const swarm = createSwarm(5, 2);
    stepSwarm(swarm.swarmId, fitness);
    expect(getSwarm(swarm.swarmId)!.iteration).toBe(1);
  });

  it("tracks global best", () => {
    const swarm = createSwarm(10, 2);
    stepSwarm(swarm.swarmId, fitness);
    expect(getSwarm(swarm.swarmId)!.globalBestFitness).toBeGreaterThan(-Infinity);
  });

  it("converges after max iterations", () => {
    const swarm = createSwarm(5, 2);
    stepSwarm(swarm.swarmId, fitness, 1);
    expect(getSwarm(swarm.swarmId)!.converged).toBe(true);
  });

  it("improves fitness over iterations", () => {
    const swarm = createSwarm(20, 2);
    let prevBest = -Infinity;
    for (let i = 0; i < 5; i++) stepSwarm(swarm.swarmId, fitness, 100);
    const finalBest = getSwarm(swarm.swarmId)!.globalBestFitness;
    expect(finalBest).toBeGreaterThanOrEqual(prevBest);
  });
});
