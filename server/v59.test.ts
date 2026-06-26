/**
 * v59.test.ts — The Prediction Engine
 */
import { describe, it, expect, beforeEach } from "vitest";
import { predictShortTerm, getShortTermPredictions, _resetShortTermPredictorForTest } from "./shortTermPredictor";
import { forecastLongTerm, getForecasts, _resetLongTermForecasterForTest } from "./longTermForecaster";
import { propagateUncertainty, _resetUncertaintyPropagatorForTest } from "./uncertaintyPropagator";
import { addPredictionOutcome, evaluateCalibration, _resetPredictionCalibratorForTest } from "./predictionCalibrator";
import { simulateScenarios, getSimulations, _resetScenarioSimulatorForTest } from "./scenarioSimulator";
import { ensemblePredictions, _resetPredictionEnsemblerForTest } from "./predictionEnsembler";

beforeEach(() => {
  _resetShortTermPredictorForTest();
  _resetLongTermForecasterForTest();
  _resetUncertaintyPropagatorForTest();
  _resetPredictionCalibratorForTest();
  _resetScenarioSimulatorForTest();
  _resetPredictionEnsemblerForTest();
});

describe("shortTermPredictor", () => {
  it("predicts future values from history", () => {
    const pred = predictShortTerm("series-1", [10, 12, 11, 13, 14], 3);
    expect(pred.predictedValues).toHaveLength(3);
    expect(pred.confidence).toBeGreaterThan(0);
  });

  it("throws on empty history", () => {
    expect(() => predictShortTerm("s", [], 3)).toThrow();
  });

  it("retrieves predictions by series id", () => {
    predictShortTerm("s1", [1, 2, 3], 2);
    predictShortTerm("s2", [4, 5, 6], 2);
    expect(getShortTermPredictions("s1")).toHaveLength(1);
    expect(getShortTermPredictions("s2")).toHaveLength(1);
  });
});

describe("longTermForecaster", () => {
  it("forecasts with positive trend", () => {
    const history = Array.from({ length: 24 }, (_, i) => 100 + i * 2);
    const forecast = forecastLongTerm("trend-series", history, 12);
    expect(forecast.trendSlope).toBeGreaterThan(0);
    expect(forecast.forecastValues).toHaveLength(12);
    expect(forecast.rSquared).toBeGreaterThan(0.9);
  });

  it("throws with fewer than 2 data points", () => {
    expect(() => forecastLongTerm("s", [5], 3)).toThrow();
  });

  it("computes R-squared for flat series", () => {
    const history = Array(12).fill(50);
    const forecast = forecastLongTerm("flat", history, 6);
    expect(forecast.rSquared).toBeGreaterThanOrEqual(0);
  });
});

describe("uncertaintyPropagator", () => {
  it("propagates uncertainty across horizon", () => {
    const result = propagateUncertainty([10, 11, 12], 0.5);
    expect(result.outputBounds.length).toBeGreaterThan(0);
    expect(result.propagationFactor).toBeGreaterThan(1);
  });

  it("wider bounds for later predictions", () => {
    const result = propagateUncertainty([10, 11, 12, 13, 14], 1.0, [0.95]);
    const bounds95 = result.outputBounds.filter(b => b.confidenceLevel === 0.95);
    const firstWidth = bounds95[0].upper - bounds95[0].lower;
    const lastWidth = bounds95[bounds95.length - 1].upper - bounds95[bounds95.length - 1].lower;
    expect(lastWidth).toBeGreaterThan(firstWidth);
  });
});

describe("predictionCalibrator", () => {
  it("evaluates coverage rate", () => {
    for (let i = 0; i < 20; i++) {
      addPredictionOutcome({ predicted: 10, actual: 10 + (i % 3 - 1) * 0.5, lowerBound: 8, upperBound: 12 });
    }
    const result = evaluateCalibration(0.95);
    expect(result.coverageRate).toBe(1.0);
    expect(result.isWellCalibrated).toBe(true);
  });

  it("detects poor calibration", () => {
    for (let i = 0; i < 20; i++) {
      addPredictionOutcome({ predicted: 10, actual: 10 + (i % 2 === 0 ? 5 : -5), lowerBound: 9, upperBound: 11 });
    }
    const result = evaluateCalibration(0.95);
    expect(result.isWellCalibrated).toBe(false);
  });

  it("throws with no outcomes", () => {
    expect(() => evaluateCalibration()).toThrow();
  });
});

describe("scenarioSimulator", () => {
  it("simulates scenarios and computes expected value", () => {
    const result = simulateScenarios(100, [
      { name: "Bull", probability: 0.3, multiplier: 1.5, assumptions: ["Growth"] },
      { name: "Base", probability: 0.5, multiplier: 1.0, assumptions: ["Stable"] },
      { name: "Bear", probability: 0.2, multiplier: 0.6, assumptions: ["Recession"] },
    ]);
    expect(result.scenarios).toHaveLength(3);
    expect(result.expectedValue).toBeGreaterThan(0);
    expect(result.bestCase).toBe(150);
    expect(result.worstCase).toBe(60);
  });

  it("normalizes probabilities to sum to 1", () => {
    const result = simulateScenarios(50, [
      { name: "A", probability: 2, multiplier: 1.2, assumptions: [] },
      { name: "B", probability: 2, multiplier: 0.8, assumptions: [] },
    ]);
    const totalProb = result.scenarios.reduce((s, sc) => s + sc.probability, 0);
    expect(totalProb).toBeCloseTo(1.0, 5);
  });
});

describe("predictionEnsembler", () => {
  it("ensembles multiple model predictions", () => {
    const result = ensemblePredictions([
      { modelId: "m1", predictions: [10, 11, 12], weight: 0.5, historicalAccuracy: 0.8 },
      { modelId: "m2", predictions: [12, 13, 14], weight: 0.5, historicalAccuracy: 0.75 },
    ]);
    expect(result.ensembledPredictions).toHaveLength(3);
    expect(result.ensembledPredictions[0]).toBeCloseTo(11, 1);
    expect(result.diversityScore).toBeGreaterThan(0);
  });

  it("weights models by their weight parameter", () => {
    const result = ensemblePredictions([
      { modelId: "heavy", predictions: [100], weight: 0.9, historicalAccuracy: 0.9 },
      { modelId: "light", predictions: [0], weight: 0.1, historicalAccuracy: 0.5 },
    ]);
    expect(result.ensembledPredictions[0]).toBeCloseTo(90, 0);
  });

  it("throws with no models", () => {
    expect(() => ensemblePredictions([])).toThrow();
  });
});
