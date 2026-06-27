/**
 * universalReasoningEngine.ts — v100.0.0 "Andromeda: The Complete Autonomous AI System"
 * Unified reasoning engine integrating deductive, inductive, abductive, and analogical reasoning.
 */
export type ReasoningMode = "deductive" | "inductive" | "abductive" | "analogical" | "causal" | "probabilistic";
export interface Premise { premiseId: string; content: string; confidence: number; type: "fact" | "rule" | "observation" | "hypothesis"; }
export interface ReasoningChain {
  chainId: string;
  mode: ReasoningMode;
  premises: Premise[];
  conclusion: string;
  confidence: number;
  steps: string[];
  valid: boolean;
  timestamp: number;
}

const premises = new Map<string, Premise>();
const chains: ReasoningChain[] = [];
let premiseCounter = 0;
let chainCounter = 0;

export function addPremise(content: string, confidence: number, type: Premise["type"] = "fact"): Premise {
  const premise: Premise = { premiseId: `pr-${++premiseCounter}`, content, confidence, type };
  premises.set(premise.premiseId, premise);
  return premise;
}

export function reason(mode: ReasoningMode, premiseIds: string[], conclusion: string): ReasoningChain {
  const usedPremises = premiseIds.map(id => premises.get(id)).filter(Boolean) as Premise[];
  const steps: string[] = [];
  let confidence = 1.0;

  switch (mode) {
    case "deductive":
      steps.push("Apply universal rules to specific cases");
      confidence = usedPremises.reduce((min, p) => Math.min(min, p.confidence), 1.0);
      break;
    case "inductive":
      steps.push("Generalize from specific observations");
      confidence = usedPremises.length > 0 ? usedPremises.reduce((s, p) => s + p.confidence, 0) / usedPremises.length * 0.8 : 0;
      break;
    case "abductive":
      steps.push("Infer best explanation for observations");
      confidence = usedPremises.length > 0 ? Math.max(...usedPremises.map(p => p.confidence)) * 0.7 : 0;
      break;
    case "analogical":
      steps.push("Map structure from source to target domain");
      confidence = usedPremises.length >= 2 ? (usedPremises[0].confidence + usedPremises[1].confidence) / 2 * 0.75 : 0;
      break;
    case "causal":
      steps.push("Trace cause-effect relationships");
      confidence = usedPremises.reduce((prod, p) => prod * p.confidence, 1.0);
      break;
    case "probabilistic":
      steps.push("Combine evidence using probability calculus");
      confidence = 1 - usedPremises.reduce((prod, p) => prod * (1 - p.confidence), 1.0);
      break;
  }

  const valid = confidence > 0.3 && usedPremises.length > 0;
  const chain: ReasoningChain = { chainId: `rc-${++chainCounter}`, mode, premises: usedPremises, conclusion, confidence, steps, valid, timestamp: Date.now() };
  chains.push(chain);
  return chain;
}

export function getChains(mode?: ReasoningMode): ReasoningChain[] { return mode ? chains.filter(c => c.mode === mode) : [...chains]; }
export function getPremises(): Premise[] { return [...premises.values()]; }
export function _resetUniversalReasoningEngineForTest(): void { premises.clear(); chains.length = 0; premiseCounter = 0; chainCounter = 0; }
