/**
 * pragmaticReasoner.ts — v94.0.0 "Emergent Communication & Language Grounding"
 * Reasons about speaker intent, implicature, and context beyond literal meaning.
 */
export type SpeechAct = "assertion" | "question" | "request" | "promise" | "warning" | "greeting" | "apology";
export type ImplicatureType = "scalar" | "conversational" | "conventional";

export interface PragmaticAnalysis {
  analysisId: string;
  utterance: string;
  speakerId: string;
  literalMeaning: string;
  impliedMeaning: string;
  speechAct: SpeechAct;
  implicatures: Array<{ type: ImplicatureType; content: string; confidence: number }>;
  contextDependencies: string[];
  pragmaticScore: number;
  analyzedAt: number;
}

const analyses: PragmaticAnalysis[] = [];
let analysisCounter = 0;

const speechActPatterns: Array<{ pattern: RegExp; act: SpeechAct }> = [
  { pattern: /^(can|could|would|please|help)/i, act: "request" },
  { pattern: /\?$/, act: "question" },
  { pattern: /^(i promise|i will|i'll)/i, act: "promise" },
  { pattern: /^(warning|beware|careful)/i, act: "warning" },
  { pattern: /^(hello|hi|hey|good morning)/i, act: "greeting" },
  { pattern: /^(sorry|apolog|forgive)/i, act: "apology" },
];

function detectSpeechAct(utterance: string): SpeechAct {
  for (const { pattern, act } of speechActPatterns) {
    if (pattern.test(utterance.trim())) return act;
  }
  return "assertion";
}

export function analyzeUtterance(utterance: string, speakerId: string, context: Record<string, unknown> = {}): PragmaticAnalysis {
  const speechAct = detectSpeechAct(utterance);
  const implicatures: PragmaticAnalysis["implicatures"] = [];
  const contextDependencies: string[] = [];

  // Simple implicature detection
  if (utterance.toLowerCase().includes("some")) {
    implicatures.push({ type: "scalar", content: "Not all (scalar implicature from 'some')", confidence: 0.8 });
  }
  if (utterance.toLowerCase().includes("can you")) {
    implicatures.push({ type: "conversational", content: "Speaker is requesting action, not asking about ability", confidence: 0.9 });
  }

  // Context dependencies
  if (context["previousTopic"]) contextDependencies.push(`Refers to previous topic: ${context["previousTopic"]}`);
  if (context["sharedKnowledge"]) contextDependencies.push("Relies on shared background knowledge");

  const pragmaticScore = 0.5 + implicatures.length * 0.1 + (speechAct !== "assertion" ? 0.2 : 0);

  const analysis: PragmaticAnalysis = {
    analysisId: `pa-${++analysisCounter}`,
    utterance, speakerId,
    literalMeaning: utterance,
    impliedMeaning: implicatures.map(i => i.content).join("; ") || utterance,
    speechAct, implicatures, contextDependencies,
    pragmaticScore: Math.min(1.0, pragmaticScore),
    analyzedAt: Date.now(),
  };
  analyses.push(analysis);
  return analysis;
}

export function getAnalyses(speakerId?: string): PragmaticAnalysis[] { return speakerId ? analyses.filter(a => a.speakerId === speakerId) : [...analyses]; }
export function _resetPragmaticReasonerForTest(): void { analyses.length = 0; analysisCounter = 0; }
