/**
 * counterfactualReasoner.ts — v98.0.0 "Causal Inference & Counterfactual Reasoning"
 * Generates and evaluates counterfactual scenarios: "What if X had been different?"
 */
export interface Scenario {
  scenarioId: string;
  name: string;
  factualValues: Record<string, number>;
  counterfactualValues: Record<string, number>;
  changedVariables: string[];
}

export interface CounterfactualQuery {
  queryId: string;
  scenarioId: string;
  question: string;
  outcomeVariable: string;
  factualOutcome: number;
  counterfactualOutcome: number;
  difference: number;
  percentageChange: number;
  plausibility: number;
}

const scenarios = new Map<string, Scenario>();
const queries: CounterfactualQuery[] = [];
let scenarioCounter = 0;
let queryCounter = 0;

export function createScenario(name: string, factualValues: Record<string, number>, counterfactualValues: Record<string, number>): Scenario {
  const changedVariables = Object.keys(counterfactualValues).filter(k => factualValues[k] !== counterfactualValues[k]);
  const scenario: Scenario = { scenarioId: `sc-${++scenarioCounter}`, name, factualValues, counterfactualValues, changedVariables };
  scenarios.set(scenario.scenarioId, scenario);
  return scenario;
}

export function query(scenarioId: string, question: string, outcomeVariable: string, computeOutcome: (values: Record<string, number>) => number): CounterfactualQuery | null {
  const scenario = scenarios.get(scenarioId);
  if (!scenario) return null;

  const factualOutcome = computeOutcome(scenario.factualValues);
  const counterfactualOutcome = computeOutcome(scenario.counterfactualValues);
  const difference = counterfactualOutcome - factualOutcome;
  const percentageChange = factualOutcome !== 0 ? (difference / Math.abs(factualOutcome)) * 100 : 0;

  // Plausibility: fewer changes = more plausible
  const plausibility = Math.max(0, 1 - scenario.changedVariables.length * 0.1);

  const q: CounterfactualQuery = { queryId: `cq-${++queryCounter}`, scenarioId, question, outcomeVariable, factualOutcome, counterfactualOutcome, difference, percentageChange, plausibility };
  queries.push(q);
  return q;
}

export function compareScenarios(scenarioAId: string, scenarioBId: string): { moreChanges: string; similarity: number } | null {
  const a = scenarios.get(scenarioAId); const b = scenarios.get(scenarioBId);
  if (!a || !b) return null;
  const allKeys = new Set([...Object.keys(a.factualValues), ...Object.keys(b.factualValues)]);
  let same = 0;
  for (const k of allKeys) { if (a.factualValues[k] === b.factualValues[k]) same++; }
  return { moreChanges: a.changedVariables.length > b.changedVariables.length ? a.scenarioId : b.scenarioId, similarity: same / allKeys.size };
}

export function getScenario(scenarioId: string): Scenario | undefined { return scenarios.get(scenarioId); }
export function getQueries(scenarioId?: string): CounterfactualQuery[] { return scenarioId ? queries.filter(q => q.scenarioId === scenarioId) : [...queries]; }
export function _resetCounterfactualReasonerForTest(): void { scenarios.clear(); queries.length = 0; scenarioCounter = 0; queryCounter = 0; }
