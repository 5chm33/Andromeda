/**
 * scenarioSimulator.ts — v59.0.0 "The Prediction Engine"
 * Simulates multiple future scenarios with probability-weighted outcomes.
 */

export interface Scenario { scenarioId: string; name: string; probability: number; keyAssumptions: string[]; projectedOutcome: number; }
export interface SimulationResult { simId: string; scenarios: Scenario[]; expectedValue: number; bestCase: number; worstCase: number; }
const simulations: SimulationResult[] = [];
let simCounter = 0;

export function simulateScenarios(baseValue: number, scenarioSpecs: Array<{ name: string; probability: number; multiplier: number; assumptions: string[] }>): SimulationResult {
  const total = scenarioSpecs.reduce((s, sc) => s + sc.probability, 0);
  const scenarios: Scenario[] = scenarioSpecs.map((spec, i) => ({
    scenarioId: `sc-${simCounter}-${i}`,
    name: spec.name,
    probability: spec.probability / total,
    keyAssumptions: spec.assumptions,
    projectedOutcome: baseValue * spec.multiplier,
  }));
  const expectedValue = scenarios.reduce((s, sc) => s + sc.probability * sc.projectedOutcome, 0);
  const outcomes = scenarios.map(sc => sc.projectedOutcome);
  const result: SimulationResult = { simId: `sim-${++simCounter}`, scenarios, expectedValue, bestCase: Math.max(...outcomes), worstCase: Math.min(...outcomes) };
  simulations.push(result);
  return result;
}

export function getSimulations(): SimulationResult[] { return [...simulations]; }
export function _resetScenarioSimulatorForTest(): void { simulations.length = 0; simCounter = 0; }
