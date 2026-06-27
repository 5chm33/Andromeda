/**
 * ethicsEngine.ts — v93.0.0 "Ethical Reasoning & AI Safety"
 * Core ethics engine that evaluates actions against ethical principles and frameworks.
 */
export type EthicalFramework = "utilitarian" | "deontological" | "virtue_ethics" | "care_ethics" | "contractualist";
export type EthicalVerdict = "approved" | "conditional" | "flagged" | "rejected";

export interface EthicalPrinciple {
  principleId: string;
  name: string;
  framework: EthicalFramework;
  description: string;
  weight: number;
}

export interface EthicalEvaluation {
  evaluationId: string;
  actionDescription: string;
  agentId: string;
  principleScores: Record<string, number>;
  overallScore: number;
  verdict: EthicalVerdict;
  rationale: string;
  evaluatedAt: number;
}

const principles: EthicalPrinciple[] = [];
const evaluations: EthicalEvaluation[] = [];
let principleCounter = 0;
let evalCounter = 0;

export function addPrinciple(name: string, framework: EthicalFramework, description: string, weight = 1.0): EthicalPrinciple {
  const principle: EthicalPrinciple = { principleId: `ep-${++principleCounter}`, name, framework, description, weight };
  principles.push(principle);
  return principle;
}

export function evaluateAction(agentId: string, actionDescription: string, principleScores: Record<string, number>): EthicalEvaluation {
  const totalWeight = principles.reduce((s, p) => s + p.weight, 0) || 1;
  let weightedScore = 0;
  for (const p of principles) {
    const score = principleScores[p.principleId] ?? 0.5;
    weightedScore += score * p.weight;
  }
  const overallScore = totalWeight > 0 ? weightedScore / totalWeight : 0.5;

  let verdict: EthicalVerdict;
  let rationale: string;
  if (overallScore >= 0.8) { verdict = "approved"; rationale = "Action aligns well with ethical principles."; }
  else if (overallScore >= 0.6) { verdict = "conditional"; rationale = "Action is acceptable with caveats."; }
  else if (overallScore >= 0.4) { verdict = "flagged"; rationale = "Action raises ethical concerns requiring review."; }
  else { verdict = "rejected"; rationale = "Action violates core ethical principles."; }

  const evaluation: EthicalEvaluation = { evaluationId: `ee-${++evalCounter}`, actionDescription, agentId, principleScores, overallScore, verdict, rationale, evaluatedAt: Date.now() };
  evaluations.push(evaluation);
  return evaluation;
}

export function getPrinciples(framework?: EthicalFramework): EthicalPrinciple[] { return framework ? principles.filter(p => p.framework === framework) : [...principles]; }
export function getEvaluations(agentId?: string): EthicalEvaluation[] { return agentId ? evaluations.filter(e => e.agentId === agentId) : [...evaluations]; }
export function _resetEthicsEngineForTest(): void { principles.length = 0; evaluations.length = 0; principleCounter = 0; evalCounter = 0; }
