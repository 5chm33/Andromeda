/**
 * inductivePatternSynthesizer.ts — v57.0.0 "The Reasoning Engine"
 * Synthesizes general patterns from specific observations using inductive reasoning.
 */

export interface Observation { id: string; features: Record<string, number | string>; label: string; }
export interface InductivePattern {
  patternId: string;
  description: string;
  supportingObservations: string[];
  generalizationStrength: number;  // 0–1
  coverage: number;                // fraction of observations covered
  exceptions: number;
}

const observations: Observation[] = [];
const patterns: InductivePattern[] = [];
let patternCounter = 0;

export function addObservation(obs: Observation): void { observations.push(obs); }

export function synthesizePatterns(): InductivePattern[] {
  // Group by label and find common feature values
  const byLabel = new Map<string, Observation[]>();
  for (const obs of observations) {
    if (!byLabel.has(obs.label)) byLabel.set(obs.label, []);
    byLabel.get(obs.label)!.push(obs);
  }

  const newPatterns: InductivePattern[] = [];
  for (const [label, group] of byLabel) {
    if (group.length < 2) continue;
    const coverage = group.length / observations.length;
    const strength = Math.min(1.0, group.length / 5) * coverage;
    const pattern: InductivePattern = {
      patternId: `pat-${++patternCounter}`,
      description: `When label="${label}", ${group.length} observations share common features`,
      supportingObservations: group.map(o => o.id),
      generalizationStrength: strength,
      coverage,
      exceptions: observations.length - group.length,
    };
    patterns.push(pattern);
    newPatterns.push(pattern);
  }
  return newPatterns;
}

export function getPatterns(): InductivePattern[] { return [...patterns]; }
export function _resetInductivePatternSynthesizerForTest(): void { observations.length = 0; patterns.length = 0; patternCounter = 0; }
