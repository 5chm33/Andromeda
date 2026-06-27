/**
 * v96.test.ts — Quantum-Inspired Optimization
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createSession, step, getSession, _resetAnnealingSchedulerForTest } from "./annealingScheduler";
import { initializePopulation, evolveGeneration, getState, _resetPopulationEvolverForTest } from "./populationEvolver";
import { addPoint, analyzeLandscape, getPoints, getLatestAnalysis, _resetFitnessLandscapeMapperForTest } from "./fitnessLandscapeMapper";
import { addObjective, addSolution, computeParetoFront, getBestByObjective, getSolutions, _resetParetoOptimizerForTest } from "./paretoOptimizer";
import { createExperiment, suggestTrial, reportTrialResult, getExperiment, _resetHyperparameterTunerForTest } from "./hyperparameterTuner";

// ─── annealingScheduler ───────────────────────────────────────────────────────
describe("annealingScheduler", () => {
  beforeEach(() => _resetAnnealingSchedulerForTest());

  it("creates an annealing session", () => {
    const state = createSession({ initialTemperature: 100, finalTemperature: 0.1, coolingSchedule: "exponential", maxIterations: 1000, coolingRate: 0.99 });
    expect(state.sessionId).toMatch(/^ann-/);
    expect(state.currentTemperature).toBe(100);
  });

  it("accepts better solutions", () => {
    const state = createSession({ initialTemperature: 100, finalTemperature: 0.1, coolingSchedule: "exponential", maxIterations: 100, coolingRate: 0.99 });
    state.currentEnergy = 10;
    const { accepted } = step(state.sessionId, 5, "better");
    expect(accepted).toBe(true);
  });

  it("cools temperature on each step", () => {
    const state = createSession({ initialTemperature: 100, finalTemperature: 0.1, coolingSchedule: "exponential", maxIterations: 100, coolingRate: 0.9 });
    state.currentEnergy = 10;
    step(state.sessionId, 10, "same");
    expect(getSession(state.sessionId)!.currentTemperature).toBeLessThan(100);
  });

  it("tracks best solution", () => {
    const state = createSession({ initialTemperature: 100, finalTemperature: 0.1, coolingSchedule: "exponential", maxIterations: 100, coolingRate: 0.99 });
    state.currentEnergy = 10;
    step(state.sessionId, 3, "best_so_far");
    expect(getSession(state.sessionId)!.bestEnergy).toBe(3);
    expect(getSession(state.sessionId)!.bestSolution).toBe("best_so_far");
  });

  it("converges after max iterations", () => {
    const state = createSession({ initialTemperature: 1, finalTemperature: 0.1, coolingSchedule: "linear", maxIterations: 2, coolingRate: 0.5 });
    state.currentEnergy = 5;
    step(state.sessionId, 5, "s1");
    step(state.sessionId, 5, "s2");
    expect(getSession(state.sessionId)!.converged).toBe(true);
  });
});

// ─── populationEvolver ────────────────────────────────────────────────────────
describe("populationEvolver", () => {
  beforeEach(() => _resetPopulationEvolverForTest());

  const fitness = (genes: number[]) => -genes.reduce((s, g) => s + (g - 0.5) ** 2, 0);

  it("initializes population", () => {
    const state = initializePopulation({ populationSize: 10, mutationRate: 0.01, crossoverRate: 0.7, elitismCount: 2, maxGenerations: 50 }, 5, fitness);
    expect(state.stateId).toMatch(/^evo-/);
    expect(state.population.length).toBe(10);
  });

  it("evolves a generation", () => {
    const state = initializePopulation({ populationSize: 10, mutationRate: 0.01, crossoverRate: 0.7, elitismCount: 2, maxGenerations: 50 }, 5, fitness);
    evolveGeneration(state.stateId, fitness);
    expect(getState(state.stateId)!.generation).toBe(1);
  });

  it("tracks best individual", () => {
    const state = initializePopulation({ populationSize: 20, mutationRate: 0.05, crossoverRate: 0.8, elitismCount: 2, maxGenerations: 100 }, 3, fitness);
    expect(state.bestIndividual).not.toBeNull();
    expect(state.bestIndividual!.fitness).toBeDefined();
  });

  it("converges after max generations", () => {
    const state = initializePopulation({ populationSize: 5, mutationRate: 0.1, crossoverRate: 0.5, elitismCount: 1, maxGenerations: 2 }, 3, fitness);
    evolveGeneration(state.stateId, fitness);
    evolveGeneration(state.stateId, fitness);
    expect(getState(state.stateId)!.converged).toBe(true);
  });
});

// ─── fitnessLandscapeMapper ───────────────────────────────────────────────────
describe("fitnessLandscapeMapper", () => {
  beforeEach(() => _resetFitnessLandscapeMapperForTest());

  it("adds landscape points", () => {
    addPoint([0.5, 0.5], 0.8);
    expect(getPoints().length).toBe(1);
  });

  it("identifies global optimum", () => {
    addPoint([0.1, 0.1], 0.3);
    addPoint([0.5, 0.5], 0.9);
    addPoint([0.9, 0.9], 0.4);
    const analysis = analyzeLandscape();
    expect(analysis.globalOptimum!.fitness).toBe(0.9);
  });

  it("detects multimodal landscape", () => {
    addPoint([0.1], 0.2);
    addPoint([0.3], 0.8);
    addPoint([0.5], 0.3);
    addPoint([0.7], 0.85);
    addPoint([0.9], 0.2);
    const analysis = analyzeLandscape();
    expect(["bimodal", "multimodal"]).toContain(analysis.modality);
  });

  it("returns latest analysis", () => {
    addPoint([0.5], 0.5);
    analyzeLandscape();
    expect(getLatestAnalysis()).not.toBeNull();
  });

  it("handles empty landscape", () => {
    const analysis = analyzeLandscape();
    expect(analysis.totalPoints).toBe(0);
    expect(analysis.globalOptimum).toBeNull();
  });
});

// ─── paretoOptimizer ──────────────────────────────────────────────────────────
describe("paretoOptimizer", () => {
  beforeEach(() => _resetParetoOptimizerForTest());

  it("adds objectives", () => {
    const obj = addObjective("speed", false, 1.0);
    expect(obj.name).toBe("speed");
    expect(obj.minimize).toBe(false);
  });

  it("adds solutions", () => {
    const sol = addSolution({ x: 0.5 }, { speed: 0.8, cost: 0.3 });
    expect(sol.solutionId).toMatch(/^sol-/);
  });

  it("computes pareto front", () => {
    addObjective("speed", false);
    addObjective("cost", true);
    addSolution({}, { speed: 0.9, cost: 0.8 }); // fast but expensive
    addSolution({}, { speed: 0.5, cost: 0.2 }); // slow but cheap
    addSolution({}, { speed: 0.3, cost: 0.9 }); // dominated
    const front = computeParetoFront();
    expect(front.solutions.length).toBe(2); // dominated solution excluded
  });

  it("finds best by objective", () => {
    addObjective("accuracy", false);
    addSolution({}, { accuracy: 0.7 });
    addSolution({}, { accuracy: 0.95 });
    const best = getBestByObjective("accuracy");
    expect(best!.objectiveValues["accuracy"]).toBe(0.95);
  });

  it("returns all solutions", () => {
    addSolution({}, { x: 1 });
    addSolution({}, { x: 2 });
    expect(getSolutions().length).toBe(2);
  });
});

// ─── hyperparameterTuner ──────────────────────────────────────────────────────
describe("hyperparameterTuner", () => {
  beforeEach(() => _resetHyperparameterTunerForTest());

  it("creates an experiment", () => {
    const exp = createExperiment("LR Tuning", "bayesian", [{ name: "lr", type: "continuous", min: 0.0001, max: 0.1, logScale: true }], "accuracy");
    expect(exp.experimentId).toMatch(/^exp-/);
    expect(exp.strategy).toBe("bayesian");
  });

  it("suggests a trial", () => {
    const exp = createExperiment("Test", "random", [{ name: "n_layers", type: "discrete", min: 1, max: 5 }], "loss", false);
    const trial = suggestTrial(exp.experimentId);
    expect(trial).not.toBeNull();
    expect(trial!.parameters["n_layers"]).toBeGreaterThanOrEqual(1);
  });

  it("reports trial result", () => {
    const exp = createExperiment("Test2", "random", [{ name: "lr", type: "continuous", min: 0.001, max: 0.1 }], "accuracy");
    const trial = suggestTrial(exp.experimentId)!;
    reportTrialResult(trial.trialId, 0.92);
    expect(trial.score).toBe(0.92);
    expect(trial.status).toBe("completed");
  });

  it("tracks best trial", () => {
    const exp = createExperiment("Best", "random", [{ name: "x", type: "continuous", min: 0, max: 1 }], "score");
    const t1 = suggestTrial(exp.experimentId)!;
    const t2 = suggestTrial(exp.experimentId)!;
    reportTrialResult(t1.trialId, 0.7);
    reportTrialResult(t2.trialId, 0.95);
    expect(getExperiment(exp.experimentId)!.bestTrial!.score).toBe(0.95);
  });

  it("samples categorical parameters", () => {
    const exp = createExperiment("Cat", "grid", [{ name: "optimizer", type: "categorical", choices: ["adam", "sgd", "rmsprop"] }], "loss", false);
    const trial = suggestTrial(exp.experimentId)!;
    expect(["adam", "sgd", "rmsprop"]).toContain(trial.parameters["optimizer"]);
  });
});
