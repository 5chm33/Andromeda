/**
 * v95.test.ts — Embodied Cognition & Spatial Reasoning
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createMap, addRegion, findNearestRegion, getRegionsInRadius, getMap, _resetSpatialMapperForTest } from "./spatialMapper";
import { createGrid, setObstacle, planPath, getPaths, _resetPathPlannerForTest } from "./pathPlanner";
import { registerObject, updatePosition, detectCollision, detectAllCollisions, getCollisions, _resetCollisionDetectorForTest } from "./collisionDetector";
import { recordReading, updatePerceptualModel, getPerceivedObjects, getReadings, getModel, _resetEnvironmentPerceiverForTest } from "./environmentPerceiver";
import { registerAgent as registerActionAgent, queueAction, executeNextAction, getAgentState, getActions, _resetActionExecutorForTest } from "./actionExecutor";
import { createEmbodiedAgent, setGoal, stepTowardGoal, interact, rest, getStatus, getAllAgents, _resetEmbodiedAgentForTest } from "./embodiedAgent";

// ─── spatialMapper ────────────────────────────────────────────────────────────
describe("spatialMapper", () => {
  beforeEach(() => _resetSpatialMapperForTest());

  it("creates a spatial map", () => {
    const map = createMap("Office", 100, 100);
    expect(map.mapId).toMatch(/^sm-/);
    expect(map.width).toBe(100);
  });

  it("adds regions", () => {
    const map = createMap("Building", 200, 200);
    const region = addRegion(map.mapId, "Kitchen", { x: 50, y: 50 }, 10, "room");
    expect(region).not.toBeNull();
    expect(region!.regionId).toMatch(/^sr-/);
  });

  it("finds nearest region", () => {
    const map = createMap("Floor", 100, 100);
    addRegion(map.mapId, "Room A", { x: 10, y: 10 }, 5, "room");
    addRegion(map.mapId, "Room B", { x: 80, y: 80 }, 5, "room");
    const nearest = findNearestRegion(map.mapId, { x: 12, y: 12 });
    expect(nearest!.name).toBe("Room A");
  });

  it("finds regions in radius", () => {
    const map = createMap("Area", 100, 100);
    addRegion(map.mapId, "Near", { x: 5, y: 5 }, 2, "room");
    addRegion(map.mapId, "Far", { x: 90, y: 90 }, 2, "room");
    const nearby = getRegionsInRadius(map.mapId, { x: 0, y: 0 }, 20);
    expect(nearby.length).toBe(1);
    expect(nearby[0].name).toBe("Near");
  });
});

// ─── pathPlanner ──────────────────────────────────────────────────────────────
describe("pathPlanner", () => {
  beforeEach(() => _resetPathPlannerForTest());

  it("plans a simple path", () => {
    createGrid("g1", 5, 5);
    const path = planPath("g1", 0, 0, 2, 2);
    expect(path.found).toBe(true);
    expect(path.waypoints.length).toBeGreaterThan(0);
  });

  it("returns start and goal in waypoints", () => {
    createGrid("g2", 5, 5);
    const path = planPath("g2", 0, 0, 4, 0);
    expect(path.waypoints[0]).toEqual({ x: 0, y: 0 });
    expect(path.waypoints[path.waypoints.length - 1]).toEqual({ x: 4, y: 0 });
  });

  it("handles obstacles", () => {
    createGrid("g3", 5, 5);
    // Block direct path
    setObstacle("g3", 1, 0); setObstacle("g3", 1, 1); setObstacle("g3", 1, 2); setObstacle("g3", 1, 3);
    const path = planPath("g3", 0, 0, 2, 0);
    // Path should go around or not be found if fully blocked
    expect(path.pathId).toMatch(/^path-/);
  });

  it("stores paths", () => {
    createGrid("g4", 3, 3);
    planPath("g4", 0, 0, 2, 2);
    expect(getPaths().length).toBe(1);
  });
});

// ─── collisionDetector ────────────────────────────────────────────────────────
describe("collisionDetector", () => {
  beforeEach(() => _resetCollisionDetectorForTest());

  it("registers objects", () => {
    const obj = registerObject("Wall", { x: 0, y: 0, width: 10, height: 10 });
    expect(obj.objectId).toMatch(/^co-/);
  });

  it("detects collision between overlapping objects", () => {
    const a = registerObject("A", { x: 0, y: 0, width: 10, height: 10 });
    const b = registerObject("B", { x: 5, y: 5, width: 10, height: 10 });
    const result = detectCollision(a.objectId, b.objectId);
    expect(result!.colliding).toBe(true);
    expect(result!.penetrationDepth).toBeGreaterThan(0);
  });

  it("no collision for non-overlapping objects", () => {
    const a = registerObject("A", { x: 0, y: 0, width: 5, height: 5 });
    const b = registerObject("B", { x: 20, y: 20, width: 5, height: 5 });
    const result = detectCollision(a.objectId, b.objectId);
    expect(result!.colliding).toBe(false);
  });

  it("updates position", () => {
    const obj = registerObject("Mover", { x: 0, y: 0, width: 5, height: 5 });
    updatePosition(obj.objectId, 50, 50);
    expect(obj.boundingBox.x).toBe(50);
  });

  it("detects all collisions", () => {
    const a = registerObject("A", { x: 0, y: 0, width: 10, height: 10 });
    const b = registerObject("B", { x: 5, y: 5, width: 10, height: 10 });
    const c = registerObject("C", { x: 100, y: 100, width: 5, height: 5 });
    const collisions = detectAllCollisions();
    expect(collisions.length).toBe(1);
  });
});

// ─── environmentPerceiver ─────────────────────────────────────────────────────
describe("environmentPerceiver", () => {
  beforeEach(() => _resetEnvironmentPerceiverForTest());

  it("records sensor readings", () => {
    const r = recordReading("agent-1", "visual", { brightness: 0.8 }, 0.9, { x: 0, y: 0 });
    expect(r.readingId).toMatch(/^sr-/);
  });

  it("updates perceptual model", () => {
    const model = updatePerceptualModel("agent-2", [{ objectId: "obj-1", type: "wall", distance: 5, direction: 90, confidence: 0.9 }], { x: 1, y: 1 }, 0);
    expect(model.perceivedObjects.length).toBe(1);
  });

  it("filters perceived objects by distance", () => {
    updatePerceptualModel("agent-3", [
      { objectId: "near", type: "box", distance: 3, direction: 0, confidence: 0.9 },
      { objectId: "far", type: "wall", distance: 20, direction: 180, confidence: 0.7 },
    ], { x: 0, y: 0 }, 0);
    const nearby = getPerceivedObjects("agent-3", 10);
    expect(nearby.length).toBe(1);
    expect(nearby[0].objectId).toBe("near");
  });

  it("retrieves readings by sensor type", () => {
    recordReading("agent-4", "visual", {}, 0.8, { x: 0, y: 0 });
    recordReading("agent-4", "auditory", {}, 0.7, { x: 0, y: 0 });
    expect(getReadings("agent-4", "visual").length).toBe(1);
  });
});

// ─── actionExecutor ───────────────────────────────────────────────────────────
describe("actionExecutor", () => {
  beforeEach(() => _resetActionExecutorForTest());

  it("registers an agent", () => {
    const state = registerActionAgent("agent-1");
    expect(state.energy).toBe(100);
  });

  it("queues an action", () => {
    registerActionAgent("agent-2");
    const action = queueAction("agent-2", "move", { dx: 5, dy: 0 });
    expect(action).not.toBeNull();
    expect(action!.status).toBe("pending");
  });

  it("executes move action and updates position", () => {
    registerActionAgent("agent-3", { x: 0, y: 0 });
    queueAction("agent-3", "move", { dx: 3, dy: 4 });
    executeNextAction("agent-3");
    expect(getAgentState("agent-3")!.position).toEqual({ x: 3, y: 4 });
  });

  it("consumes energy on action", () => {
    registerActionAgent("agent-4");
    queueAction("agent-4", "move", {});
    executeNextAction("agent-4");
    expect(getAgentState("agent-4")!.energy).toBeLessThan(100);
  });

  it("fails action when out of energy", () => {
    registerActionAgent("agent-5", { x: 0, y: 0 }, 0);
    queueAction("agent-5", "move", {});
    const result = executeNextAction("agent-5");
    expect(result!.status).toBe("failed");
  });
});

// ─── embodiedAgent ────────────────────────────────────────────────────────────
describe("embodiedAgent", () => {
  beforeEach(() => _resetEmbodiedAgentForTest());

  it("creates an embodied agent", () => {
    const status = createEmbodiedAgent({ agentId: "robot-1", name: "R1", maxEnergy: 100, sensorRange: 10, movementSpeed: 1, capabilities: ["move"] });
    expect(status.mode).toBe("idle");
    expect(status.energy).toBe(100);
  });

  it("sets a goal and enters navigating mode", () => {
    createEmbodiedAgent({ agentId: "robot-2", name: "R2", maxEnergy: 100, sensorRange: 10, movementSpeed: 2, capabilities: [] });
    setGoal("robot-2", { x: 10, y: 0 });
    expect(getStatus("robot-2")!.mode).toBe("navigating");
    expect(getStatus("robot-2")!.distanceToGoal).toBe(10);
  });

  it("steps toward goal and reduces distance", () => {
    createEmbodiedAgent({ agentId: "robot-3", name: "R3", maxEnergy: 100, sensorRange: 10, movementSpeed: 1, capabilities: [] });
    setGoal("robot-3", { x: 5, y: 0 });
    stepTowardGoal("robot-3");
    expect(getStatus("robot-3")!.distanceToGoal!).toBeLessThan(5);
  });

  it("interacts with objects", () => {
    createEmbodiedAgent({ agentId: "robot-4", name: "R4", maxEnergy: 100, sensorRange: 10, movementSpeed: 1, capabilities: [] });
    interact("robot-4", "door-1");
    expect(getStatus("robot-4")!.objectsInteracted).toBe(1);
  });

  it("restores energy on rest", () => {
    createEmbodiedAgent({ agentId: "robot-5", name: "R5", maxEnergy: 100, sensorRange: 10, movementSpeed: 1, capabilities: [] });
    const status = getStatus("robot-5")!;
    status.energy = 50;
    rest("robot-5");
    expect(getStatus("robot-5")!.energy).toBeGreaterThan(50);
  });
});
