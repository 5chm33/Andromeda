/**
 * v87.test.ts — Simulation & Game Theory
 * Comprehensive tests for all 6 v87 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createSimulation, scheduleEvent, stepSimulation, runSimulation, getSimulation, _resetSimulationEngineForTest } from "./simulationEngine";
import { createGame, startGame, applyAction, updateScore, endGame, getGame, getCurrentPlayer, _resetGameStateManagerForTest } from "./gameStateManager";
import { defineRewardFunction, calculateReward, getCumulativeReward, getAverageReward, getRewardHistory, _resetRewardCalculatorForTest } from "./rewardCalculator";
import { createPolicy, selectAction, updatePolicy, getQTable, getPolicy, _resetPolicyOptimizerForTest } from "./policyOptimizer";
import { createEnvironment, addState, addTransition, step, reset, getEnvironment, _resetEnvironmentModelForTest } from "./environmentModel";
import { createMCTSTree, expandNode, backpropagate, selectBestAction, getNode, getTreeSize, _resetMonteCarloForTest } from "./monteCarloPlanner";

// ─── simulationEngine ────────────────────────────────────────────────────────
describe("simulationEngine", () => {
  beforeEach(() => _resetSimulationEngineForTest());

  it("creates a simulation", () => {
    const sim = createSimulation("Traffic Sim");
    expect(sim.simId).toMatch(/^sim-/);
    expect(sim.status).toBe("idle");
  });

  it("schedules and processes events", () => {
    const sim = createSimulation("Test");
    scheduleEvent(sim.simId, 10, "arrival", { carId: "c1" });
    scheduleEvent(sim.simId, 20, "departure", { carId: "c1" });
    const processed = stepSimulation(sim.simId);
    expect(processed.length).toBe(1);
    expect(processed[0].type).toBe("arrival");
  });

  it("runs to completion", () => {
    const sim = createSimulation("Short");
    scheduleEvent(sim.simId, 1, "event1");
    scheduleEvent(sim.simId, 2, "event2");
    runSimulation(sim.simId);
    expect(getSimulation(sim.simId)?.status).toBe("completed");
  });

  it("tracks metrics", () => {
    const sim = createSimulation("Metrics");
    scheduleEvent(sim.simId, 1, "click");
    scheduleEvent(sim.simId, 2, "click");
    scheduleEvent(sim.simId, 3, "view");
    runSimulation(sim.simId);
    expect(getSimulation(sim.simId)?.metrics["click"]).toBe(2);
    expect(getSimulation(sim.simId)?.metrics["view"]).toBe(1);
  });

  it("processes events in time order", () => {
    const sim = createSimulation("Order");
    scheduleEvent(sim.simId, 30, "late");
    scheduleEvent(sim.simId, 5, "early");
    const first = stepSimulation(sim.simId);
    expect(first[0].type).toBe("early");
  });

  it("resets cleanly", () => {
    createSimulation("X");
    _resetSimulationEngineForTest();
    expect(getSimulation("sim-1")).toBeUndefined();
  });
});

// ─── gameStateManager ────────────────────────────────────────────────────────
describe("gameStateManager", () => {
  beforeEach(() => _resetGameStateManagerForTest());

  it("creates a game with players", () => {
    const game = createGame("Chess", ["Alice", "Bob"]);
    expect(game.players.length).toBe(2);
    expect(game.phase).toBe("setup");
  });

  it("starts a game", () => {
    const game = createGame("Chess", ["Alice", "Bob"]);
    expect(startGame(game.gameId)).toBe(true);
    expect(getGame(game.gameId)?.phase).toBe("playing");
  });

  it("applies actions in turn order", () => {
    const game = createGame("TicTacToe", ["Alice", "Bob"]);
    startGame(game.gameId);
    const p1 = getCurrentPlayer(game.gameId)!;
    applyAction(game.gameId, p1.playerId, "move_center");
    expect(game.turnNumber).toBe(1);
  });

  it("updates scores", () => {
    const game = createGame("Points", ["Alice"]);
    startGame(game.gameId);
    updateScore(game.gameId, game.players[0].playerId, 10);
    expect(getGame(game.gameId)?.players[0].score).toBe(10);
  });

  it("ends game with winner", () => {
    const game = createGame("Race", ["Alice", "Bob"]);
    startGame(game.gameId);
    updateScore(game.gameId, game.players[0].playerId, 100);
    endGame(game.gameId);
    expect(getGame(game.gameId)?.phase).toBe("ended");
    expect(getGame(game.gameId)?.winner).toBe(game.players[0].playerId);
  });

  it("resets cleanly", () => {
    createGame("X", ["A"]);
    _resetGameStateManagerForTest();
    expect(getGame("game-1")).toBeUndefined();
  });
});

// ─── rewardCalculator ────────────────────────────────────────────────────────
describe("rewardCalculator", () => {
  beforeEach(() => _resetRewardCalculatorForTest());

  it("defines and calculates reward", () => {
    const fn = defineRewardFunction("basic", "dense", { goal_reached: 10, step_penalty: -0.1 });
    const signal = calculateReward(fn.functionId, "agent-1", "s1", "move_right", { goal_reached: 1, step_penalty: 1 });
    expect(signal).not.toBeNull();
    expect(signal!.rawReward).toBeCloseTo(9.9, 1);
  });

  it("accumulates cumulative reward", () => {
    const fn = defineRewardFunction("acc", "dense", { score: 5 });
    calculateReward(fn.functionId, "agent-1", "s1", "a1", { score: 1 });
    calculateReward(fn.functionId, "agent-1", "s2", "a2", { score: 1 });
    expect(getCumulativeReward("agent-1")).toBeCloseTo(10, 1);
  });

  it("computes average reward", () => {
    const fn = defineRewardFunction("avg", "dense", { x: 1 });
    calculateReward(fn.functionId, "agent-2", "s1", "a1", { x: 4 });
    calculateReward(fn.functionId, "agent-2", "s2", "a2", { x: 6 });
    expect(getAverageReward("agent-2")).toBe(5);
  });

  it("returns null for unknown function", () => {
    expect(calculateReward("unknown", "a", "s", "act", {})).toBeNull();
  });

  it("filters history by agent", () => {
    const fn = defineRewardFunction("f", "sparse", { r: 1 });
    calculateReward(fn.functionId, "agent-A", "s1", "a1", { r: 1 });
    calculateReward(fn.functionId, "agent-B", "s1", "a1", { r: 1 });
    expect(getRewardHistory("agent-A").length).toBe(1);
  });
});

// ─── policyOptimizer ─────────────────────────────────────────────────────────
describe("policyOptimizer", () => {
  beforeEach(() => _resetPolicyOptimizerForTest());

  it("creates a policy", () => {
    const pol = createPolicy("QLearner");
    expect(pol.policyId).toMatch(/^pol-/);
    expect(pol.epsilon).toBe(1.0);
  });

  it("selects action (greedy after update)", () => {
    const pol = createPolicy("Greedy", 0.5, 0.99, 0); // epsilon=0 for greedy
    updatePolicy(pol.policyId, "s1", "right", 10, "s2", ["left", "right"]);
    const action = selectAction(pol.policyId, "s1", ["left", "right"]);
    expect(action).toBe("right");
  });

  it("updates Q-values", () => {
    const pol = createPolicy("Q", 0.5, 0.99, 0);
    const step = updatePolicy(pol.policyId, "s1", "up", 5, "s2", ["up", "down"]);
    expect(step).not.toBeNull();
    expect(step!.qAfter).toBeGreaterThan(step!.qBefore);
  });

  it("decays epsilon", () => {
    const pol = createPolicy("Decay", 0.1, 0.99, 1.0, 0.5, 0.01);
    const epsilonBefore = pol.epsilon;
    updatePolicy(pol.policyId, "s1", "a1", 1, "s2", ["a1"]);
    expect(getPolicy(pol.policyId)!.epsilon).toBeLessThan(epsilonBefore);
  });

  it("returns Q table", () => {
    const pol = createPolicy("Table", 1.0, 0.99, 0);
    updatePolicy(pol.policyId, "s1", "a1", 5, "s2", []);
    const qt = getQTable(pol.policyId);
    expect(qt["s1"]).toBeDefined();
  });
});

// ─── environmentModel ────────────────────────────────────────────────────────
describe("environmentModel", () => {
  beforeEach(() => _resetEnvironmentModelForTest());

  it("creates environment with states", () => {
    const env = createEnvironment("GridWorld");
    addState(env.envId, "s0", { x: 0, y: 0 });
    addState(env.envId, "s1", { x: 1, y: 0 });
    expect(getEnvironment(env.envId)?.states.size).toBe(2);
  });

  it("steps through transitions", () => {
    const env = createEnvironment("Simple");
    addState(env.envId, "start", { pos: 0 });
    addState(env.envId, "end", { pos: 1 }, true);
    addTransition(env.envId, "start", "move", "end", 1.0, 10);
    const obs = step(env.envId, "move");
    expect(obs?.stateId).toBe("end");
    expect(obs?.reward).toBe(10);
    expect(obs?.isTerminal).toBe(true);
  });

  it("resets to initial state", () => {
    const env = createEnvironment("Reset");
    addState(env.envId, "s0", { v: 0 });
    addState(env.envId, "s1", { v: 1 });
    addTransition(env.envId, "s0", "go", "s1", 1.0, 1);
    step(env.envId, "go");
    const obs = reset(env.envId, "s0");
    expect(obs?.stateId).toBe("s0");
  });

  it("returns null for unknown action", () => {
    const env = createEnvironment("NoAction");
    addState(env.envId, "s0", {});
    expect(step(env.envId, "unknown")).toBeNull();
  });

  it("provides available actions in observation", () => {
    const env = createEnvironment("Actions");
    addState(env.envId, "s0", {});
    addState(env.envId, "s1", {});
    addState(env.envId, "s2", {});
    addTransition(env.envId, "s0", "left", "s1", 0.5, 0);
    addTransition(env.envId, "s0", "right", "s2", 0.5, 0);
    const obs = reset(env.envId, "s0");
    expect(obs?.availableActions.length).toBe(2);
  });
});

// ─── monteCarloPlanner ───────────────────────────────────────────────────────
describe("monteCarloPlanner", () => {
  beforeEach(() => _resetMonteCarloForTest());

  it("creates an MCTS tree", () => {
    const root = createMCTSTree("tree-1", "s0", ["left", "right"]);
    expect(root.nodeId).toMatch(/^node-/);
    expect(root.untriedActions).toContain("left");
    expect(getTreeSize("tree-1")).toBe(1);
  });

  it("expands a node", () => {
    const root = createMCTSTree("tree-2", "s0", ["up", "down"]);
    const child = expandNode("tree-2", root.nodeId, "s1", "up", ["left", "right"]);
    expect(child).not.toBeNull();
    expect(getTreeSize("tree-2")).toBe(2);
    expect(getNode("tree-2", root.nodeId)?.childIds).toContain(child!.nodeId);
  });

  it("backpropagates values", () => {
    const root = createMCTSTree("tree-3", "s0", ["a"]);
    const child = expandNode("tree-3", root.nodeId, "s1", "a", []);
    backpropagate("tree-3", child!.nodeId, 5);
    expect(getNode("tree-3", root.nodeId)?.visitCount).toBe(1);
    expect(getNode("tree-3", root.nodeId)?.totalValue).toBe(5);
  });

  it("selects best action by average value", () => {
    const root = createMCTSTree("tree-4", "s0", ["left", "right"]);
    const c1 = expandNode("tree-4", root.nodeId, "s1", "left", []);
    const c2 = expandNode("tree-4", root.nodeId, "s2", "right", []);
    backpropagate("tree-4", c1!.nodeId, 2);
    backpropagate("tree-4", c2!.nodeId, 8);
    const result = selectBestAction("tree-4", root.nodeId);
    expect(result?.bestAction).toBe("right");
  });

  it("returns null when no children", () => {
    const root = createMCTSTree("tree-5", "s0", ["a"]);
    expect(selectBestAction("tree-5", root.nodeId)).toBeNull();
  });

  it("resets cleanly", () => {
    createMCTSTree("tree-6", "s0", []);
    _resetMonteCarloForTest();
    expect(getTreeSize("tree-6")).toBe(0);
  });
});
