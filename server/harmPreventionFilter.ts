/**
 * harmPreventionFilter.ts — v93.0.0 "Ethical Reasoning & AI Safety"
 * Multi-layer harm prevention filter that screens outputs for potential harm.
 */
export type HarmCategory = "physical" | "psychological" | "financial" | "privacy" | "societal" | "environmental";
export type FilterDecision = "allow" | "modify" | "block";

export interface HarmPattern {
  patternId: string;
  category: HarmCategory;
  pattern: string;
  severity: number;
  description: string;
}

export interface FilterResult {
  resultId: string;
  input: string;
  decision: FilterDecision;
  detectedPatterns: Array<{ patternId: string; category: HarmCategory; severity: number }>;
  harmScore: number;
  modifiedOutput: string | null;
  explanation: string;
  filteredAt: number;
}

const patterns: HarmPattern[] = [];
const results: FilterResult[] = [];
let patternCounter = 0;
let resultCounter = 0;

export function addHarmPattern(category: HarmCategory, pattern: string, severity: number, description: string): HarmPattern {
  const hp: HarmPattern = { patternId: `hp-${++patternCounter}`, category, pattern, severity, description };
  patterns.push(hp);
  return hp;
}

export function filterContent(input: string): FilterResult {
  const detected: FilterResult["detectedPatterns"] = [];
  let harmScore = 0;

  for (const pattern of patterns) {
    if (input.toLowerCase().includes(pattern.pattern.toLowerCase())) {
      detected.push({ patternId: pattern.patternId, category: pattern.category, severity: pattern.severity });
      harmScore = Math.max(harmScore, pattern.severity);
    }
  }

  let decision: FilterDecision;
  let modifiedOutput: string | null = null;
  let explanation: string;

  if (harmScore >= 0.8) { decision = "block"; explanation = `Content blocked: high harm score (${harmScore.toFixed(2)})`; }
  else if (harmScore >= 0.4) {
    decision = "modify";
    modifiedOutput = input;
    for (const d of detected) {
      const pattern = patterns.find(p => p.patternId === d.patternId);
      if (pattern) modifiedOutput = modifiedOutput.replace(new RegExp(pattern.pattern, "gi"), "[REDACTED]");
    }
    explanation = `Content modified: moderate harm detected`;
  } else {
    decision = "allow";
    explanation = "Content passed harm filter";
  }

  const result: FilterResult = { resultId: `fr-${++resultCounter}`, input, decision, detectedPatterns: detected, harmScore, modifiedOutput, explanation, filteredAt: Date.now() };
  results.push(result);
  return result;
}

export function getPatterns(category?: HarmCategory): HarmPattern[] { return category ? patterns.filter(p => p.category === category) : [...patterns]; }
export function getFilterResults(decision?: FilterDecision): FilterResult[] { return decision ? results.filter(r => r.decision === decision) : [...results]; }
export function _resetHarmPreventionFilterForTest(): void { patterns.length = 0; results.length = 0; patternCounter = 0; resultCounter = 0; }
