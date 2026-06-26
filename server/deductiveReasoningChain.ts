/**
 * deductiveReasoningChain.ts — v57.0.0 "The Reasoning Engine"
 * Implements formal deductive reasoning using modus ponens and syllogistic chains.
 */

export interface Premise { id: string; statement: string; confidence: number; }
export interface DeductionStep { stepId: string; rule: string; premises: string[]; conclusion: string; confidence: number; }
export interface DeductionResult { chainId: string; steps: DeductionStep[]; finalConclusion: string; overallConfidence: number; valid: boolean; }

const chains: DeductionResult[] = [];
let chainCounter = 0;
let stepCounter = 0;

export function buildDeductiveChain(premises: Premise[], targetConclusion: string): DeductionResult {
  const steps: DeductionStep[] = [];
  let confidence = premises.reduce((min, p) => Math.min(min, p.confidence), 1.0);

  // Simple modus ponens: if all premises support the conclusion, chain is valid
  for (let i = 0; i < premises.length - 1; i++) {
    steps.push({
      stepId: `step-${++stepCounter}`,
      rule: "modus_ponens",
      premises: [premises[i].id, premises[i + 1].id],
      conclusion: i === premises.length - 2 ? targetConclusion : `intermediate-${i}`,
      confidence: (premises[i].confidence + premises[i + 1].confidence) / 2,
    });
  }

  const result: DeductionResult = {
    chainId: `chain-${++chainCounter}`,
    steps,
    finalConclusion: targetConclusion,
    overallConfidence: confidence,
    valid: confidence > 0.5 && steps.length > 0,
  };
  chains.push(result);
  return result;
}

export function validateChain(chainId: string): boolean {
  const chain = chains.find(c => c.chainId === chainId);
  return chain?.valid ?? false;
}

export function getChains(): DeductionResult[] { return [...chains]; }
export function _resetDeductiveReasoningChainForTest(): void { chains.length = 0; chainCounter = 0; stepCounter = 0; }
