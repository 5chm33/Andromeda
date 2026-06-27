/**
 * interventionEngine.ts — v98.0.0 "Causal Inference & Counterfactual Reasoning"
 * Models do-calculus interventions: P(Y | do(X=x)).
 */
export interface Variable { name: string; value: number; isIntervened: boolean; }
export interface Intervention { interventionId: string; targetVariable: string; setValue: number; timestamp: number; }
export interface InterventionResult {
  resultId: string;
  interventionId: string;
  preInterventionValues: Record<string, number>;
  postInterventionValues: Record<string, number>;
  estimatedEffect: number;
  confidence: number;
}

const variables = new Map<string, Variable>();
const interventions: Intervention[] = [];
const results: InterventionResult[] = [];
let interventionCounter = 0;
let resultCounter = 0;

export function registerVariable(name: string, value: number): Variable {
  const v: Variable = { name, value, isIntervened: false };
  variables.set(name, v);
  return v;
}

export function intervene(targetVariable: string, setValue: number): Intervention | null {
  const v = variables.get(targetVariable);
  if (!v) return null;
  const intervention: Intervention = { interventionId: `int-${++interventionCounter}`, targetVariable, setValue, timestamp: Date.now() };
  interventions.push(intervention);
  v.value = setValue;
  v.isIntervened = true;
  return intervention;
}

export function measureEffect(interventionId: string, outcomeVariable: string, preValues: Record<string, number>, postValues: Record<string, number>): InterventionResult {
  const preOutcome = preValues[outcomeVariable] ?? 0;
  const postOutcome = postValues[outcomeVariable] ?? 0;
  const estimatedEffect = postOutcome - preOutcome;
  const confidence = Math.min(1.0, 0.9 - Math.abs(estimatedEffect) * 0.05);

  const result: InterventionResult = { resultId: `ir-${++resultCounter}`, interventionId, preInterventionValues: preValues, postInterventionValues: postValues, estimatedEffect, confidence };
  results.push(result);
  return result;
}

export function removeIntervention(targetVariable: string): void {
  const v = variables.get(targetVariable);
  if (v) v.isIntervened = false;
}

export function getVariable(name: string): Variable | undefined { return variables.get(name); }
export function getInterventions(): Intervention[] { return [...interventions]; }
export function getResults(): InterventionResult[] { return [...results]; }
export function _resetInterventionEngineForTest(): void { variables.clear(); interventions.length = 0; results.length = 0; interventionCounter = 0; resultCounter = 0; }
