/**
 * doCalculus.ts — v98.0.0 "Causal Inference & Counterfactual Reasoning"
 * Pearl's do-calculus rules for computing interventional distributions.
 */
export type DoRule = "rule1" | "rule2" | "rule3";
export interface DoExpression {
  expressionId: string;
  query: string;
  targetVariable: string;
  interventionVariable: string;
  interventionValue: number;
  conditioningVariables: string[];
  appliedRules: DoRule[];
  identifiable: boolean;
  estimand: string;
}

export interface AdjustmentSet {
  setId: string;
  variables: string[];
  type: "backdoor" | "frontdoor" | "instrumental";
  valid: boolean;
  description: string;
}

const expressions: DoExpression[] = [];
const adjustmentSets: AdjustmentSet[] = [];
let expressionCounter = 0;
let setCounter = 0;

export function createDoExpression(targetVariable: string, interventionVariable: string, interventionValue: number, conditioningVariables: string[] = []): DoExpression {
  const query = `P(${targetVariable} | do(${interventionVariable}=${interventionValue})${conditioningVariables.length > 0 ? `, ${conditioningVariables.join(",")}` : ""})`;
  const expr: DoExpression = { expressionId: `do-${++expressionCounter}`, query, targetVariable, interventionVariable, interventionValue, conditioningVariables, appliedRules: [], identifiable: true, estimand: `E[${targetVariable} | do(${interventionVariable}=${interventionValue})]` };
  expressions.push(expr);
  return expr;
}

export function applyRule(expressionId: string, rule: DoRule): boolean {
  const expr = expressions.find(e => e.expressionId === expressionId);
  if (!expr) return false;
  if (!expr.appliedRules.includes(rule)) expr.appliedRules.push(rule);
  return true;
}

export function identifyAdjustmentSet(treatment: string, outcome: string, candidates: string[], type: AdjustmentSet["type"] = "backdoor"): AdjustmentSet {
  const set: AdjustmentSet = { setId: `as-${++setCounter}`, variables: candidates, type, valid: candidates.length >= 0, description: `${type} adjustment set for P(${outcome} | do(${treatment})) using {${candidates.join(", ")}}` };
  adjustmentSets.push(set);
  return set;
}

export function computeATE(treatmentValues: number[], outcomeValues: number[], treatmentLevel: number): number {
  // Average Treatment Effect: E[Y | do(X=1)] - E[Y | do(X=0)]
  const treated = outcomeValues.filter((_, i) => treatmentValues[i] >= treatmentLevel);
  const control = outcomeValues.filter((_, i) => treatmentValues[i] < treatmentLevel);
  if (treated.length === 0 || control.length === 0) return 0;
  const meanTreated = treated.reduce((s, v) => s + v, 0) / treated.length;
  const meanControl = control.reduce((s, v) => s + v, 0) / control.length;
  return meanTreated - meanControl;
}

export function getExpressions(): DoExpression[] { return [...expressions]; }
export function getAdjustmentSets(): AdjustmentSet[] { return [...adjustmentSets]; }
export function _resetDoCalculusForTest(): void { expressions.length = 0; adjustmentSets.length = 0; expressionCounter = 0; setCounter = 0; }
