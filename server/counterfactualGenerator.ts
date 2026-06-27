/**
 * counterfactualGenerator.ts — v88.0.0 "Explainability & Interpretability"
 * Generates counterfactual explanations: "what would need to change to get a different outcome?"
 */
export interface CounterfactualChange {
  feature: string;
  originalValue: number;
  counterfactualValue: number;
  delta: number;
  relativeChange: number;
}

export interface Counterfactual {
  cfId: string;
  inputId: string;
  originalPrediction: string;
  targetPrediction: string;
  changes: CounterfactualChange[];
  feasibilityScore: number;
  proximityScore: number;
  sparsityScore: number;
  naturalLanguage: string;
  computedAt: number;
}

const counterfactuals: Counterfactual[] = [];
let cfCounter = 0;

export function generateCounterfactual(
  inputId: string,
  originalFeatures: Record<string, number>,
  originalPrediction: string,
  targetPrediction: string,
  featureRanges: Record<string, { min: number; max: number }>,
  actionableFeatures?: string[]
): Counterfactual {
  const changes: CounterfactualChange[] = [];
  const actionable = actionableFeatures ?? Object.keys(originalFeatures);

  for (const feature of actionable) {
    const range = featureRanges[feature];
    if (!range) continue;
    const original = originalFeatures[feature] ?? 0;
    // Simple heuristic: move feature toward midpoint of range
    const midpoint = (range.min + range.max) / 2;
    const target = original < midpoint ? Math.min(original * 1.5 + 1, range.max) : Math.max(original * 0.7 - 1, range.min);
    const delta = target - original;
    if (Math.abs(delta) > 0.001) {
      changes.push({ feature, originalValue: original, counterfactualValue: target, delta, relativeChange: original !== 0 ? delta / Math.abs(original) : delta });
    }
  }

  // Score metrics
  const sparsityScore = 1 - (changes.length / Object.keys(originalFeatures).length);
  const proximityScore = changes.length > 0 ? 1 / (1 + changes.reduce((s, c) => s + Math.abs(c.delta), 0) / changes.length) : 1;
  const feasibilityScore = (sparsityScore + proximityScore) / 2;

  const changeDescriptions = changes.slice(0, 3).map(c => `${c.feature} from ${c.originalValue.toFixed(2)} to ${c.counterfactualValue.toFixed(2)}`);
  const naturalLanguage = `To change the prediction from "${originalPrediction}" to "${targetPrediction}", consider: ${changeDescriptions.join("; ")}.`;

  const cf: Counterfactual = {
    cfId: `cf-${++cfCounter}`,
    inputId, originalPrediction, targetPrediction,
    changes, feasibilityScore, proximityScore, sparsityScore,
    naturalLanguage,
    computedAt: Date.now(),
  };
  counterfactuals.push(cf);
  return cf;
}

export function getCounterfactual(cfId: string): Counterfactual | undefined { return counterfactuals.find(c => c.cfId === cfId); }
export function getCounterfactualsForInput(inputId: string): Counterfactual[] { return counterfactuals.filter(c => c.inputId === inputId); }
export function _resetCounterfactualGeneratorForTest(): void { counterfactuals.length = 0; cfCounter = 0; }
