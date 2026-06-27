/**
 * languageGrounder.ts — v94.0.0 "Emergent Communication & Language Grounding"
 * Grounds language symbols to perceptual and conceptual representations.
 */
export interface GroundedSymbol {
  symbolId: string;
  word: string;
  perceptualFeatures: Record<string, number>;
  conceptualFeatures: Record<string, unknown>;
  groundingConfidence: number;
  usageCount: number;
  lastUsedAt: number;
}

export interface GroundingResult {
  resultId: string;
  input: string;
  groundedSymbols: GroundedSymbol[];
  overallGroundingScore: number;
  ungroundedTokens: string[];
  timestamp: number;
}

const symbols = new Map<string, GroundedSymbol>();
const results: GroundingResult[] = [];
let symbolCounter = 0;
let resultCounter = 0;

export function groundSymbol(word: string, perceptualFeatures: Record<string, number>, conceptualFeatures: Record<string, unknown>, confidence = 0.8): GroundedSymbol {
  const existing = [...symbols.values()].find(s => s.word.toLowerCase() === word.toLowerCase());
  if (existing) {
    existing.perceptualFeatures = { ...existing.perceptualFeatures, ...perceptualFeatures };
    existing.conceptualFeatures = { ...existing.conceptualFeatures, ...conceptualFeatures };
    existing.groundingConfidence = Math.max(existing.groundingConfidence, confidence);
    return existing;
  }
  const symbol: GroundedSymbol = { symbolId: `gs-${++symbolCounter}`, word, perceptualFeatures, conceptualFeatures, groundingConfidence: confidence, usageCount: 0, lastUsedAt: Date.now() };
  symbols.set(symbol.symbolId, symbol);
  return symbol;
}

export function groundText(text: string): GroundingResult {
  const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  const groundedSymbols: GroundedSymbol[] = [];
  const ungroundedTokens: string[] = [];

  for (const token of tokens) {
    const symbol = [...symbols.values()].find(s => s.word.toLowerCase() === token);
    if (symbol) { symbol.usageCount++; symbol.lastUsedAt = Date.now(); groundedSymbols.push(symbol); }
    else ungroundedTokens.push(token);
  }

  const overallGroundingScore = tokens.length > 0 ? groundedSymbols.length / tokens.length : 0;
  const result: GroundingResult = { resultId: `gr-${++resultCounter}`, input: text, groundedSymbols, overallGroundingScore, ungroundedTokens, timestamp: Date.now() };
  results.push(result);
  return result;
}

export function getSymbol(word: string): GroundedSymbol | null { return [...symbols.values()].find(s => s.word.toLowerCase() === word.toLowerCase()) ?? null; }
export function getAllSymbols(): GroundedSymbol[] { return [...symbols.values()]; }
export function _resetLanguageGrounderForTest(): void { symbols.clear(); results.length = 0; symbolCounter = 0; resultCounter = 0; }
