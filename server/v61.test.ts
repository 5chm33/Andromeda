/**
 * v61.test.ts — The Optimization Core
 */
import { describe, it, expect, beforeEach } from "vitest";
import { optimizeGradientDescent, _resetGradientDescentOptimizerForTest } from "./gradientDescentOptimizer";
import { optimizeBayesian, _resetBayesianOptimizerForTest } from "./bayesianOptimizer";
import { optimizeEvolutionary, _resetEvolutionaryOptimizerForTest } from "./evolutionaryOptimizer";
import { optimizeSimulatedAnnealing, _resetSimulatedAnnealingEngineForTest } from "./simulatedAnnealingEngine";
import { optimizePSO, _resetParticleSwarmOptimizerForTest } from "./particleSwarmOptimizer";
import { ensembleOptimizers, getEnsembles, _resetOptimizationEnsemblerForTest } from "./optimizationEnsembler";

beforeEach(() => {
  _resetGradientDescentOptimizerForTest();
  _resetBayesianOptimizerForTest();
  _resetEvolutionaryOptimizerForTest();
  _resetSimulatedAnnealingEngineForTest();
  _resetParticleSwarmOptimizerForTest();
  _resetOptimizationEnsemblerForTest();
});

describe("gradientDescentOptimizer", () => {
  it("minimizes a simple quadratic function", () => {
    // f(x) = (x - 3)^2, minimum at x=3
    const result = optimizeGradientDescent(
      [0],
      (p) => Math.pow(p[0] - 3, 2),
      (p) => [2 * (p[0] - 3)],
      { learningRate: 0.1, maxIterations: 200 }
    );
    expect(result.finalParams[0]).toBeCloseTo(3, 0);
    expect(result.finalLoss).toBeLessThan(0.1);
  });

  it("detects convergence", () => {
    const result = optimizeGradientDescent(
      [5],
      (p) => Math.pow(p[0] - 5, 2),
      (p) => [2 * (p[0] - 5)],
      { learningRate: 0.5, tolerance: 1e-4 }
    );
    expect(result.converged).toBe(true);
  });
});

describe("bayesianOptimizer", () => {
  it("finds near-optimal value in search space", () => {
    // maximize f(x) = -(x-2)^2 + 4, peak at x=2
    const result = optimizeBayesian(
      (p) => -Math.pow(p[0] - 2, 2) + 4,
      [{ min: -5, max: 5 }],
      25
    );
    expect(result.bestValue).toBeGreaterThan(2);
    expect(result.observations.length).toBe(25);
  });

  it("respects search space bounds", () => {
    const result = optimizeBayesian(
      (p) => p[0],
      [{ min: 0, max: 1 }],
      10
    );
    for (const obs of result.observations) {
      expect(obs.params[0]).toBeGreaterThanOrEqual(0);
      expect(obs.params[0]).toBeLessThanOrEqual(1);
    }
  });
});

describe("evolutionaryOptimizer", () => {
  it("maximizes a fitness function", () => {
    // maximize f(x) = -(x-5)^2 + 25, peak at x=5
    const result = optimizeEvolutionary(
      (genes) => -Math.pow(genes[0] - 5, 2) + 25,
      [[-10, 10]],
      30, 50
    );
    expect(result.bestIndividual.fitness).toBeGreaterThan(20);
    expect(result.bestIndividual.genes[0]).toBeCloseTo(5, 0);
  });

  it("returns population size and generation count", () => {
    const result = optimizeEvolutionary(
      (genes) => genes[0],
      [[0, 1]],
      20, 10
    );
    expect(result.populationSize).toBe(20);
    expect(result.generations).toBe(10);
  });
});

describe("simulatedAnnealingEngine", () => {
  it("minimizes a simple energy function", () => {
    const result = optimizeSimulatedAnnealing(
      (s) => Math.pow(s[0] - 3, 2),
      [10],
      (s) => [s[0] + (Math.random() - 0.5) * 0.5],
      50, 0.99, 500
    );
    expect(result.bestEnergy).toBeLessThan(5);
    expect(result.acceptanceRate).toBeGreaterThan(0);
    expect(result.acceptanceRate).toBeLessThanOrEqual(1);
  });

  it("tracks final temperature", () => {
    const result = optimizeSimulatedAnnealing(
      (s) => Math.pow(s[0], 2),
      [5],
      (s) => [s[0] + (Math.random() - 0.5)],
      100, 0.9, 100
    );
    expect(result.finalTemperature).toBeLessThan(100);
  });
});

describe("particleSwarmOptimizer", () => {
  it("maximizes a fitness function", () => {
    // maximize f(x) = -(x-4)^2 + 16
    const result = optimizePSO(
      (pos) => -Math.pow(pos[0] - 4, 2) + 16,
      [[-10, 10]],
      20, 50
    );
    expect(result.globalBestFitness).toBeGreaterThan(10);
    expect(result.swarmSize).toBe(20);
  });

  it("respects bounds", () => {
    const result = optimizePSO(
      (pos) => pos[0],
      [[0, 5]],
      10, 20
    );
    expect(result.globalBestPosition[0]).toBeGreaterThanOrEqual(0);
    expect(result.globalBestPosition[0]).toBeLessThanOrEqual(5);
  });
});

describe("optimizationEnsembler", () => {
  it("selects the best optimizer result", () => {
    const results = [
      { optimizerId: "gd", bestValue: 0.85, bestParams: [3.1], runtime: 10 },
      { optimizerId: "bo", bestValue: 0.92, bestParams: [3.0], runtime: 30 },
      { optimizerId: "evo", bestValue: 0.78, bestParams: [2.9], runtime: 50 },
    ];
    const ensemble = ensembleOptimizers(results, 0.5);
    expect(ensemble.winner.optimizerId).toBe("bo");
    expect(ensemble.improvementOverBaseline).toBeCloseTo(0.42, 2);
  });

  it("computes consensus params as mean", () => {
    const results = [
      { optimizerId: "a", bestValue: 1.0, bestParams: [2.0, 4.0], runtime: 5 },
      { optimizerId: "b", bestValue: 0.9, bestParams: [4.0, 6.0], runtime: 5 },
    ];
    const ensemble = ensembleOptimizers(results, 0);
    expect(ensemble.consensusParams[0]).toBeCloseTo(3.0, 5);
    expect(ensemble.consensusParams[1]).toBeCloseTo(5.0, 5);
  });

  it("throws with no results", () => {
    expect(() => ensembleOptimizers([], 0)).toThrow();
  });
});
