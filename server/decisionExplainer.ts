/**
 * decisionExplainer.ts — v88.0.0 "Explainability & Interpretability"
 * Generates human-readable explanations for model decisions using rule extraction.
 */
export interface DecisionRule {
  ruleId: string;
  conditions: Array<{ feature: string; operator: string; value: number | string }>;
  prediction: string;
  confidence: number;
  support: number;
  coverage: number;
}

export interface DecisionExplanation {
  explanationId: string;
  inputId: string;
  prediction: string;
  confidence: number;
  primaryReason: string;
  supportingFactors: string[];
  contradictingFactors: string[];
  rules: DecisionRule[];
  naturalLanguage: string;
  computedAt: number;
}

const explanations: DecisionExplanation[] = [];
let explCounter = 0;
let ruleCounter = 0;

export function extractRule(conditions: DecisionRule["conditions"], prediction: string, confidence: number, support = 0.1, coverage = 0.2): DecisionRule {
  return { ruleId: `rule-${++ruleCounter}`, conditions, prediction, confidence, support, coverage };
}

export function explainDecision(inputId: string, prediction: string, confidence: number, featureValues: Record<string, number>, rules: DecisionRule[]): DecisionExplanation {
  const matchingRules = rules.filter(rule => {
    return rule.conditions.every(cond => {
      const val = featureValues[cond.feature];
      if (val === undefined) return false;
      switch (cond.operator) {
        case ">": return val > Number(cond.value);
        case "<": return val < Number(cond.value);
        case ">=": return val >= Number(cond.value);
        case "<=": return val <= Number(cond.value);
        case "==": return val === Number(cond.value);
        default: return false;
      }
    });
  });

  const sortedFeatures = Object.entries(featureValues).sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));
  const supportingFactors = sortedFeatures.filter(([, v]) => v > 0).slice(0, 3).map(([k]) => `${k} is high`);
  const contradictingFactors = sortedFeatures.filter(([, v]) => v < 0).slice(0, 2).map(([k]) => `${k} is low`);
  const primaryReason = sortedFeatures[0] ? `${sortedFeatures[0][0]} is the most influential factor` : "No dominant factor identified";

  const naturalLanguage = `The model predicted "${prediction}" with ${(confidence * 100).toFixed(1)}% confidence. ${primaryReason}. ${supportingFactors.length > 0 ? `Supporting factors: ${supportingFactors.join(", ")}.` : ""} ${contradictingFactors.length > 0 ? `Contradicting factors: ${contradictingFactors.join(", ")}.` : ""}`.trim();

  const explanation: DecisionExplanation = {
    explanationId: `exp-${++explCounter}`,
    inputId, prediction, confidence,
    primaryReason, supportingFactors, contradictingFactors,
    rules: matchingRules,
    naturalLanguage,
    computedAt: Date.now(),
  };
  explanations.push(explanation);
  return explanation;
}

export function getExplanation(explanationId: string): DecisionExplanation | undefined { return explanations.find(e => e.explanationId === explanationId); }
export function getExplanationsForInput(inputId: string): DecisionExplanation[] { return explanations.filter(e => e.inputId === inputId); }
export function _resetDecisionExplainerForTest(): void { explanations.length = 0; explCounter = 0; ruleCounter = 0; }
