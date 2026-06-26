/**
 * abductiveHypothesisEngine.ts — v57.0.0 "The Reasoning Engine"
 * Generates best-explanation hypotheses from observations (abductive reasoning).
 */

export interface Evidence { id: string; description: string; strength: number; }
export interface Hypothesis {
  hypothesisId: string;
  explanation: string;
  supportingEvidence: string[];
  plausibilityScore: number;
  simplicity: number;  // Occam's razor: fewer assumptions = higher simplicity
  rank: number;
}

const hypotheses: Hypothesis[] = [];
let hypCounter = 0;

export function generateHypotheses(evidence: Evidence[], explanationCandidates: string[]): Hypothesis[] {
  const newHyps: Hypothesis[] = [];
  for (let i = 0; i < explanationCandidates.length; i++) {
    const candidate = explanationCandidates[i];
    const supporting = evidence.filter(e => e.strength > 0.5).map(e => e.id);
    const avgStrength = evidence.reduce((s, e) => s + e.strength, 0) / (evidence.length || 1);
    const simplicity = 1 / (i + 1);  // earlier candidates assumed simpler
    const hyp: Hypothesis = {
      hypothesisId: `hyp-${++hypCounter}`,
      explanation: candidate,
      supportingEvidence: supporting,
      plausibilityScore: avgStrength * simplicity,
      simplicity,
      rank: i + 1,
    };
    hypotheses.push(hyp);
    newHyps.push(hyp);
  }
  return newHyps.sort((a, b) => b.plausibilityScore - a.plausibilityScore);
}

export function getBestHypothesis(): Hypothesis | null {
  return hypotheses.sort((a, b) => b.plausibilityScore - a.plausibilityScore)[0] ?? null;
}

export function _resetAbductiveHypothesisEngineForTest(): void { hypotheses.length = 0; hypCounter = 0; }
